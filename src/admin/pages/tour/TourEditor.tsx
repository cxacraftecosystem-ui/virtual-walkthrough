/**
 * Guided-tour editor for one exhibition: an ordered list of stops (drag, or the handle's ↑/↓ keys,
 * to reorder; add, duplicate, remove) and a form for the selected stop — place, title, caption, where
 * the visitor stands and looks, the item the caption opens, how long to linger, Hindi / Bengali.
 * "Paste stop from museum" takes the staff tools' "Copy view as tour stop". The raw JSON stays
 * available under Advanced. No stops = the bundled tour.
 */
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { BUNDLED_TOUR_STOPS } from '../../../museum/config/tour'
import { request, type Item } from '../../api'
import { EXHIBITIONS_CHANGED } from '../../ExhibitionSwitcher'
import { exApi, type AdminExhibition } from '../../exhibitionsApi'
import { LANGS, getPath, setPath } from '../../fields'
import {
  Badge,
  Button,
  ButtonRow,
  Combobox,
  EmptyState,
  Field,
  Icon,
  IconButton,
  Input,
  Modal,
  Select,
  Skeleton,
  Tabs,
  Textarea,
  errMsg,
  useConfirm,
  useToast,
  useUnsavedGuard,
  type ComboOption,
  type SelectOption,
} from '../../ui'
import { COLLECTIONS, slugify, titleOf, uniqueId } from '../content/model'
import { tourIsDirty } from './dirty'
import { ITEM_KINDS, parsePastedStops, stopIndexOf, validateStops, type StopItemKind } from './validate'

type Stop = { key: string; data: Record<string, unknown> }
let keySeq = 0
const wrap = (data: Record<string, unknown>): Stop => ({ key: `s${++keySeq}`, data })
const plain = (stops: Stop[]) => stops.map((s) => s.data)
const KIND_LABEL: Record<StopItemKind, string> = { artwork: 'Artwork', exhibit: 'Exhibit', infographic: 'Panel', object: 'Object', video: 'Film' }
const KIND_OPTIONS: SelectOption[] = ITEM_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))

