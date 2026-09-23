import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ContentCollection, ExhibitionText, MuseumContent } from '../../museum/content/types'
import { resolveFrame, type FrameConfig, type FrameStyleId } from '../../museum/config/frames'
import { api, type Item, type MediaRecord } from '../api'
import { FIELDS, SURFACE_GROUPS, getPath, setPath, surfaceRange, template, type FieldDef } from '../fields'
import { MediaPicker, mediaMatches } from '../MediaPicker'
import { useExhibitionList } from '../ExhibitionSwitcher'
import { useSelectedExhibition } from '../exhibitionsApi'
import { EmptyState, Modal, PageHeader, Skeleton, errMsg, hasUnsavedChanges, useConfirm, useToast, useUnsavedGuard } from '../ui'

const COLLECTIONS: { id: ContentCollection; label: string; singular: string; hash: string }[] = [
  { id: 'artworks', label: 'Artworks', singular: 'artwork', hash: 'artwork' },
  { id: 'exhibits', label: 'Exhibits', singular: 'exhibit', hash: 'exhibit' },
  { id: 'infographics', label: 'Infographics', singular: 'infographic panel', hash: 'infographic' },
  { id: 'videos', label: 'Videos', singular: 'video', hash: 'video' },
  { id: 'objects', label: 'Objects', singular: 'object', hash: 'object' },
]
type Tab = ContentCollection | 'texts'
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/
const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)

