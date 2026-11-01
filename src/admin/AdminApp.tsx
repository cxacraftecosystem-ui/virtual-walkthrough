'use client'

/**
 * The admin app: session check, sign-in, and the shell around every page.
 *
 * Shell
 * - Sidebar (groups of role-filtered pages, the exhibition switcher, "Open museum") and a floating
 *   top bar (page title, the command palette trigger, the account menu with the Light/Dark/System
 *   theme). Below 1024px the sidebar becomes a drawer behind a menu button (focus kept inside,
 *   Escape closes, the page behind is inert).
 * - Hash routing: `#/<page>[/…]`; an empty hash opens Home. Pages are code-split (React.lazy) and
 *   load behind a skeleton, so three.js (Capture) is fetched only when that page opens.
 * - Unsaved changes: navigating through the nav, the palette, a link or browser back/forward to
 *   another page asks first; on Cancel the address is put back.
 * - Nav badges from `api.overview()` (prints waiting, comments since the comments page was last
 *   opened, open errors), refreshed every 60 s, on window focus, on route change and on the window
 *   event 'museum-admin:overview' (a page may fire it after a change that moves a count).
 * - Keys: `/` search on the page · `?` shortcuts · `g` + key go to a page · Ctrl/Cmd+K palette.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { googleSignedOut } from '../museum/api/google'
import { SITE } from '../site'
import { api, ApiError, can, ROLE_LABEL, type Overview, type Role, type User } from './api'
import { CommandPalette, type PaletteRoute } from './CommandPalette'
import { ExhibitionSwitcher } from './ExhibitionSwitcher'
import { useSelectedExhibition } from './exhibitionsApi'
import { LoginPage } from './pages/LoginPage'
import { THEME_LABEL, type ThemePref } from './theme'
import { CountBadge, Icon, Modal, Segmented, Skeleton, ToastProvider, errMsg, hasUnsavedChanges, useConfirmLeave, type IconName } from './ui'
import { useThemeController, useThemePref } from './ui/useTheme'

export type PageId = 'home' | 'checklist' | 'activity' | 'content' | 'exhibitions' | 'makers' | 'media' | 'capture' | 'prints' | 'comments' | 'analytics' | 'errors' | 'access'
type Group = 'Overview' | 'Content' | 'Media' | 'Visitors' | 'Insights' | 'Settings'

/** Fired by pages after a change that moves a dashboard count (approving prints, resolving errors…). */
export const OVERVIEW_STALE = 'museum-admin:overview'

/**
 * Sections, their sidebar group, the minimum role that sees them (the server enforces the same
 * rules), the `g <key>` keyboard shortcut and the icon.
 */
const PAGES: { id: PageId; label: string; group: Group; min: Role; key: string; icon: IconName; masterLabel?: string }[] = [
  { id: 'home', label: 'Home', group: 'Overview', min: 'curator', key: 'h', icon: 'home' },
  { id: 'checklist', label: 'Checklist', group: 'Overview', min: 'curator', key: 'l', icon: 'checklist' },
  { id: 'activity', label: 'Activity', group: 'Overview', min: 'curator', key: 'y', icon: 'activity' },
  { id: 'content', label: 'Content', group: 'Content', min: 'curator', key: 'c', icon: 'content' },
  { id: 'exhibitions', label: 'Exhibitions', group: 'Content', min: 'curator', key: 'x', icon: 'exhibitions' },
  { id: 'makers', label: 'Makers', group: 'Content', min: 'curator', key: 'k', icon: 'makers' },
  { id: 'media', label: 'Media library', group: 'Media', min: 'curator', key: 'm', icon: 'media' },
  { id: 'capture', label: 'Capture tools', group: 'Media', min: 'curator', key: 't', icon: 'capture' },
  { id: 'prints', label: 'Visitor prints', group: 'Visitors', min: 'curator', key: 'p', icon: 'prints' },
  { id: 'comments', label: 'Comments', group: 'Visitors', min: 'admin', key: 'o', icon: 'comments' },
  { id: 'analytics', label: 'Analytics', group: 'Insights', min: 'admin', key: 'a', icon: 'analytics' },
  { id: 'errors', label: 'Errors', group: 'Insights', min: 'admin', key: 'e', icon: 'errors' },
  { id: 'access', label: 'Users', group: 'Settings', min: 'admin', key: 'u', icon: 'users', masterLabel: 'Users & access' },
]
const GROUPS: Group[] = ['Overview', 'Content', 'Media', 'Visitors', 'Insights', 'Settings']