export function TourEditor({ exhibition }: { exhibition: AdminExhibition }) {
  const [stops, setStops] = useState<Stop[] | null>(null)
  const [saved, setSaved] = useState<string>('[]')
  const [custom, setCustom] = useState(false)
  const [sel, setSel] = useState(0)
  const [view, setView] = useState<'stops' | 'json'>('stops')
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [serverError, setServerError] = useState<{ field: string; message: string } | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pasting, setPasting] = useState(false)
  const [items, setItems] = useState<Record<StopItemKind, ComboOption[]> | null>(null)
  const [announce, setAnnounce] = useState('')
  const dragFrom = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const toast = useToast()
  const confirm = useConfirm()

  // edits typed under Advanced count before "Apply text": they arm the guard and enable Save
  const dirty = tourIsDirty({ stops: stops && plain(stops), saved, view, jsonText })
  useUnsavedGuard(dirty && !busy)

  useEffect(() => {
    let alive = true
    setStops(null)
    setLoadError('')
    exApi
      .tour(exhibition.id)
      .then((t) => {
        if (!alive) return
        const list = Array.isArray(t) ? t.filter((s): s is Record<string, unknown> => !!s && typeof s === 'object') : []
        setCustom(list.length > 0)
        setStops(list.map(wrap))
        setSaved(JSON.stringify(list))
        setSel(0)
      })
      .catch((e) => alive && setLoadError(errMsg(e)))
    return () => {
      alive = false
    }
  }, [exhibition.id])

  // items of this exhibition, for the "item" picker and the existence check
  useEffect(() => {
    let alive = true
    Promise.all(
      COLLECTIONS.map((c) =>
        request<Item[]>('GET', `/api/admin/content/${c.id}?exhibition=${encodeURIComponent(exhibition.id)}`)
          .then((l) => [c.kind, l.map((i) => ({ value: i.id, label: titleOf(i), description: i.id }))] as const)
          .catch(() => [c.kind, [] as ComboOption[]] as const),
      ),
    ).then((pairs) => alive && setItems(Object.fromEntries(pairs) as Record<StopItemKind, ComboOption[]>))
    return () => {
      alive = false
    }
  }, [exhibition.id])

  const errors = useMemo(() => (stops ? validateStops(plain(stops)) : {}), [stops])
  const errorKeys = Object.keys(errors)
  const errOf = (i: number, path: string) => (showErrors ? errors[`stops[${i}].${path}`] : undefined) ?? (serverError?.field === `stops[${i}].${path}` ? serverError.message : undefined)
  const stopHasError = (i: number) => (showErrors && errorKeys.some((k) => stopIndexOf(k) === i)) || (serverError ? stopIndexOf(serverError.field) === i : false)
  const itemMissing = (s: Record<string, unknown>) => {
    const it = s.item as { kind?: StopItemKind; id?: string } | undefined
    if (!it?.kind || !it.id || !items) return false
    return !items[it.kind]?.some((o) => o.value === it.id)
  }

  const takenIds = (list: Stop[]) => list.map((s) => (typeof s.data.id === 'string' ? s.data.id : '')).filter(Boolean)
  const editStop = (i: number, path: string, value: unknown) => {
    setServerError(null)
    setStops((l) => (l ? l.map((s, j) => (j === i ? { ...s, data: setPath(s.data, path, value) } : s)) : l))
  }
  const move = (from: number, to: number) => {
    if (!stops || to < 0 || to >= stops.length || from === to) return
    const next = [...stops]
    const [s] = next.splice(from, 1)
    next.splice(to, 0, s)
    setStops(next)
    setSel(to)
    setAnnounce(`Stop moved to position ${to + 1} of ${next.length}.`)
  }
  const add = (data?: Record<string, unknown>, at?: number) => {
    const list = stops ?? []
    const base = data ?? { id: '', place: '', title: '', text: '', view: { x: 0, z: 0, yawDeg: 0, pitchDeg: 0 } }
    const seed = typeof base.id === 'string' && base.id ? base.id : slugify(String(base.title || base.place || 'stop')) || 'stop'
    const stop = wrap({ ...base, id: uniqueId(seed, takenIds(list)) })
    const pos = at ?? list.length
    const next = [...list.slice(0, pos), stop, ...list.slice(pos)]
    setStops(next)
    setSel(pos)
    return next
  }
  const remove = async (i: number) => {
    if (!stops) return
    const s = stops[i]
    if (String(s.data.title ?? '').trim() && !(await confirm({ title: `Remove stop ${i + 1}?`, body: `“${String(s.data.title)}” is taken out of the tour when you save.`, confirmLabel: 'Remove stop', danger: true }))) return
    const next = stops.filter((_, j) => j !== i)
    setStops(next)
    setSel(Math.max(0, Math.min(i, next.length - 1)))
  }

  function pasteStops(text: string) {
    const pasted = parsePastedStops(text)
    let list = stops ?? []
    for (const p of pasted) {
      const seed = typeof p.id === 'string' && p.id ? p.id : slugify(String(p.title || p.place || 'stop')) || 'stop'
      list = [...list, wrap({ ...p, id: uniqueId(seed, takenIds(list)) })]
    }
    setStops(list)
    setSel(list.length - 1)
    setPasting(false)
    toast(pasted.length === 1 ? 'Stop added from the museum' : `${pasted.length} stops added from the museum`)
  }
  async function pasteFromClipboard() {
    let text: string
    try {
      text = await navigator.clipboard.readText()
    } catch {
      return setPasting(true)
    }
    try {
      pasteStops(text)
    } catch {
      setPasting(true)
    }
  }

  function switchView(v: 'stops' | 'json') {
    if (v === view) return
    if (v === 'json') {
      setJsonText(JSON.stringify(plain(stops ?? []), null, 2))
      setJsonError('')
      setView('json')
      return
    }
    try {
      const parsed = JSON.parse(jsonText || '[]') as unknown
      if (!Array.isArray(parsed)) throw new Error('The tour text must be a list of stops inside [ ].')
      const list = parsed.filter((s): s is Record<string, unknown> => !!s && typeof s === 'object' && !Array.isArray(s))
      if (list.length !== parsed.length) throw new Error('Every stop must be an object inside { }.')
      // keep keys stable for stops that did not move
      setStops(list.map((d, i) => (stops?.[i] && JSON.stringify(stops[i].data) === JSON.stringify(d) ? stops[i] : wrap(d))))
      setSel((s) => Math.min(s, Math.max(0, list.length - 1)))
      setJsonError('')
      setView('stops')
    } catch (e) {
      setJsonError(e instanceof SyntaxError ? 'This text can’t be read — check for a missing comma, quote or bracket.' : errMsg(e))
    }
  }

  async function save(asStandard = false) {
    if (!stops) return
    if (view === 'json' && !asStandard) {
      switchView('stops')
      return toast('Check the stops, then save again.', 'info')
    }
    if (!asStandard && stops.length && errorKeys.length) {
      setShowErrors(true)
      const first = stopIndexOf(errorKeys[0])
      if (first !== null) setSel(first)
      return toast(`${errorKeys.length} ${errorKeys.length === 1 ? 'problem needs' : 'problems need'} fixing before saving.`, 'error')
    }
    setBusy(true)
    setServerError(null)
    try {
      const r = await exApi.putTour(exhibition.id, asStandard || !stops.length ? null : plain(stops))
      const list = (r.stops ?? []) as Record<string, unknown>[]
      setCustom(list.length > 0)
      setStops(list.map(wrap))
      setSaved(JSON.stringify(list))
      setShowErrors(false)
      setSel((s) => Math.min(s, Math.max(0, list.length - 1)))
      toast(list.length ? `Saved ${list.length} tour stops` : 'This exhibition now uses the standard tour')
      window.dispatchEvent(new Event(EXHIBITIONS_CHANGED))
    } catch (e) {
      const field = (e as { body?: { field?: unknown } }).body?.field
      if (typeof field === 'string') {
        setServerError({ field, message: errMsg(e) })
        const i = stopIndexOf(field)
        if (i !== null) setSel(i)
      }
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function switchToStandard() {
    const ok = await confirm({
      title: 'Use the standard tour?',
      body: `The ${stops?.length ?? 0} custom stops of “${exhibition.title}” are replaced by the standard tour.`,
      confirmLabel: 'Use the standard tour',
      danger: true,
    })
    if (ok) void save(true)
  }
  async function loadStandard() {
    if (stops?.length && !(await confirm({ title: 'Replace these stops with the standard ones?', body: 'Nothing is saved until you press Save tour.', confirmLabel: 'Load standard stops', tone: 'warning' }))) return
    setStops(BUNDLED_TOUR_STOPS.map((s) => wrap(JSON.parse(JSON.stringify(s)) as Record<string, unknown>)))
    setSel(0)
  }

  const onHandleKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const to = e.key === 'ArrowUp' ? i - 1 : i + 1
      move(i, to)
      requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-stop-handle="${to}"]`)?.focus())
    }
  }
  const dragProps = (i: number) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      dragFrom.current = i
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', String(i))
    },
    onDragOver: (e: DragEvent) => {
      if (dragFrom.current === null) return
      e.preventDefault()
      if (dragOver !== i) setDragOver(i)
    },
    onDragLeave: () => setDragOver((d) => (d === i ? null : d)),
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      if (dragFrom.current !== null) move(dragFrom.current, i)
      dragFrom.current = null
      setDragOver(null)
    },
    onDragEnd: () => {
      dragFrom.current = null
      setDragOver(null)
    },
  })

  const s = stops?.[sel]
  const kind = (s?.data.item as { kind?: StopItemKind } | undefined)?.kind ?? ''

  return (
    <section className="card tour-card" aria-labelledby="tour-title">
      <div className="card-head">
        <h2 id="tour-title">Guided tour — {exhibition.title}</h2>
        <Badge tone={custom ? 'ok' : 'neutral'}>{custom ? 'Custom tour' : 'Standard tour'}</Badge>
        <Button size="sm" icon="external" href={`${exhibition.path}?tour`} target="_blank" rel="noreferrer" title="Opens the museum and starts the saved tour">
          Preview
        </Button>
      </div>
      {loadError ? <p className="alert">{loadError}</p> : null}
      {!stops ? (
        !loadError && <Skeleton kind="list" rows={5} />
      ) : (
        <>
          <Tabs variant="underline" label="Tour view" tabs={[{ id: 'stops', label: 'Stops', count: stops.length }, { id: 'json', label: 'Advanced' }]} value={view} onChange={switchView} />
          {view === 'json' ? (
            <div className="tour-json">
              <p className="muted small">All stops as text. Switch back to Stops to check them.</p>
              <textarea
                className={`json-editor ${jsonError ? 'invalid' : ''}`}
                spellCheck={false}
                rows={Math.min(28, Math.max(8, jsonText.split('\n').length + 1))}
                value={jsonText}
                onChange={(e) => {
                  setJsonText(e.target.value)
                  setJsonError('')
                }}
                aria-label="Tour stops as text"
                aria-invalid={!!jsonError}
              />
              {jsonError ? <p className="alert" style={{ marginTop: 6 }}>{jsonError}</p> : null}
              <ButtonRow align="start">
                <Button onClick={() => switchView('stops')}>Apply text</Button>
              </ButtonRow>
            </div>
          ) : (
            <>
              <div className="toolbar tour-toolbar">
                <Button size="sm" icon="plus" onClick={() => add()}>Add stop</Button>
                <Button size="sm" icon="copy" onClick={() => void pasteFromClipboard()} title="Paste a stop copied with “Copy view as tour stop” in the museum">
                  Paste stop from museum
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void loadStandard()}>Load standard stops</Button>
              </div>
              {stops.length === 0 ? (
                <EmptyState title="This exhibition uses the standard tour" icon="exhibitions" as="h3" action={<Button onClick={() => void loadStandard()}>Start from the standard stops</Button>}>
                  Add a stop, paste one from the museum, or start from the standard stops.
                </EmptyState>
              ) : (
                <div className="tour-grid">
                  <ol className="tour-list" aria-label="Stops, in tour order">
                    {stops.map((st, i) => (
                      <li key={st.key} className={[i === sel && 'active', dragOver === i && 'drop', stopHasError(i) && 'has-error'].filter(Boolean).join(' ')} {...dragProps(i)}>
                        <button
                          type="button"
                          className="tour-handle"
                          data-stop-handle={i}
                          aria-label={`Reorder stop ${i + 1}: arrow keys move it`}
                          title="Drag, or use ↑ / ↓, to reorder"
                          onKeyDown={(e) => onHandleKey(e, i)}
                        >
                          <Icon name="sort" />
                        </button>
                        <button type="button" className="tour-pick" aria-current={i === sel ? 'true' : undefined} onClick={() => setSel(i)}>
                          <span className="tour-n num">{i + 1}</span>
                          <span className="tour-t">
                            <span className="t">{String(st.data.title || '') || 'Untitled stop'}</span>
                            <span className="p">{String(st.data.place || '') || '–'}</span>
                          </span>
                          {stopHasError(i) ? <Badge tone="danger">Fix</Badge> : itemMissing(st.data) ? <Badge tone="warn">Item?</Badge> : null}
                        </button>
                      </li>
                    ))}
                  </ol>
                  <span className="sr-only" role="status">{announce}</span>
                  {s ? (
                    <div className="tour-form">
                      <div className="card-head">
                        <h3>Stop {sel + 1}</h3>
                        <IconButton icon="chevronUp" label="Move up" size="sm" disabled={sel === 0} onClick={() => move(sel, sel - 1)} />
                        <IconButton icon="chevronDown" label="Move down" size="sm" disabled={sel === stops.length - 1} onClick={() => move(sel, sel + 1)} />
                        <Button size="sm" icon="copy" onClick={() => add({ ...JSON.parse(JSON.stringify(s.data)), title: `${String(s.data.title || '')} (copy)`.trim() }, sel + 1)}>Duplicate</Button>
                        <Button size="sm" variant="danger" icon="trash" onClick={() => void remove(sel)}>Remove</Button>
                      </div>
                      {serverError && stopIndexOf(serverError.field) === null ? <p className="alert">{serverError.message}</p> : null}
                      <div className="grid-2">
                        <Field label="Place" required error={errOf(sel, 'place')} hint="The room, shown above the title.">
                          <Input value={str(s.data.place)} onChange={(e) => editStop(sel, 'place', e.target.value)} />
                        </Field>
                        <Field label="Id" required error={errOf(sel, 'id')} hint="Used in visit statistics.">
                          <Input className="mono" value={str(s.data.id)} spellCheck={false} onChange={(e) => editStop(sel, 'id', e.target.value)} />
                        </Field>
                        <Field label="Title" required error={errOf(sel, 'title')} className="span-all">
                          <Input value={str(s.data.title)} onChange={(e) => editStop(sel, 'title', e.target.value)} />
                        </Field>
                        <Field label="Caption" error={errOf(sel, 'text')} className="span-all" hint={`${str(s.data.text).length.toLocaleString()} / 4,000`}>
                          <Textarea rows={4} value={str(s.data.text)} onChange={(e) => editStop(sel, 'text', e.target.value)} />
                        </Field>
                      </div>
                      <h4 className="tour-sub">Where the visitor stands and looks</h4>
                      {showErrors && errors[`stops[${sel}].view`] ? <p className="field-error">{errors[`stops[${sel}].view`]}</p> : null}
                      <div className="grid-2 tour-view">
                        <NumField label="x (m)" value={getPath(s.data, 'view.x')} error={errOf(sel, 'view.x')} onChange={(v) => editStop(sel, 'view.x', v)} required />
                        <NumField label="z (m)" value={getPath(s.data, 'view.z')} error={errOf(sel, 'view.z')} onChange={(v) => editStop(sel, 'view.z', v)} required />
                        <NumField label="Heading (°)" hint="0 north, 90 east" value={getPath(s.data, 'view.yawDeg')} error={errOf(sel, 'view.yawDeg')} onChange={(v) => editStop(sel, 'view.yawDeg', v)} required />
                        <NumField label="Tilt (°)" hint="up is positive" value={getPath(s.data, 'view.pitchDeg')} error={errOf(sel, 'view.pitchDeg')} onChange={(v) => editStop(sel, 'view.pitchDeg', v)} />
                      </div>
                      <h4 className="tour-sub">What the caption opens</h4>
                      <div className="grid-2">
                        <Field group label="Item kind" error={errOf(sel, 'item.kind')}>
                          {(w) => (
                            <Select
                              {...w}
                              value={kind}
                              options={KIND_OPTIONS}
                              placeholder="No item"
                              clearable
                              onChange={(k) => editStop(sel, 'item', k ? { kind: k, id: kind === k ? str(getPath(s.data, 'item.id')) : '' } : undefined)}
                            />
                          )}
                        </Field>
                        <Field
                          group
                          label="Item"
                          error={errOf(sel, 'item.id')}
                          hint={itemMissing(s.data) ? <span className="fld-warn">Not in this exhibition: the caption shows no “More about this”.</span> : undefined}
                        >
                          {(w) => (
                            <Combobox
                              {...w}
                              value={str(getPath(s.data, 'item.id'))}
                              options={kind && items ? items[kind as StopItemKind] : []}
                              disabled={!kind}
                              allowFreeText
                              placeholder={kind ? 'Search by title or id…' : 'Choose a kind first'}
                              onChange={(id) => editStop(sel, 'item', kind ? { kind, id } : undefined)}
                            />
                          )}
                        </Field>
                        <NumField label="Linger (s)" hint="Empty: the tour’s default." value={s.data.dwellSec} error={errOf(sel, 'dwellSec')} onChange={(v) => editStop(sel, 'dwellSec', v)} />
                      </div>
                      <details className="group tour-l10n">
                        <summary>
                          Localisation <span className="hint">— optional; empty fields fall back to English</span>
                        </summary>
                        {LANGS.map((l) => (
                          <div className="lang-block" key={l.id}>
                            <h4 lang={l.id}>{l.name}</h4>
                            <div className="grid-2">
                              {(['place', 'title', 'text'] as const).map((f) => (
                                <Field key={f} label={f === 'text' ? 'Caption' : f === 'place' ? 'Place' : 'Title'} className={f === 'text' ? 'span-all' : undefined}>
                                  {f === 'text' ? (
                                    <Textarea rows={3} lang={l.id} value={str(getPath(s.data, `i18n.${l.id}.${f}`))} onChange={(e) => editStop(sel, `i18n.${l.id}.${f}`, e.target.value || undefined)} />
                                  ) : (
                                    <Input lang={l.id} value={str(getPath(s.data, `i18n.${l.id}.${f}`))} onChange={(e) => editStop(sel, `i18n.${l.id}.${f}`, e.target.value || undefined)} />
                                  )}
                                </Field>
                              ))}
                            </div>
                          </div>
                        ))}
                      </details>
                    </div>
                  ) : null}
                </div>
              )}
            </>
          )}
          <div className={`save-bar ${dirty ? 'is-dirty' : ''}`}>
            <Button variant="primary" onClick={() => void save()} loading={busy} loadingLabel="Saving…" disabled={!dirty}>
              Save tour
            </Button>
            {dirty ? (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setStops((JSON.parse(saved) as Record<string, unknown>[]).map(wrap))
                  setSel(0)
                  setShowErrors(false)
                  setServerError(null)
                  setView('stops')
                }}
              >
                Discard changes
              </Button>
            ) : null}
            {showErrors && errorKeys.length ? <span className="small danger-text">{errorKeys.length} to fix</span> : dirty ? <span className="dirty">Unsaved changes</span> : null}
            <span className="spacer" />
            {custom ? (
              <Button size="sm" variant="danger" disabled={busy} onClick={() => void switchToStandard()}>
                Use the standard tour
              </Button>
            ) : null}
          </div>
        </>
      )}
      {pasting && <PasteStopDialog onClose={() => setPasting(false)} onPaste={pasteStops} />}
    </section>
  )
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

function NumField({ label, value, error, hint, required, onChange }: { label: string; value: unknown; error?: string; hint?: string; required?: boolean; onChange: (v: number | undefined) => void }) {
  return (
    <Field label={label} error={error} hint={hint} required={required}>
      <Input type="number" inputMode="decimal" step="any" value={typeof value === 'number' && Number.isFinite(value) ? value : ''} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
    </Field>
  )
}

function PasteStopDialog({ onPaste, onClose }: { onPaste: (text: string) => void; onClose: () => void }) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  return (
    <Modal
      title="Paste stop from museum"
      size="small"
      description="In the museum, stand where the stop should be, open the staff tools and choose “Copy view as tour stop”."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!text.trim()}
            onClick={() => {
              try {
                onPaste(text)
              } catch (e) {
                setError(errMsg(e))
              }
            }}
          >
            Add stop
          </Button>
        </>
      }
    >
      <Field label="Tour stop" error={error || undefined}>
        <Textarea
          className="mono"
          rows={6}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setError('')
          }}
          data-autofocus
        />
      </Field>
    </Modal>
  )
}
