/**
 * One collection: the list (sortable table, filters, multi-select bulk actions) and, when the address
 * names an item, its editor. Items stay loaded while switching between the two, so filters and
 * selection survive opening an item.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ContentCollection } from '../../../museum/content/types'
import { api, type ContentStamp, type Item, type SavedItem } from '../../api'
import { getSelectedExhibition } from '../../exhibitionsApi'
import { FIELDS, SURFACE_GROUPS, ZONE_NAMES, getPath, itemZone, setPath, surfaceRange, template } from '../../fields'
import { forgetRecent } from '../../recent'
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  Menu,
  RowAction,
  RowActions,
  SearchInput,
  Select,
  errMsg,
  formatDate,
  formatRelative,
  useConfirm,
  useToast,
  type Column,
  type SelectOption,
} from '../../ui'
import { copyToExhibition, failureText, runSequential, stampKey, undoDelete, type Stamps } from './actions'
import { ISSUE_LABEL, itemIssues, type Issue, type IssueCode } from './completeness'
import { CopyDialog, MoveDialog, NewItemDialog } from './dialogs'
import { clearDraft, newDrafts } from './drafts'
import { ItemEditor } from './ItemEditor'
import { itemThumb, metaOf, museumHref, stripInternal, titleOf, type ContentAddress } from './model'
import { useContentRefs } from './refs'
import type { ExpectedFor } from './stamps'

type Row = { item: Item; issues: Issue[]; zone: string | null }
type Chip = Exclude<IssueCode, 'maker-missing' | 'related' | 'maker'>

export function CollectionView({
  collection,
  address,
  exhibitionId,
  museumBase,
  stamps,
  expectedFor,
  onStamp,
  navigate,
  onCountChanged,
}: {
  collection: ContentCollection
  address: ContentAddress
  /** The exhibition being edited, by id (null: unknown, so local drafts are not kept). */
  exhibitionId: string | null
  museumBase: string
  /** For the "Last edited" column and the editor's line; writes take their guard from `expectedFor`. */
  stamps: Stamps | null
  expectedFor: ExpectedFor
  onStamp: (key: string, stamp: ContentStamp | null) => void
  navigate: (id: string | null, opts?: { replace?: boolean; force?: boolean }) => void
  onCountChanged: () => void
}) {
  const meta = metaOf(collection)
  const fields = FIELDS[collection]
  const refs = useContentRefs()
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [creating, setCreating] = useState<{ source: Item | null } | null>(null)
  const [query, setQuery] = useState('')
  const [zone, setZone] = useState('')
  const [surface, setSurface] = useState('')
  const [chips, setChips] = useState<Set<Chip>>(() => new Set())
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [dialog, setDialog] = useState<'copy' | 'move' | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const toast = useToast()
  const confirm = useConfirm()

  useEffect(() => {
    let alive = true
    setError('')
    api
      .list(collection)
      .then((list) => {
        if (!alive) return
        // never-saved drafts kept in this browser come back as unsaved items
        const ids = new Set(list.map((i) => i.id))
        const recovered = newDrafts(exhibitionId, collection)
          .filter((d) => !ids.has(d.id))
          .map((d) => ({ ...d.draft.draft, id: d.id, __new: true }) as Item)
        setItems([...list, ...recovered])
      })
      .catch((e) => alive && setError(errMsg(e)))
    return () => {
      alive = false
    }
  }, [collection, exhibitionId, reload])

  // the palette's "New …" lands on +new
  useEffect(() => {
    if (address.id === '+new' && items) {
      setCreating({ source: null })
      navigate(null, { replace: true, force: true })
    }
  }, [address.id, items, navigate])

  const rows = useMemo<Row[] | null>(() => (items ? items.map((item) => ({ item, issues: itemIssues(collection, item, refs.sets), zone: itemZone(item) })) : null), [items, collection, refs.sets])

  const hasSurface = fields.some((f) => f.type === 'surface')
  const hasMedia = fields.some((f) => f.type === 'media' && f.required)
  const hasAlt = fields.some((f) => f.path === 'alt')
  const chipList: { id: Chip; label: string }[] = [
    { id: 'placeholder', label: ISSUE_LABEL.placeholder },
    ...(hasMedia ? [{ id: 'media' as const, label: ISSUE_LABEL.media }] : []),
    ...(hasAlt ? [{ id: 'alt' as const, label: ISSUE_LABEL.alt }] : []),
    { id: 'hi', label: ISSUE_LABEL.hi },
    { id: 'bn', label: ISSUE_LABEL.bn },
    ...(hasSurface ? [{ id: 'placement' as const, label: ISSUE_LABEL.placement }] : []),
  ]

  const zoneOptions = useMemo<SelectOption[]>(() => {
    const used = new Set((rows ?? []).map((r) => r.zone).filter((z): z is string => !!z))
    return [...used].map((z) => ({ value: z, label: ZONE_NAMES.get(z) ?? z })).sort((a, b) => String(a.label).localeCompare(String(b.label)))
  }, [rows])
  const surfaceOptions = useMemo<SelectOption[]>(() => {
    const used = new Set((items ?? []).map((i) => getPath(i, 'placement.surface')).filter((s): s is string => typeof s === 'string'))
    return SURFACE_GROUPS.flatMap((g) => g.surfaces.filter((s) => used.has(s.id)).map((s) => ({ value: s.id, label: s.label, description: g.zone })))
  }, [items])

  const shown = useMemo(() => {
    if (!rows) return null
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (zone && r.zone !== zone) return false
      if (surface && getPath(r.item, 'placement.surface') !== surface) return false
      for (const c of chips) if (!r.issues.some((i) => i.code === c)) return false
      if (!q) return true
      return [r.item.id, titleOf(r.item), String(getPath(r.item, 'placement.surface') ?? ''), String(r.item.artisan ?? '')].some((s) => s.toLowerCase().includes(q))
    })
  }, [rows, query, zone, surface, chips])
  const filtered = !!(query || zone || surface || chips.size)

  const current = address.id && address.id !== '+new' ? (items?.find((i) => i.id === address.id) ?? null) : null

  /* ---------------- item changes ---------------- */

  const putLocal = useCallback(
    (saved: SavedItem) => {
      const { updatedAt, updatedBy, ...item } = saved
      setItems((list) => {
        const l = list ?? []
        return l.some((i) => i.id === item.id) ? l.map((i) => (i.id === item.id ? (item as Item) : i)) : [...l, item as Item]
      })
      if (updatedAt) onStamp(stampKey(collection, saved.id), { updatedAt, updatedBy: updatedBy ?? null })
      onCountChanged()
    },
    [collection, onStamp, onCountChanged],
  )

  const dropLocal = useCallback((ids: string[]) => {
    const set = new Set(ids)
    setItems((list) => (list ?? []).filter((i) => !set.has(i.id)))
    setSelected((s) => new Set([...s].filter((id) => !set.has(id))))
  }, [])

  /** Delete saved items, then offer Undo (restores each from its delete revision). */
  const deleteItems = useCallback(
    async (targets: Item[]): Promise<string[]> => {
      const byId = new Map(targets.map((t) => [t.id, t]))
      // Undo goes to the exhibition the delete ran in, even if the curator has switched since
      const deletedIn = exhibitionId ?? getSelectedExhibition()
      const res = await runSequential(
        targets.map((t) => t.id),
        async (id) => api.remove(collection, id, { expectedUpdatedAt: await expectedFor(collection, id) }),
      )
      const gone = res.done.map((d) => d.id)
      if (gone.length) {
        dropLocal(gone)
        for (const id of gone) {
          onStamp(stampKey(collection, id), null)
          forgetRecent(collection, id, exhibitionId)
          clearDraft(exhibitionId, collection, id)
        }
        onCountChanged()
        const label = gone.length === 1 ? `Deleted “${titleOf(byId.get(gone[0]) as Item)}”` : `Deleted ${gone.length} ${meta.label.toLowerCase()}`
        toast(label, 'ok', {
          action: {
            label: 'Undo',
            onClick: () => {
              void (async () => {
                const back = await runSequential(gone, (id) => undoDelete(collection, id, deletedIn))
                // after a switch of exhibition this list is gone and these updates go nowhere, as they should
                for (const b of back.done) putLocal(b.value)
                if (back.failed.length) toast(failureText('brought back', back.failed), 'error')
                else toast(back.done.length === 1 ? 'Brought back' : `Brought back ${back.done.length} items`)
              })()
            },
          },
        })
      }
      if (res.failed.length) {
        const conflictHint = res.failed.length === 1 && targets.length === 1 ? res.failed[0].message : failureText('deleted', res.failed)
        toast(conflictHint, 'error')
        setSelected(new Set(res.failed.map((f) => f.id)))
      }
      return gone
    },
    [collection, expectedFor, dropLocal, onStamp, exhibitionId, onCountChanged, meta.label, toast, putLocal],
  )

  /** Save edits to several items one by one (guarded by their stamps); failed rows stay ticked. */
  async function bulkUpdate(ids: string[], change: (i: Item) => Item | null, verb: string, done: (n: number) => string) {
    setBulkBusy(true)
    const targets = (items ?? []).filter((i) => ids.includes(i.id) && i.__new !== true)
    const res = await runSequential(
      targets.map((t) => t.id),
      async (id) => {
        const it = targets.find((t) => t.id === id) as Item
        const next = change(it)
        if (!next) return null
        return api.put(collection, stripInternal(next) as Item, { expectedUpdatedAt: await expectedFor(collection, id) })
      },
    )
    let n = 0
    for (const d of res.done)
      if (d.value) {
        putLocal(d.value)
        n++
      }
    setBulkBusy(false)
    setDialog(null)
    if (res.failed.length) {
      const changed = res.failed.some((f) => /changed|conflict/i.test(f.message))
      toast(`${failureText(verb, res.failed)}${changed ? ' Reload to see the latest versions.' : ''}`, 'error')
      setSelected(new Set(res.failed.map((f) => f.id)))
    } else setSelected(new Set())
    if (n) toast(done(n))
  }

  async function bulkDelete(ids: string[]) {
    const all = (items ?? []).filter((i) => ids.includes(i.id))
    const drafts = all.filter((i) => i.__new === true)
    const saved = all.filter((i) => i.__new !== true)
    const ok = await confirm({
      title: `Delete ${all.length} ${all.length === 1 ? meta.singular : meta.label.toLowerCase()}?`,
      body: `They disappear for every visitor. You can bring them back with Undo or from the trash.${drafts.length ? ` ${drafts.length} unsaved ${drafts.length === 1 ? 'draft is' : 'drafts are'} discarded.` : ''}`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    for (const d of drafts) clearDraft(exhibitionId, collection, d.id)
    dropLocal(drafts.map((d) => d.id))
    setBulkBusy(true)
    await deleteItems(saved)
    setBulkBusy(false)
  }

  async function bulkCopy(ids: string[], target: string, overwrite: boolean) {
    setBulkBusy(true)
    const targets = (items ?? []).filter((i) => ids.includes(i.id) && i.__new !== true)
    const res = await runSequential(
      targets.map((t) => t.id),
      (id) => copyToExhibition(collection, targets.find((t) => t.id === id) as Item, target, overwrite),
    )
    setBulkBusy(false)
    setDialog(null)
    const copied = res.done.filter((d) => d.value === 'copied').length
    const skipped = res.done.filter((d) => d.value === 'skipped')
    if (res.failed.length) {
      toast(failureText('copied', res.failed), 'error')
      setSelected(new Set(res.failed.map((f) => f.id)))
    } else setSelected(new Set())
    if (copied || skipped.length)
      toast(
        `Copied ${copied} ${copied === 1 ? 'item' : 'items'}${skipped.length ? `; ${skipped.length} already there (left as ${skipped.length === 1 ? 'it was' : 'they were'})` : ''}.`,
        copied ? 'ok' : 'info',
      )
  }

  function bulkMove(ids: string[], surfaceId: string) {
    const r = surfaceRange(surfaceId)
    if (!r) return
    void bulkUpdate(
      ids,
      (it) => {
        const at = getPath(it, 'placement.at')
        const clamped = typeof at === 'number' && Number.isFinite(at) ? Math.min(r.max, Math.max(r.min, at)) : (r.min + r.max) / 2
        return setPath(setPath(it, 'placement.surface', surfaceId), 'placement.at', Math.round(clamped * 100) / 100) as Item
      },
      'moved',
      (n) => `Moved ${n} ${n === 1 ? 'item' : 'items'} to ${r.label}`,
    )
  }

  function create(id: string, title: string, source: Item | null) {
    const base = source ? { ...stripInternal(source), id } : template(collection, id, items ?? [])
    const draft: Item = { ...base, ...(title ? { title } : {}), id, __new: true }
    setItems((list) => [...(list ?? []), draft])
    setCreating(null)
    navigate(id, { force: true })
  }

  /* ---------------- render ---------------- */

  if (error)
    return (
      <div className="card">
        <EmptyState title={`Couldn’t load ${meta.label.toLowerCase()}`} icon="alert" action={<Button onClick={() => setReload((k) => k + 1)}>Try again</Button>}>
          {error}
        </EmptyState>
      </div>
    )

  if (address.id && address.id !== '+new') {
    if (!items) return <div className="card"><div className="skel-lines" aria-busy="true" aria-label="Loading"><span className="skel line title" /><span className="skel line" /><span className="skel line short" /></div></div>
    if (!current)
      return (
        <div className="card">
          <EmptyState title={`No ${meta.singular} “${address.id}”`} icon="search" action={<Button onClick={() => navigate(null, { force: true })}>Back to {meta.label.toLowerCase()}</Button>}>
            It may have been deleted. Deleted items are in the trash.
          </EmptyState>
        </div>
      )
    return (
      <>
        <ItemEditor
          key={current.id}
          collection={collection}
          item={current}
          stamp={stamps?.[stampKey(collection, current.id)]}
          exhibitionId={exhibitionId}
          expectedFor={expectedFor}
          museumBase={museumBase}
          focusField={address.field}
          onChanged={putLocal}
          onDelete={async (it) => {
            const gone = await deleteItems([it])
            if (gone.length) navigate(null, { force: true })
            return gone.length > 0
          }}
          onDiscardNew={(id) => {
            dropLocal([id])
            navigate(null, { force: true })
          }}
          onDuplicate={(it) => setCreating({ source: it })}
        />
        {creating && <NewItemDialog collection={collection} existing={items} source={creating.source} onClose={() => setCreating(null)} onCreate={(id, t) => create(id, t, creating.source)} />}
      </>
    )
  }

  const columns: Column<Row>[] = [
    {
      id: 'title',
      header: 'Title',
      sortValue: (r) => titleOf(r.item).toLowerCase(),
      cell: (r) => {
        const thumb = itemThumb(collection, r.item)
        return (
          <div className="ct-title">
            {thumb ? <img className="ct-thumb" src={thumb} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} /> : <span className="ct-thumb" aria-hidden="true">{titleOf(r.item).slice(0, 1).toUpperCase()}</span>}
            <span className="ct-text">
              <a className="cell-title" href={`#/content/${collection}/${encodeURIComponent(r.item.id)}`} onClick={(e) => {
                e.preventDefault()
                navigate(r.item.id)
              }}>
                {titleOf(r.item)}
              </a>
              <span className="cell-sub mono">{r.item.id}</span>
            </span>
          </div>
        )
      },
    },
    {
      id: 'where',
      header: hasSurface ? 'Wall' : 'Zone',
      hidePhone: true,
      sortValue: (r) => (hasSurface ? (surfaceRange(getPath(r.item, 'placement.surface'))?.label ?? '') : (ZONE_NAMES.get(r.zone ?? '') ?? r.zone ?? '')),
      cell: (r) => {
        if (!hasSurface) return r.zone ? (ZONE_NAMES.get(r.zone) ?? r.zone) : '–'
        const sr = surfaceRange(getPath(r.item, 'placement.surface'))
        const at = getPath(r.item, 'placement.at')
        return sr ? (
          <span className="stack">
            {sr.label}
            <span className="cell-sub">
              {ZONE_NAMES.get(sr.zone) ?? sr.zone}
              {typeof at === 'number' ? ` · ${at.toFixed(2)} m` : ''}
            </span>
          </span>
        ) : (
          '–'
        )
      },
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (r) => (r.item.__new === true ? -1 : r.issues.length),
      cell: (r) => (
        <div className="ct-badges">
          {r.item.__new === true && <Badge tone="warn">Not saved</Badge>}
          {r.item.placeholder === true && <Badge tone="info">Needs content</Badge>}
          {r.issues.filter((i) => i.code !== 'placeholder').length ? (
            <Badge title={r.issues.filter((i) => i.code !== 'placeholder').map((i) => i.label).join('\n')}>
              {r.issues.filter((i) => i.code !== 'placeholder').length} to check
            </Badge>
          ) : r.item.__new !== true && r.item.placeholder !== true ? (
            <Badge tone="ok">Complete</Badge>
          ) : null}
        </div>
      ),
    },
    {
      id: 'updated',
      header: 'Last edited',
      hidePhone: true,
      sortValue: (r) => stamps?.[stampKey(collection, r.item.id)]?.updatedAt ?? '',
      cell: (r) => {
        const s = stamps?.[stampKey(collection, r.item.id)]
        return s ? (
          <span className="stack" title={formatDate(s.updatedAt)}>
            {formatRelative(s.updatedAt)}
            <span className="cell-sub">{s.updatedBy ?? '–'}</span>
          </span>
        ) : (
          '–'
        )
      },
    },
  ]

  const toggleChip = (c: Chip) =>
    setChips((s) => {
      const n = new Set(s)
      if (n.has(c)) n.delete(c)
      else n.add(c)
      return n
    })

  return (
    <>
      <div className="toolbar ct-toolbar">
        <SearchInput value={query} onChange={setQuery} label={`Search ${meta.label.toLowerCase()}`} placeholder={`Search ${meta.label.toLowerCase()}`} />
        <Select size="sm" value={zone} onChange={setZone} options={zoneOptions} placeholder="All zones" clearable aria-label="Zone" className="ct-filter" />
        {hasSurface ? <Select size="sm" value={surface} onChange={setSurface} options={surfaceOptions} placeholder="All walls" clearable searchable aria-label="Wall" className="ct-filter" /> : null}
        <span className="spacer" />
        <Button variant="primary" icon="plus" onClick={() => setCreating({ source: null })}>
          New {meta.singular}
        </Button>
      </div>
      <div className="ct-chips" role="group" aria-label="Show only">
        <span className="muted small">Show only</span>
        {chipList.map((c) => {
          const n = rows ? rows.filter((r) => r.issues.some((i) => i.code === c.id)).length : null
          return (
            <button key={c.id} type="button" className="ui-tab" aria-pressed={chips.has(c.id)} onClick={() => toggleChip(c.id)}>
              {c.label}
              {n !== null ? <span className="count">{n}</span> : null}
            </button>
          )
        })}
        {filtered ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setQuery('')
              setZone('')
              setSurface('')
              setChips(new Set())
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>
      <DataTable
        rows={shown}
        columns={columns}
        getRowId={(r) => r.item.id}
        caption={`${meta.label} of this exhibition`}
        selectable
        selected={selected}
        onSelectedChange={setSelected}
        defaultSort={null}
        onRowClick={(r) => navigate(r.item.id)}
        rowActions={(r) => (
          <RowActions label={`Actions for ${titleOf(r.item)}`}>
            <RowAction tone="edit" icon="edit" onClick={() => navigate(r.item.id)}>Update</RowAction>
            <Menu
              label={`More for ${titleOf(r.item)}`}
              items={[
                { label: 'Duplicate', icon: 'copy', onSelect: () => setCreating({ source: r.item }) },
                ...(r.item.__new !== true ? [{ label: 'Preview in museum', icon: 'external' as const, href: museumHref(museumBase, collection, r.item.id), external: true }] : []),
              ]}
            />
          </RowActions>
        )}
        bulkActions={(ids) => (
          <>
            <Button
              size="sm"
              icon="check"
              disabled={bulkBusy}
              onClick={() =>
                void bulkUpdate(ids, (it) => (it.placeholder === true ? ({ ...it, placeholder: false } as Item) : null), 'marked complete', (n) => `Marked ${n} ${n === 1 ? 'item' : 'items'} complete`)
              }
            >
              Mark complete
            </Button>
            {hasSurface ? (
              <Button size="sm" icon="arrowRight" disabled={bulkBusy} onClick={() => setDialog('move')}>
                Move to wall
              </Button>
            ) : null}
            <Button size="sm" icon="copy" disabled={bulkBusy} onClick={() => setDialog('copy')}>
              Copy to exhibition
            </Button>
            <Button size="sm" variant="danger" icon="trash" disabled={bulkBusy} onClick={() => void bulkDelete(ids)}>
              Delete
            </Button>
          </>
        )}
        empty={
          filtered ? (
            <EmptyState title="Nothing matches these filters" icon="filter" as="h3" action={<Button onClick={() => { setQuery(''); setZone(''); setSurface(''); setChips(new Set()) }}>Clear filters</Button>} />
          ) : (
            <EmptyState title={`No ${meta.label.toLowerCase()} yet`} icon="content" as="h3" action={<Button variant="primary" icon="plus" onClick={() => setCreating({ source: null })}>New {meta.singular}</Button>}>
              Create the first {meta.singular} for this exhibition.
            </EmptyState>
          )
        }
        footer={
          shown && items ? (
            <div className="ui-table-foot">
              <span>
                {filtered ? `${shown.length.toLocaleString()} of ${items.length.toLocaleString()}` : `${items.length.toLocaleString()} ${items.length === 1 ? meta.singular : meta.label.toLowerCase()}`}
              </span>
            </div>
          ) : null
        }
      />
      {creating && items && <NewItemDialog collection={collection} existing={items} source={creating.source} onClose={() => setCreating(null)} onCreate={(id, t) => create(id, t, creating.source)} />}
      {dialog === 'copy' && <CopyDialog count={selected.size} busy={bulkBusy} onClose={() => setDialog(null)} onCopy={(ex, ow) => void bulkCopy([...selected], ex, ow)} />}
      {dialog === 'move' && <MoveDialog count={selected.size} busy={bulkBusy} onClose={() => setDialog(null)} onMove={(s) => bulkMove([...selected], s)} />}
    </>
  )
}