/* ------------------------------------------------------------------ */
/* Code-split pages                                                    */
/* ------------------------------------------------------------------ */

/** A page module's component: its default export, else the named one (pages are being migrated). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pick = <P,>(m: Record<string, any>, name: string) => ({ default: (m.default ?? m[name]) as ComponentType<P> })
const HomePage = lazy(() => import('./pages/HomePage').then((m) => pick<{ user: User; overview: Overview | null; error?: string; onRefresh?: () => void }>(m, 'HomePage')))
const ChecklistPage = lazy(() => import('./pages/ChecklistPage').then((m) => pick<{ user: User }>(m, 'ChecklistPage')))
const ActivityPage = lazy(() => import('./pages/ActivityPage').then((m) => pick<{ user: User }>(m, 'ActivityPage')))
const ContentPage = lazy(() => import('./pages/ContentPage').then((m) => pick<{ canReset?: boolean }>(m, 'ContentPage')))
const ExhibitionsPage = lazy(() => import('./pages/ExhibitionsPage').then((m) => pick<{ canManage: boolean }>(m, 'ExhibitionsPage')))
const MakersPage = lazy(() => import('./pages/MakersPage').then((m) => pick<object>(m, 'MakersPage')))
const MediaPage = lazy(() => import('./pages/MediaPage').then((m) => pick<object>(m, 'MediaPage')))
const CapturePage = lazy(() => import('./pages/CapturePage').then((m) => pick<object>(m, 'CapturePage')))
const PrintsPage = lazy(() => import('./pages/PrintsPage').then((m) => pick<object>(m, 'PrintsPage')))
const CommentsPage = lazy(() => import('./pages/CommentsPage').then((m) => pick<object>(m, 'CommentsPage')))
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage').then((m) => pick<object>(m, 'AnalyticsPage')))
const ErrorsPage = lazy(() => import('./pages/ErrorsPage').then((m) => pick<object>(m, 'ErrorsPage')))
const AccessPage = lazy(() => import('./pages/AccessPage').then((m) => pick<{ me: User; canManageAccess: boolean }>(m, 'AccessPage')))

/** Warm the chunk on hover/focus of a nav link, so the click opens instantly. */
const PRELOAD: Partial<Record<PageId, () => Promise<unknown>>> = {
  home: () => import('./pages/HomePage'),
  checklist: () => import('./pages/ChecklistPage'),
  activity: () => import('./pages/ActivityPage'),
  content: () => import('./pages/ContentPage'),
  exhibitions: () => import('./pages/ExhibitionsPage'),
  makers: () => import('./pages/MakersPage'),
  media: () => import('./pages/MediaPage'),
  prints: () => import('./pages/PrintsPage'),
  comments: () => import('./pages/CommentsPage'),
  analytics: () => import('./pages/AnalyticsPage'),
  errors: () => import('./pages/ErrorsPage'),
  access: () => import('./pages/AccessPage'),
}

/* ------------------------------------------------------------------ */

const pageOf = (hash: string): PageId | null => {
  const h = hash.replace(/^#\/?/, '').split(/[/?]/)[0]
  return (PAGES.find((p) => p.id === h)?.id ?? null) as PageId | null
}

const initials = (name: string) =>
  name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('') || '?'

function BrandMark() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 20V9l9-5 9 5v11" />
      <path d="M7 20v-7M12 20v-7M17 20v-7M3 20h18" />
    </svg>
  )
}

export function AdminApp() {
  useThemeController()
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [bootError, setBootError] = useState('')

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) setUser(null)
        else {
          setUser(null)
          setBootError(e instanceof Error ? e.message : String(e))
        }
      })
  }, [])

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined)
    googleSignedOut()
    setUser(null)
  }, [])

  if (user === undefined) return <BootSkeleton />
  if (!user)
    return (
      <ToastProvider>
        <LoginPage onLogin={setUser} notice={bootError} />
      </ToastProvider>
    )
  if (!can(user, 'curator')) {
    return (
      <div className="adm-center">
        <div className="card narrow login">
          <span className="kicker">{SITE.shortName}</span>
          <h1 className="display">No staff access</h1>
          <p className="muted">
            You are signed in as <strong>{user.email}</strong>, a visitor account. Ask the museum&apos;s master admin to add your email (or your
            organisation&apos;s domain) to the access list, then sign in again with Google so your address is verified.
          </p>
          <div className="btn-row">
            <button type="button" className="btn primary" onClick={logout}>Sign out</button>
            <a className="btn" href="/gallery">Open the museum</a>
          </div>
        </div>
      </div>
    )
  }
  return (
    <ToastProvider>
      <Shell user={user} onLogout={logout} />
    </ToastProvider>
  )
}

