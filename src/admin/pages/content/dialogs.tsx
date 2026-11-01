/** Small dialogs of the content list: new / duplicate item, copy to another exhibition, move to a wall. */
import { useState } from 'react'
import type { ContentCollection } from '../../../museum/content/types'
import type { Item } from '../../api'
import { useExhibitionList } from '../../ExhibitionSwitcher'
import { useSelectedExhibition } from '../../exhibitionsApi'
import { SURFACE_GROUPS, surfaceRange } from '../../fields'
import { Button, Field, Input, Modal, Select, Switch, type SelectOption } from '../../ui'
import { ID_RE, metaOf, slugify, titleOf, uniqueId } from './model'

/** Title + permanent id for a new item, or for a copy of `source`. */
export function NewItemDialog({
  collection,
  existing,
  source,
  onCreate,
  onClose,
}: {
  collection: ContentCollection
  existing: readonly Item[]
  source?: Item | null
  onCreate: (id: string, title: string) => void
  onClose: () => void
}) {
  const meta = metaOf(collection)
  const taken = existing.map((i) => i.id)
  const [title, setTitle] = useState(source ? `${titleOf(source)} (copy)` : '')
  const [id, setId] = useState(source ? uniqueId(`${source.id}-copy`.slice(0, 100), taken) : '')
  const [idTouched, setIdTouched] = useState(!!source)
  const [touched, setTouched] = useState(false)
  const effectiveId = idTouched ? id : slugify(title)
  const idError = !effectiveId
    ? 'An id is required.'
    : !ID_RE.test(effectiveId)
      ? 'Use letters, digits, “-”, “_” or “.”, starting with a letter or digit (up to 100).'
      : taken.includes(effectiveId)
        ? `“${effectiveId}” is already used in ${meta.label.toLowerCase()}.`
        : ''
  const submit = () => {
    setTouched(true)
    if (!idError) onCreate(effectiveId, title.trim())
  }
  return (
    <Modal
      title={source ? `Duplicate “${titleOf(source)}”` : `New ${meta.singular}`}
      size="small"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit}>Open draft</Button>
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
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} data-autofocus />
        </Field>
        <Field label="Id" required error={touched && idError ? idError : undefined} hint={`Permanent: used in links (#${meta.kind}=…) and visit statistics.`}>
          <Input
            className="mono"
            value={effectiveId}
            spellCheck={false}
            onBlur={() => setTouched(true)}
            onChange={(e) => {
              setIdTouched(true)
              setId(e.target.value)
            }}
          />
        </Field>
        <button hidden type="submit" />
      </form>
      <p className="muted small" style={{ marginTop: 12 }}>Nothing is visible to visitors until you save.</p>
    </Modal>
  )
}

/** Choose another exhibition to copy items into. */
export function CopyDialog({ count, onCopy, onClose, busy }: { count: number; onCopy: (exhibitionId: string, overwrite: boolean) => void; onClose: () => void; busy: boolean }) {
  const list = useExhibitionList()
  const selected = useSelectedExhibition()
  const currentId = list?.find((e) => e.id === selected)?.id ?? list?.find((e) => e.isDefault)?.id
  const options: SelectOption[] = (list ?? []).filter((e) => e.id !== currentId).map((e) => ({ value: e.id, label: e.title, description: `${e.path}${e.status === 'draft' ? ' · draft' : ''}` }))
  const [target, setTarget] = useState('')
  const [overwrite, setOverwrite] = useState(false)
  return (
    <Modal
      title={`Copy ${count} ${count === 1 ? 'item' : 'items'} to another exhibition`}
      size="small"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" disabled={!target} loading={busy} loadingLabel="Copying…" onClick={() => onCopy(target, overwrite)}>Copy</Button>
        </>
      }
    >
      {list && options.length === 0 ? (
        <p className="muted">There is no other exhibition yet.</p>
      ) : (
        <div className="grid-2" style={{ gridTemplateColumns: '1fr' }}>
          <Field group label="Exhibition" required>
            {(w) => <Select {...w} value={target} options={options} onChange={setTarget} placeholder="Choose an exhibition…" />}
          </Field>
          <Switch checked={overwrite} onChange={setOverwrite} label="Replace items with the same id" description="Off: items already there are left as they are." />
        </div>
      )}
    </Modal>
  )
}

const SURFACE_OPTIONS: SelectOption[] = SURFACE_GROUPS.flatMap((g) => g.surfaces.map((s) => ({ value: s.id, label: s.label, description: g.zone })))

/** Choose a wall to move items to; each keeps its position, clamped into the new wall's range. */
export function MoveDialog({ count, onMove, onClose, busy }: { count: number; onMove: (surface: string) => void; onClose: () => void; busy: boolean }) {
  const [surface, setSurface] = useState('')
  const r = surfaceRange(surface)
  return (
    <Modal
      title={`Move ${count} ${count === 1 ? 'item' : 'items'} to another wall`}
      size="small"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" disabled={!surface} loading={busy} loadingLabel="Moving…" onClick={() => onMove(surface)}>Move</Button>
        </>
      }
    >
      <Field group label="Wall" required hint={r ? `Positions outside ${r.min.toFixed(2)}–${r.max.toFixed(2)} m (${r.axisLabel}) are moved to the nearest end.` : undefined}>
        {(w) => <Select {...w} value={surface} options={SURFACE_OPTIONS} onChange={setSurface} searchable placeholder="Choose a wall…" />}
      </Field>
    </Modal>
  )
}
