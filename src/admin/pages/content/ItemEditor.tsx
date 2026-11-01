/**
 * The item editor: a generated, sectioned form with a live preview and an Advanced (JSON) view.
 * - Saves are guarded by the item's stamp (`X-Expected-Updated-At`, from `expectedFor`); a 409 opens
 *   ConflictDialog. Never sent unguarded.
 * - Unsaved edits are kept in this browser (drafts.ts) and offered back on reopen. Restored edits are saved
 *   against the stamp they were made on, so a colleague's save since then shows as a conflict.
 * - Errors show once a field is left (or after a save attempt); a wall-range error shows at once.
 * - History drawer (restore a version), Duplicate, Preview in museum, Paste placement from the
 *   museum's staff dock, Ctrl/Cmd+S (not while a dialog is open).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ContentCollection } from '../../../museum/content/types'
import { api, isConflict, type ConflictBody, type ContentStamp, type Item, type SavedItem } from '../../api'
import { FIELDS, LANGS, getPath, setPath, surfaceRange, surfaceWarning, type FieldDef } from '../../fields'
import { recordRecent } from '../../recent'
import { Badge, Button, ButtonRow, Field, Modal, Textarea, errMsg, formatDate, formatRelative, useConfirm, useToast, useUnsavedGuard } from '../../ui'
import { ConflictDialog } from './ConflictDialog'
import { FieldControl, fieldDomId } from './FieldControl'
import { HistoryDrawer } from './HistoryDrawer'
import { ItemPreview } from './ItemPreview'
import { clearDraft, readDraft, writeDraft, type LocalDraft } from './drafts'
import { isBlank, metaOf, museumHref, stripInternal, titleOf } from './model'
import { useContentRefs, type ContentRefs } from './refs'
import type { ExpectedFor } from './stamps'

type Section = { id: string; title: string; groups: FieldDef['group'][]; collapsible?: boolean; hint?: string }
const SECTIONS: Section[] = [
  { id: 'details', title: 'Details', groups: ['Details'] },
  { id: 'media', title: 'Media', groups: ['Media'] },
  { id: 'placement', title: 'Placement', groups: ['Placement'] },
  { id: 'display', title: 'Display', groups: ['Display', 'Flags'] },
  { id: 'l10n', title: 'Localisation', groups: ['Translations'], collapsible: true, hint: 'optional — the museum falls back to English' },
  { id: 'meta', title: 'Metadata', groups: ['Metadata'], collapsible: true },
]
const sectionOf = (f: FieldDef) => SECTIONS.find((s) => s.groups.includes(f.group))?.id ?? 'details'

const AUTOSAVE_MS = 800

function validate(fields: FieldDef[], draft: Record<string, unknown>): Record<string, string> {
  const errs: Record<string, string> = {}
  for (const f of fields) {
    const v = getPath(draft, f.path)
    if (f.required && isBlank(v)) errs[f.path] = `${f.label.replace(/\s*\(.*\)$/, '')} is required.`
    if ((f.type === 'number' || f.type === 'at') && typeof v === 'number' && !Number.isFinite(v)) errs[f.path] = 'Enter a number.'
    if (f.type === 'at' && typeof v === 'number' && Number.isFinite(v)) {
      const r = surfaceRange(getPath(draft, 'placement.surface'))
      if (r && (v < r.min - 1e-6 || v > r.max + 1e-6)) errs[f.path] = `Outside this wall: ${r.min.toFixed(2)} to ${r.max.toFixed(2)} m.`
    }
    if (f.type === 'surface' && !isBlank(v) && !surfaceRange(v)) errs[f.path] = 'This wall isn’t in the building. Choose another.'
    if (f.type === 'color' && typeof v === 'string' && v && !/^#[0-9a-f]{6}$/i.test(v)) errs[f.path] = 'Use a colour like #2c3f6b.'
    if (f.type === 'vec3' && Array.isArray(v) && v.some((n) => typeof n !== 'number' || !Number.isFinite(n))) errs[f.path] = 'Enter three numbers.'
  }
  return errs
}

/** Non-blocking notices: an id that names nothing yet, a wall kept for an installation. */
function refWarnings(fields: FieldDef[], draft: Record<string, unknown>, refs: ContentRefs): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of fields) {
    if (f.type === 'surface') {
      const w = surfaceWarning(getPath(draft, f.path))
      if (w) out[f.path] = w
      continue
    }
    if (f.type !== 'ref' || !f.ref) continue
    const v = getPath(draft, f.path)
    if (typeof v !== 'string' || !v) continue
    if (refs.exists(f.ref, v) === false)
      out[f.path] = f.ref === 'artisan' ? `No maker profile “${v}” yet. Add it under Makers.` : `No ${f.ref === 'artworks' ? 'artwork' : 'exhibit'} “${v}” in this exhibition.`
  }
  return out
}

