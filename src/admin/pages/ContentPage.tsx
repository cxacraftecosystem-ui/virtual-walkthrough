import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ContentCollection, ExhibitionText } from '../../museum/content/types'
import { api, type Item, type MediaRecord } from '../api'
import { FIELDS, getPath, setPath, template, type FieldDef } from '../fields'
import { errMsg, useToast } from '../ui'

const COLLECTIONS: { id: ContentCollection; label: string }[] = [
  { id: 'artworks', label: 'Artworks' },
  { id: 'exhibits', label: 'Exhibits' },
  { id: 'infographics', label: 'Infographics' },
  { id: 'videos', label: 'Videos' },
  { id: 'objects', label: 'Objects' },
]
type Tab = ContentCollection | 'texts'
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/

export function ContentPage() {
  const [tab, setTab] = useState<Tab>('artworks')
  const [counts, setCounts] = useState<Partial<Record<ContentCollection, number>>>({})
  const [version, setVersion] = useState<number | null>(null)
  const [media, setMedia] = useState<MediaRecord[]>([])
  const [resetKey, setResetKey] = useState(0)
  const toast = useToast()

  const refreshMeta = useCallback(() => {
    api
      .content()
      .then((c) => {
        setVersion(c.version)
        setCounts({ artworks: c.artworks.length, exhibits: c.exhibits.length, infographics: c.infographics.length, videos: c.videos.length, objects: c.objects.length })
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    refreshMeta()
    api.media().then(setMedia).catch(() => undefined)
  }, [refreshMeta])

  async function reset() {
    if (!window.confirm('Replace ALL content with the bundled defaults from the source code? Your edits will be lost.')) return
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
      <div className="page-head">
        <div>
          <h1>Content</h1>
          <p className="muted">Changes are live for new museum visits as soon as they are saved{version !== null ? ` · content version ${version}` : ''}.</p>
        </div>
        <div className="spacer" />
        <button className="btn danger small" onClick={reset}>Reset to bundled defaults…</button>
      </div>
      <nav className="tabs subtabs" aria-label="Collections">
        {COLLECTIONS.map((c) => (
          <button key={c.id} className={tab === c.id ? 'tab active' : 'tab'} onClick={() => setTab(c.id)}>
            {c.label}
            {counts[c.id] !== undefined && <span className="count">{counts[c.id]}</span>}
          </button>
        ))}
        <button className={tab === 'texts' ? 'tab active' : 'tab'} onClick={() => setTab('texts')}>Exhibition &amp; welcome</button>
      </nav>
      {tab === 'texts' ? (
        <TextsEditor key={`texts-${resetKey}`} onSaved={refreshMeta} />
      ) : (
        <CollectionEditor key={`${tab}-${resetKey}`} collection={tab} media={media} onChanged={refreshMeta} />
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */

function CollectionEditor({ collection, media, onChanged }: { collection: ContentCollection; media: MediaRecord[]; onChanged: () => void }) {
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newId, setNewId] = useState('')
  const [filter, setFilter] = useState('')
  const toast = useToast()

  useEffect(() => {
    api
      .list(collection)
      .then((list) => {
        setItems(list)
        setSelected((s) => s ?? list[0]?.id ?? null)
      })
      .catch((e) => setError(errMsg(e)))
  }, [collection])

  const current = items?.find((i) => i.id === selected) ?? null
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return (items ?? []).filter((i) => !q || i.id.toLowerCase().includes(q) || String(i.title ?? '').toLowerCase().includes(q))
  }, [items, filter])

  function startCreate() {
    setCreating(true)
    setNewId('')
  }

  function create() {
    const id = newId.trim()
    if (!ID_RE.test(id)) return toast('Id: letters, digits, "-", "_", "." (max 100), starting with a letter or digit', 'error')
    if (items?.some((i) => i.id === id)) return toast(`"${id}" already exists`, 'error')
    const draft = template(collection, id) as Item
    setItems((list) => [...(list ?? []), { ...draft, __new: true }])
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

  if (error) return <p className="alert">{error}</p>
  if (!items) return <p className="muted">Loading…</p>

  return (
    <div className="editor">
      <aside className="card item-list">
        <div className="list-head">
          <div className="row">
            <input type="search" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter items" style={{ flex: 1 }} />
            <button className="btn small primary" onClick={startCreate}>+ New</button>
          </div>
          {creating && (
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault()
                create()
              }}
            >
              <input type="text" autoFocus placeholder="new-item-id" value={newId} onChange={(e) => setNewId(e.target.value)} style={{ flex: 1 }} aria-label="New item id" />
              <button className="btn small">Create</button>
              <button type="button" className="btn small ghost" onClick={() => setCreating(false)}>✕</button>
            </form>
          )}
        </div>
        <ul>
          {shown.map((i) => (
            <li key={i.id}>
              <button className={i.id === selected ? 'active' : ''} onClick={() => setSelected(i.id)}>
                <span className="t">{String(i.title ?? i.id)}</span>
                <span className="i">
                  {i.id}
                  {i.placeholder === true && <span className="badge warn">placeholder</span>}
                  {i.__new === true && <span className="badge">unsaved</span>}
                </span>
              </button>
            </li>
          ))}
          {shown.length === 0 && <li className="empty small">No items</li>}
        </ul>
      </aside>
      {current ? (
        <ItemEditor key={current.id} collection={collection} item={current} media={media} onSaved={onSaved} onDeleted={onDeleted} />
      ) : (
        <div className="card empty">Select an item or create a new one.</div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

const GROUP_ORDER: FieldDef['group'][] = ['Details', 'Media', 'Placement', 'Display', 'Flags', 'Metadata']

function stripInternal(item: Record<string, unknown>) {
  const { __new: _n, ...rest } = item
  void _n
  return rest
}

function ItemEditor({
  collection,
  item,
  media,
  onSaved,
  onDeleted,
}: {
  collection: ContentCollection
  item: Item
  media: MediaRecord[]
  onSaved: (i: Item) => void
  onDeleted: (id: string) => void
}) {
  const isNew = item.__new === true
  const initial = useMemo(() => stripInternal(item), [item])
  const [draft, setDraft] = useState<Record<string, unknown>>(initial)
  const [jsonText, setJsonText] = useState(() => JSON.stringify(initial, null, 2))
  const [jsonError, setJsonError] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const dirty = isNew || JSON.stringify(draft) !== JSON.stringify(initial)

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

  async function save() {
    if (jsonError) return toast('Fix the JSON first', 'error')
    setBusy(true)
    try {
      const saved = await api.put(collection, { ...draft, id: item.id } as Item)
      toast(`Saved “${String(saved.title ?? saved.id)}”`)
      onSaved(saved)
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (isNew) return onDeleted(item.id)
    if (!window.confirm(`Delete “${String(item.title ?? item.id)}” from ${collection}? This cannot be undone.`)) return
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

  const fields = FIELDS[collection]
  return (
    <section className="card">
      <div className="form-head">
        <h2>{String(draft.title ?? item.id) || item.id}</h2>
        <span className="mono muted">{collection}/{item.id}</span>
        {draft.placeholder === true && <span className="badge warn">placeholder</span>}
      </div>

      {GROUP_ORDER.map((g) => {
        const fs = fields.filter((f) => f.group === g)
        if (!fs.length) return null
        return (
          <div className="group" key={g}>
            <h3>{g}</h3>
            <div className="grid-2">
              {fs.map((f) => (
                <Field key={f.path} def={f} value={getPath(draft, f.path)} media={media} onChange={(v) => update(setPath(draft, f.path, v))} />
              ))}
            </div>
          </div>
        )
      })}

      <div className="group">
        <h3>Raw JSON (all fields)</h3>
        <textarea
          className={`json-editor ${jsonError ? 'invalid' : ''}`}
          spellCheck={false}
          value={jsonText}
          onChange={(e) => onJson(e.target.value)}
          rows={Math.min(28, jsonText.split('\n').length + 1)}
          aria-label="Raw JSON"
        />
        {jsonError && <p className="alert" style={{ marginTop: 6 }}>{jsonError}</p>}
      </div>

      <div className="save-bar">
        <button className="btn primary" onClick={save} disabled={busy || !dirty || Boolean(jsonError)}>{busy ? 'Saving…' : isNew ? 'Create' : 'Save changes'}</button>
        {!isNew && (
          <button className="btn ghost" onClick={() => update(initial)} disabled={busy || !dirty}>Revert</button>
        )}
        {dirty && <span className="dirty">{isNew ? 'Not saved yet' : 'Unsaved changes'}</span>}
        <span className="spacer" />
        <button className="btn danger small" onClick={remove} disabled={busy}>{isNew ? 'Discard' : 'Delete'}</button>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */

const mediaMatches = (m: MediaRecord, accept?: FieldDef['accept']) => !accept || m.mime.startsWith(accept === 'model' ? 'model/' : `${accept}/`)

function Field({ def, value, media, onChange }: { def: FieldDef; value: unknown; media: MediaRecord[]; onChange: (v: unknown) => void }) {
  const label = (
    <span>
      {def.label}
      {def.required && <span className="req"> *</span>}
    </span>
  )
  const hint = def.hint ? <span className="hint">{def.hint}</span> : null
  const str = (v: string) => onChange(v === '' && !def.required ? undefined : v)

  switch (def.type) {
    case 'checkbox':
      return (
        <label className="check span-all">
          <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked ? true : def.path === 'placeholder' ? false : undefined)} />
          {def.label}
        </label>
      )
    case 'textarea':
      return (
        <label className="field span-all">
          {label}
          <textarea rows={def.path === 'body' ? 5 : 3} value={typeof value === 'string' ? value : ''} onChange={(e) => str(e.target.value)} />
          {hint}
        </label>
      )
    case 'number':
      return (
        <label className="field">
          {label}
          <input
            type="number"
            step={def.step ?? 'any'}
            value={typeof value === 'number' ? value : ''}
            onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          />
          {hint}
        </label>
      )
    case 'select': {
      const v = typeof value === 'string' ? value : ''
      const opts = def.options ?? []
      return (
        <label className="field">
          {label}
          <select value={v} onChange={(e) => str(e.target.value)}>
            {!def.required && <option value="">—</option>}
            {v && !opts.includes(v) && <option value={v}>{v}</option>}
            {opts.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          {hint}
        </label>
      )
    }
    case 'frame': {
      // string preset id, or { style, ...overrides } — only `style` is edited here
      const isObj = typeof value === 'object' && value !== null
      const style = isObj ? String((value as { style?: string }).style ?? '') : typeof value === 'string' ? value : ''
      return (
        <label className="field">
          {label}
          <select
            value={style}
            onChange={(e) => {
              const s = e.target.value
              if (!s) return onChange(undefined)
              onChange(isObj ? { ...(value as object), style: s } : s)
            }}
          >
            <option value="">— default —</option>
            {(def.options ?? []).map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          {isObj && <span className="hint">Has custom overrides (see raw JSON)</span>}
        </label>
      )
    }
    case 'color': {
      const v = typeof value === 'string' ? value : ''
      return (
        <label className="field">
          {label}
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input type="color" value={/^#[0-9a-f]{6}$/i.test(v) ? v : '#000000'} onChange={(e) => onChange(e.target.value)} style={{ width: 40, height: 34, padding: 0, border: 0, background: 'none' }} />
            <input type="text" value={v} onChange={(e) => str(e.target.value)} />
          </div>
        </label>
      )
    }
    case 'media': {
      const v = typeof value === 'string' ? value : ''
      const listId = `media-${def.accept ?? 'any'}`
      const options = media.filter((m) => mediaMatches(m, def.accept))
      return (
        <label className="field span-all">
          {label}
          <div className="media-input">
            {def.accept === 'image' && v && <img src={v} alt="" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />}
            <input type="text" list={listId} value={v} placeholder="/artworks/… or a media library URL" onChange={(e) => str(e.target.value)} />
            <datalist id={listId}>
              {options.map((m) => (
                <option key={m.id} value={m.url}>{m.filename}</option>
              ))}
            </datalist>
          </div>
          <span className="hint">{hint ?? `Pick from the media library (${options.length} ${def.accept ?? 'file'}${options.length === 1 ? '' : 's'}) or type a path under /public.`}</span>
        </label>
      )
    }
    case 'lines': {
      const arr = Array.isArray(value) ? (value as unknown[]).map(String) : []
      return (
        <label className="field span-all">
          {label}
          <textarea rows={4} value={arr.join('\n')} onChange={(e) => {
            const lines = e.target.value.split('\n')
            onChange(lines.length === 1 && lines[0] === '' ? undefined : lines)
          }} />
        </label>
      )
    }
    case 'vec3': {
      const arr = Array.isArray(value) ? (value as number[]) : [0, 0, 0]
      return (
        <div className="field span-all">
          {label}
          <div className="grid-3">
            {['x', 'y', 'z'].map((axis, i) => (
              <input
                key={axis}
                type="number"
                step={0.05}
                aria-label={axis}
                placeholder={axis}
                value={typeof arr[i] === 'number' ? arr[i] : ''}
                onChange={(e) => {
                  const next = [0, 1, 2].map((j) => (typeof arr[j] === 'number' ? arr[j] : 0))
                  next[i] = Number(e.target.value)
                  onChange(next)
                }}
              />
            ))}
          </div>
        </div>
      )
    }
    case 'kv': {
      const obj = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, string>) : {}
      const entries = Object.entries(obj)
      const write = (list: [string, string][]) => onChange(list.length ? Object.fromEntries(list) : undefined)
      return (
        <div className="field span-all">
          {label}
          {entries.map(([k, v], idx) => (
            <div className="kv-row" key={idx}>
              <input type="text" value={k} placeholder="key" aria-label="Metadata key" onChange={(e) => write(entries.map((en, j) => (j === idx ? [e.target.value, en[1]] : en)))} />
              <input type="text" value={v} placeholder="value" aria-label="Metadata value" onChange={(e) => write(entries.map((en, j) => (j === idx ? [en[0], e.target.value] : en)))} />
              <button type="button" className="btn small ghost" onClick={() => write(entries.filter((_, j) => j !== idx))} aria-label="Remove">✕</button>
            </div>
          ))}
          <div>
            <button type="button" className="btn small" onClick={() => write([...entries, [`field${entries.length + 1}`, '']])}>+ Add field</button>
          </div>
        </div>
      )
    }
    default:
      return (
        <label className="field">
          {label}
          <input type="text" value={typeof value === 'string' ? value : value === undefined ? '' : String(value)} onChange={(e) => str(e.target.value)} />
          {hint}
        </label>
      )
  }
}

/* ------------------------------------------------------------------ */

function TextsEditor({ onSaved }: { onSaved: () => void }) {
  const [ex, setEx] = useState<ExhibitionText | null>(null)
  const [welcome, setWelcome] = useState<{ title: string; body: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  useEffect(() => {
    api
      .content()
      .then((c) => {
        setEx({ ...c.exhibition })
        setWelcome({ ...c.welcome })
      })
      .catch((e) => toast(errMsg(e), 'error'))
  }, [toast])

  async function save() {
    if (!ex || !welcome) return
    setBusy(true)
    try {
      await api.putExhibition(ex)
      await api.putWelcome(welcome)
      toast('Exhibition text & welcome saved')
      onSaved()
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!ex || !welcome) return <p className="muted">Loading…</p>
  return (
    <div style={{ maxWidth: 820 }}>
      <section className="card">
        <h2>Reveal-wall title</h2>
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
      </section>
      <section className="card">
        <h2>Reception welcome</h2>
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
        <div className="save-bar">
          <button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save texts'}</button>
        </div>
      </section>
    </div>
  )
}
