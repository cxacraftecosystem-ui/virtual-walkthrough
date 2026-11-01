/**
 * Comments (#/comments, admin+): guestbook entries and comments on items. They publish as soon as they
 * are posted; hide anything that should not stay up.
 *
 * - Tabs (all / visible / hidden) with counts, search over text, author and item, a date filter, a
 *   sortable table, 50 rows a page.
 * - "On" links to the item's content editor and to the item in the museum.
 * - Bulk hide / unhide / delete (api.commentsBulk, 200 at a time; failed rows stay ticked).
 * - Keyboard triage: j/k move, h hide or unhide, x tick, Enter opens the comment.
 * - `#/comments/<id>` points at that comment (links from the activity log).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type AdminComment, type CommentsBulkAction } from '../api'
import {
  Button,
  ButtonRow,
  DataTable,
  Drawer,
  EmptyState,
  Icon,
  PageHeader,
  Pagination,
  RowAction,
  RowActions,
  SearchInput,
  Select,
  StatusBadge,
  Tabs,
  errMsg,
  formatDate,
  formatRelative,
  pageSlice,
  useConfirm,
  useToast,
  type Column,
  type SortState,
} from '../ui'
import { KeyLegend, chunked, hashTail, overviewStale, plural, sortRows, useCursor, useRefreshOnFocus, useTriageKeys } from './triage'
import './operations.css'

type Filter = 'all' | 'visible' | 'hidden'
type Since = '' | '1' | '7' | '30' | '90'
const PAGE = 50
const SERVER_CAP = 2000
const KIND_LABEL: Record<string, string> = { artwork: 'Artwork', exhibit: 'Exhibit', infographic: 'Infographic', video: 'Video', object: 'Object' }
const SINCE_OPTIONS: { value: Since; label: string }[] = [
  { value: '', label: 'Any time' },
  { value: '1', label: 'Last 24 hours' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
]
const BULK_WORD: Record<CommentsBulkAction, string> = { hide: 'Hid', unhide: 'Unhid', delete: 'Deleted' }

const excerpt = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const contentHref = (c: AdminComment) => (c.itemKind && c.itemId ? `#/content/${c.itemKind}s/${encodeURIComponent(c.itemId)}` : null)
const museumHref = (c: AdminComment) => (c.itemKind && c.itemId ? `/gallery#${c.itemKind}=${encodeURIComponent(c.itemId)}` : null)

function OnCell({ c }: { c: AdminComment }) {
  const edit = contentHref(c)
  const visit = museumHref(c)
  if (!edit || !visit) return <span className="muted">Guestbook</span>
  return (
    <span className="ops-on">
      <a href={edit} title="Open in the content editor">
        <span className="cell-sub">{KIND_LABEL[c.itemKind ?? ''] ?? c.itemKind}</span>
        <span className="mono truncate">{c.itemId}</span>
      </a>
      <a className="icon-btn sm" href={visit} target="_blank" rel="noreferrer" aria-label={`Open ${c.itemId} in the museum (new tab)`} title="Open in the museum">
        <Icon name="external" />
      </a>
    </span>
  )
}

export function CommentsPage() {
  const [items, setItems] = useState<AdminComment[] | null>(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [since, setSince] = useState<Since>('')
  const [sort, setSort] = useState<SortState>({ id: 'when', dir: 'desc' })
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [openId, setOpenId] = useState<string | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const confirm = useConfirm()
  const gen = useRef(0)
  const deepLink = useRef(hashTail('comments'))

  const load = useCallback(() => {
    const g = ++gen.current
    api
      .comments()
      .then((list) => {
        if (g !== gen.current) return
        setItems(list)
        setError('')
      })
      .catch((e) => g === gen.current && setError(errMsg(e)))
  }, [])
  useEffect(load, [load])
  useRefreshOnFocus(load)

  const all = useMemo(() => items ?? [], [items])
  const hiddenCount = useMemo(() => all.filter((c) => c.hidden).length, [all])

  const columns = useMemo<Column<AdminComment>[]>(
    () => [
      {
        id: 'when',
        header: 'When',
        width: 120,
        hidePhone: true,
        sortValue: (c) => c.createdAt,
        cell: (c) => (
          <time dateTime={c.createdAt} title={formatDate(c.createdAt)} style={{ whiteSpace: 'nowrap' }}>
            {formatRelative(c.createdAt)}
          </time>
        ),
      },
      {
        id: 'author',
        header: 'Author',
        sortValue: (c) => c.displayName,
        cell: (c) => (
          <>
            <span className="cell-title">{c.displayName || 'Anonymous'}</span>
            {c.userEmail ? <span className="cell-sub truncate" style={{ display: 'block', maxWidth: 220 }}>{c.userEmail}</span> : null}
          </>
        ),
      },
      { id: 'on', header: 'On', hidePhone: true, sortValue: (c) => (c.itemKind ? `${c.itemKind}/${c.itemId}` : ''), cell: (c) => <OnCell c={c} /> },
      {
        id: 'body',
        header: 'Comment',
        cell: (c) => (
          <button type="button" className="mx-linkish ops-comment" onClick={() => setOpenId(c.id)} title="Open the comment">
            {excerpt(c.body, 220)}
          </button>
        ),
      },
      { id: 'status', header: 'Status', sortValue: (c) => (c.hidden ? 1 : 0), cell: (c) => <StatusBadge status={c.hidden ? 'hidden' : 'visible'} /> },
    ],
    [],
  )

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    const from = since ? Date.now() - Number(since) * 864e5 : 0
    const rows = all.filter((c) => {
      if (filter === 'visible' && c.hidden) return false
      if (filter === 'hidden' && !c.hidden) return false
      if (from && new Date(c.createdAt).getTime() < from) return false
      return (
        !s ||
        c.body.toLowerCase().includes(s) ||
        c.displayName.toLowerCase().includes(s) ||
        (c.userEmail ?? '').toLowerCase().includes(s) ||
        (c.itemId ?? 'guestbook').toLowerCase().includes(s)
      )
    })
    const col = columns.find((c) => c.id === sort?.id)
    return sort ? sortRows(rows, col?.sortValue, sort.dir) : rows
  }, [all, filter, q, since, sort, columns])

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE))
  const curPage = Math.min(page, pages)
  const rows = useMemo(() => pageSlice(filtered, curPage, PAGE), [filtered, curPage])
  const ids = useMemo(() => rows.map((c) => c.id), [rows])
  const cursor = useCursor(ids, '.ui-table tr.is-cursor')
  const current = rows[cursor.index] ?? null
  const open = openId ? all.find((c) => c.id === openId) ?? null : null

  // filters start again from page 1
  useEffect(() => setPage(1), [filter, q, since, sort])
  // forget ticks on comments that are gone
  useEffect(() => {
    if (!items) return
    const have = new Set(items.map((c) => c.id))
    setSelected((s) => {
      const keep = new Set([...s].filter((id) => have.has(id)))
      return keep.size === s.size ? s : keep
    })
  }, [items])

  // a deep link points at its comment once the list is in
  const { setCurrent } = cursor
  useEffect(() => {
    const id = deepLink.current
    if (!id || !items) return
    const i = filtered.findIndex((c) => c.id === id)
    if (i < 0) {
      if (filter !== 'all' || q || since) {
        setFilter('all')
        setQ('')
        setSince('')
        return // runs again with everything shown
      }
      deepLink.current = ''
      return
    }
    const p = Math.floor(i / PAGE) + 1
    if (p !== curPage) return setPage(p)
    deepLink.current = ''
    setCurrent(id)
    setFlashId(id)
    const t = setTimeout(() => setFlashId(null), 1400)
    requestAnimationFrame(() => document.querySelector('.ui-table tr[data-flash="true"]')?.scrollIntoView({ block: 'center' }))
    return () => clearTimeout(t)
  }, [items, filtered, filter, q, since, curPage, setCurrent])

  async function setHidden(c: AdminComment, hidden: boolean, undoable = true) {
    try {
      await api.setHidden(c.id, hidden)
      setItems((list) => (list ?? []).map((x) => (x.id === c.id ? { ...x, hidden } : x)))
      overviewStale()
      toast(`“${excerpt(c.body, 60)}”`, 'ok', {
        title: hidden ? 'Comment hidden' : 'Comment visible again',
        action: undoable ? { label: 'Undo', onClick: () => void setHidden({ ...c, hidden }, !hidden, false) } : undefined,
      })
    } catch (e) {
      toast(errMsg(e), 'error')
    }
  }

  async function remove(c: AdminComment) {
    const ok = await confirm({
      title: 'Delete this comment?',
      body: (
        <>
          <p>“{excerpt(c.body, 140)}” by {c.displayName || 'Anonymous'} is removed. Hiding it instead keeps a record.</p>
          <p>This can’t be undone.</p>
        </>
      ),
      confirmLabel: 'Delete comment',
      danger: true,
    })
    if (!ok) return
    try {
      await api.deleteComment(c.id)
      setItems((list) => (list ?? []).filter((x) => x.id !== c.id))
      if (openId === c.id) setOpenId(null)
      overviewStale()
      toast('Comment deleted')
    } catch (e) {
      toast(errMsg(e), 'error')
    }
  }

  async function bulk(action: CommentsBulkAction, list: string[]) {
    if (!list.length || busy) return
    if (action === 'delete') {
      const ok = await confirm({
        title: `Delete ${plural(list.length, 'comment')}?`,
        body: 'Hiding them instead keeps a record. This can’t be undone.',
        confirmLabel: `Delete ${plural(list.length, 'comment')}`,
        danger: true,
        typeToConfirm: list.length >= 10 ? 'delete' : undefined,
      })
      if (!ok) return
    }
    setBusy(true)
    try {
      const { updated, failed, lastError } = await chunked(list, (chunk) => api.commentsBulk(chunk, action))
      const failedSet = new Set(failed)
      const okIds = new Set(list.filter((id) => !failedSet.has(id)))
      setItems((cur) => (cur ?? []).flatMap((c) => (!okIds.has(c.id) ? [c] : action === 'delete' ? [] : [{ ...c, hidden: action === 'hide' }])))
      setSelected(new Set(failed))
      overviewStale()
      if (failed.length) toast(`${errMsg(lastError)} ${plural(failed.length, 'comment')} stay ticked.`, 'error', { title: `${BULK_WORD[action]} ${updated}; ${failed.length} failed` })
      else toast(`${BULK_WORD[action]} ${plural(updated, 'comment')}`)
    } finally {
      setBusy(false)
    }
  }

  const label = (id: string, i: number) => {
    const c = rows.find((x) => x.id === id)
    return c ? `${i + 1} of ${rows.length}: ${c.displayName || 'Anonymous'}, ${c.hidden ? 'hidden' : 'visible'}. ${excerpt(c.body, 80)}` : ''
  }
  useTriageKeys(
    {
      j: () => cursor.move(1, label),
      k: () => cursor.move(-1, label),
      h: () => current && void setHidden(current, !current.hidden),
      x: () =>
        current &&
        setSelected((s) => {
          const n = new Set(s)
          if (n.has(current.id)) n.delete(current.id)
          else n.add(current.id)
          return n
        }),
      Enter: () => current && setOpenId(current.id),
    },
    !!items,
  )

  const filtering = !!q.trim() || !!since

  return (
    <>
      <PageHeader icon="comments" title="Comments" description="Guestbook entries and comments on items. They appear as soon as they’re posted; hide anything that shouldn’t stay up." />
      {error ? <p className="alert" role="alert">{items ? `Couldn’t refresh: ${error}` : error}</p> : null}

      <Tabs<Filter>
        label="Filter comments"
        value={filter}
        onChange={setFilter}
        tabs={[
          { id: 'all', label: 'All', count: items ? all.length : undefined },
          { id: 'visible', label: 'Visible', count: items ? all.length - hiddenCount : undefined },
          { id: 'hidden', label: 'Hidden', count: items ? hiddenCount : undefined },
        ]}
        className="ops-tabs"
      />
      <div className="toolbar ops-toolbar">
        <SearchInput value={q} onChange={setQ} label="Search comments by text, author or item" placeholder="Search text, author, item" />
        <Select<Since> size="sm" value={since} onChange={setSince} options={SINCE_OPTIONS} aria-label="Posted" />
        <span className="spacer" />
        <KeyLegend keys={[['j k', 'move'], ['h', 'hide / unhide'], ['x', 'tick'], ['Enter', 'open']]} />
      </div>
      {items && items.length >= SERVER_CAP ? <p className="note small">Showing the latest {SERVER_CAP.toLocaleString()} comments.</p> : null}
      <p className="sr-only" aria-live="polite">{cursor.announce}</p>

      <div className="ops-table">
        <DataTable<AdminComment>
          rows={items ? rows : null}
          columns={columns}
          getRowId={(c) => c.id}
          caption="Comments"
          sort={sort}
          onSortChange={setSort}
          selectable
          selected={selected}
          onSelectedChange={setSelected}
          rowClassName={(c) => [c.id === cursor.currentId && 'is-cursor', c.hidden && 'is-hidden'].filter(Boolean).join(' ') || undefined}
          flashId={flashId}
          minWidth={860}
          rowActionsLabel="Comment actions"
          rowActions={(c) => (
            <RowActions destructive={<RowAction tone="danger" icon="trash" onClick={() => void remove(c)}>Delete</RowAction>}>
              <RowAction icon={c.hidden ? 'eye' : 'close'} onClick={() => void setHidden(c, !c.hidden)}>{c.hidden ? 'Unhide' : 'Hide'}</RowAction>
            </RowActions>
          )}
          bulkActions={(sel) => (
            <>
              <Button size="sm" icon="close" disabled={busy} onClick={() => void bulk('hide', sel)}>Hide</Button>
              <Button size="sm" icon="eye" disabled={busy} onClick={() => void bulk('unhide', sel)}>Unhide</Button>
              <Button size="sm" variant="danger" icon="trash" disabled={busy} onClick={() => void bulk('delete', sel)}>Delete</Button>
            </>
          )}
          empty={
            <EmptyState icon="comments" as="h3" title={filtering ? 'No matching comments' : filter === 'hidden' ? 'Nothing hidden' : 'No comments yet'}>
              {filtering ? 'Try other words or a longer period.' : filter === 'hidden' ? 'Comments you hide appear here.' : 'Guestbook entries and item comments appear here as soon as they’re posted.'}
            </EmptyState>
          }
          footer={filtered.length > PAGE ? <Pagination page={curPage} pageSize={PAGE} total={filtered.length} onPage={setPage} noun="comments" /> : null}
        />
      </div>

      {open ? (
        <Drawer
          title={open.displayName || 'Anonymous'}
          description={formatDate(open.createdAt)}
          onClose={() => setOpenId(null)}
          footer={
            <ButtonRow destructive={<Button variant="danger" icon="trash" onClick={() => void remove(open)}>Delete</Button>}>
              <Button icon={open.hidden ? 'eye' : 'close'} onClick={() => void setHidden(open, !open.hidden)}>{open.hidden ? 'Unhide' : 'Hide'}</Button>
            </ButtonRow>
          }
        >
          <blockquote className="ops-quote">{open.body}</blockquote>
          <dl className="mx-facts">
            <dt>Status</dt>
            <dd><StatusBadge status={open.hidden ? 'hidden' : 'visible'} /></dd>
            <dt>Author</dt>
            <dd>
              {open.displayName || 'Anonymous'}
              {open.userEmail ? <span className="muted"> · {open.userEmail}</span> : <span className="muted"> · not signed in</span>}
            </dd>
            <dt>On</dt>
            <dd>
              {contentHref(open) ? (
                <>
                  {KIND_LABEL[open.itemKind ?? ''] ?? open.itemKind} <span className="mono">{open.itemId}</span>
                  <span className="ops-links">
                    <a href={contentHref(open) ?? undefined}>Open in the content editor</a>
                    <a href={museumHref(open) ?? undefined} target="_blank" rel="noreferrer">Open in the museum<span className="sr-only"> (opens in a new tab)</span></a>
                  </span>
                </>
              ) : (
                'The guestbook'
              )}
            </dd>
            <dt>Activity</dt>
            <dd><a href={`#/activity?target=comment:${encodeURIComponent(open.id)}`}>Changes to this comment</a></dd>
          </dl>
        </Drawer>
      ) : null}
    </>
  )
}

export default CommentsPage
