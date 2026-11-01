'use client'

/**
 * Command palette (Ctrl/Cmd+K): one search box over
 * - pages the user can open (role-filtered by the shell),
 * - actions (new artwork/exhibit/…, switch exhibition, theme, open the museum, sign out, shortcuts),
 * - every content item of the exhibition being edited (title or id → #/content/<tab>/<id>),
 * - makers, media files (by name → copy the URL; Ctrl/Cmd+Enter opens it) and exhibitions.
 *
 * Keyboard only: ↑/↓ move, Enter runs, Escape closes. ARIA combobox (the input) + listbox. The last
 * eight things run are remembered in this browser and shown first when the box is empty.
 * Data loads when the palette opens (content and makers are cached for a minute; media is searched
 * on the server as you type).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ContentCollection, MuseumContent } from '../museum/content/types'
import { api, can, type MediaRecord, type User } from './api'
import { type AdminArtisan, type AdminExhibition, exApi, useSelectedExhibition } from './exhibitionsApi'
import { currentExhibition, useExhibitionList, useSwitchExhibition } from './ExhibitionSwitcher'
import { safeUrl } from './safeUrl'
import { THEME_LABEL, type ThemePref } from './theme'
import { Icon, type IconName, useToast } from './ui'
import { useThemePref } from './ui/useTheme'

export interface PaletteRoute {
  id: string
  label: string
  icon: IconName
  group: string
  /** `g` shortcut key */
  key?: string
}

interface Entry {
  key: string
  group: 'Recent' | 'Pages' | 'Actions' | 'Content' | 'Makers' | 'Media' | 'Exhibitions'
  label: string
  sub?: string
  icon: IconName
  thumb?: string
  /** extra words to match */
  keywords?: string
  hint?: ReactNode
  run: (e: { ctrl: boolean }) => void | Promise<void>
  /** stored in "recent" (only navigations; actions with side effects are not replayed blindly) */
  recent?: { label: string; sub?: string; icon: IconName; href: string }
}

const COLLECTIONS: { id: ContentCollection; label: string; singular: string; icon: IconName }[] = [
  { id: 'artworks', label: 'Artworks', singular: 'artwork', icon: 'image' },
  { id: 'exhibits', label: 'Exhibits', singular: 'exhibit', icon: 'box' },
  { id: 'infographics', label: 'Infographics', singular: 'infographic panel', icon: 'file' },
  { id: 'videos', label: 'Videos', singular: 'video', icon: 'media' },
  { id: 'objects', label: 'Objects', singular: 'object', icon: 'box' },
]

const RECENT_KEY = 'museum.admin.palette.recent'
type RecentRef = NonNullable<Entry['recent']>
function readRecentRefs(): RecentRef[] {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(v) ? (v as RecentRef[]).filter((r) => r && typeof r.href === 'string' && typeof r.label === 'string').slice(0, 8) : []
  } catch {
    return []
  }
}
function rememberRef(r: RecentRef) {
  try {
    const next = [r, ...readRecentRefs().filter((x) => x.href !== r.href)].slice(0, 8)
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    /* storage blocked */
  }
}