/** First paint while the session is checked: the shell's silhouette instead of a bare "Loading…". */
function BootSkeleton() {
  return (
    <div className="adm" aria-busy="true" aria-label="Loading the admin">
      <aside className="adm-side boot">
        <div className="side-brand">
          <span className="brand-tile"><BrandMark /></span>
          <span className="brand-text">
            <span className="kicker">{SITE.shortName}</span>
            <span className="display">Museum Admin</span>
          </span>
        </div>
        <div className="skel-list" style={{ padding: '8px 4px' }}>
          {Array.from({ length: 8 }, (_, i) => <span key={i} className="skel line" />)}
        </div>
      </aside>
      <div className="adm-col">
        <div className="adm-topbar" aria-hidden="true"><span className="skel line" style={{ width: 160 }} /></div>
        <main className="adm-main">
          <Skeleton kind="page" />
        </main>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Overview polling + comment "unseen" baseline                         */
/* ------------------------------------------------------------------ */

const SEEN_KEY = 'museum.admin.comments.seen'
const WEEK = 7 * 864e5
function readSeen(): { at: number; count: number } | null {
  try {
    const v = JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? 'null') as { at?: unknown; count?: unknown } | null
    return v && typeof v.at === 'number' && typeof v.count === 'number' ? { at: v.at, count: v.count } : null
  } catch {
    return null
  }
}
function writeSeen(count: number) {
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify({ at: Date.now(), count }))
  } catch {
    /* storage blocked: the badge keeps showing the week's count */
  }
}
/** Comments in the last 7 days minus those already counted when the comments page was last opened. */
function unseenComments(comments7d: number) {
  const s = readSeen()
  if (!s || Date.now() - s.at > WEEK) return comments7d
  return Math.max(0, comments7d - s.count)
}

