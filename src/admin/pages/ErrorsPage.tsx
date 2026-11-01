/**
 * Errors (#/errors, admin+): script errors reported by visitors' browsers, grouped by message and
 * origin. No personal data is stored. A resolved error that happens again reopens by itself.
 *
 * - Tabs (open / resolved / all) with counts, search (message, kind, page, release, GPU), sort by
 *   count, last 24 hours, last seen or first seen (column headers or the Sort menu).
 * - A group opens in a drawer: its last stack and browser, then its recent occurrences, each of which
 *   expands to its own stack.
 * - Bulk resolve / reopen / delete (api.errorsBulk, 200 at a time; failed rows stay ticked).
 * - Keyboard triage: j/k move, r resolve or reopen, x tick, Enter opens the group.
 * - `#/errors/<fingerprint>` opens that group (links from the activity log).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type ErrorGroup, type ErrorOccurrence, type ErrorsBulkAction } from '../api'
import {
  Badge,
  Button,
  ButtonRow,
  DataTable,
  Drawer,
  EmptyState,
  PageHeader,
  Pagination,
  RowAction,
  RowActions,
  SearchInput,
  Select,
  Skeleton,
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

type Status = 'open' | 'resolved' | 'all'
type SortKey = 'lastSeen' | 'count' | 'day' | 'firstSeen'
const PAGE = 50
const SERVER_CAP = 500
const SORTS: { value: SortKey; label: string }[] = [
  { value: 'lastSeen', label: 'Last seen' },
  { value: 'count', label: 'Most reports' },
  { value: 'day', label: 'Most in 24 h' },
  { value: 'firstSeen', label: 'Newest first' },
]
const BULK_WORD: Record<ErrorsBulkAction, string> = { resolve: 'Resolved', reopen: 'Reopened', delete: 'Deleted' }
const ts = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() || 0 : 0)
const short = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export function ErrorsPage() {
  const [status, setStatus] = useState<Status>('open')
  const [data, setData] = useState<{ groups: ErrorGroup[]; open: number; resolved: number } | null>(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<SortState>({ id: 'lastSeen', dir: 'desc' })
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [openFp, setOpenFp] = useState<string | null>(() => hashTail('errors') || null)
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const toast = useToast()
  const confirm = useConfirm()
  const gen = useRef(0)

  const load = useCallback(
    (quiet = false) => {
      const g = ++gen.current
      if (quiet) setRefreshing(true)
      api
        .errors(status)
        .then((d) => {
          if (g !== gen.current) return
          setData(d)
          setError('')
        })
        .catch((e) => g === gen.current && setError(errMsg(e)))
        .finally(() => g === gen.current && setRefreshing(false))
    },
    [status],
  )
  useEffect(() => {
    setData(null)
    load()
  }, [load])
  useRefreshOnFocus(() => load(true))

  const columns = useMemo<Column<ErrorGroup>[]>(
    () => [
      {
        id: 'message',
        header: 'Error',
        cell: (g) => (
          <span className="ops-err">
            <button type="button" className="mx-linkish cell-title ops-err-msg" onClick={() => setOpenFp(g.fingerprint)} title="Open the error">
              {short(g.message, 160)}
            </button>
            {g.lastUrl ? <span className="cell-sub mono truncate" title={g.lastUrl}>{g.lastUrl}</span> : null}
          </span>
        ),
      },
      { id: 'kind', header: 'Kind', hidePhone: true, className: 'ops-err-kind', sortValue: (g) => g.kind, cell: (g) => <Badge title={g.kind}>{g.kind}</Badge> },
      { id: 'count', header: 'Reports', align: 'right', sortValue: (g) => g.count, cell: (g) => g.count.toLocaleString() },
      { id: 'day', header: '24 h', align: 'right', sortValue: (g) => g.last24h ?? 0, cell: (g) => (g.last24h ? g.last24h.toLocaleString() : '–') },
      {
        id: 'lastSeen',
        header: 'Last seen',
        sortValue: (g) => ts(g.lastSeen),
        cell: (g) => <time dateTime={g.lastSeen} title={formatDate(g.lastSeen)} style={{ whiteSpace: 'nowrap' }}>{formatRelative(g.lastSeen)}</time>,
      },
      {
        id: 'firstSeen',
        header: 'First seen',
        hidePhone: true,
        className: 'ops-wide-only',
        sortValue: (g) => ts(g.firstSeen),
        cell: (g) => <time dateTime={g.firstSeen} title={formatDate(g.firstSeen)} style={{ whiteSpace: 'nowrap' }}>{formatRelative(g.firstSeen)}</time>,
      },
      { id: 'status', header: 'Status', sortValue: (g) => (g.resolvedAt ? 1 : 0), cell: (g) => <StatusBadge status={g.resolvedAt ? 'resolved' : 'open'} /> },
    ],
    [],
  )

  const groups = useMemo(() => data?.groups ?? [], [data])
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    const rows = s
      ? groups.filter((g) => [g.message, g.kind, g.lastUrl, g.lastRelease, g.lastGpu, g.lastTier, g.fingerprint].some((v) => (v ?? '').toLowerCase().includes(s)))
      : groups
    const col = columns.find((c) => c.id === sort?.id)
    return sort ? sortRows(rows, col?.sortValue, sort.dir) : rows
  }, [groups, q, sort, columns])
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE))
  const curPage = Math.min(page, pages)
  const rows = useMemo(() => pageSlice(filtered, curPage, PAGE), [filtered, curPage])
  const ids = useMemo(() => rows.map((g) => g.fingerprint), [rows])
  const cursor = useCursor(ids, '.ui-table tr.is-cursor')
  const current = rows[cursor.index] ?? null
  const open = openFp ? groups.find((g) => g.fingerprint === openFp) ?? null : null

  useEffect(() => setPage(1), [status, q, sort])
  useEffect(() => {
    const have = new Set(groups.map((g) => g.fingerprint))
    setSelected((s) => {
      const keep = new Set([...s].filter((id) => have.has(id)))
      return keep.size === s.size ? s : keep
    })
  }, [groups])
  // a deep link to a resolved group: look in "all"
  useEffect(() => {
    if (openFp && data && !open && status === 'open' && hashTail('errors') === openFp) setStatus('all')
  }, [openFp, data, open, status])

  const closeDrawer = () => {
    setOpenFp(null)
    if (hashTail('errors')) window.history.replaceState(null, '', '#/errors')
  }

  async function setResolved(g: ErrorGroup, resolved: boolean) {
    try {
      await api.resolveError(g.fingerprint, resolved)
      overviewStale()
      toast(short(g.message, 80), 'ok', { title: resolved ? 'Resolved' : 'Reopened', action: { label: 'Undo', onClick: () => void undoResolve(g, !resolved) } })
      load(true)
    } catch (e) {
      toast(errMsg(e), 'error')
    }
  }
  async function undoResolve(g: ErrorGroup, resolved: boolean) {
    try {
      await api.resolveError(g.fingerprint, resolved)
      overviewStale()
      load(true)
    } catch (e) {
      toast(errMsg(e), 'error')
    }
  }

  async function remove(g: ErrorGroup) {
    const ok = await confirm({
      title: 'Delete this error?',
      body: 'The group and its recorded reports are removed. If it happens again it comes back as new. This can’t be undone.',
      confirmLabel: 'Delete error',
      danger: true,
    })
    if (!ok) return
    try {
      await api.deleteError(g.fingerprint)
      if (openFp === g.fingerprint) closeDrawer()
      overviewStale()
      toast('Error deleted')
      load(true)
    } catch (e) {
      toast(errMsg(e), 'error')
    }
  }

  async function bulk(action: ErrorsBulkAction, list: string[]) {
    if (!list.length || busy) return
    if (action === 'delete') {
      const ok = await confirm({
        title: `Delete ${plural(list.length, 'error')}?`,
        body: 'The groups and their reports are removed. Any that happen again come back as new. This can’t be undone.',
        confirmLabel: `Delete ${plural(list.length, 'error')}`,
        danger: true,
        typeToConfirm: list.length >= 10 ? 'delete' : undefined,
      })
      if (!ok) return
    }
    setBusy(true)
    try {
      const { updated, failed, lastError } = await chunked(list, (chunk) => api.errorsBulk(chunk, action))
      setSelected(new Set(failed))
      overviewStale()
      if (failed.length) toast(`${errMsg(lastError)} ${plural(failed.length, 'error')} stay ticked.`, 'error', { title: `${BULK_WORD[action]} ${updated}; ${failed.length} failed` })
      else toast(`${BULK_WORD[action]} ${plural(updated, 'error')}`)
      load(true)
    } finally {
      setBusy(false)
    }
  }

  const label = (id: string, i: number) => {
    const g = rows.find((x) => x.fingerprint === id)
    return g ? `${i + 1} of ${rows.length}: ${short(g.message, 80)}, ${g.count} reports, ${g.resolvedAt ? 'resolved' : 'open'}` : ''
  }
  useTriageKeys(
    {
      j: () => cursor.move(1, label),
      k: () => cursor.move(-1, label),
      r: () => current && void setResolved(current, !current.resolvedAt),
      x: () =>
        current &&
        setSelected((s) => {
          const n = new Set(s)
          if (n.has(current.fingerprint)) n.delete(current.fingerprint)
          else n.add(current.fingerprint)
          return n
        }),
      Enter: () => current && setOpenFp(current.fingerprint),
    },
    !!data,
  )

  const sortKey = (sort?.id as SortKey | undefined) ?? 'lastSeen'

  return (
    <>
      <PageHeader
        icon="errors"
        title="Errors"
        description="Script errors from visitors’ browsers, grouped by message. No personal data is kept. A resolved error that happens again reopens by itself."
        actions={<Button icon="refresh" onClick={() => load(true)} loading={refreshing} loadingLabel="Refreshing…">Refresh</Button>}
      />
      {error ? <p className="alert" role="alert">{data ? `Couldn’t refresh: ${error}` : error}</p> : null}

      <Tabs<Status>
        label="Filter errors"
        value={status}
        onChange={setStatus}
        tabs={[
          { id: 'open', label: 'Open', count: data?.open ?? undefined },
          { id: 'resolved', label: 'Resolved', count: data?.resolved ?? undefined },
          { id: 'all', label: 'All', count: data ? data.open + data.resolved : undefined },
        ]}
        className="ops-tabs"
      />
      <div className="toolbar ops-toolbar">
        <SearchInput value={q} onChange={setQ} label="Search errors by message, page, release or GPU" placeholder="Search message, page, release" />
        <Select<SortKey>
          size="sm"
          value={SORTS.some((s) => s.value === sortKey) ? sortKey : ''}
          placeholder="Sort"
          onChange={(v) => setSort({ id: v, dir: 'desc' })}
          options={SORTS}
          aria-label="Sort errors"
        />
        <span className="spacer" />
        <KeyLegend keys={[['j k', 'move'], ['r', 'resolve / reopen'], ['x', 'tick'], ['Enter', 'open']]} />
      </div>
      {data && data.groups.length >= SERVER_CAP ? <p className="note small">Showing the {SERVER_CAP} most recent groups.</p> : null}
      <p className="sr-only" aria-live="polite">{cursor.announce}</p>

      <div className="ops-table">
        <DataTable<ErrorGroup>
          rows={data ? rows : null}
          columns={columns}
          getRowId={(g) => g.fingerprint}
          caption="Error groups"
          sort={sort}
          onSortChange={setSort}
          selectable
          selected={selected}
          onSelectedChange={setSelected}
          rowClassName={(g) => (g.fingerprint === cursor.currentId ? 'is-cursor' : undefined)}
          minWidth={1040}
          rowActionsLabel="Error actions"
          rowActions={(g) => (
            <RowActions destructive={<RowAction tone="danger" icon="trash" onClick={() => void remove(g)}>Delete</RowAction>}>
              {g.resolvedAt ? (
                <RowAction icon="undo" onClick={() => void setResolved(g, false)}>Reopen</RowAction>
              ) : (
                <RowAction tone="positive" icon="check" onClick={() => void setResolved(g, true)}>Resolve</RowAction>
              )}
            </RowActions>
          )}
          bulkActions={(sel) => (
            <>
              <Button size="sm" variant="positive" icon="check" disabled={busy} onClick={() => void bulk('resolve', sel)}>Resolve</Button>
              <Button size="sm" icon="undo" disabled={busy} onClick={() => void bulk('reopen', sel)}>Reopen</Button>
              <Button size="sm" variant="danger" icon="trash" disabled={busy} onClick={() => void bulk('delete', sel)}>Delete</Button>
            </>
          )}
          empty={
            <EmptyState icon="errors" as="h3" title={q ? 'No matching errors' : status === 'open' ? 'No open errors' : status === 'resolved' ? 'Nothing resolved yet' : 'No errors recorded'}>
              {q ? `Nothing matches “${q}”.` : undefined}
            </EmptyState>
          }
          footer={filtered.length > PAGE ? <Pagination page={curPage} pageSize={PAGE} total={filtered.length} onPage={setPage} noun="groups" /> : null}
        />
      </div>

      {open ? <ErrorDrawer g={open} onClose={closeDrawer} onResolve={(r) => void setResolved(open, r)} onDelete={() => void remove(open)} /> : null}
    </>
  )
}

export default ErrorsPage

/* ------------------------------------------------------------------ */