/** Fuzzy score: prefix > word start > substring > in-order letters; -1 = no match. */
export function fuzzyScore(text: string, q: string): number {
  if (!q) return 1
  const t = text.toLowerCase()
  const i = t.indexOf(q)
  if (i === 0) return 100 - Math.min(t.length, 50) / 10
  if (i > 0) return (/[\s\-_/·(]/.test(t[i - 1]) ? 80 : 60) - i / 10
  let ti = 0
  let gaps = 0
  for (const ch of q) {
    const f = t.indexOf(ch, ti)
    if (f < 0) return -1
    gaps += f - ti
    ti = f + 1
  }
  return Math.max(1, 30 - gaps * 3)
}

function highlight(label: string, q: string): ReactNode {
  if (!q) return label
  const i = label.toLowerCase().indexOf(q)
  if (i < 0) return label
  return (
    <>
      {label.slice(0, i)}
      <mark>{label.slice(i, i + q.length)}</mark>
      {label.slice(i + q.length)}
    </>
  )
}

const asTitle = (it: Record<string, unknown>) => (typeof it.title === 'string' && it.title.trim() ? it.title : String(it.id ?? ''))
const thumbOf = (c: ContentCollection, it: Record<string, unknown>) => {
  const v = c === 'artworks' ? it.image : c === 'videos' ? it.poster : null
  return safeUrl(v, 'image')
}
const isImage = (m: MediaRecord) => m.mime.startsWith('image/')

let cache: { at: number; exhibition: string; content: MuseumContent | null; artisans: AdminArtisan[] | null } | null = null

export function CommandPalette({
  open,
  onClose,
  user,
  routes,
  go,
  onLogout,
  onShortcuts,
}: {
  open: boolean
  onClose: () => void
  user: User
  routes: PaletteRoute[]
  /** Navigate (runs the unsaved-changes check); `hash` like '#/content/artworks/x'. */
  go: (hash: string) => void
  onLogout: () => void
  onShortcuts: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [content, setContent] = useState<MuseumContent | null>(null)
  const [artisans, setArtisans] = useState<AdminArtisan[] | null>(null)
  const [media, setMedia] = useState<MediaRecord[] | null>(null)
  const [recent, setRecent] = useState<RecentRef[]>([])
  const toast = useToast()
  const selected = useSelectedExhibition()
  const exList = useExhibitionList()
  const switchTo = useSwitchExhibition()
  const [themePref, setThemePref] = useThemePref()
  const query = q.trim().toLowerCase()

  // open/close the native dialog; load data
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (!open) {
      if (d.open) d.close()
      return
    }
    if (!d.open) d.showModal()
    setQ('')
    setActive(0)
    setRecent(readRecentRefs())
    requestAnimationFrame(() => inputRef.current?.focus())
    const fresh = cache && cache.exhibition === selected && Date.now() - cache.at < 60_000
    if (fresh && cache) {
      setContent(cache.content)
      setArtisans(cache.artisans)
      return
    }
    let alive = true
    Promise.all([api.content().catch(() => null), exApi.artisans().catch(() => null)]).then(([c, a]) => {
      cache = { at: Date.now(), exhibition: selected, content: c, artisans: a }
      if (!alive) return
      setContent(c)
      setArtisans(a)
    })
    return () => {
      alive = false
    }
  }, [open, selected])

  // media: searched on the server as the query changes (debounced, late answers ignored)
  useEffect(() => {
    if (!open) return
    const ctl = { cancelled: false }
    const t = setTimeout(() => {
      api
        .mediaPage({ q: query || undefined, limit: query ? 12 : 6 })
        .then((p) => !ctl.cancelled && setMedia(p.items))
        .catch(() => !ctl.cancelled && setMedia([]))
    }, query ? 180 : 0)
    return () => {
      ctl.cancelled = true
      clearTimeout(t)
    }
  }, [open, query])

  const navigate = useCallback(
    (href: string, r?: RecentRef) => {
      if (r) rememberRef(r)
      onClose()
      go(href)
    },
    [go, onClose],
  )

  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = []
    const ex = currentExhibition(exList, selected)
    for (const p of routes) {
      const href = `#/${p.id}`
      const r = { label: p.label, icon: p.icon, href, sub: 'Page' }
      out.push({ key: `page:${p.id}`, group: 'Pages', label: p.label, sub: p.group, icon: p.icon, hint: p.key ? <><kbd>g</kbd><kbd>{p.key}</kbd></> : undefined, run: () => navigate(href, r), recent: r })
    }
    // actions
    const canContent = can(user, 'curator')
    if (canContent)
      for (const c of COLLECTIONS) {
        out.push({ key: `new:${c.id}`, group: 'Actions', label: `New ${c.singular}`, sub: ex ? `In ${ex.title}` : undefined, icon: 'plus', keywords: `create add ${c.label}`, run: () => navigate(`#/content/${c.id}/+new`) })
      }
    if (can(user, 'admin')) out.push({ key: 'new:exhibition', group: 'Actions', label: 'New exhibition', icon: 'plus', keywords: 'create add', run: () => navigate('#/exhibitions/+new') })
    if (canContent) out.push({ key: 'new:maker', group: 'Actions', label: 'New maker profile', icon: 'plus', keywords: 'create add artisan', run: () => navigate('#/makers/+new') })
    const nextTheme: ThemePref = themePref === 'light' ? 'dark' : themePref === 'dark' ? 'system' : 'light'
    out.push({ key: 'theme:toggle', group: 'Actions', label: `Theme: switch to ${THEME_LABEL[nextTheme]}`, sub: `Now ${THEME_LABEL[themePref]}`, icon: themePref === 'dark' ? 'moon' : themePref === 'light' ? 'sun' : 'monitor', keywords: 'dark light mode appearance toggle', run: () => setThemePref(nextTheme) })
    out.push({ key: 'museum', group: 'Actions', label: 'Open the museum', sub: ex ? ex.title : undefined, icon: 'external', keywords: 'gallery visit preview', run: () => {
      onClose()
      window.open(ex?.path || '/gallery', '_blank', 'noopener')
    } })
    out.push({ key: 'shortcuts', group: 'Actions', label: 'Keyboard shortcuts', icon: 'keyboard', keywords: 'help keys', run: () => {
      onClose()
      onShortcuts()
    } })
    out.push({ key: 'logout', group: 'Actions', label: 'Sign out', icon: 'logout', keywords: 'log out exit', run: () => {
      onClose()
      onLogout()
    } })
    // exhibitions
    for (const e of exList ?? []) {
      const isCurrent = ex?.id === e.id
      out.push({
        key: `ex:${e.id}`,
        group: 'Exhibitions',
        label: isCurrent ? `${e.title} (editing)` : `Switch to ${e.title}`,
        sub: [e.isDefault ? 'Default' : '', e.status === 'draft' ? 'Draft' : 'Published', `${e.items} items`].filter(Boolean).join(' · '),
        icon: 'exhibitions',
        keywords: `exhibition ${e.slug} ${e.id} ${e.title}`,
        run: async () => {
          onClose()
          await switchTo(e.id, exList as AdminExhibition[])
        },
      })
    }
    // content of the exhibition being edited
    if (content)
      for (const c of COLLECTIONS) {
        for (const raw of content[c.id] as unknown as Record<string, unknown>[]) {
          const id = String(raw.id ?? '')
          if (!id) continue
          const title = asTitle(raw)
          const href = `#/content/${c.id}/${encodeURIComponent(id)}`
          const r = { label: title, sub: `${c.label} · ${id}`, icon: c.icon, href }
          out.push({ key: `item:${c.id}:${id}`, group: 'Content', label: title, sub: `${c.label} · ${id}${raw.placeholder ? ' · needs content' : ''}`, icon: c.icon, thumb: thumbOf(c.id, raw), keywords: `${id} ${c.label}`, run: () => navigate(href, r), recent: r })
        }
      }
    for (const a of artisans ?? []) {
      const href = `#/makers/${encodeURIComponent(a.id)}`
      const r = { label: a.name || a.id, sub: 'Maker', icon: 'makers' as IconName, href }
      out.push({ key: `maker:${a.id}`, group: 'Makers', label: a.name || a.id, sub: [a.craft, a.cluster].filter(Boolean).join(' · ') || a.id, icon: 'makers', thumb: safeUrl(a.portrait, 'image'), keywords: `${a.id} ${a.craft} ${a.cluster}`, run: () => navigate(href, r), recent: r })
    }
    for (const m of media ?? []) {
      const url = safeUrl(m.url, isImage(m) ? 'image' : 'link')
      out.push({
        key: `media:${m.id}`,
        group: 'Media',
        label: m.filename,
        sub: `${m.folder ? `${m.folder} · ` : ''}${m.mime}`,
        icon: isImage(m) ? 'image' : 'file',
        thumb: isImage(m) && url ? url : undefined,
        keywords: m.url,
        hint: <>Copy · <kbd>Ctrl</kbd><kbd>↵</kbd> open</>,
        run: async ({ ctrl }) => {
          onClose()
          if (!url) return
          if (ctrl) {
            window.open(url, '_blank', 'noopener')
            return
          }
          try {
            await navigator.clipboard.writeText(url)
            toast(`Copied the address of ${m.filename}`)
          } catch {
            toast('Couldn’t copy — your browser blocked the clipboard.', 'error')
          }
        },
      })
    }
    return out
  }, [routes, user, exList, selected, content, artisans, media, themePref, navigate, onClose, onShortcuts, onLogout, setThemePref, switchTo, toast])

  // filter + rank; group order fixed, best matches first inside a group, capped per group
  const results = useMemo(() => {
    const groups: Entry['group'][] = ['Recent', 'Pages', 'Actions', 'Content', 'Makers', 'Media', 'Exhibitions']
    const caps: Record<Entry['group'], number> = { Recent: 8, Pages: query ? 6 : 20, Actions: query ? 6 : 4, Content: query ? 12 : 0, Makers: query ? 6 : 0, Media: query ? 8 : 0, Exhibitions: query ? 6 : 0 }
    const byGroup = new Map<Entry['group'], { e: Entry; s: number }[]>()
    if (!query) {
      const recentEntries: Entry[] = recent.map((r) => ({ key: `recent:${r.href}`, group: 'Recent', label: r.label, sub: r.sub, icon: r.icon, run: () => navigate(r.href, r), recent: r }))
      byGroup.set('Recent', recentEntries.map((e) => ({ e, s: 1 })))
    }
    for (const e of entries) {
      const s = Math.max(fuzzyScore(e.label, query), e.keywords ? fuzzyScore(e.keywords, query) - 25 : -1, e.sub ? fuzzyScore(e.sub, query) - 30 : -1)
      if (s < 0 || (query && s < 5)) continue
      const list = byGroup.get(e.group) ?? []
      list.push({ e, s })
      byGroup.set(e.group, list)
    }
    // with enough real (substring) matches, drop the loose in-order-letter ones
    if (query) {
      let strong = 0
      for (const l of byGroup.values()) strong += l.filter((x) => x.s >= 30).length
      if (strong >= 3) for (const [g, l] of byGroup) byGroup.set(g, l.filter((x) => x.s >= 30))
    }
    const best = (g: Entry['group']) => Math.max(0, ...(byGroup.get(g) ?? []).map((x) => x.s))
    // while typing, the group holding the best match comes first
    const order = query ? [...groups].sort((a, b) => best(b) - best(a)) : groups
    const flat: Entry[] = []
    const shownGroups: { group: Entry['group']; start: number; total: number; shown: number }[] = []
    for (const g of order) {
      const list = byGroup.get(g)
      if (!list?.length) continue
      if (query) list.sort((a, b) => b.s - a.s)
      const take = list.slice(0, caps[g])
      if (!take.length) continue
      shownGroups.push({ group: g, start: flat.length, total: list.length, shown: take.length })
      flat.push(...take.map((x) => x.e))
    }
    return { flat, shownGroups }
  }, [entries, query, recent, navigate])

  const flat = results.flat
  const activeIdx = Math.min(active, Math.max(0, flat.length - 1))
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${activeIdx}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  const runEntry = (e: Entry | undefined, ctrl = false) => {
    if (!e) return
    if (e.recent && e.group !== 'Recent') rememberRef(e.recent)
    void e.run({ ctrl })
  }

  const loadingContent = open && content === null && artisans === null
  return (
    <dialog
      ref={ref}
      className="adm-dialog cmdk"
      aria-label="Command palette"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      {open ? (
        <>
          <div className="cmdk-input-row">
            <Icon name="search" />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls="cmdk-list"
              aria-autocomplete="list"
              aria-activedescendant={flat.length ? `cmdk-opt-${activeIdx}` : undefined}
              aria-label="Search pages, actions, content, makers and media"
              placeholder="Search pages, content, makers, media… or type a command"
              autoComplete="off"
              spellCheck={false}
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setActive(0)
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setActive((a) => (flat.length ? (Math.min(a, flat.length - 1) + 1) % flat.length : 0))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setActive((a) => (flat.length ? (Math.min(a, flat.length - 1) - 1 + flat.length) % flat.length : 0))
                } else if (e.key === 'Home' && e.ctrlKey) {
                  e.preventDefault()
                  setActive(0)
                } else if (e.key === 'End' && e.ctrlKey) {
                  e.preventDefault()
                  setActive(flat.length - 1)
                } else if (e.key === 'Enter') {
                  e.preventDefault()
                  runEntry(flat[activeIdx], e.ctrlKey || e.metaKey)
                }
              }}
            />
            <kbd className="hide-phone" aria-hidden="true">Esc</kbd>
          </div>
          <ul ref={listRef} id="cmdk-list" role="listbox" className="cmdk-list" aria-label="Results">
            {flat.length === 0 ? (
              <li className="cmdk-empty" role="presentation">
                {loadingContent ? 'Loading…' : query ? <>Nothing matches “{q.trim()}”.</> : 'Type to search.'}
              </li>
            ) : (
              results.shownGroups.map((g) => (
                <li key={g.group} role="presentation">
                  <div className="cmdk-group" id={`cmdk-g-${g.group}`} aria-hidden="true">
                    {g.group}
                    {g.total > g.shown ? <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}> · {g.shown} of {g.total}, keep typing to narrow</span> : null}
                  </div>
                  <ul role="group" aria-labelledby={`cmdk-g-${g.group}`} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {flat.slice(g.start, g.start + g.shown).map((e, j) => {
                      const i = g.start + j
                      return (
                        <li
                          key={e.key}
                          id={`cmdk-opt-${i}`}
                          data-i={i}
                          role="option"
                          aria-selected={i === activeIdx}
                          className="cmdk-item"
                          onMouseMove={() => i !== activeIdx && setActive(i)}
                          onMouseDown={(ev) => ev.preventDefault()}
                          onClick={(ev) => runEntry(e, ev.ctrlKey || ev.metaKey)}
                        >
                          <span className="ci-icon" aria-hidden="true">
                            {e.thumb ? <img src={e.thumb} alt="" loading="lazy" /> : <Icon name={e.icon} />}
                          </span>
                          <span className="ci-text">
                            <span className="ci-label">{highlight(e.label, query)}</span>
                            {e.sub ? <span className="ci-sub">{e.sub}</span> : null}
                          </span>
                          {e.hint && i === activeIdx ? <span className="ci-hint hide-phone">{e.hint}</span> : null}
                        </li>
                      )
                    })}
                  </ul>
                </li>
              ))
            )}
          </ul>
          <div className="cmdk-foot" aria-hidden="true">
            <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
            <span><kbd>↵</kbd> open</span>
            <span><kbd>Esc</kbd> close</span>
            {content === null && !loadingContent ? null : <span style={{ marginLeft: 'auto' }}>{content ? `${COLLECTIONS.reduce((n, c) => n + content[c.id].length, 0)} items in this exhibition` : ''}</span>}
          </div>
        </>
      ) : null}
    </dialog>
  )
}
