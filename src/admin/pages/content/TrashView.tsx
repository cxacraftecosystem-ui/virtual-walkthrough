/** Deleted items of this exhibition that have not been made again, with Restore. */
import { useEffect, useState } from 'react'
import { api, type TrashItem } from '../../api'
import { Button, DataTable, EmptyState, RowAction, RowActions, SearchInput, errMsg, formatDate, formatRelative, useToast, type Column } from '../../ui'
import { failureText, restoreRevision, runSequential } from './actions'
import { contentHref, metaOf } from './model'

export function TrashView({ onRestored }: { onRestored: () => void }) {
  const [items, setItems] = useState<TrashItem[] | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const toast = useToast()

  useEffect(() => {
    let alive = true
    setError('')
    api
      .contentTrash()
      .then((r) => alive && setItems(r.items))
      .catch((e) => alive && setError(errMsg(e)))
    return () => {
      alive = false
    }
  }, [reload])

  const key = (t: TrashItem) => `${t.collection}/${t.id}`
  async function restore(list: TrashItem[]) {
    setBusy(true)
    const res = await runSequential(list.map(key), async (k) => {
      const t = list.find((x) => key(x) === k) as TrashItem
      // 'new': refused when someone has made the id again since it was deleted, instead of replacing theirs
      await restoreRevision(t.collection, t.id, t.rev, 'new')
      return t
    })
    setBusy(false)
    const back = new Set(res.done.map((d) => d.id))
    setItems((l) => (l ?? []).filter((t) => !back.has(key(t))))
    if (res.done.length) {
      const one = res.done.length === 1 ? res.done[0].value : null
      toast(one ? `Restored “${one.title}”` : `Restored ${res.done.length} items`, 'ok', one ? { action: { label: 'Open', onClick: () => (window.location.hash = contentHref(one.collection, one.id).slice(1)) } } : undefined)
      onRestored()
    }
    if (res.failed.length) {
      toast(failureText('restored', res.failed), 'error')
      setSelected(new Set(res.failed.map((f) => f.id)))
    } else setSelected(new Set())
  }

  const q = query.trim().toLowerCase()
  const shown = items ? items.filter((t) => !q || t.title.toLowerCase().includes(q) || t.id.toLowerCase().includes(q)) : null
  const columns: Column<TrashItem>[] = [
    {
      id: 'title',
      header: 'Item',
      sortValue: (t) => t.title.toLowerCase(),
      cell: (t) => (
        <span className="stack">
          <span className="cell-title">{t.title}</span>
          <span className="cell-sub mono">{t.id}</span>
        </span>
      ),
    },
    { id: 'collection', header: 'Collection', sortValue: (t) => metaOf(t.collection).label, cell: (t) => metaOf(t.collection).label, hidePhone: true },
    {
      id: 'deleted',
      header: 'Deleted',
      sortValue: (t) => t.deletedAt,
      cell: (t) => (
        <span className="stack" title={formatDate(t.deletedAt)}>
          {formatRelative(t.deletedAt)}
          <span className="cell-sub">{t.deletedBy ?? '–'}</span>
        </span>
      ),
    },
  ]

  if (error)
    return (
      <div className="card">
        <EmptyState title="Couldn’t load the trash" icon="alert" action={<Button onClick={() => setReload((n) => n + 1)}>Try again</Button>}>
          {error}
        </EmptyState>
      </div>
    )
  return (
    <>
      <div className="toolbar">
        <SearchInput value={query} onChange={setQuery} label="Search deleted items" placeholder="Search deleted items" />
      </div>
      <DataTable
        rows={shown}
        columns={columns}
        getRowId={key}
        caption="Deleted items"
        selectable
        selected={selected}
        onSelectedChange={setSelected}
        defaultSort={{ id: 'deleted', dir: 'desc' }}
        rowActions={(t) => (
          <RowActions>
            <RowAction tone="positive" icon="undo" disabled={busy} onClick={() => void restore([t])}>
              Restore
            </RowAction>
          </RowActions>
        )}
        bulkActions={(ids) => (
          <Button size="sm" icon="undo" loading={busy} loadingLabel="Restoring…" onClick={() => void restore((items ?? []).filter((t) => ids.includes(key(t))))}>
            Restore
          </Button>
        )}
        empty={
          q ? (
            <EmptyState title="Nothing matches" icon="search" as="h3" />
          ) : (
            <EmptyState title="The trash is empty" icon="trash" as="h3">
              Deleted items of this exhibition appear here.
            </EmptyState>
          )
        }
        footer={items && items.length >= 500 ? <div className="ui-table-foot">Showing the latest 500 deleted items.</div> : null}
      />
    </>
  )
}