function useOverview(exhibition: string) {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [error, setError] = useState('')
  const gen = useRef(0)
  const refresh = useCallback(() => {
    const g = ++gen.current
    api
      .overview()
      .then((o) => {
        if (g !== gen.current) return
        setOverview(o)
        setError('')
      })
      .catch((e: unknown) => g === gen.current && setError(errMsg(e))) // keep the last good numbers
  }, [])
  useEffect(() => {
    refresh()
    const t = setInterval(() => document.visibilityState === 'visible' && refresh(), 60_000)
    const onFocus = () => refresh()
    const onVisible = () => document.visibilityState === 'visible' && refresh()
    window.addEventListener('focus', onFocus)
    window.addEventListener(OVERVIEW_STALE, onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener(OVERVIEW_STALE, onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh, exhibition])
  return { overview, error, refresh }
}

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

function Shell({ user, onLogout }: { user: User; onLogout: () => void }) {
  const exhibitionSel = useSelectedExhibition() // content pages remount per exhibition
  const [page, setPage] = useState<PageId>('home') // hash is read after mount (no window during SSR)
  const [navKey, setNavKey] = useState(0) // bumped to remount the page on an explicit re-navigation
  const [navOpen, setNavOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [help, setHelp] = useState(false)
  const [palette, setPalette] = useState(false)
  const [commentsSeenTick, setCommentsSeenTick] = useState(0)
  const leave = useConfirmLeave()
  const mainRef = useRef<HTMLElement>(null)
  const sideRef = useRef<HTMLElement>(null)
  const menuBtnRef = useRef<HTMLButtonElement>(null)
  const userBtnRef = useRef<HTMLButtonElement>(null)
  const lastHash = useRef('')
  const allowNext = useRef(false)
  const { overview, error: overviewError, refresh: refreshOverview } = useOverview(exhibitionSel)
  const [themePref, setThemePref] = useThemePref()

  const visible = useMemo(() => PAGES.filter((p) => can(user, p.min)), [user])
  const current = visible.find((p) => p.id === page) ?? visible[0]
  const isMaster = user.role === 'master'
  const labelOf = useCallback((p: (typeof PAGES)[number]) => (isMaster && p.masterLabel ? p.masterLabel : p.label), [isMaster])
  const id = current?.id ?? 'home'

  // ---- routing ------------------------------------------------------------
  const scrollTop = () => mainRef.current?.closest('.adm-root')?.scrollTo({ top: 0 })
  const applyHash = useCallback(() => {
    lastHash.current = window.location.hash
    setPage(pageOf(window.location.hash) ?? 'home')
    setNavOpen(false)
    scrollTop()
  }, [])

  useEffect(() => {
    if (!window.location.hash || !pageOf(window.location.hash)) window.history.replaceState(null, '', '#/home')
    applyHash()
    const onHash = async () => {
      if (allowNext.current) {
        allowNext.current = false
        return applyHash()
      }
      const target = window.location.hash
      const leavingPage = pageOf(target) !== pageOf(lastHash.current)
      // same-page hash changes belong to the page (it guards its own edits)
      if (!leavingPage || !hasUnsavedChanges()) return applyHash()
      // put the old address back while asking (pushState fires no hashchange)
      window.history.pushState(null, '', lastHash.current || '#/home')
      if (await leave()) {
        window.history.replaceState(null, '', target)
        applyHash()
      }
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [applyHash, leave])

  /** Navigate to a hash ('#/content/artworks/x' or a page id), asking first when edits are unsaved. */
  const go = useCallback(
    async (to: string) => {
      const hash = to.startsWith('#') ? to : `#/${to}`
      if (hash === window.location.hash) {
        setNavOpen(false)
        return
      }
      const samePage = pageOf(hash) === pageOf(window.location.hash)
      if (!(await leave())) return
      allowNext.current = true
      window.location.hash = hash.slice(1)
      if (samePage) setNavKey((k) => k + 1) // a deep link inside the open page: remount it on the new address
    },
    [leave],
  )

  useEffect(() => {
    document.title = `${current ? labelOf(current) : 'Admin'} · Museum Admin · ${SITE.shortName}`
  }, [current, labelOf])

  // refresh counts on page change; opening Comments marks this week's comments as seen
  useEffect(() => {
    refreshOverview()
  }, [id, refreshOverview])
  useEffect(() => {
    if (id === 'comments' && overview) {
      writeSeen(overview.counts.comments7d)
      setCommentsSeenTick((t) => t + 1)
    }
  }, [id, overview])

  // ---- keyboard -----------------------------------------------------------
  useEffect(() => {
    let gAt = 0
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((o) => !o)
        return
      }
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.getAttribute('role') === 'combobox')) return
      if (document.querySelector('dialog[open]')) return
      if (e.key === '/') {
        const box = mainRef.current?.querySelector<HTMLInputElement>('input[type="search"]')
        if (box) {
          e.preventDefault()
          box.focus()
          box.select()
        }
        return
      }
      if (e.key === '?') {
        e.preventDefault()
        setHelp(true)
        return
      }
      if (e.key === 'g') {
        gAt = Date.now()
        return
      }
      if (Date.now() - gAt < 1200) {
        const p = visible.find((x) => x.key === e.key.toLowerCase())
        gAt = 0
        if (p) {
          e.preventDefault()
          void go(p.id)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, go])

  // ---- account menu: outside click / Escape ------------------------------
  useEffect(() => {
    if (!menuOpen) return
    const close = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.user-card')) setMenuOpen(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setMenuOpen(false)
      userBtnRef.current?.focus()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', esc, true)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', esc, true)
    }
  }, [menuOpen])

  // ---- mobile drawer: focus in, Tab wraps, Escape closes ------------------
  useEffect(() => {
    if (!navOpen) return
    const side = sideRef.current
    const focusables = () => Array.from(side?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []).filter((el) => el.offsetParent !== null)
    requestAnimationFrame(() => (side?.querySelector<HTMLElement>('.nav-item.active') ?? focusables()[0])?.focus())
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (document.querySelector('.ui-popover')) return // an open select inside handles it
        setNavOpen(false)
        menuBtnRef.current?.focus()
        return
      }
      if (e.key !== 'Tab') return
      const els = focusables()
      if (!els.length) return
      const first = els[0]
      const last = els[els.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navOpen])

  // the drawer only exists below 1024px: close it if the window grows past that
  useEffect(() => {
    if (!navOpen) return
    const q = window.matchMedia('(min-width: 1024px)')
    const onChange = () => q.matches && setNavOpen(false)
    q.addEventListener('change', onChange)
    return () => q.removeEventListener('change', onChange)
  }, [navOpen])

  // ---- badges -------------------------------------------------------------
  const counts = overview?.counts
  const badges = useMemo<Partial<Record<PageId, ReactNode>>>(() => {
    void commentsSeenTick // re-read the seen baseline after opening Comments
    if (!counts) return {}
    const b: Partial<Record<PageId, ReactNode>> = {}
    if (can(user, 'curator') && counts.pendingPrints) b.prints = <CountBadge count={counts.pendingPrints} label="waiting for a decision" />
    if (can(user, 'admin')) {
      const unseen = unseenComments(counts.comments7d)
      if (unseen) b.comments = <CountBadge count={unseen} label="new since you last looked" tone="neutral" />
      if (counts.openErrors) b.errors = <CountBadge count={counts.openErrors} label="open" tone="danger" />
    }
    return b
  }, [counts, user, commentsSeenTick])

  // ---- page body ----------------------------------------------------------
  let body: ReactNode = null
  if (id === 'home') body = <HomePage user={user} overview={overview} error={overviewError} onRefresh={refreshOverview} />
  else if (id === 'checklist') body = <ChecklistPage key={exhibitionSel || 'default'} user={user} />
  else if (id === 'activity') body = <ActivityPage user={user} />
  else if (id === 'content') body = <ContentPage key={exhibitionSel || 'default'} canReset={can(user, 'admin')} />
  else if (id === 'exhibitions') body = <ExhibitionsPage canManage={can(user, 'admin')} />
  else if (id === 'makers') body = <MakersPage />
  else if (id === 'media') body = <MediaPage />
  else if (id === 'capture') body = <CapturePage />
  else if (id === 'prints') body = <PrintsPage />
  else if (id === 'analytics') body = <AnalyticsPage />
  else if (id === 'comments') body = <CommentsPage />
  else if (id === 'errors') body = <ErrorsPage />
  else if (id === 'access') body = <AccessPage me={user} canManageAccess={isMaster} />

  const paletteRoutes = useMemo<PaletteRoute[]>(() => visible.map((p) => ({ id: p.id, label: labelOf(p), icon: p.icon, group: p.group, key: p.key })), [visible, labelOf])
  const closePalette = useCallback(() => setPalette(false), [])
  const openHelp = useCallback(() => setHelp(true), [])
  const name = user.displayName || user.email

  return (
    <div className={`adm ${navOpen ? 'nav-open' : ''}`}>
      <a className="skip-link" href="#adm-main" onClick={(e) => {
        e.preventDefault()
        mainRef.current?.focus()
      }}>Skip to content</a>

      <div className="side-scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />
      <aside className="adm-side" id="adm-side" ref={sideRef} aria-label="Admin navigation">
        <a className="side-brand" href="#/home" onClick={(e) => {
          e.preventDefault()
          void go('home')
        }}>
          <span className="brand-tile"><BrandMark /></span>
          <span className="brand-text">
            <span className="kicker">{SITE.shortName}</span>
            <span className="display">Museum Admin</span>
          </span>
        </a>

        <div className="side-ex">
          <ExhibitionSwitcher />
        </div>

        <nav className="side-nav" aria-label="Sections">
          {GROUPS.map((g) => {
            const items = visible.filter((p) => p.group === g)
            if (!items.length) return null
            return (
              <div className="nav-group" key={g} role="group" aria-labelledby={`nav-g-${g}`}>
                <span className="nav-group-label" id={`nav-g-${g}`}>{g}</span>
                {items.map((p) => (
                  <a
                    key={p.id}
                    href={`#/${p.id}`}
                    className={id === p.id ? 'nav-item active' : 'nav-item'}
                    aria-current={id === p.id ? 'page' : undefined}
                    onMouseEnter={() => void PRELOAD[p.id]?.()}
                    onFocus={() => void PRELOAD[p.id]?.()}
                    onClick={(e) => {
                      e.preventDefault()
                      void go(p.id)
                    }}
                  >
                    <Icon name={p.icon} className="nav-icon" />
                    <span className="nav-label">{labelOf(p)}</span>
                    {badges[p.id]}
                    <kbd className="nav-kbd" aria-hidden="true">g {p.key}</kbd>
                  </a>
                ))}
              </div>
            )
          })}
        </nav>

        <div className="side-foot">
          <a className="nav-item museum-link" href="/gallery" target="_blank" rel="noreferrer">
            <Icon name="external" className="nav-icon" />
            <span className="nav-label">Open the museum</span>
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </div>
      </aside>

      <div className="adm-col" inert={navOpen || undefined}>
        <header className="adm-topbar">
          <button
            ref={menuBtnRef}
            type="button"
            className="icon-btn topbar-menu"
            onClick={() => setNavOpen((o) => !o)}
            aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={navOpen}
            aria-controls="adm-side"
          >
            <Icon name={navOpen ? 'close' : 'menu'} />
          </button>
          <div className="topbar-title">
            <span className="crumb">{current ? current.group : SITE.shortName}</span>
            <span className="here">{current ? labelOf(current) : 'Museum Admin'}</span>
          </div>
          <button type="button" className="palette-trigger" onClick={() => setPalette(true)} aria-label="Search and commands" aria-keyshortcuts="Control+K Meta+K" title="Search and commands (Ctrl K)">
            <Icon name="search" />
            <span className="label">Search or jump to…</span>
            <span className="keys" aria-hidden="true"><kbd>Ctrl</kbd><kbd>K</kbd></span>
          </button>
          <div className="user-card">
            <button ref={userBtnRef} type="button" className="user-btn" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen} aria-controls="adm-account" aria-label={`Account: ${name}, ${ROLE_LABEL[user.role]}`}>
              <span className={`avatar role-${user.role}`} aria-hidden="true">{initials(name)}</span>
              <span className="user-text" aria-hidden="true">
                <span className="user-name">{name}</span>
                <span className="user-role">{ROLE_LABEL[user.role]}</span>
              </span>
              <Icon name="chevronDown" className="chev" width={16} height={16} />
            </button>
            {menuOpen && (
              <div className="user-menu" id="adm-account" role="region" aria-label="Account">
                <div className="user-menu-head">
                  <strong className="truncate">{user.displayName || user.email}</strong>
                  <span className="muted small truncate" title={user.email}>{user.email}</span>
                  <span className={`badge role-${user.role}`} style={{ alignSelf: 'flex-start', marginTop: 4 }}>{ROLE_LABEL[user.role]}</span>
                </div>
                <div className="user-menu-section">
                  <span className="label" id="theme-label">Theme</span>
                  <Segmented<ThemePref>
                    label="Theme"
                    value={themePref}
                    onChange={setThemePref}
                    options={(['light', 'dark', 'system'] as ThemePref[]).map((v) => ({ value: v, label: THEME_LABEL[v], icon: v === 'light' ? 'sun' : v === 'dark' ? 'moon' : 'monitor' }))}
                  />
                </div>
                <button type="button" onClick={() => {
                  setMenuOpen(false)
                  setPalette(true)
                }}>
                  <Icon name="search" /><span className="grow">Search and commands</span><kbd>Ctrl K</kbd>
                </button>
                <button type="button" onClick={() => {
                  setMenuOpen(false)
                  setHelp(true)
                }}>
                  <Icon name="keyboard" /><span className="grow">Keyboard shortcuts</span><kbd>?</kbd>
                </button>
                <a href="/gallery" target="_blank" rel="noreferrer" onClick={() => setMenuOpen(false)}>
                  <Icon name="external" /><span className="grow">Open the museum</span>
                </a>
                <button type="button" className="danger-text" onClick={onLogout}>
                  <Icon name="logout" /><span className="grow">Sign out</span>
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="adm-main" id="adm-main" ref={mainRef} tabIndex={-1} key={`${id}:${navKey}`}>
          <Suspense fallback={<Skeleton kind={id === 'home' ? 'tiles' : 'page'} />}>{body}</Suspense>
        </main>
      </div>

      <CommandPalette open={palette} onClose={closePalette} user={user} routes={paletteRoutes} go={go} onLogout={onLogout} onShortcuts={openHelp} />

      {help && (
        <Modal title="Keyboard shortcuts" size="small" onClose={() => setHelp(false)}>
          <dl className="shortcuts">
            <dt><kbd>Ctrl</kbd><kbd>K</kbd></dt>
            <dd>Search and commands</dd>
            <dt><kbd>/</kbd></dt>
            <dd>Search on this page</dd>
            <dt><kbd>?</kbd></dt>
            <dd>Show this list</dd>
          </dl>
          <h3 className="sc-group" style={{ margin: '16px 0 8px' }}>Go to</h3>
          <dl className="shortcuts">
            {visible.map((p) => (
              <FragmentRow key={p.id} k={`g ${p.key}`} label={labelOf(p)} />
            ))}
          </dl>
        </Modal>
      )}
    </div>
  )
}

function FragmentRow({ k, label }: { k: string; label: string }) {
  return (
    <>
      <dt>{k.split(' ').map((x, i) => <kbd key={i}>{x}</kbd>)}</dt>
      <dd>{label}</dd>
    </>
  )
}
