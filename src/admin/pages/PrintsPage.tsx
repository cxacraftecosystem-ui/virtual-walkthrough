/**
 * Visitor prints (#/prints, curator+): prints made in the museum's print studio wait here as pending;
 * approved prints hang on the Visitors' Wall (the 24 most recently approved).
 *
 * - Filter tabs with counts, search by visitor name or motif, a grid with ticks for bulk approve /
 *   reject / back to review / delete (api.printsBulk, 200 at a time; failed prints stay ticked).
 * - Keyboard triage: j/k move, a approve, r reject, x tick, Enter opens the lightbox (←/→ step through,
 *   a/r decide there too). Approving or rejecting in the review queue moves on to the next print.
 * - A single approve or reject offers Undo. The list reloads quietly when the tab regains focus.
 * - `#/prints/<id>` opens that print (links from the activity log).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type AdminPrint, type PrintStatus, type PrintsBulkAction } from '../api'
import { safeUrl } from '../safeUrl'
import {
  Button,
  ButtonRow,
  Checkbox,
  EmptyState,
  Kbd,
  Modal,
  PageHeader,
  RowAction,
  SearchInput,
  Skeleton,
  StatusBadge,
  Tabs,
  errMsg,
  formatBytes,
  formatDate,
  formatRelative,
  useConfirm,
  useToast,
} from '../ui'
import { KeyLegend, chunked, hashTail, overviewStale, plural, useCursor, useRefreshOnFocus, useTriageKeys } from './triage'
import './operations.css'

export type { AdminPrint } from '../api'

type Filter = PrintStatus | 'all'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'pending', label: 'Awaiting review' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'all', label: 'All' },
]
const SERVER_CAP = 1000
const DONE_WORD: Record<PrintStatus, string> = { approved: 'Approved', rejected: 'Rejected', pending: 'Moved back to review' }
const BULK_WORD: Record<PrintsBulkAction, string> = { approve: 'Approved', reject: 'Rejected', pending: 'Moved back to review', delete: 'Deleted' }
const BULK_STATUS: Partial<Record<PrintsBulkAction, PrintStatus>> = { approve: 'approved', reject: 'rejected', pending: 'pending' }

const who = (p: AdminPrint) => p.displayName || 'Anonymous visitor'

export function PrintsPage() {
  const [filter, setFilter] = useState<Filter>('pending')
  const [items, setItems] = useState<AdminPrint[] | null>(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<Set<string>>(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [lightbox, setLightbox] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const toast = useToast()
  const confirm = useConfirm()
  const gen = useRef(0)
  const deepLink = useRef(hashTail('prints'))

  const load = useCallback(
    (quiet = false) => {
      const g = ++gen.current
      if (quiet) setRefreshing(true)
      api
        .prints('all')
        .then((list) => {
          if (g !== gen.current) return
          setItems(list)
          setError('')
        })
        .catch((e) => g === gen.current && setError(errMsg(e))) // a failed reload keeps what is shown
        .finally(() => g === gen.current && setRefreshing(false))
    },
    [],
  )
  useEffect(() => load(), [load])
  useRefreshOnFocus(() => load(true))

  const all = useMemo(() => items ?? [], [items])
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { pending: 0, approved: 0, rejected: 0, all: all.length }
    for (const p of all) c[p.status]++
    return c
  }, [all])
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return all.filter(
      (p) =>
        (filter === 'all' || p.status === filter) &&
        (!s || who(p).toLowerCase().includes(s) || p.motif.toLowerCase().includes(s) || (p.meta.blocks ?? []).some((b) => b.toLowerCase().includes(s))),
    )
  }, [all, filter, q])
  const ids = useMemo(() => shown.map((p) => p.id), [shown])
  const cursor = useCursor(ids)
  const current = shown[cursor.index] ?? null

  // forget ticks on prints that left the list
  useEffect(() => {
    if (!items) return
    const have = new Set(items.map((p) => p.id))
    setSelected((s) => {
      const keep = new Set([...s].filter((id) => have.has(id)))
      return keep.size === s.size ? s : keep
    })
  }, [items])

  // a deep link opens that print once the list is in
  const { setCurrent } = cursor
  useEffect(() => {
    const id = deepLink.current
    if (!id || !items) return
    const p = items.find((x) => x.id === id)
    if (!p) {
      deepLink.current = ''
      return
    }
    if (filter !== 'all' && p.status !== filter) return setFilter(p.status) // runs again with the right tab
    if (!ids.includes(id)) return setQ('')
    deepLink.current = ''
    setCurrent(id)
    setLightbox(true)
  }, [items, filter, ids, setCurrent])

  // nothing left to show (the last print was decided): close the lightbox
  useEffect(() => {
    if (lightbox && !current) setLightbox(false)
  }, [lightbox, current])

  const markBusy = (id: string, on: boolean) =>
    setBusy((b) => {
      const n = new Set(b)
      if (on) n.add(id)
      else n.delete(id)
      return n
    })

  async function setStatus(p: AdminPrint, status: PrintStatus, undoable = true) {
    if (busy.has(p.id) || p.status === status) return
    const before = p.status
    markBusy(p.id, true)
    try {
      const next = await api.patchPrint(p.id, status)
      setItems((list) => (list ?? []).map((x) => (x.id === p.id ? next : x)))
      overviewStale()
      toast(
        `${who(p)}${status === 'approved' ? ' — on the Visitors’ Wall' : ''}`,
        'ok',
        undoable ? { title: DONE_WORD[status], action: { label: 'Undo', onClick: () => void setStatus(next, before, false) } } : { title: DONE_WORD[status] },
      )
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      markBusy(p.id, false)
    }
  }

  async function remove(p: AdminPrint) {
    if (!(await confirm({ title: 'Delete this print?', body: 'The print and its image are removed. Rejecting it instead keeps it off the wall. This can’t be undone.', confirmLabel: 'Delete print', danger: true }))) return
    markBusy(p.id, true)
    try {
      await api.deletePrint(p.id)
      setItems((list) => (list ?? []).filter((x) => x.id !== p.id))
      overviewStale()
      toast('Print deleted')
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      markBusy(p.id, false)
    }
  }

  async function bulk(action: PrintsBulkAction) {
    const list = [...selected]
    if (!list.length || bulkBusy) return
    if (action === 'delete') {
      const ok = await confirm({
        title: `Delete ${plural(list.length, 'print')}?`,
        body: 'The prints and their images are removed. Rejecting them instead keeps them off the wall. This can’t be undone.',
        confirmLabel: `Delete ${plural(list.length, 'print')}`,
        danger: true,
        typeToConfirm: list.length >= 10 ? 'delete' : undefined,
      })
      if (!ok) return
    }
    setBulkBusy(true)
    try {
      const { updated, failed, lastError } = await chunked(list, (chunk) => api.printsBulk(chunk, action))
      const failedSet = new Set(failed)
      const okIds = new Set(list.filter((id) => !failedSet.has(id)))
      const status = BULK_STATUS[action]
      setItems((cur) => (cur ?? []).flatMap((p) => (!okIds.has(p.id) ? [p] : action === 'delete' ? [] : [{ ...p, status: status ?? p.status }])))
      setSelected(new Set(failed))
      overviewStale()
      if (failed.length) toast(`${errMsg(lastError)} ${plural(failed.length, 'print')} stay ticked.`, 'error', { title: `${BULK_WORD[action]} ${updated}; ${failed.length} failed` })
      else toast(`${BULK_WORD[action]} ${plural(updated, 'print')}`)
      load(true) // reviewer names and times
    } finally {
      setBulkBusy(false)
    }
  }

  const toggle = (id: string, on?: boolean) =>
    setSelected((s) => {
      const n = new Set(s)
      if (on ?? !n.has(id)) n.add(id)
      else n.delete(id)
      return n
    })

  const label = (id: string, i: number) => {
    const p = shown.find((x) => x.id === id)
    return p ? `${i + 1} of ${shown.length}: ${who(p)}, ${p.status}` : ''
  }
  useTriageKeys(
    {
      j: () => cursor.move(1, label),
      k: () => cursor.move(-1, label),
      a: () => current && void setStatus(current, 'approved'),
      r: () => current && void setStatus(current, 'rejected'),
      x: () => current && toggle(current.id),
      Enter: () => current && setLightbox(true),
    },
    !!items,
  )

  const allTicked = ids.length > 0 && ids.every((id) => selected.has(id))

  return (
    <>
      <PageHeader
        icon="prints"
        title="Visitor prints"
        description="Prints made in the museum’s print studio. Approved prints hang on the Visitors’ Wall — the 24 most recent."
        actions={
          <Button icon="refresh" onClick={() => load(true)} loading={refreshing} loadingLabel="Refreshing…">
            Refresh
          </Button>
        }
      />
      {error ? <p className="alert" role="alert">{items ? `Couldn’t refresh: ${error}` : error}</p> : null}

      <Tabs<Filter>
        label="Filter prints"
        value={filter}
        onChange={(f) => {
          setFilter(f)
          cursor.setCurrent(null)
        }}
        tabs={FILTERS.map((f) => ({ id: f.id, label: f.label, count: items ? counts[f.id] : undefined, countLabel: f.id === 'pending' ? 'waiting for a decision' : undefined }))}
        className="ops-tabs"
      />
      <div className="toolbar ops-toolbar">
        <SearchInput value={q} onChange={setQ} label="Search prints by visitor name or motif" placeholder="Search name or motif" />
        {shown.length ? (
          <Checkbox
            checked={allTicked}
            indeterminate={selected.size > 0 && !allTicked}
            onChange={(c) => setSelected(c ? new Set(ids) : new Set())}
            label={allTicked ? 'Clear selection' : `Select all ${shown.length}`}
          />
        ) : null}
        <span className="spacer" />
        <KeyLegend keys={[['j k', 'move'], ['a', 'approve'], ['r', 'reject'], ['x', 'tick'], ['Enter', 'open']]} />
      </div>
      {items && items.length >= SERVER_CAP ? <p className="note small">Showing the latest {SERVER_CAP.toLocaleString()} prints.</p> : null}
      <p className="sr-only" aria-live="polite">{cursor.announce}</p>

      {!items ? (
        <Skeleton kind="cards" rows={8} />
      ) : shown.length === 0 ? (
        <div className="card">
          <EmptyState icon="prints" title={q ? 'No matching prints' : filter === 'pending' ? 'Nothing waiting for review' : 'No prints here yet'}>
            {q ? `Nothing matches “${q}”.` : filter === 'pending' ? 'New prints from the studio appear here.' : undefined}
          </EmptyState>
        </div>
      ) : (
        <div className="media-grid ops-print-grid">
          {shown.map((p, i) => {
            const src = safeUrl(p.url, 'image')
            const isBusy = busy.has(p.id) || bulkBusy
            const isCur = i === cursor.index
            return (
              <article
                key={p.id}
                className={`media-card ops-print${selected.has(p.id) ? ' is-ticked' : ''}`}
                data-cursor={isCur || undefined}
                onClick={(e) => {
                  if (!(e.target as HTMLElement).closest('button, a, input, label')) cursor.setCurrent(p.id)
                }}
              >
                <button
                  type="button"
                  className="thumb ops-thumb-btn"
                  onClick={() => {
                    cursor.setCurrent(p.id)
                    setLightbox(true)
                  }}
                  aria-label={`Open the print by ${who(p)}`}
                >
                  {src ? <img src={src} alt="" loading="lazy" decoding="async" /> : null}
                </button>
                <span className="mx-tick">
                  <Checkbox checked={selected.has(p.id)} onChange={(c) => toggle(p.id, c)} label={`Select the print by ${who(p)}`} labelHidden />
                </span>
                <div className="meta">
                  <span className="name">{who(p)}</span>
                  <span className="small muted">
                    <time dateTime={p.createdAt} title={formatDate(p.createdAt)}>{formatRelative(p.createdAt)}</time> · {(p.meta.blocks ?? []).length ? (p.meta.blocks ?? []).join(', ') : p.motif || '–'}
                  </span>
                  <span className="ops-print-status">
                    <StatusBadge status={p.status} />
                    {p.reviewedBy ? <span className="small muted truncate" title={`Reviewed by ${p.reviewedBy}`}>{p.reviewedBy}</span> : null}
                  </span>
                </div>
                <div className="actions">
                  {p.status !== 'approved' ? (
                    <RowAction tone="positive" icon="check" disabled={isBusy} onClick={() => void setStatus(p, 'approved')}>Approve</RowAction>
                  ) : null}
                  {p.status !== 'rejected' ? (
                    <RowAction icon="close" disabled={isBusy} onClick={() => void setStatus(p, 'rejected')}>Reject</RowAction>
                  ) : null}
                  {p.status !== 'pending' ? (
                    <RowAction icon="undo" disabled={isBusy} onClick={() => void setStatus(p, 'pending')}>Review again</RowAction>
                  ) : null}
                  <span className="spacer" />
                  <RowAction tone="danger" icon="trash" disabled={isBusy} onClick={() => void remove(p)} aria-label={`Delete the print by ${who(p)}`} title="Delete" />
                </div>
              </article>
            )
          })}
        </div>
      )}

      {selected.size > 0 ? (
        <div className="ui-bulkbar" role="region" aria-label="Bulk actions">
          <span className="count" aria-live="polite">{selected.size} selected</span>
          <Button size="sm" variant="positive" icon="check" disabled={bulkBusy} onClick={() => void bulk('approve')}>Approve</Button>
          <Button size="sm" icon="close" disabled={bulkBusy} onClick={() => void bulk('reject')}>Reject</Button>
          <Button size="sm" icon="undo" disabled={bulkBusy} onClick={() => void bulk('pending')}>Review again</Button>
          <Button size="sm" variant="danger" icon="trash" disabled={bulkBusy} onClick={() => void bulk('delete')}>Delete</Button>
          <button type="button" className="btn ghost small pill" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      ) : null}

      {lightbox && current ? (
        <Lightbox
          p={current}
          index={cursor.index}
          total={shown.length}
          busy={busy.has(current.id) || bulkBusy}
          onPrev={() => cursor.move(-1)}
          onNext={() => cursor.move(1)}
          onStatus={(s) => void setStatus(current, s)}
          onDelete={() => void remove(current)}
          onClose={() => setLightbox(false)}
        />
      ) : null}
    </>
  )
}

export default PrintsPage

function Lightbox({
  p,
  index,
  total,
  busy,
  onPrev,
  onNext,
  onStatus,
  onDelete,
  onClose,
}: {
  p: AdminPrint
  index: number
  total: number
  busy: boolean
  onPrev: () => void
  onNext: () => void
  onStatus: (s: PrintStatus) => void
  onDelete: () => void
  onClose: () => void
}) {
  const live = useRef({ onPrev, onNext, onStatus, busy, p })
  useEffect(() => {
    live.current = { onPrev, onNext, onStatus, busy, p }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return
      if (document.querySelectorAll('dialog[open]').length > 1) return // a confirm on top
      const l = live.current
      if (e.key === 'ArrowLeft' || e.key === 'k') l.onPrev()
      else if (e.key === 'ArrowRight' || e.key === 'j') l.onNext()
      else if (e.key === 'a' && !l.busy && l.p.status !== 'approved') l.onStatus('approved')
      else if (e.key === 'r' && !l.busy && l.p.status !== 'rejected') l.onStatus('rejected')
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const src = safeUrl(p.url, 'image')
  const href = safeUrl(p.url, 'link')
  const m = p.meta
  return (
    <Modal
      title={who(p)}
      description={`${formatDate(p.createdAt)} · ${index + 1} of ${total}`}
      size="large"
      onClose={onClose}
      footer={
        <ButtonRow destructive={<Button variant="danger" icon="trash" onClick={onDelete} disabled={busy}>Delete</Button>}>
          <Button icon="chevronLeft" onClick={onPrev} disabled={index <= 0} aria-keyshortcuts="ArrowLeft">Previous</Button>
          <Button iconEnd="chevronRight" onClick={onNext} disabled={index >= total - 1} aria-keyshortcuts="ArrowRight" data-autofocus>Next</Button>
          {p.status !== 'rejected' ? <Button icon="close" onClick={() => onStatus('rejected')} disabled={busy} aria-keyshortcuts="r">Reject</Button> : null}
          {p.status !== 'approved' ? (
            <Button variant="primary" icon="check" onClick={() => onStatus('approved')} disabled={busy} aria-keyshortcuts="a">
              Approve
            </Button>
          ) : (
            <Button icon="undo" onClick={() => onStatus('pending')} disabled={busy}>Review again</Button>
          )}
        </ButtonRow>
      }
    >
      <div className="ops-lightbox">
        <div className="ops-lightbox-stage">{src ? <img src={src} alt={`Print by ${who(p)}`} /> : <span className="muted">The image isn’t available.</span>}</div>
        <dl className="mx-facts">
          <dt>Status</dt>
          <dd><StatusBadge status={p.status} />{p.reviewedBy ? <span className="muted small"> · {p.reviewedBy}{p.reviewedAt ? `, ${formatRelative(p.reviewedAt)}` : ''}</span> : null}</dd>
          <dt>Motifs</dt>
          <dd>{(m.blocks ?? []).join(', ') || p.motif || '–'}</dd>
          {m.dyes?.length ? (
            <>
              <dt>Colours</dt>
              <dd>{m.dyes.join(', ')}</dd>
            </>
          ) : null}
          {m.ground ? (
            <>
              <dt>Ground</dt>
              <dd>{m.ground}</dd>
            </>
          ) : null}
          <dt>Impressions</dt>
          <dd className="num">{m.stamps ?? 0}</dd>
          <dt>Image</dt>
          <dd>
            {p.width} × {p.height} px · {formatBytes(p.size)}
            {href ? (
              <>
                {' · '}
                <a href={href} target="_blank" rel="noreferrer">Full size<span className="sr-only"> (opens in a new tab)</span></a>
              </>
            ) : null}
          </dd>
          <dt>Visitor</dt>
          <dd>{p.userId ? 'Signed in' : 'Not signed in'}</dd>
        </dl>
        <p className="ops-keys hide-phone" aria-hidden="true">
          <span><Kbd>←</Kbd> <Kbd>→</Kbd> step</span>
          <span><Kbd>a</Kbd> approve</span>
          <span><Kbd>r</Kbd> reject</span>
        </p>
      </div>
    </Modal>
  )
}
