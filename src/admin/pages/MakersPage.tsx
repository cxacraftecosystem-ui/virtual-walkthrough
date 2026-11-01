/**
 * Makers (#/makers, curator+): the "Meet the maker" profiles shown in the museum's info panel and on
 * /makers/<id>. Profiles belong to this museum and are shared by all of its exhibitions; an item
 * names its maker with the "Maker profile id" field on the Content page. Enter only what the workshop
 * has supplied and approved — never invent details about real people.
 *
 * - A searchable list and an editor (Field primitives). Portrait through the media picker (upload in
 *   place). Ctrl/Cmd+S saves; unsaved edits are guarded (switching maker, leaving the page, closing).
 * - New maker: a name, and an id made from it (editable) — like new content items.
 * - "Used by N items" lists the content that names this maker; deleting a maker still in use needs the
 *   word typed, and a delete can be undone from the toast.
 * - `#/makers/<id>` selects a maker; `#/makers/+new` opens the new-maker dialog.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type AdminArtisan, type ArtisanUsage, exApi, setSelectedExhibition } from '../exhibitionsApi'
import { MediaPicker } from '../MediaPicker'
import { safeUrl } from '../safeUrl'
import {
  Badge,
  Button,
  ButtonRow,
  EmptyState,
  Field,
  Icon,
  IconButton,
  Input,
  Kbd,
  Modal,
  PageHeader,
  SearchInput,
  Skeleton,
  Switch,
  Textarea,
  errMsg,
  useConfirm,
  useConfirmLeave,
  useToast,
  useUnsavedGuard,
} from '../ui'
import { hashTail, plural } from './triage'
import '../exhibitions.css'
import './operations.css'

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/
const URL_RE = /^https?:\/\/\S+$/i
const COLLECTION_LABEL: Record<string, string> = { artworks: 'Artwork', exhibits: 'Exhibit', infographics: 'Infographic', videos: 'Video', objects: 'Object' }
type LinkKey = 'website' | 'commissionUrl' | 'shopUrl'
const LINK_KEYS: LinkKey[] = ['website', 'commissionUrl', 'shopUrl']

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)

const blank = (id: string, name: string): AdminArtisan => ({
  id,
  name: name || 'New maker',
  cluster: '',
  craft: '',
  bio: '',
  portrait: '',
  contact: '',
  website: '',
  shopUrl: '',
  commissionUrl: '',
  verified: false,
  placeholder: true,
  sort: 0,
})
const bySort = (a: AdminArtisan, b: AdminArtisan) => a.sort - b.sort || a.name.localeCompare(b.name)
const same = (a: AdminArtisan | null | undefined, b: AdminArtisan | null | undefined) => JSON.stringify(a) === JSON.stringify(b)

export function MakersPage() {
  const [list, setList] = useState<AdminArtisan[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [draft, setDraft] = useState<AdminArtisan | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [creating, setCreating] = useState(false)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [picking, setPicking] = useState(false)
  const [usage, setUsage] = useState<{ id: string; items: ArtisanUsage[] | null; error?: string } | null>(null)
  const toast = useToast()
  const confirm = useConfirm()
  const leave = useConfirmLeave()
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const saved = list?.find((a) => a.id === sel) ?? null
  const dirty = !!draft && (isNew || !same(draft, saved))
  useUnsavedGuard(dirty)

  const urlErrors = useMemo(() => {
    const out: Partial<Record<LinkKey, string>> = {}
    if (draft) for (const k of LINK_KEYS) if (draft[k] && !URL_RE.test(draft[k].trim())) out[k] = 'Start with http:// or https://'
    return out
  }, [draft])
  const nameError = draft && !draft.name.trim() ? 'A name is required' : ''
  const valid = !nameError && Object.keys(urlErrors).length === 0

  const select = useCallback((a: AdminArtisan | null, writeHash = true) => {
    setSel(a?.id ?? null)
    setDraft(a)
    setIsNew(false)
    setSaveError('')
    if (writeHash) window.history.replaceState(null, '', a ? `#/makers/${encodeURIComponent(a.id)}` : '#/makers')
  }, [])

  // first load: honour #/makers/<id> and #/makers/+new
  useEffect(() => {
    exApi
      .artisans()
      .then((l) => {
        const sorted = [...l].sort(bySort)
        setList(sorted)
        const tail = hashTail('makers')
        if (tail === '+new') {
          setCreating(true)
          window.history.replaceState(null, '', '#/makers')
        }
        const hit = tail && tail !== '+new' ? sorted.find((a) => a.id === tail) : null
        if (hit) select(hit, false)
        else if (sorted[0] && tail !== '+new') select(sorted[0], false)
      })
      .catch((e) => setLoadError(errMsg(e)))
  }, [select])

  // browser back/forward between makers: ask before dropping edits
  const liveRef = useRef({ list, sel, dirty, select, leave })
  useEffect(() => {
    liveRef.current = { list, sel, dirty, select, leave }
  })
  useEffect(() => {
    const onHash = () => {
      // a navigation from the shell remounts this page; let that happen first
      setTimeout(async () => {
        if (!alive.current) return
        const { list: l, sel: s, dirty: d, select: pick, leave: ask } = liveRef.current
        const tail = hashTail('makers')
        if (!window.location.hash.startsWith('#/makers')) return
        if (tail === '+new') {
          window.history.replaceState(null, '', s ? `#/makers/${encodeURIComponent(s)}` : '#/makers')
          setCreating(true)
          return
        }
        if (!tail || tail === s) return
        const hit = l?.find((a) => a.id === tail)
        if (!hit) return
        if (d && !(await ask('Your unsaved changes to this maker will be lost.'))) {
          window.history.replaceState(null, '', s ? `#/makers/${encodeURIComponent(s)}` : '#/makers')
          return
        }
        pick(hit, false)
      }, 0)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // where the selected maker is used
  useEffect(() => {
    if (!sel || isNew) {
      setUsage(null)
      return
    }
    let on = true
    setUsage({ id: sel, items: null })
    exApi
      .artisanUsage(sel)
      .then((r) => on && setUsage({ id: sel, items: r.usage }))
      .catch((e) => on && setUsage({ id: sel, items: null, error: errMsg(e) }))
    return () => {
      on = false
    }
  }, [sel, isNew])

  async function pick(a: AdminArtisan) {
    if (a.id === sel && !isNew) return
    if (dirty && !(await leave('Your unsaved changes to this maker will be lost.'))) return
    select(a)
  }

  async function startNew() {
    if (dirty && !(await leave('Your unsaved changes to this maker will be lost.'))) return
    setCreating(true)
  }

  function create(id: string, name: string) {
    setCreating(false)
    setSel(id)
    setDraft(blank(id, name))
    setIsNew(true)
    setSaveError('')
    window.history.replaceState(null, '', '#/makers')
  }

  const save = useCallback(async () => {
    if (!draft || busy || !dirty || !valid) return
    setBusy(true)
    setSaveError('')
    try {
      const clean: AdminArtisan = { ...draft, name: draft.name.trim(), website: draft.website.trim(), shopUrl: draft.shopUrl.trim(), commissionUrl: draft.commissionUrl.trim() }
      const a = await exApi.putArtisan(clean)
      setList((l) => [...(l ?? []).filter((x) => x.id !== a.id), a].sort(bySort))
      setDraft(a)
      setSel(a.id)
      const wasNew = isNew
      setIsNew(false)
      window.history.replaceState(null, '', `#/makers/${encodeURIComponent(a.id)}`)
      toast(`“${a.name}”`, 'ok', { title: wasNew ? 'Maker created' : 'Saved' })
    } catch (e) {
      setSaveError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }, [draft, busy, dirty, valid, isNew, toast])

  // Ctrl/Cmd+S
  useEffect(() => {
    if (!draft) return
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's' || e.altKey || e.shiftKey) return
      if (document.querySelector('dialog[open]')) return
      e.preventDefault()
      void save()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [draft, save])

  async function remove() {
    if (!draft) return
    if (isNew) {
      if (!(await leave('This new maker hasn’t been saved.'))) return
      select(list?.[0] ?? null)
      return
    }
    const victim = saved ?? draft
    setBusy(true)
    let items: ArtisanUsage[] | null
    try {
      items = (await exApi.artisanUsage(victim.id)).usage
    } catch {
      items = null
    }
    setBusy(false)
    const n = items?.length ?? 0
    const ok = await confirm({
      title: `Delete “${victim.name}”?`,
      body: (
        <>
          {items === null ? (
            <p>Couldn’t check which items name this maker. Any that do will stop showing a maker card.</p>
          ) : n ? (
            <>
              <p>{plural(n, 'item')} name{n === 1 ? 's' : ''} this maker and will stop showing a maker card:</p>
              <ul className="mx-usage-mini">
                {items.slice(0, 5).map((u) => (
                  <li key={`${u.exhibitionId}/${u.collection}/${u.id}`}>
                    {COLLECTION_LABEL[u.collection] ?? u.collection} “{u.title || u.id}”
                  </li>
                ))}
                {n > 5 ? <li className="muted">and {n - 5} more</li> : null}
              </ul>
            </>
          ) : (
            <p>No item names this maker.</p>
          )}
          {dirty ? <p>Unsaved edits to this profile are discarded too.</p> : null}
        </>
      ),
      confirmLabel: 'Delete profile',
      danger: true,
      typeToConfirm: n || items === null ? 'delete' : undefined,
    })
    if (!ok) return
    setBusy(true)
    try {
      await exApi.deleteArtisan(victim.id)
      const rest = (list ?? []).filter((x) => x.id !== victim.id)
      setList(rest)
      select(rest[0] ?? null)
      toast(`“${victim.name}”`, 'ok', {
        title: 'Maker deleted',
        action: {
          label: 'Undo',
          onClick: () => {
            exApi
              .putArtisan(victim)
              .then((a) => {
                setList((l) => [...(l ?? []).filter((x) => x.id !== a.id), a].sort(bySort))
                toast(`“${a.name}” is back`)
              })
              .catch((e) => toast(errMsg(e), 'error'))
          },
        },
      })
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const set = <K extends keyof AdminArtisan>(k: K, v: AdminArtisan[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d))

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (list ?? []).filter((a) => !s || [a.name, a.id, a.craft, a.cluster].some((v) => v.toLowerCase().includes(s)))
  }, [list, q])
  const portrait = draft ? safeUrl(draft.portrait, 'image') : undefined
  const n = usage && usage.id === sel ? usage.items?.length : undefined

  return (
    <>
      <PageHeader
        icon="makers"
        title="Makers"
        description="“Meet the maker” profiles, shared by every exhibition in this museum. Enter only what the workshop has supplied and approved."
        actions={<Button variant="primary" icon="plus" onClick={() => void startNew()} disabled={!list}>New maker</Button>}
      />
      {loadError ? <p className="alert" role="alert">{loadError}</p> : null}

      {!list ? (
        loadError ? null : (
          <div className="editor">
            <div className="card item-list"><Skeleton kind="list" rows={6} /></div>
            <Skeleton kind="form" rows={6} />
          </div>
        )
      ) : (
        <div className="editor">
          <aside className="card item-list" aria-label="Maker profiles">
            <div className="list-head">
              <SearchInput value={q} onChange={setQ} label="Search makers" placeholder="Search name, craft, place" />
            </div>
            <ul>
              {isNew && draft ? (
                <li>
                  <button type="button" className="active" aria-current="true">
                    <span className="li-thumb mk-li-thumb" aria-hidden="true"><Icon name="user" /></span>
                    <span className="li-text">
                      <span className="t">{draft.name || draft.id}</span>
                      <span className="i">
                        {draft.id} <Badge tone="info">Not saved</Badge>
                      </span>
                    </span>
                  </button>
                </li>
              ) : null}
              {shown.map((a) => {
                const thumb = safeUrl(a.portrait, 'image')
                const active = a.id === sel && !isNew
                return (
                  <li key={a.id}>
                    <button type="button" className={active ? 'active' : ''} aria-current={active || undefined} onClick={() => void pick(a)}>
                      <span className="li-thumb mk-li-thumb" aria-hidden="true">{thumb ? <img src={thumb} alt="" loading="lazy" /> : <Icon name="user" />}</span>
                      <span className="li-text">
                        <span className="t">{active && draft ? draft.name || a.name : a.name}</span>
                        <span className="i">
                          {a.craft || a.id}
                          {a.placeholder ? <Badge tone="warn">Hidden</Badge> : null}
                          {a.verified ? <Badge tone="ok">Verified</Badge> : null}
                          {active && dirty ? <Badge tone="info">Unsaved</Badge> : null}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
              {list.length === 0 && !isNew ? <li className="empty small">No profiles yet</li> : null}
              {list.length > 0 && shown.length === 0 ? <li className="empty small">Nothing matches “{q}”.</li> : null}
            </ul>
            <div className="list-foot">{plural(list.length, 'profile')}{q && shown.length !== list.length ? ` · ${shown.length} shown` : ''}</div>
          </aside>

          {draft ? (
            <section className="card" aria-labelledby="mk-title">
              <div className="form-head">
                <div className="fh-text">
                  <h2 id="mk-title">{draft.name || draft.id}</h2>
                  <span className="fh-meta">
                    <span className="mono muted">{draft.id}</span>
                    {isNew ? <Badge tone="info">Not saved</Badge> : n === undefined ? null : n ? <Badge tone="neutral">Used by {plural(n, 'item')}</Badge> : <Badge tone="neutral">Not used yet</Badge>}
                    {draft.placeholder ? <Badge tone="warn">Hidden from visitors</Badge> : null}
                  </span>
                </div>
                {!isNew ? (
                  <ButtonRow>
                    <Button size="sm" icon="activity" href={`#/activity?target=artisan:${encodeURIComponent(draft.id)}`}>History</Button>
                    <Button size="sm" icon="external" href={`/makers/${encodeURIComponent(draft.id)}`} target="_blank" rel="noreferrer">
                      Public page<span className="sr-only"> (opens in a new tab)</span>
                    </Button>
                  </ButtonRow>
                ) : null}
              </div>

              <div className="group">
                <h3>Profile</h3>
                <div className="grid-2">
                  <Field label="Name" required error={nameError || undefined} hint="As the maker wishes to be credited" className="span-all">
                    <Input value={draft.name} onChange={(e) => set('name', e.target.value)} autoComplete="off" />
                  </Field>
                  <Field label="Craft">
                    <Input value={draft.craft} onChange={(e) => set('craft', e.target.value)} />
                  </Field>
                  <Field label="Cluster or region" hint="Exactly as supplied">
                    <Input value={draft.cluster} onChange={(e) => set('cluster', e.target.value)} />
                  </Field>
                  <Field label="Biography" hint="The info panel shows the first 180 or so characters; the maker page shows all of it." className="span-all">
                    <Textarea rows={6} value={draft.bio} onChange={(e) => set('bio', e.target.value)} />
                  </Field>
                  <Field label="Portrait" hint="Only with the maker’s consent." className="span-all" group>
                    {(w) => (
                      <div className="media-input">
                        <span className="mk-portrait-slot" aria-hidden="true">{portrait ? <img src={portrait} alt="" /> : <Icon name="user" />}</span>
                        <Input {...w} value={draft.portrait} placeholder="Choose from the media library, or paste an address" onChange={(e) => set('portrait', e.target.value)} spellCheck={false} />
                        <Button icon="image" onClick={() => setPicking(true)}>Choose…</Button>
                        {draft.portrait ? <IconButton icon="close" label="Clear the portrait" onClick={() => set('portrait', '')} /> : null}
                      </div>
                    )}
                  </Field>
                </div>
              </div>

              <div className="group">
                <h3>Links <span className="hint">Each button appears only when its address is filled in.</span></h3>
                <div className="grid-2">
                  <Field label="“Visit the maker” address" error={urlErrors.website}>
                    <Input type="url" value={draft.website} onChange={(e) => set('website', e.target.value)} placeholder="https://…" spellCheck={false} />
                  </Field>
                  <Field label="“Commission” address" error={urlErrors.commissionUrl}>
                    <Input type="url" value={draft.commissionUrl} onChange={(e) => set('commissionUrl', e.target.value)} placeholder="https://…" spellCheck={false} />
                  </Field>
                  <Field label="“Buy (fair trade)” address" hint="The maker’s or cooperative’s own shop" error={urlErrors.shopUrl}>
                    <Input type="url" value={draft.shopUrl} onChange={(e) => set('shopUrl', e.target.value)} placeholder="https://…" spellCheck={false} />
                  </Field>
                  <Field label="Contact" hint="Shown on the maker page — only if the maker wants it public">
                    <Input value={draft.contact} onChange={(e) => set('contact', e.target.value)} />
                  </Field>
                </div>
              </div>

              <div className="group">
                <h3>Visibility</h3>
                <Switch
                  checked={draft.placeholder}
                  onChange={(v) => set('placeholder', v)}
                  label="Hidden from visitors"
                  description={
                    draft.placeholder
                      ? 'Hidden: no maker card in the museum and no public maker page. Turn this off once the workshop has supplied and approved the profile.'
                      : 'Shown: items that name this maker show its card, and /makers/' + draft.id + ' is public.'
                  }
                />
                <Switch checked={draft.verified} onChange={(v) => set('verified', v)} label="Verified" description="The workshop or the maker has confirmed these details." />
                <Field label="Order" hint="Lower numbers come first in lists." className="mk-sort">
                  <Input type="number" inputMode="numeric" value={String(draft.sort)} onChange={(e) => set('sort', Number(e.target.value) || 0)} />
                </Field>
              </div>

              {!isNew ? (
                <div className="group">
                  <h3>Used by</h3>
                  {!usage || usage.id !== sel || (usage.items === null && !usage.error) ? (
                    <Skeleton kind="list" rows={2} />
                  ) : usage.error ? (
                    <p className="muted small" style={{ margin: 0 }}>Couldn’t check: {usage.error}</p>
                  ) : usage.items && usage.items.length ? (
                    <ul className="mx-usage">
                      {usage.items.map((u) => (
                        <li key={`${u.exhibitionId}/${u.collection}/${u.id}`}>
                          <a href={`#/content/${u.collection}/${encodeURIComponent(u.id)}`} onClick={() => setSelectedExhibition(u.exhibitionId)}>
                            <Icon name="content" />
                            <span className="grow">
                              <span className="truncate" style={{ display: 'block', fontWeight: 500 }}>{u.title || u.id}</span>
                              <span className="muted small">{COLLECTION_LABEL[u.collection] ?? u.collection} · {u.exhibitionId}</span>
                            </span>
                            <Icon name="chevronRight" />
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted small" style={{ margin: 0 }}>No item names this maker yet. Use the “Maker profile id” field on an artwork or exhibit.</p>
                  )}
                </div>
              ) : null}

              {saveError ? <p className="alert" role="alert" style={{ marginTop: 16 }}>{saveError}</p> : null}
              <div className={`save-bar${dirty ? ' is-dirty' : ''}`}>
                <Button variant="primary" icon="check" onClick={() => void save()} loading={busy} loadingLabel="Saving…" disabled={!dirty || !valid} aria-keyshortcuts="Control+S Meta+S">
                  {isNew ? 'Create' : 'Save changes'}
                </Button>
                {!isNew && saved ? (
                  <Button variant="ghost" onClick={() => setDraft(saved)} disabled={busy || !dirty}>Revert</Button>
                ) : null}
                {dirty ? <span className="dirty">{isNew ? 'Not saved' : 'Unsaved changes'}</span> : <span className="muted small hide-phone"><Kbd>Ctrl</Kbd> <Kbd>S</Kbd> saves</span>}
                <span className="spacer" />
                <Button variant="danger" size="sm" icon="trash" onClick={() => void remove()} disabled={busy}>{isNew ? 'Discard' : 'Delete'}</Button>
              </div>
            </section>
          ) : (
            <div className="card">
              <EmptyState icon="makers" title={list.length ? 'Choose a maker' : 'No maker profiles yet'} action={<Button variant="primary" icon="plus" onClick={() => void startNew()}>New maker</Button>}>
                {list.length ? 'Pick a profile from the list, or start a new one.' : 'Add a profile once the workshop has supplied one.'}
              </EmptyState>
            </div>
          )}
        </div>
      )}

      {creating && list ? <NewMakerDialog existing={list} onCreate={create} onClose={() => setCreating(false)} /> : null}
      {picking && draft ? (
        <MediaPicker
          accept="image"
          value={draft.portrait}
          onClose={() => setPicking(false)}
          onPick={(url) => {
            set('portrait', url)
            setPicking(false)
          }}
        />
      ) : null}
    </>
  )
}

export default MakersPage

function NewMakerDialog({ existing, onCreate, onClose }: { existing: AdminArtisan[]; onCreate: (id: string, name: string) => void; onClose: () => void }) {
  const [name, setName] = useState('')
  const [id, setId] = useState('')
  const [idTouched, setIdTouched] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const effectiveId = idTouched ? id.trim() : slugify(name)
  const nameError = !name.trim() ? 'A name is required' : ''
  const idError = !effectiveId
    ? 'An id is required'
    : !ID_RE.test(effectiveId)
      ? 'Letters, digits, “-”, “_” or “.”, starting with a letter or digit (max 100)'
      : existing.some((a) => a.id === effectiveId)
        ? `“${effectiveId}” is already a maker here`
        : ''
  const submit = () => {
    setSubmitted(true)
    if (!nameError && !idError) onCreate(effectiveId, name.trim())
  }
  return (
    <Modal
      title="New maker"
      size="small"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit}>Start profile</Button>
        </>
      }
    >
      <form
        className="mk-new"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        noValidate
      >
        <Field label="Name" required error={submitted && nameError ? nameError : undefined}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="As the maker wishes to be credited" data-autofocus autoComplete="off" />
        </Field>
        <Field
          label="Id"
          required
          error={submitted && idError ? idError : undefined}
          hint="Permanent — used in /makers/… links and by the items that name this maker."
        >
          <Input
            className="mono"
            value={effectiveId}
            onChange={(e) => {
              setIdTouched(true)
              setId(e.target.value)
            }}
            spellCheck={false}
            autoComplete="off"
          />
        </Field>
        <button hidden type="submit" />
      </form>
      <p className="muted small" style={{ margin: '12px 0 0' }}>The profile starts hidden from visitors. Nothing is saved until you press Create.</p>
    </Modal>
  )
}
