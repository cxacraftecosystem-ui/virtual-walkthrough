import { useEffect, useMemo, useState } from 'react'
import { api, type MediaRecord } from '../api'
import { type AdminArtisan, exApi } from '../exhibitionsApi'
import { errMsg, useConfirm, useToast, useUnsavedGuard } from '../ui'
import '../exhibitions.css'

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/
const URL_RE = /^https?:\/\/\S+$/i
const PLACEHOLDER = 'Artisan profile — to be supplied by the workshop'

const blank = (id: string): AdminArtisan => ({
  id,
  name: PLACEHOLDER,
  cluster: '',
  craft: 'Hand block printing',
  bio: `${PLACEHOLDER}.`,
  portrait: '',
  contact: '',
  website: '',
  shopUrl: '',
  commissionUrl: '',
  verified: false,
  placeholder: true,
  sort: 0,
})

/**
 * Makers ("Meet the maker"): artisan profiles shown in the museum's info panel and on
 * /makers/<id>. Curators and above. Enter only what the workshop supplied and approved.
 * Link a profile to an artwork / exhibit with its `artisanId` field (Content page).
 */
export function MakersPage() {
  const [list, setList] = useState<AdminArtisan[] | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [draft, setDraft] = useState<AdminArtisan | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [newId, setNewId] = useState('')
  const [media, setMedia] = useState<MediaRecord[]>([])
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const confirm = useConfirm()

  useEffect(() => {
    exApi
      .artisans()
      .then((l) => {
        setList(l)
        if (l[0]) {
          setSel(l[0].id)
          setDraft(l[0])
        }
      })
      .catch((e) => toast(errMsg(e), 'error'))
    api.media().then(setMedia).catch(() => undefined)
  }, [toast])

  const images = useMemo(() => media.filter((m) => m.mime.startsWith('image/')), [media])
  const saved = list?.find((a) => a.id === sel)
  const dirty = isNew || (draft && saved && JSON.stringify(draft) !== JSON.stringify(saved))
  const urlErrors = draft ? (['website', 'shopUrl', 'commissionUrl'] as const).filter((k) => draft[k] && !URL_RE.test(draft[k])) : []

  useUnsavedGuard(!!dirty)

  async function pick(a: AdminArtisan) {
    if (dirty && !(await confirm({ title: 'Discard unsaved changes?', body: 'Your edits to this maker profile have not been saved.', confirmLabel: 'Discard', danger: true }))) return
    setSel(a.id)
    setDraft(a)
    setIsNew(false)
  }

  function create() {
    const id = newId.trim()
    if (!ID_RE.test(id)) return toast('Id: letters, digits, "-", "_", "." (max 100)', 'error')
    if (list?.some((a) => a.id === id)) return toast(`"${id}" already exists`, 'error')
    setSel(id)
    setDraft(blank(id))
    setIsNew(true)
    setNewId('')
  }

  async function save() {
    if (!draft) return
    setBusy(true)
    try {
      const a = await exApi.putArtisan(draft)
      setList((l) => {
        const rest = (l ?? []).filter((x) => x.id !== a.id)
        return [...rest, a].sort((x, y) => x.sort - y.sort || x.name.localeCompare(y.name))
      })
      setDraft(a)
      setIsNew(false)
      toast(`Saved “${a.name}”`)
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!draft) return
    if (isNew) {
      setDraft(null)
      setSel(null)
      setIsNew(false)
      return
    }
    if (!(await confirm({ title: `Delete “${draft.name}”?`, body: 'Items that reference this maker simply stop showing a maker card.', confirmLabel: 'Delete profile', danger: true }))) return
    setBusy(true)
    try {
      await exApi.deleteArtisan(draft.id)
      setList((l) => (l ?? []).filter((x) => x.id !== draft.id))
      setDraft(null)
      setSel(null)
      toast('Deleted')
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const set = <K extends keyof AdminArtisan>(k: K, v: AdminArtisan[K]) => draft && setDraft({ ...draft, [k]: v })
  const text = (k: 'name' | 'cluster' | 'craft' | 'contact' | 'website' | 'shopUrl' | 'commissionUrl', label: string, hint?: string, span = false) => (
    <label className={`field${span ? ' span-all' : ''}`}>
      <span>{label}{k === 'name' && <span className="req"> *</span>}</span>
      <input type={k.endsWith('Url') || k === 'website' ? 'url' : 'text'} value={draft?.[k] ?? ''} onChange={(e) => set(k, e.target.value)} aria-invalid={(urlErrors as readonly string[]).includes(k)} />
      {hint && <span className="hint">{hint}</span>}
    </label>
  )

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Makers</h1>
          <p className="muted">
            “Meet the maker” profiles (shared by all exhibitions). Enter only information the workshop has supplied and approved — never invent details about real
            people. Link a profile from an artwork or exhibit with its <span className="mono">artisanId</span> field.
          </p>
        </div>
      </div>
      {!list ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="editor">
          <aside className="card item-list">
            <div className="list-head">
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault()
                  create()
                }}
              >
                <input type="text" placeholder="new-maker-id" value={newId} onChange={(e) => setNewId(e.target.value)} style={{ flex: 1 }} aria-label="New maker id" />
                <button className="btn small primary">+ New</button>
              </form>
            </div>
            <ul>
              {list.map((a) => (
                <li key={a.id}>
                  <button className={a.id === sel ? 'active' : ''} onClick={() => pick(a)}>
                    <span className="t">{a.name}</span>
                    <span className="i">
                      {a.id}
                      {a.placeholder && <span className="badge warn">placeholder</span>}
                      {a.verified && <span className="badge ok">verified</span>}
                    </span>
                  </button>
                </li>
              ))}
              {isNew && draft && (
                <li>
                  <button className="active">
                    <span className="t">{draft.name}</span>
                    <span className="i">{draft.id} <span className="badge">unsaved</span></span>
                  </button>
                </li>
              )}
              {list.length === 0 && !isNew && <li className="empty small">No profiles yet</li>}
            </ul>
          </aside>
          {draft ? (
            <section className="card">
              <div className="form-head">
                <h2>{draft.name || draft.id}</h2>
                <span className="mono muted">makers/{draft.id}</span>
                {!isNew && <a className="small" href={`/makers/${encodeURIComponent(draft.id)}`} target="_blank" rel="noreferrer">Public page ↗</a>}
              </div>
              <div className="group">
                <h3>Profile</h3>
                <div className="grid-2">
                  {text('name', 'Name', 'As the maker wishes to be credited', true)}
                  {text('craft', 'Craft')}
                  {text('cluster', 'Cluster / region', 'Free text, exactly as supplied')}
                  <label className="field span-all">
                    <span>Biography</span>
                    <textarea rows={6} value={draft.bio} onChange={(e) => set('bio', e.target.value)} />
                    <span className="hint">The info panel shows the first ~180 characters; the full text is on the maker page.</span>
                  </label>
                  <label className="field span-all">
                    <span>Portrait image</span>
                    <div className="media-input">
                      {draft.portrait && <img className="mk-portrait" src={draft.portrait} alt="" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />}
                      <input type="text" list="mk-images" value={draft.portrait} placeholder="/media/artworks/… or https://…" onChange={(e) => set('portrait', e.target.value)} />
                      <datalist id="mk-images">
                        {images.map((m) => (
                          <option key={m.id} value={m.url}>{m.filename}</option>
                        ))}
                      </datalist>
                    </div>
                    <span className="hint">Only with the maker&apos;s consent. Upload on the Media page first.</span>
                  </label>
                </div>
              </div>
              <div className="group">
                <h3>Links (buttons appear only when filled)</h3>
                <div className="grid-2">
                  {text('website', '“Visit the maker” URL', 'https://…')}
                  {text('commissionUrl', '“Commission” URL', 'https://…')}
                  {text('shopUrl', '“Buy (fair trade)” URL', 'The maker’s or cooperative’s own shop')}
                  {text('contact', 'Contact (shown on the maker page)', 'Only if the maker wants it public')}
                </div>
                {urlErrors.length > 0 && <p className="alert" style={{ marginTop: 8 }}>Links must start with http:// or https://</p>}
              </div>
              <div className="group">
                <h3>Flags</h3>
                <label className="check span-all">
                  <input type="checkbox" checked={draft.placeholder} onChange={(e) => set('placeholder', e.target.checked)} /> Placeholder profile (labelled as such in the museum)
                </label>
                <label className="check span-all">
                  <input type="checkbox" checked={draft.verified} onChange={(e) => set('verified', e.target.checked)} /> Verified — details confirmed by the workshop / maker
                </label>
                <label className="field" style={{ maxWidth: 160, marginTop: 8 }}>
                  <span>Sort order</span>
                  <input type="number" value={draft.sort} onChange={(e) => set('sort', Number(e.target.value) || 0)} />
                </label>
              </div>
              <div className="save-bar">
                <button className="btn primary" onClick={save} disabled={busy || !dirty || !draft.name.trim() || urlErrors.length > 0}>
                  {busy ? 'Saving…' : isNew ? 'Create' : 'Save changes'}
                </button>
                {!isNew && saved && (
                  <button className="btn ghost" onClick={() => setDraft(saved)} disabled={busy || !dirty}>Revert</button>
                )}
                {dirty && <span className="dirty">{isNew ? 'Not saved yet' : 'Unsaved changes'}</span>}
                <span className="spacer" />
                <button className="btn danger small" onClick={remove} disabled={busy}>{isNew ? 'Discard' : 'Delete'}</button>
              </div>
            </section>
          ) : (
            <div className="card empty">Select a profile or create a new one.</div>
          )}
        </div>
      )}
    </>
  )
}