function ErrorDrawer({ g, onClose, onResolve, onDelete }: { g: ErrorGroup; onClose: () => void; onResolve: (resolved: boolean) => void; onDelete: () => void }) {
  const [occ, setOcc] = useState<ErrorOccurrence[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    setOcc(null)
    setError('')
    api
      .errorDetail(g.fingerprint)
      .then((d) => alive && setOcc(d.occurrences))
      .catch((e) => alive && setError(errMsg(e)))
    return () => {
      alive = false
    }
  }, [g.fingerprint])
  return (
    <Drawer
      wide
      title={short(g.message, 140)}
      description={`${g.kind} · ${plural(g.count, 'report')}${g.last24h ? `, ${g.last24h} in the last 24 h` : ''}`}
      onClose={onClose}
      footer={
        <ButtonRow destructive={<Button variant="danger" icon="trash" onClick={onDelete}>Delete</Button>}>
          {g.resolvedAt ? (
            <Button icon="undo" onClick={() => onResolve(false)}>Reopen</Button>
          ) : (
            <Button variant="primary" icon="check" onClick={() => onResolve(true)}>Resolve</Button>
          )}
        </ButtonRow>
      }
    >
      <dl className="mx-facts">
        <dt>Status</dt>
        <dd>
          <StatusBadge status={g.resolvedAt ? 'resolved' : 'open'} />
          {g.resolvedAt ? <span className="muted small"> · {formatDate(g.resolvedAt)}</span> : null}
        </dd>
        <dt>Seen</dt>
        <dd>
          {formatDate(g.firstSeen)} – {formatDate(g.lastSeen)}
        </dd>
        {g.lastUrl ? (
          <>
            <dt>Page</dt>
            <dd className="mono mx-url">{g.lastUrl}</dd>
          </>
        ) : null}
        {g.lastRelease ? (
          <>
            <dt>Release</dt>
            <dd className="mono">{g.lastRelease}</dd>
          </>
        ) : null}
        <dt>Device</dt>
        <dd>
          {[g.lastTier && `${g.lastTier} tier`, g.lastGpu].filter(Boolean).join(' · ') || '–'}
          {g.lastUa ? <span className="cell-sub" style={{ display: 'block' }}>{g.lastUa}</span> : null}
        </dd>
        <dt>Fingerprint</dt>
        <dd className="mono small">{g.fingerprint}</dd>
      </dl>
      <h3 className="mx-section-title">Last stack</h3>
      <pre className="ops-stack">{g.lastStack ?? 'No stack was sent.'}</pre>

      <h3 className="mx-section-title">Recent reports</h3>
      {error ? (
        <p className="alert" role="alert">{error}</p>
      ) : occ === null ? (
        <Skeleton kind="list" rows={4} />
      ) : occ.length === 0 ? (
        <p className="muted">No reports kept.</p>
      ) : (
        <>
          <ul className="ops-occ">
            {occ.map((o) => (
              <li key={o.id}>
                <details>
                  <summary>
                    <time dateTime={o.createdAt} title={formatDate(o.createdAt)}>{formatRelative(o.createdAt)}</time>
                    <span className="mono truncate">{o.url ?? '–'}</span>
                    <span className="muted small">{[o.tier, o.release].filter(Boolean).join(' · ')}</span>
                  </summary>
                  <div className="ops-occ-body">
                    {o.gpu ? <p className="small"><strong>GPU</strong> {o.gpu}</p> : null}
                    {o.ua ? <p className="small muted">{o.ua}</p> : null}
                    <pre className="ops-stack">{o.stack ?? 'No stack was sent.'}</pre>
                  </div>
                </details>
              </li>
            ))}
          </ul>
          {occ.length < g.count ? <p className="muted small">The latest {occ.length} of {g.count.toLocaleString()} reports.</p> : null}
        </>
      )}
    </Drawer>
  )
}