/** `#/content/<tab>/<id>` — the content page keeps its tab + selection in the URL (shareable, survives reload). */
function readHash(): { tab: Tab; id: string | null } {
  const [, tab, id] = window.location.hash.replace(/^#\/?/, '').split('/')
  const t = (COLLECTIONS.some((c) => c.id === tab) || tab === 'texts' ? tab : 'artworks') as Tab
  return { tab: t, id: id ? decodeURIComponent(id) : null }
}
function writeHash(tab: Tab, id?: string | null) {
  const h = `#/content/${tab}${id ? `/${encodeURIComponent(id)}` : ''}`
  if (window.location.hash !== h) window.history.replaceState(null, '', h)
}

/** Where "Preview in museum" opens: the selected exhibition's museum URL. */
function useMuseumBase() {
  const list = useExhibitionList()
  const sel = useSelectedExhibition()
  const ex = list?.find((e) => e.id === sel) ?? list?.find((e) => e.isDefault)
  return ex?.path || '/gallery'
}

/** `canReset`: admins only (curators edit items but cannot bulk-reset). */
export function ContentPage({ canReset = false }: { canReset?: boolean }) {
  // only rendered client-side (after the session check), so the hash is readable on first render
  const [tab, setTabState] = useState<Tab>(() => (typeof window === 'undefined' ? 'artworks' : readHash().tab))
  const [initialId, setInitialId] = useState<string | null>(() => (typeof window === 'undefined' ? null : readHash().id))
  const [counts, setCounts] = useState<Partial<Record<ContentCollection, number>>>({})
  const [version, setVersion] = useState<number | null>(null)
  const [media, setMedia] = useState<MediaRecord[]>([])
  const [resetKey, setResetKey] = useState(0)
  const toast = useToast()
  const confirm = useConfirm()

  const refreshMeta = useCallback(() => {
    api
      .content()
      .then((c) => {
        setVersion(c.version)
        setCounts({ artworks: c.artworks.length, exhibits: c.exhibits.length, infographics: c.infographics.length, videos: c.videos.length, objects: c.objects.length })
      })
      .catch(() => undefined)
  }, [])

  const refreshMedia = useCallback(() => {
    api.media().then(setMedia).catch(() => undefined)
  }, [])

  useEffect(() => {
    refreshMeta()
    refreshMedia()
  }, [refreshMeta, refreshMedia])

  async function setTab(t: Tab) {
    if (t === tab) return
    if (hasUnsavedChanges() && !(await confirm({ title: 'Discard unsaved changes?', body: 'Switching collections will lose the edits you have not saved.', confirmLabel: 'Discard', danger: true }))) return
    setInitialId(null)
    setTabState(t)
    writeHash(t)
  }

  async function reset() {
    const ok = await confirm({
      title: 'Reset all content?',
      body: 'This replaces every artwork, exhibit, panel, video, object and text in this exhibition with the bundled defaults from the source code. Your edits will be lost.',
      confirmLabel: 'Reset content',
      danger: true,
    })
    if (!ok) return
    try {
      await api.reset()
      toast('Content reset to bundled defaults')
      refreshMeta()
      setResetKey((k) => k + 1) // remount editors → reload lists
    } catch (e) {
      toast(errMsg(e), 'error')
    }
  }

  return (
    <>
      <PageHeader
        title="Content"
        description={<>Everything a visitor sees in the galleries. Saved changes are live for new museum visits{version !== null ? <> · content version <span className="num">{version}</span></> : null}.</>}
        actions={canReset && <button className="btn danger small" onClick={reset}>Reset to defaults…</button>}
      />
      <nav className="tabs subtabs" aria-label="Collections">
        {COLLECTIONS.map((c) => (
          <button key={c.id} className={tab === c.id ? 'tab active' : 'tab'} aria-current={tab === c.id ? 'true' : undefined} onClick={() => void setTab(c.id)}>
            {c.label}
            {counts[c.id] !== undefined && <span className="count">{counts[c.id]}</span>}
          </button>
        ))}
        <button className={tab === 'texts' ? 'tab active' : 'tab'} aria-current={tab === 'texts' ? 'true' : undefined} onClick={() => void setTab('texts')}>Exhibition &amp; welcome</button>
      </nav>
      {tab === 'texts' ? (
        <TextsEditor key={`texts-${resetKey}`} onSaved={refreshMeta} />
      ) : (
        <CollectionEditor key={`${tab}-${resetKey}`} collection={tab} initialId={initialId} media={media} onMediaChanged={refreshMedia} onChanged={refreshMeta} />
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */

const itemThumb = (c: ContentCollection, i: Item): string | null => {
  const v = c === 'artworks' ? i.image : c === 'videos' ? i.poster : null
  return typeof v === 'string' && v ? v : null
}

function CollectionEditor({
  collection,
  initialId,
  media,
  onMediaChanged,
  onChanged,
}: {
  collection: ContentCollection
  initialId: string | null
  media: MediaRecord[]
  onMediaChanged: () => void
  onChanged: () => void
}) {
  const meta = COLLECTIONS.find((c) => c.id === collection)!
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [filter, setFilter] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const confirm = useConfirm()
  const museumBase = useMuseumBase()

  useEffect(() => {
    let alive = true
    setError('')
    api
      .list(collection)
      .then((list) => {
        if (!alive) return
        setItems(list)
        setSelected((s) => s ?? (initialId && list.some((i) => i.id === initialId) ? initialId : (list[0]?.id ?? null)))
      })
      .catch((e) => alive && setError(errMsg(e)))
    return () => {
      alive = false
    }
  }, [collection, initialId, reloadKey])

  useEffect(() => {
    if (selected) writeHash(collection, selected)
  }, [collection, selected])

  const current = items?.find((i) => i.id === selected) ?? null
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return (items ?? []).filter(
      (i) => !q || i.id.toLowerCase().includes(q) || String(i.title ?? '').toLowerCase().includes(q) || String(getPath(i, 'placement.surface') ?? '').includes(q),
    )
  }, [items, filter])

  async function select(id: string) {
    if (id === selected) return
    if (hasUnsavedChanges() && !(await confirm({ title: 'Discard unsaved changes?', body: `Your edits to “${String(current?.title ?? current?.id ?? '')}” have not been saved.`, confirmLabel: 'Discard', danger: true })))
      return
    // an unsaved new draft that is abandoned disappears
    setItems((list) => (list ?? []).filter((i) => i.__new !== true || i.id === id))
    setSelected(id)
  }

  function create(id: string, title: string) {
    const draft = { ...template(collection, id), ...(title ? { title } : {}) } as Item
    setItems((list) => [...(list ?? []).filter((i) => i.__new !== true), { ...draft, __new: true }])
    setSelected(id)
    setCreating(false)
  }

  function onSaved(item: Item) {
    setItems((list) => (list ?? []).map((i) => (i.id === item.id ? item : i)))
    onChanged()
  }

  function onDeleted(id: string) {
    setItems((list) => {
      const next = (list ?? []).filter((i) => i.id !== id)
      setSelected(next[0]?.id ?? null)
      return next
    })
    onChanged()
  }

  if (error)
    return (
      <div className="card">
        <EmptyState title={`Couldn’t load ${meta.label.toLowerCase()}`} icon="!" action={<button className="btn" onClick={() => setReloadKey((k) => k + 1)}>Try again</button>}>{error}</EmptyState>
      </div>
    )
  if (!items)
    return (
      <div className="editor">
        <div className="card item-list" style={{ padding: 12 }}><Skeleton kind="list" rows={7} /></div>
        <Skeleton kind="form" rows={8} />
      </div>
    )

  return (
    <div className="editor">
      <aside className="card item-list" aria-label={`${meta.label} list`}>
        <div className="list-head">
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input type="search" placeholder={`Search ${meta.label.toLowerCase()}…`} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={`Search ${meta.label}`} style={{ flex: 1 }} />
            <button className="btn small primary" onClick={() => setCreating(true)} title={`New ${meta.singular}`}>+ New</button>
          </div>
        </div>
        <ul>
          {shown.map((i) => {
            const thumb = itemThumb(collection, i)
            return (
              <li key={i.id}>
                <button className={i.id === selected ? 'active' : ''} onClick={() => void select(i.id)} aria-current={i.id === selected ? 'true' : undefined}>
                  {thumb ? <img className="li-thumb" src={thumb} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} /> : <span className="li-thumb" aria-hidden="true">{String(i.title ?? i.id).slice(0, 1).toUpperCase()}</span>}
                  <span className="li-text">
                    <span className="t">{String(i.title ?? i.id) || i.id}</span>
                    <span className="i">
                      <span className="truncate">{i.id}</span>
                      {i.placeholder === true && <span className="badge warn">placeholder</span>}
                      {i.__new === true && <span className="badge accent">unsaved</span>}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
          {shown.length === 0 && (
            <li className="empty small">
              {filter ? <>No {meta.label.toLowerCase()} match “{filter}”.</> : <>No {meta.label.toLowerCase()} yet.</>}
            </li>
          )}
        </ul>
        <div className="list-foot">
          {filter ? `${shown.length} of ${items.length}` : `${items.length} ${items.length === 1 ? meta.singular : meta.label.toLowerCase()}`}
        </div>
      </aside>
      {current ? (
        <ItemEditor key={current.id} collection={collection} item={current} museumBase={museumBase} media={media} onMediaChanged={onMediaChanged} onSaved={onSaved} onDeleted={onDeleted} />
      ) : (
        <div className="card">
          <EmptyState title={items.length ? `Select ${/^[aeiou]/.test(meta.singular) ? 'an' : 'a'} ${meta.singular}` : `No ${meta.label.toLowerCase()} yet`} action={<button className="btn primary" onClick={() => setCreating(true)}>+ New {meta.singular}</button>}>
            {items.length ? 'Pick one from the list to edit it, or create a new one.' : `Create the first ${meta.singular} for this exhibition.`}
          </EmptyState>
        </div>
      )}
      {creating && <NewItemDialog collection={collection} existing={items} onCreate={create} onClose={() => setCreating(false)} />}
    </div>
  )
}

function NewItemDialog({ collection, existing, onCreate, onClose }: { collection: ContentCollection; existing: Item[]; onCreate: (id: string, title: string) => void; onClose: () => void }) {
  const meta = COLLECTIONS.find((c) => c.id === collection)!
  const [title, setTitle] = useState('')
  const [id, setId] = useState('')
  const [idTouched, setIdTouched] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const effectiveId = idTouched ? id : slugify(title)
  const idError = !effectiveId
    ? 'An id is required'
    : !ID_RE.test(effectiveId)
      ? 'Use letters, digits, “-”, “_” or “.”, starting with a letter or digit (max 100)'
      : existing.some((i) => i.id === effectiveId)
        ? `“${effectiveId}” already exists in ${meta.label.toLowerCase()}`
        : ''
  const submit = () => {
    setSubmitted(true)
    if (!idError) onCreate(effectiveId, title.trim())
  }
  return (
    <Modal
      title={`New ${meta.singular}`}
      size="small"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={submit}>Create draft</button>
        </>
      }
    >
      <form
        className="grid-2"
        style={{ gridTemplateColumns: '1fr' }}
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label className="field">
          <span>Title</span>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`e.g. ${collection === 'artworks' ? 'Ajrakh indigo yardage' : 'Printing table'}`} data-autofocus />
        </label>
        <label className={`field ${submitted && idError ? 'invalid' : ''}`}>
          <span>Id <span className="req">*</span></span>
          <input
            type="text"
            className="mono"
            value={effectiveId}
            onChange={(e) => {
              setIdTouched(true)
              setId(e.target.value)
            }}
            spellCheck={false}
            aria-invalid={submitted && !!idError}
          />
          {submitted && idError ? <span className="error-text">{idError}</span> : <span className="hint">Permanent — used in links (/gallery#{meta.hash}=…) and analytics. Generated from the title.</span>}
        </label>
        <button hidden type="submit" />
      </form>
      <p className="muted small" style={{ marginTop: 12 }}>The draft opens in the editor. Nothing is published until you press “Create”.</p>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */

type Section = { id: string; title: string; groups: FieldDef['group'][]; collapsible?: boolean; hint?: string }
const SECTIONS: Section[] = [
  { id: 'details', title: 'Details', groups: ['Details'] },
  { id: 'media', title: 'Media', groups: ['Media'] },
  { id: 'placement', title: 'Placement', groups: ['Placement'] },
  { id: 'display', title: 'Display', groups: ['Display', 'Flags'] },
  { id: 'l10n', title: 'Localisation', groups: ['Translations'], collapsible: true, hint: 'optional — the museum falls back to English' },
  { id: 'meta', title: 'Metadata', groups: ['Metadata'], collapsible: true },
]

function stripInternal(item: Record<string, unknown>) {
  const { __new: _n, ...rest } = item
  void _n
  return rest
}

const isEmpty = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')

function validate(fields: FieldDef[], draft: Record<string, unknown>): Record<string, string> {
  const errs: Record<string, string> = {}
  for (const f of fields) {
    const v = getPath(draft, f.path)
    if (f.required && isEmpty(v)) errs[f.path] = `${f.label.replace(/\s*\(.*\)$/, '')} is required`
    if (f.type === 'at' && typeof v === 'number') {
      const r = surfaceRange(getPath(draft, 'placement.surface'))
      if (r && (v < r.min - 1e-6 || v > r.max + 1e-6)) errs[f.path] = `Outside this wall (${r.min.toFixed(2)} to ${r.max.toFixed(2)} m)`
    }
    if (f.type === 'number' && typeof v === 'number' && Number.isNaN(v)) errs[f.path] = 'Enter a number'
  }
  return errs
}

function ItemEditor({
  collection,
  item,
  museumBase,
  media,
  onMediaChanged,
  onSaved,
  onDeleted,
}: {
  collection: ContentCollection
  item: Item
  museumBase: string
  media: MediaRecord[]
  onMediaChanged: () => void
  onSaved: (i: Item) => void
  onDeleted: (id: string) => void
}) {
  const meta = COLLECTIONS.find((c) => c.id === collection)!
  const isNew = item.__new === true
  const initial = useMemo(() => stripInternal(item), [item])
  const [draft, setDraft] = useState<Record<string, unknown>>(initial)
  const [jsonText, setJsonText] = useState(() => JSON.stringify(initial, null, 2))
  const [jsonError, setJsonError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const toast = useToast()
  const confirm = useConfirm()
  const dirty = isNew || JSON.stringify(draft) !== JSON.stringify(initial)
  useUnsavedGuard(dirty && !busy)

  const fields = FIELDS[collection]
  const errors = useMemo(() => validate(fields, draft), [fields, draft])
  const errorCount = Object.keys(errors).length

  const update = (next: Record<string, unknown>) => {
    setDraft(next)
    setJsonText(JSON.stringify(next, null, 2))
    setJsonError('')
  }

  function onJson(text: string) {
    setJsonText(text)
    try {
      const v = JSON.parse(text) as unknown
      if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('Must be a JSON object')
      if ((v as Item).id !== item.id) throw new Error(`"id" must stay "${item.id}"`)
      setDraft(v as Record<string, unknown>)
      setJsonError('')
    } catch (e) {
      setJsonError(errMsg(e))
    }
  }

  const saveRef = useRef<() => void>(() => undefined)
  async function save() {
    if (jsonError) return toast('Fix the raw JSON first', 'error')
    if (errorCount) {
      setShowErrors(true)
      return toast(`${errorCount} field${errorCount === 1 ? ' needs' : 's need'} attention before saving`, 'error')
    }
    setBusy(true)
    try {
      const saved = await api.put(collection, { ...draft, id: item.id } as Item)
      toast(`${isNew ? 'Created' : 'Saved'} “${String(saved.title ?? saved.id)}”`)
      onSaved(saved)
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    saveRef.current = () => void save()
  })

  // ⌘/Ctrl+S saves
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function remove() {
    if (isNew) return onDeleted(item.id)
    const ok = await confirm({
      title: `Delete “${String(item.title ?? item.id)}”?`,
      body: `It is removed from ${meta.label.toLowerCase()} for every visitor. This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      await api.remove(collection, item.id)
      toast('Deleted')
      onDeleted(item.id)
    } catch (e) {
      toast(errMsg(e), 'error')
      setBusy(false)
    }
  }

  const previewHref = `${museumBase}#${meta.hash}=${encodeURIComponent(item.id)}`
  const renderField = (f: FieldDef) => (
    <Field
      key={f.path}
      def={f}
      value={getPath(draft, f.path)}
      draft={draft}
      error={showErrors || f.type === 'at' ? errors[f.path] : undefined}
      media={media}
      onMediaChanged={onMediaChanged}
      onChange={(v) => update(setPath(draft, f.path, v))}
    />
  )

  return (
    <section className="card" aria-label={`Edit ${meta.singular}`}>
      <div className="form-head">
        <div className="fh-text">
          <h2>{String(draft.title ?? '') || item.id}</h2>
          <div className="fh-meta">
            <span className="mono muted">{collection}/{item.id}</span>
            {draft.placeholder === true && <span className="badge warn">placeholder</span>}
            {isNew && <span className="badge accent">draft</span>}
          </div>
        </div>
        <div className="row">
          {!isNew && (
            <a className="btn small" href={previewHref} target="_blank" rel="noreferrer" title="Opens the museum at this item in a new tab">
              Preview in museum ↗
            </a>
          )}
        </div>
      </div>

      <ItemPreview collection={collection} draft={draft} />

      {SECTIONS.map((sec) => {
        const fs = fields.filter((f) => sec.groups.includes(f.group))
        if (!fs.length) return null
        if (sec.id === 'l10n') return <LocalisationSection key={sec.id} fields={fs} render={renderField} hint={sec.hint} draft={draft} />
        const body = <div className="grid-2">{fs.map(renderField)}</div>
        if (sec.collapsible)
          return (
            <details className="group" key={sec.id}>
              <summary>{sec.title}{sec.hint && <span className="hint">— {sec.hint}</span>}</summary>
              {body}
            </details>
          )
        return (
          <div className="group" key={sec.id}>
            <h3>{sec.title}</h3>
            {body}
          </div>
        )
      })}

      <details className="group" open={!!jsonError || undefined}>
        <summary>Advanced · raw JSON <span className="hint">— every field, including ones without a form control</span></summary>
        <textarea
          className={`json-editor ${jsonError ? 'invalid' : ''}`}
          spellCheck={false}
          value={jsonText}
          onChange={(e) => onJson(e.target.value)}
          rows={Math.min(28, jsonText.split('\n').length + 1)}
          aria-label="Raw JSON"
          aria-invalid={!!jsonError}
        />
        {jsonError && <p className="alert" style={{ marginTop: 6 }}>{jsonError}</p>}
      </details>

      <div className={`save-bar ${dirty ? 'is-dirty' : ''}`}>
        <button className="btn primary" onClick={() => void save()} disabled={busy || !dirty || Boolean(jsonError)}>{busy ? 'Saving…' : isNew ? 'Create' : 'Save changes'}</button>
        {!isNew && (
          <button className="btn ghost" onClick={() => update(initial)} disabled={busy || !dirty}>Revert</button>
        )}
        {showErrors && errorCount > 0 ? (
          <span className="small danger-text">{errorCount} field{errorCount === 1 ? '' : 's'} need{errorCount === 1 ? 's' : ''} attention</span>
        ) : (
          dirty && <span className="dirty">{isNew ? 'Draft — not published yet' : 'Unsaved changes'}</span>
        )}
        <span className="spacer" />
        {!dirty && <span className="small muted hide-phone">⌘/Ctrl + S to save</span>}
        <button className="btn danger small" onClick={remove} disabled={busy}>{isNew ? 'Discard draft' : 'Delete'}</button>
      </div>
    </section>
  )
}

/** Translations: one collapsible block per language (fields are `i18n.<lang>.<field>`). */
function LocalisationSection({ fields, render, hint, draft }: { fields: FieldDef[]; render: (f: FieldDef) => ReactNode; hint?: string; draft: Record<string, unknown> }) {
  const langs = [...new Set(fields.map((f) => f.path.split('.')[1]))]
  const names: Record<string, string> = { hi: 'Hindi · हिन्दी', bn: 'Bengali · বাংলা' }
  const filled = (lang: string) => fields.filter((f) => f.path.split('.')[1] === lang && !isEmpty(getPath(draft, f.path))).length
  return (
    <details className="group">
      <summary>
        Localisation{hint && <span className="hint">— {hint}</span>}
        <span className="spacer" />
        {langs.map((l) => (
          <span key={l} className={`badge ${filled(l) ? 'ok' : ''}`} style={{ textTransform: 'none', letterSpacing: 0 }}>{l.toUpperCase()} {filled(l)}/{fields.filter((f) => f.path.split('.')[1] === l).length}</span>
        ))}
      </summary>
      {langs.map((lang) => (
        <div className="lang-block" key={lang}>
          <h4 lang={lang}>{names[lang] ?? lang}</h4>
          <div className="grid-2">{fields.filter((f) => f.path.split('.')[1] === lang).map((f) => render({ ...f, label: f.label.replace(/\s+—\s+.*$/, '') }))}</div>
        </div>
      ))}
    </details>
  )
}

/* ------------------------------------------------------------------ */
/* Previews                                                            */
/* ------------------------------------------------------------------ */

function ItemPreview({ collection, draft }: { collection: ContentCollection; draft: Record<string, unknown> }) {
  const [broken, setBroken] = useState('')
  const s = (k: string) => (typeof draft[k] === 'string' ? (draft[k] as string) : '')
  const range = surfaceRange(getPath(draft, 'placement.surface'))
  const at = getPath(draft, 'placement.at')
  const place = range ? (
    <span>
      {range.label}
      {typeof at === 'number' ? <> · {at.toFixed(2)} m</> : null}
    </span>
  ) : collection === 'objects' ? (
    <span>{s('zone') || 'no zone'} · {Array.isArray(draft.position) ? (draft.position as number[]).map((n) => Number(n).toFixed(1)).join(', ') : '—'}</span>
  ) : (
    <span className="danger-text">No wall selected</span>
  )

  let visual: ReactNode
  if (collection === 'artworks') {
    const img = s('image')
    const frame = resolveFrame((draft.frame as FrameConfig | FrameStyleId | undefined) ?? undefined)
    const K = 110 // px per metre in the preview
    const fw = Math.round(frame.frameWidth * K)
    const mw = Math.round(frame.matWidth * K)
    visual = (
      <div className="pv-frame">
        {img && broken !== img ? (
          <div
            className="pv-art framed"
            style={{ padding: fw, background: frame.material === 'none' ? frame.backingColor : frame.color, boxShadow: frame.material === 'none' ? undefined : 'inset 0 0 0 1px rgba(0,0,0,.25), 0 6px 14px -6px rgba(0,0,0,.45)' }}
          >
            <div style={{ padding: mw, background: frame.matColor }}>
              <img src={img} alt="" onError={() => setBroken(img)} style={{ maxHeight: 110 }} />
            </div>
          </div>
        ) : (
          <span className="pv-missing">{img ? 'Image not found' : 'No image yet'}</span>
        )}
      </div>
    )
  } else if (collection === 'videos') {
    const poster = s('poster')
    const src = s('src')
    visual = (
      <div className="pv-frame">
        {src ? <video src={src} poster={poster || undefined} muted playsInline preload="metadata" controls /> : poster ? <img src={poster} alt="" /> : <span className="pv-missing">No video yet</span>}
      </div>
    )
  } else if (collection === 'exhibits' || collection === 'objects') {
    const model = s('model')
    visual = (
      <div className="pv-frame" style={collection === 'exhibits' && !model ? { background: s('inkColor') || undefined } : undefined}>
        <span className="pv-missing" style={collection === 'exhibits' && !model ? { color: '#fbf7f0' } : undefined}>
          {model ? <>3D model<br /><span className="mono">{model.split('/').pop()}</span></> : collection === 'exhibits' ? `Procedural block · ${s('placeholderMotif') || 'rosette'}` : `Procedural · ${s('kind') || 'object'}`}
        </span>
      </div>
    )
  } else {
    visual = (
      <div className="pv-frame" style={{ background: '#f4efe6' }}>
        <span className="pv-missing" style={{ color: 'var(--ink)' }}>
          <span className="kicker">{s('kicker') || 'Panel'}</span>
          <br />
          <strong className="display" style={{ fontSize: 16 }}>{s('title') || 'Untitled'}</strong>
        </span>
      </div>
    )
  }
  const model = s('model')
  return (
    <div className="preview-panel">
      {visual}
      <div className="pv-meta">
        <span className="kicker">Preview</span>
        {place}
        {collection === 'artworks' && <span className="muted">Frame: {typeof draft.frame === 'object' && draft.frame ? String((draft.frame as { style?: string }).style) + ' (custom)' : s('frame') || 'default (thin black)'}</span>}
        {model && <a className="small" href={model} target="_blank" rel="noreferrer">Open model file ↗</a>}
        {s('description') && <span className="muted truncate">{s('description')}</span>}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Fields                                                              */
/* ------------------------------------------------------------------ */

function Field({
  def,
  value,
  draft,
  error,
  media,
  onMediaChanged,
  onChange,
}: {
  def: FieldDef
  value: unknown
  draft: Record<string, unknown>
  error?: string
  media: MediaRecord[]
  onMediaChanged: () => void
  onChange: (v: unknown) => void
}) {
  const [picking, setPicking] = useState(false)
  const label = (
    <span>
      {def.label}
      {def.required && <span className="req" aria-hidden="true"> *</span>}
    </span>
  )
  const foot = error ? <span className="error-text" role="alert">{error}</span> : def.hint ? <span className="hint">{def.hint}</span> : null
  const cls = (extra = '') => `field ${extra} ${error ? 'invalid' : ''}`.trim()
  const str = (v: string) => onChange(v === '' && !def.required ? undefined : v)
  const aria = { 'aria-invalid': error ? true : undefined, 'aria-required': def.required || undefined }

  switch (def.type) {
    case 'checkbox':
      return (
        <label className="check-card span-all">
          <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked ? true : def.path === 'placeholder' ? false : undefined)} />
          <span>
            {def.label}
            {def.hint && <span className="hint">{def.hint}</span>}
          </span>
        </label>
      )
    case 'textarea':
      return (
        <label className={cls('span-all')}>
          {label}
          <textarea rows={def.path.endsWith('body') ? 5 : 3} value={typeof value === 'string' ? value : ''} onChange={(e) => str(e.target.value)} {...aria} />
          {foot}
        </label>
      )
    case 'number':
      return (
        <label className={cls()}>
          {label}
          <input type="number" step={def.step ?? 'any'} value={typeof value === 'number' ? value : ''} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} {...aria} />
          {foot}
        </label>
      )
    case 'surface': {
      const v = typeof value === 'string' ? value : ''
      const known = SURFACE_GROUPS.some((g) => g.surfaces.some((s) => s.id === v))
      return (
        <label className={cls()}>
          {label}
          <select value={v} onChange={(e) => str(e.target.value)} {...aria}>
            {!v && <option value="">Choose a wall…</option>}
            {v && !known && <option value={v}>{v} (unknown)</option>}
            {SURFACE_GROUPS.map((g) => (
              <optgroup key={g.zone} label={g.zone}>
                {g.surfaces.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
          {foot ?? <span className="hint mono">{v}</span>}
        </label>
      )
    }
    case 'at': {
      const r = surfaceRange(getPath(draft, 'placement.surface'))
      const n = typeof value === 'number' ? value : null
      const pct = r && n !== null && r.max > r.min ? Math.max(0, Math.min(1, (n - r.min) / (r.max - r.min))) * 100 : null
      const out = !!error
      return (
        <label className={cls()}>
          {label}
          <div className="input-suffix">
            <input type="number" step={def.step ?? 'any'} min={r?.min} max={r?.max} value={n ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} {...aria} />
            <span aria-hidden="true">m</span>
          </div>
          {r ? (
            <span className="surface-hint">
              <span className="num">{r.min.toFixed(2)}</span>
              <span className="range-track" aria-hidden="true">{pct !== null && <span className={`dot ${out ? 'out' : ''}`} style={{ left: `${pct}%` }} />}</span>
              <span className="num">{r.max.toFixed(2)}</span>
              <span>world {r.axis}</span>
            </span>
          ) : (
            <span className="hint">Choose a wall to see its valid range</span>
          )}
          {error && <span className="error-text" role="alert">{error}</span>}
        </label>
      )
    }
    case 'select': {
      const v = typeof value === 'string' ? value : ''
      const opts = def.options ?? []
      return (
        <label className={cls()}>
          {label}
          <select value={v} onChange={(e) => str(e.target.value)} {...aria}>
            {!def.required ? <option value="">— none —</option> : !v && <option value="">Choose…</option>}
            {v && !opts.includes(v) && <option value={v}>{v}</option>}
            {opts.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          {foot}
        </label>
      )
    }
    case 'frame': {
      // string preset id, or { style, ...overrides } — only `style` is edited here
      const isObj = typeof value === 'object' && value !== null
      const style = isObj ? String((value as { style?: string }).style ?? '') : typeof value === 'string' ? value : ''
      return (
        <label className={cls()}>
          {label}
          <select
            value={style}
            onChange={(e) => {
              const s = e.target.value
              if (!s) return onChange(undefined)
              onChange(isObj ? { ...(value as object), style: s } : s)
            }}
          >
            <option value="">Default (thin black)</option>
            {(def.options ?? []).map((o) => (
              <option key={o} value={o}>{o.replace(/-/g, ' ')}</option>
            ))}
          </select>
          {isObj ? <span className="hint">Has custom overrides (see raw JSON)</span> : foot}
        </label>
      )
    }
    case 'color': {
      const v = typeof value === 'string' ? value : ''
      return (
        <label className={cls()}>
          {label}
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input type="color" value={/^#[0-9a-f]{6}$/i.test(v) ? v : '#000000'} onChange={(e) => onChange(e.target.value)} aria-label={`${def.label} picker`} />
            <input type="text" className="mono" value={v} placeholder="#2c3f6b" onChange={(e) => str(e.target.value)} {...aria} />
          </div>
          {foot}
        </label>
      )
    }
    case 'media': {
      const v = typeof value === 'string' ? value : ''
      const listId = `media-${def.accept ?? 'any'}`
      const options = media.filter((m) => mediaMatches(m, def.accept))
      const thumb = def.accept === 'image' ? v : def.accept === 'video' ? null : null
      return (
        <div className={cls('span-all')}>
          {label}
          <div className="media-input">
            {thumb && <img className="mi-thumb" src={thumb} alt="" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} onLoad={(e) => ((e.target as HTMLImageElement).style.visibility = 'visible')} />}
            <input type="text" list={listId} value={v} placeholder={def.accept === 'model' ? '/models/… .glb' : def.accept === 'video' ? '/video/… .mp4' : '/artworks/… or a media library URL'} onChange={(e) => str(e.target.value)} aria-label={def.label} {...aria} />
            <datalist id={listId}>
              {options.map((m) => (
                <option key={m.id} value={m.url}>{m.filename}</option>
              ))}
            </datalist>
            <button type="button" className="btn" onClick={() => setPicking(true)}>Browse…</button>
            {v && !def.required && (
              <button type="button" className="icon-btn" onClick={() => onChange(undefined)} aria-label={`Clear ${def.label}`} title="Clear">×</button>
            )}
          </div>
          {foot ?? <span className="hint">Choose from the media library ({options.length} {def.accept ?? 'file'}{options.length === 1 ? '' : 's'}) or type a path under /public.</span>}
          {picking && (
            <MediaPicker
              accept={def.accept}
              value={v}
              onClose={() => {
                setPicking(false)
                onMediaChanged()
              }}
              onPick={(url) => {
                onChange(url)
                setPicking(false)
                onMediaChanged()
              }}
            />
          )}
        </div>
      )
    }
    case 'lines': {
      const arr = Array.isArray(value) ? (value as unknown[]).map(String) : []
      return (
        <label className={cls('span-all')}>
          {label}
          <textarea
            rows={Math.max(3, arr.length + 1)}
            value={arr.join('\n')}
            onChange={(e) => {
              const lines = e.target.value.split('\n')
              onChange(lines.length === 1 && lines[0] === '' ? undefined : lines)
            }}
          />
          {foot ?? <span className="hint">{arr.length} line{arr.length === 1 ? '' : 's'}</span>}
        </label>
      )
    }
    case 'vec3': {
      const arr = Array.isArray(value) ? (value as number[]) : [0, 0, 0]
      return (
        <div className={cls('span-all')}>
          {label}
          <div className="grid-3 keep">
            {['x', 'y', 'z'].map((axis, i) => (
              <div className="input-suffix" key={axis}>
                <input
                  type="number"
                  step={0.05}
                  aria-label={`${def.label} ${axis}`}
                  value={typeof arr[i] === 'number' ? arr[i] : ''}
                  onChange={(e) => {
                    const next = [0, 1, 2].map((j) => (typeof arr[j] === 'number' ? arr[j] : 0))
                    next[i] = Number(e.target.value)
                    onChange(next)
                  }}
                />
                <span aria-hidden="true">{axis}</span>
              </div>
            ))}
          </div>
          {foot ?? <span className="hint">World metres: x east, y up, z south</span>}
        </div>
      )
    }
    case 'kv': {
      const obj = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, string>) : {}
      const entries = Object.entries(obj)
      const write = (list: [string, string][]) => onChange(list.length ? Object.fromEntries(list) : undefined)
      return (
        <div className="field span-all">
          {entries.length === 0 && <span className="hint">No extra metadata. Rows appear on the item’s info card.</span>}
          {entries.map(([k, v], idx) => (
            <div className="kv-row" key={idx}>
              <input type="text" value={k} placeholder="Label" aria-label="Metadata label" onChange={(e) => write(entries.map((en, j) => (j === idx ? [e.target.value, en[1]] : en)))} />
              <input type="text" value={v} placeholder="Value" aria-label="Metadata value" onChange={(e) => write(entries.map((en, j) => (j === idx ? [en[0], e.target.value] : en)))} />
              <button type="button" className="icon-btn" onClick={() => write(entries.filter((_, j) => j !== idx))} aria-label={`Remove ${k || 'row'}`}>×</button>
            </div>
          ))}
          <div>
            <button type="button" className="btn small" onClick={() => write([...entries, [`Field ${entries.length + 1}`, '']])}>+ Add row</button>
          </div>
        </div>
      )
    }
    default:
      return (
        <label className={cls()}>
          {label}
          <input type="text" value={typeof value === 'string' ? value : value === undefined ? '' : String(value)} onChange={(e) => str(e.target.value)} {...aria} />
          {foot}
        </label>
      )
  }
}

/* ------------------------------------------------------------------ */

function TextsEditor({ onSaved }: { onSaved: () => void }) {
  const [ex, setEx] = useState<ExhibitionText | null>(null)
  const [welcome, setWelcome] = useState<MuseumContent['welcome'] | null>(null)
  const [initial, setInitial] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const snapshot = JSON.stringify([ex, welcome])
  const dirty = !!initial && snapshot !== initial
  useUnsavedGuard(dirty && !busy)

  useEffect(() => {
    api
      .content()
      .then((c) => {
        setEx({ ...c.exhibition })
        setWelcome({ ...c.welcome })
        setInitial(JSON.stringify([{ ...c.exhibition }, { ...c.welcome }]))
      })
      .catch((e) => setError(errMsg(e)))
  }, [])

  async function save() {
    if (!ex || !welcome) return
    setBusy(true)
    try {
      await api.putExhibition(ex)
      await api.putWelcome(welcome)
      toast('Exhibition text & welcome saved')
      setInitial(JSON.stringify([ex, welcome]))
      onSaved()
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (error) return <div className="card"><EmptyState title="Couldn’t load the texts" icon="!">{error}</EmptyState></div>
  if (!ex || !welcome) return <div style={{ maxWidth: 860 }}><Skeleton kind="form" rows={4} /></div>
  return (
    <div className="card" style={{ maxWidth: 860 }}>
      <div className="group">
        <h3>Reveal-wall title</h3>
        <div className="grid-2">
          <label className="field">
            <span>Kicker</span>
            <input type="text" value={ex.kicker} onChange={(e) => setEx({ ...ex, kicker: e.target.value })} />
          </label>
          <label className="field">
            <span>Title</span>
            <input type="text" value={ex.title} onChange={(e) => setEx({ ...ex, title: e.target.value })} />
          </label>
          <label className="field span-all">
            <span>Subtitle</span>
            <input type="text" value={ex.subtitle} onChange={(e) => setEx({ ...ex, subtitle: e.target.value })} />
          </label>
          <label className="field span-all">
            <span>Introduction</span>
            <textarea rows={4} value={ex.intro} onChange={(e) => setEx({ ...ex, intro: e.target.value })} />
          </label>
        </div>
      </div>
      <div className="group">
        <h3>Reception welcome</h3>
        <div className="grid-2">
          <label className="field span-all">
            <span>Title</span>
            <input type="text" value={welcome.title} onChange={(e) => setWelcome({ ...welcome, title: e.target.value })} />
          </label>
          <label className="field span-all">
            <span>Body</span>
            <textarea rows={4} value={welcome.body} onChange={(e) => setWelcome({ ...welcome, body: e.target.value })} />
          </label>
        </div>
      </div>
      <details className="group">
        <summary>Localisation <span className="hint">— optional Hindi / Bengali; empty fields fall back to English</span></summary>
        {(['hi', 'bn'] as const).map((lang) => (
          <div className="lang-block" key={lang}>
            <h4 lang={lang}>{lang === 'hi' ? 'Hindi · हिन्दी' : 'Bengali · বাংলা'}</h4>
            <div className="grid-2">
              {(['kicker', 'title', 'subtitle', 'intro'] as const).map((f) => (
                <label className={`field${f === 'intro' || f === 'subtitle' ? ' span-all' : ''}`} key={`ex-${f}`}>
                  <span>Reveal wall · {f}</span>
                  {f === 'intro' ? (
                    <textarea rows={3} lang={lang} value={ex.i18n?.[lang]?.[f] ?? ''} onChange={(e) => setEx({ ...ex, i18n: withText(ex.i18n, lang, f, e.target.value) })} />
                  ) : (
                    <input type="text" lang={lang} value={ex.i18n?.[lang]?.[f] ?? ''} onChange={(e) => setEx({ ...ex, i18n: withText(ex.i18n, lang, f, e.target.value) })} />
                  )}
                </label>
              ))}
              {(['title', 'body'] as const).map((f) => (
                <label className="field span-all" key={`w-${f}`}>
                  <span>Welcome · {f}</span>
                  {f === 'body' ? (
                    <textarea rows={3} lang={lang} value={welcome.i18n?.[lang]?.[f] ?? ''} onChange={(e) => setWelcome({ ...welcome, i18n: withText(welcome.i18n, lang, f, e.target.value) })} />
                  ) : (
                    <input type="text" lang={lang} value={welcome.i18n?.[lang]?.[f] ?? ''} onChange={(e) => setWelcome({ ...welcome, i18n: withText(welcome.i18n, lang, f, e.target.value) })} />
                  )}
                </label>
              ))}
            </div>
          </div>
        ))}
      </details>
      <div className={`save-bar ${dirty ? 'is-dirty' : ''}`}>
        <button className="btn primary" onClick={save} disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save texts'}</button>
        {dirty && (
          <button className="btn ghost" onClick={() => {
            const [e, w] = JSON.parse(initial) as [ExhibitionText, MuseumContent['welcome']]
            setEx(e)
            setWelcome(w)
          }} disabled={busy}>Revert</button>
        )}
        {dirty && <span className="dirty">Unsaved changes</span>}
      </div>
    </div>
  )
}

/** Immutable update of `i18n[lang][field]` (empty string removes the override). */
function withText<F extends string>(i18n: Partial<Record<'hi' | 'bn', Partial<Record<F, string>>>> | undefined, lang: 'hi' | 'bn', field: F, value: string) {
  const cur = { ...(i18n?.[lang] ?? {}) } as Partial<Record<F, string>>
  if (value) cur[field] = value
  else delete cur[field]
  return { ...(i18n ?? {}), [lang]: cur }
}