/** Reads `{ surface, at, centerHeight? }` (the museum's "Copy placement"); throws a reader-facing message. */
function parsePlacement(text: string): { surface: string; at: number; centerHeight?: number } {
  let v: unknown
  try {
    v = JSON.parse(text.trim())
  } catch {
    throw new Error('That isn’t a placement. In the museum, use “Copy placement” in the staff tools, then paste here.')
  }
  const p = (v && typeof v === 'object' && 'placement' in (v as object) ? (v as { placement: unknown }).placement : v) as Record<string, unknown> | null
  if (!p || typeof p !== 'object') throw new Error('That isn’t a placement.')
  if (typeof p.surface !== 'string' || !surfaceRange(p.surface)) throw new Error(`The wall “${String(p.surface ?? '')}” isn’t in this building.`)
  if (typeof p.at !== 'number' || !Number.isFinite(p.at)) throw new Error('The placement has no position on the wall.')
  return { surface: p.surface, at: p.at, ...(typeof p.centerHeight === 'number' && Number.isFinite(p.centerHeight) ? { centerHeight: p.centerHeight } : {}) }
}

export function ItemEditor({
  collection,
  item,
  stamp,
  expectedFor,
  exhibitionId,
  museumBase,
  focusField,
  onChanged,
  onDelete,
  onDuplicate,
  onDiscardNew,
}: {
  collection: ContentCollection
  item: Item
  /** Shown as "Last edited by"; may be missing while the stamps load. */
  stamp: ContentStamp | undefined
  /** The guard for a save of this saved item (stamps.ts). */
  expectedFor: ExpectedFor
  /** The exhibition being edited, by id: scopes the local draft and the recent list (null: neither is kept). */
  exhibitionId: string | null
  museumBase: string
  /** Field path to focus on open ("jump to field"). */
  focusField: string | null
  /** The item was saved, restored or replaced by another curator's version. */
  onChanged: (item: SavedItem) => void
  /** Delete the saved item (the list shows the Undo toast). Resolves true when it went. */
  onDelete: (item: Item, stamp: ContentStamp | undefined) => Promise<boolean>
  onDuplicate: (item: Item) => void
  /** Drop a never-saved draft. */
  onDiscardNew: (id: string) => void
}) {
  const meta = metaOf(collection)
  const refs = useContentRefs()
  const isNew = item.__new === true
  const initial = useMemo(() => stripInternal(item), [item])
  const [draft, setDraft] = useState<Record<string, unknown>>(initial)
  const [jsonText, setJsonText] = useState(() => JSON.stringify(initial, null, 2))
  const [jsonError, setJsonError] = useState('')
  const [busy, setBusy] = useState(false)
  const [touched, setTouched] = useState<Set<string>>(() => new Set())
  const [showAll, setShowAll] = useState(false)
  const [conflict, setConflict] = useState<ConflictBody | null>(null)
  const [history, setHistory] = useState(false)
  const [pasting, setPasting] = useState(false)
  const [restore, setRestore] = useState<LocalDraft | null>(() => {
    const d = readDraft(exhibitionId, collection, item.id)
    return d && JSON.stringify(d.draft) !== JSON.stringify(initial) ? d : null
  })
  /**
   * The stamp restored local edits were made on. The next save is guarded with it rather than with the item's
   * current stamp, so a colleague's save in between comes back as a conflict instead of being overwritten.
   * Cleared whenever the editor takes a new baseline (save, their version, a restored version, Revert).
   */
  const restoredBase = useRef<string | null>(null)
  const [openSecs, setOpenSecs] = useState<Set<string>>(() => {
    const f = focusField ? FIELDS[collection].find((d) => d.path === focusField) : undefined
    return new Set(f ? [sectionOf(f)] : [])
  })
  const toast = useToast()
  const confirm = useConfirm()
  const dirty = isNew || JSON.stringify(draft) !== JSON.stringify(initial)
  useUnsavedGuard(dirty && !busy)

  // a new version from the server (save, restore, theirs) becomes the baseline
  const lastItem = useRef(item)
  useEffect(() => {
    if (lastItem.current === item) return
    lastItem.current = item
    restoredBase.current = null
    const next = stripInternal(item)
    setDraft(next)
    setJsonText(JSON.stringify(next, null, 2))
    setJsonError('')
  }, [item])

  const fields = FIELDS[collection]
  const errors = useMemo(() => validate(fields, draft), [fields, draft])
  const warnings = useMemo(() => refWarnings(fields, draft, refs), [fields, draft, refs])
  const errorCount = Object.keys(errors).length

  // remember the opened item for "Continue where you left off"
  useEffect(() => {
    if (!isNew) recordRecent({ tab: collection, id: item.id, title: titleOf(item) }, exhibitionId)
    // only when an item is opened
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection, item.id])

  // jump to field
  useEffect(() => {
    if (!focusField) return
    const t = window.setTimeout(() => {
      const el = document.getElementById(fieldDomId(focusField))
      if (!el) return
      el.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
      el.focus({ preventScroll: true })
    }, 60)
    return () => window.clearTimeout(t)
  }, [focusField])

  // local draft autosave (not while a kept draft waits for an answer)
  useEffect(() => {
    if (restore) return
    const t = window.setTimeout(() => {
      if (dirty) writeDraft(exhibitionId, collection, item.id, { draft, isNew, baseUpdatedAt: restoredBase.current ?? stamp?.updatedAt ?? null })
      else clearDraft(exhibitionId, collection, item.id)
    }, AUTOSAVE_MS)
    return () => window.clearTimeout(t)
  }, [draft, dirty, restore, exhibitionId, collection, item.id, isNew, stamp?.updatedAt])

  const update = (next: Record<string, unknown>) => {
    setDraft(next)
    setJsonText(JSON.stringify(next, null, 2))
    setJsonError('')
  }
  const touch = (path: string) => setTouched((t) => (t.has(path) ? t : new Set(t).add(path)))

  function onJson(text: string) {
    setJsonText(text)
    try {
      const v = JSON.parse(text) as unknown
      if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('This text must describe one item, inside { }.')
      if ((v as Item).id !== item.id) throw new Error(`“id” must stay “${item.id}”.`)
      setDraft(v as Record<string, unknown>)
      setJsonError('')
    } catch (e) {
      setJsonError(e instanceof SyntaxError ? 'This text can’t be read — check for a missing comma, quote or bracket.' : errMsg(e))
    }
  }

  /** `expected`: the stamp to save against ('new' for a new item); null = the item's current one. */
  async function put(expected: string | null) {
    setBusy(true)
    try {
      const expectedUpdatedAt = expected ?? (await expectedFor(collection, item.id))
      const saved = await api.put(collection, { ...draft, id: item.id } as Item, { expectedUpdatedAt })
      restoredBase.current = null
      clearDraft(exhibitionId, collection, item.id)
      setConflict(null)
      setShowAll(false)
      toast(`${isNew ? 'Created' : 'Saved'} “${titleOf(saved)}”`)
      recordRecent({ tab: collection, id: item.id, title: titleOf(saved) }, exhibitionId)
      onChanged(saved)
    } catch (e) {
      if (isConflict(e)) setConflict(e.body)
      else toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const saveRef = useRef<() => void>(() => undefined)
  function save() {
    if (busy) return
    if (jsonError) return toast('Fix the Advanced text first.', 'error')
    if (errorCount) {
      setShowAll(true)
      const first = fields.find((f) => errors[f.path])
      if (first) {
        setOpenSecs((s) => new Set(s).add(sectionOf(first)))
        window.setTimeout(() => document.getElementById(fieldDomId(first.path))?.focus(), 30)
      }
      return toast(`${errorCount} ${errorCount === 1 ? 'field needs' : 'fields need'} attention before saving.`, 'error')
    }
    void put(isNew ? 'new' : restoredBase.current)
  }
  useEffect(() => {
    saveRef.current = save
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 's') return
      e.preventDefault()
      // a dialog (history, a confirm, paste, a conflict) has the floor: its own buttons decide
      if (document.querySelector('dialog[open]')) return
      saveRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function takeTheirs() {
    if (!conflict) return
    clearDraft(exhibitionId, collection, item.id)
    if (conflict.current) {
      onChanged({ ...conflict.current, updatedAt: conflict.updatedAt ?? undefined, updatedBy: conflict.updatedBy })
      toast('Showing their version')
    } else onDiscardNew(item.id)
    setConflict(null)
  }

  async function remove() {
    if (isNew) {
      if (dirty && !(await confirm({ title: 'Discard this draft?', body: 'It has never been saved.', confirmLabel: 'Discard draft', danger: true }))) return
      clearDraft(exhibitionId, collection, item.id)
      return onDiscardNew(item.id)
    }
    const ok = await confirm({
      title: `Delete “${titleOf(item)}”?`,
      body: `It disappears from ${meta.label.toLowerCase()} for every visitor. You can bring it back from the trash.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    const gone = await onDelete(item, stamp)
    if (gone) clearDraft(exhibitionId, collection, item.id)
    else setBusy(false)
  }

  async function pasteFromClipboard() {
    let text: string
    try {
      text = await navigator.clipboard.readText()
    } catch {
      return setPasting(true) // no clipboard permission: paste by hand
    }
    try {
      applyPlacement(parsePlacement(text))
    } catch {
      setPasting(true)
    }
  }
  function applyPlacement(p: { surface: string; at: number; centerHeight?: number }) {
    let next = setPath(draft, 'placement.surface', p.surface)
    next = setPath(next, 'placement.at', Math.round(p.at * 100) / 100)
    const hasHeight = fields.some((f) => f.path === 'placement.centerHeight')
    if (hasHeight && p.centerHeight !== undefined) next = setPath(next, 'placement.centerHeight', Math.round(p.centerHeight * 100) / 100)
    update(next)
    for (const k of ['placement.surface', 'placement.at']) touch(k)
    const r = surfaceRange(p.surface)
    toast(`Placed on ${r?.label ?? p.surface} at ${p.at.toFixed(2)} m`)
    setPasting(false)
  }

  const previewHref = museumHref(museumBase, collection, item.id)
  const renderField = (f: FieldDef, labelOverride?: string) => (
    <FieldControl
      key={f.path}
      def={labelOverride ? { ...f, label: labelOverride } : f}
      value={getPath(draft, f.path)}
      draft={draft}
      error={showAll || touched.has(f.path) || f.type === 'at' ? errors[f.path] : undefined}
      warning={warnings[f.path]}
      onBlur={() => touch(f.path)}
      onChange={(v) => update(setPath(draft, f.path, v))}
    />
  )
  const toggleSec = (id: string, open: boolean) =>
    setOpenSecs((s) => {
      if (s.has(id) === open) return s
      const n = new Set(s)
      if (open) n.add(id)
      else n.delete(id)
      return n
    })
  const hasPlacementWall = fields.some((f) => f.path === 'placement.surface')

  return (
    <section className="card" aria-label={`Edit ${meta.singular}`}>
      <div className="form-head">
        <div className="fh-text">
          <h2>{String(draft.title ?? '') || item.id}</h2>
          <div className="fh-meta">
            <span className="mono muted">
              {collection}/{item.id}
            </span>
            {draft.placeholder === true && <Badge tone="info">Needs content</Badge>}
            {isNew && <Badge tone="warn">Not saved yet</Badge>}
          </div>
          {!isNew && stamp ? (
            <span className="muted small" title={formatDate(stamp.updatedAt)}>
              Last edited by {stamp.updatedBy ?? 'someone'}, {formatRelative(stamp.updatedAt)}
            </span>
          ) : null}
        </div>
        <ButtonRow>
          {!isNew && (
            <Button size="sm" icon="clock" onClick={() => setHistory(true)}>
              History
            </Button>
          )}
          <Button size="sm" icon="copy" onClick={() => onDuplicate({ ...draft, id: item.id } as Item)}>
            Duplicate
          </Button>
          {!isNew && (
            <Button size="sm" icon="external" href={previewHref} target="_blank" rel="noreferrer" title="Opens the museum at this item in a new tab">
              Preview in museum
            </Button>
          )}
        </ButtonRow>
      </div>

      {restore ? (
        <div className="note draft-note" role="status">
          <span>
            Unsaved edits from {formatRelative(restore.savedAt)} were kept in this browser.
            {!isNew && restore.baseUpdatedAt && stamp && restore.baseUpdatedAt !== stamp.updatedAt ? ' The item has been saved by someone since.' : ''}
          </span>
          <ButtonRow>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                update({ ...restore.draft, id: item.id })
                if (!isNew && restore.baseUpdatedAt) restoredBase.current = restore.baseUpdatedAt
                setRestore(null)
                toast('Edits restored. Save to keep them.', 'info')
              }}
            >
              Restore edits
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                clearDraft(exhibitionId, collection, item.id)
                setRestore(null)
              }}
            >
              Discard
            </Button>
          </ButtonRow>
        </div>
      ) : null}

      <ItemPreview collection={collection} draft={draft} />

      {SECTIONS.map((sec) => {
        const fs = fields.filter((f) => sec.groups.includes(f.group))
        if (!fs.length) return null
        if (sec.id === 'l10n')
          return <LocalisationSection key={sec.id} collection={collection} fields={fs} render={renderField} hint={sec.hint} draft={draft} open={openSecs.has(sec.id)} onToggle={(o) => toggleSec(sec.id, o)} />
        const body = <div className="grid-2">{fs.map((f) => renderField(f))}</div>
        if (sec.collapsible)
          return (
            <details className="group" key={sec.id} open={openSecs.has(sec.id)} onToggle={(e) => toggleSec(sec.id, e.currentTarget.open)}>
              <summary>
                {sec.title}
                {sec.hint && <span className="hint">— {sec.hint}</span>}
              </summary>
              {body}
            </details>
          )
        return (
          <div className="group" key={sec.id}>
            <div className="group-head">
              <h3>{sec.title}</h3>
              {sec.id === 'placement' && hasPlacementWall ? (
                <Button size="sm" variant="ghost" icon="copy" onClick={() => void pasteFromClipboard()} title="Paste a placement copied from the museum’s staff tools">
                  Paste placement
                </Button>
              ) : null}
            </div>
            {body}
          </div>
        )
      })}

      <details className="group" open={!!jsonError || openSecs.has('json')} onToggle={(e) => toggleSec('json', e.currentTarget.open)}>
        <summary>
          Advanced · all fields as text <span className="hint">— including ones without a form control</span>
        </summary>
        <textarea
          className={`json-editor ${jsonError ? 'invalid' : ''}`}
          spellCheck={false}
          value={jsonText}
          onChange={(e) => onJson(e.target.value)}
          rows={Math.min(28, jsonText.split('\n').length + 1)}
          aria-label="All fields as text"
          aria-invalid={!!jsonError}
        />
        {jsonError && (
          <p className="alert" style={{ marginTop: 6 }}>
            {jsonError}
          </p>
        )}
      </details>

      <div className={`save-bar ${dirty ? 'is-dirty' : ''}`}>
        <Button variant="primary" onClick={save} loading={busy} loadingLabel="Saving…" disabled={!dirty || Boolean(jsonError)}>
          {isNew ? 'Create' : 'Save changes'}
        </Button>
        {!isNew && (
          <Button
            variant="ghost"
            onClick={() => {
              update(initial)
              restoredBase.current = null
              setTouched(new Set())
              setShowAll(false)
              clearDraft(exhibitionId, collection, item.id)
            }}
            disabled={busy || !dirty}
          >
            Revert
          </Button>
        )}
        {showAll && errorCount > 0 ? (
          <span className="small danger-text" role="status">
            {errorCount} {errorCount === 1 ? 'field needs' : 'fields need'} attention
          </span>
        ) : (
          dirty && <span className="dirty">{isNew ? 'Draft — press Create to save' : 'Unsaved changes'}</span>
        )}
        <span className="spacer" />
        {!dirty && <span className="small muted hide-phone">Ctrl/⌘ + S saves</span>}
        <Button variant="danger" size="sm" icon="trash" onClick={() => void remove()} disabled={busy}>
          {isNew ? 'Discard draft' : 'Delete'}
        </Button>
      </div>

      {conflict && (
        <ConflictDialog
          collection={collection}
          mine={draft}
          conflict={conflict}
          busy={busy}
          onClose={() => setConflict(null)}
          onTakeTheirs={takeTheirs}
          onKeepMine={() => void put(conflict.current === null ? 'new' : conflict.updatedAt)}
        />
      )}
      {history && (
        <HistoryDrawer
          collection={collection}
          id={item.id}
          current={draft}
          dirty={dirty}
          expected={() => expectedFor(collection, item.id)}
          onClose={() => setHistory(false)}
          onRestored={(restored, updatedAt) => {
            clearDraft(exhibitionId, collection, item.id)
            onChanged({ ...restored, updatedAt })
          }}
        />
      )}
      {pasting && <PasteDialog onClose={() => setPasting(false)} onPaste={(text) => applyPlacement(parsePlacement(text))} />}
    </section>
  )
}

/** Paste by hand when the browser does not let the page read the clipboard. */
function PasteDialog({ onPaste, onClose }: { onPaste: (text: string) => void; onClose: () => void }) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const submit = () => {
    try {
      onPaste(text)
    } catch (e) {
      setError(errMsg(e))
    }
  }
  return (
    <Modal
      title="Paste placement"
      size="small"
      onClose={onClose}
      description="In the museum, open the staff tools, aim at the wall and choose “Copy placement”."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!text.trim()} onClick={submit}>Use placement</Button>
        </>
      }
    >
      <Field label="Placement" error={error || undefined}>
        <Textarea
          className="mono"
          rows={3}
          value={text}
          placeholder='{"surface":"…","at":1.2,"centerHeight":1.6}'
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

/** Translations: one block per language (fields are `i18n.<lang>.<field>`), with a filled count per language. */
function LocalisationSection({
  collection,
  fields,
  render,
  hint,
  draft,
  open,
  onToggle,
}: {
  collection: ContentCollection
  fields: FieldDef[]
  render: (f: FieldDef, label?: string) => ReactNode
  hint?: string
  draft: Record<string, unknown>
  open: boolean
  onToggle: (open: boolean) => void
}) {
  void collection
  const ofLang = (lang: string) => fields.filter((f) => f.path.split('.')[1] === lang)
  const filled = (lang: string) => ofLang(lang).filter((f) => !isBlank(getPath(draft, f.path))).length
  return (
    <details className="group" open={open} onToggle={(e) => onToggle(e.currentTarget.open)}>
      <summary>
        Localisation{hint && <span className="hint">— {hint}</span>}
        <span className="spacer" />
        {LANGS.map((l) => (
          <Badge key={l.id} tone={filled(l.id) === ofLang(l.id).length ? 'ok' : filled(l.id) ? 'neutral' : 'warn'}>
            {l.short} {filled(l.id)}/{ofLang(l.id).length}
          </Badge>
        ))}
      </summary>
      {LANGS.map((l) => (
        <div className="lang-block" key={l.id}>
          <h4 lang={l.id}>{l.name}</h4>
          <div className="grid-2">{ofLang(l.id).map((f) => render(f, f.label.replace(/\s+—\s+.*$/, '')))}</div>
        </div>
      ))}
    </details>
  )
}
