/**
 * Visitor prints moderation (curator+): prints made in the museum's "Print it yourself" studio
 * wait here as `pending`; approved prints hang on the Visitors' Wall in the Craft Workshop Hall
 * (the latest 24). API: GET/PATCH/DELETE /api/admin/prints (docs/API.md → "Visitor prints").
 */
import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../api'
import { errMsg, formatBytes, formatDate, useConfirm, useToast } from '../ui'

type Status = 'pending' | 'approved' | 'rejected'
type Filter = Status | 'all'

export interface AdminPrint {
  id: string
  url: string
  displayName: string
  motif: string
  meta: { blocks?: string[]; dyes?: string[]; ground?: string; stamps?: number }
  width: number
  height: number
  size: number
  status: Status
  createdAt: string
  sessionId: string
  userId: string | null
  reviewedAt: string | null
  reviewedBy: string | null
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = (res.headers.get('content-type') ?? '').includes('json') ? await res.json() : null
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? res.statusText)
  return data as T
}

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'pending', label: 'Awaiting review' },
  { id: 'approved', label: 'On the wall' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'all', label: 'All' },
]

export function PrintsPage() {
  const [filter, setFilter] = useState<Filter>('pending')
  const [items, setItems] = useState<AdminPrint[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const toast = useToast()
  const confirm = useConfirm()

  const load = useCallback(() => {
    setItems(null)
    call<AdminPrint[]>('GET', '/api/admin/prints?status=all')
      .then(setItems)
      .catch((e) => setError(errMsg(e)))
  }, [])
  useEffect(load, [load])

  async function setStatus(p: AdminPrint, status: Status) {
    setBusy(p.id)
    try {
      const next = await call<AdminPrint>('PATCH', `/api/admin/prints/${encodeURIComponent(p.id)}`, { status })
      setItems((list) => (list ?? []).map((x) => (x.id === p.id ? next : x)))
      toast(status === 'approved' ? 'Approved — it will hang on the Visitors’ Wall' : status === 'rejected' ? 'Rejected' : 'Moved back to review')
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  async function remove(p: AdminPrint) {
    if (!(await confirm({ title: 'Delete this print?', body: 'The print and its image are removed permanently. Rejecting it instead hides it from the wall.', confirmLabel: 'Delete print', danger: true }))) return
    setBusy(p.id)
    try {
      await call('DELETE', `/api/admin/prints/${encodeURIComponent(p.id)}`)
      setItems((list) => (list ?? []).filter((x) => x.id !== p.id))
      toast('Print deleted')
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const all = items ?? []
  const count = (f: Filter) => (f === 'all' ? all.length : all.filter((p) => p.status === f).length)
  const shown = filter === 'all' ? all : all.filter((p) => p.status === filter)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Visitor prints</h1>
          <p className="muted">
            Prints made in the “Print it yourself” studio. Approve a print to hang it on the Visitors’ Wall in the Craft Workshop Hall (the 24 most
            recently approved are shown); reject anything inappropriate.
          </p>
        </div>
        <button className="btn" onClick={load}>
          Refresh
        </button>
      </div>
      {error && <p className="alert">{error}</p>}
      <nav className="tabs" aria-label="Filter prints" style={{ marginBottom: 12 }}>
        {FILTERS.map((f) => (
          <button key={f.id} className={filter === f.id ? 'tab active' : 'tab'} onClick={() => setFilter(f.id)}>
            {f.label} ({count(f.id)})
          </button>
        ))}
      </nav>
      {!items ? (
        <section className="card">
          <div className="empty">Loading…</div>
        </section>
      ) : shown.length === 0 ? (
        <section className="card">
          <div className="empty">{filter === 'pending' ? 'Nothing waiting for review.' : 'No prints here yet.'}</div>
        </section>
      ) : (
        <div className="media-grid">
          {shown.map((p) => (
            <div key={p.id} className="media-card">
              <a className="thumb" href={p.url} target="_blank" rel="noreferrer" title="Open full size">
                <img src={p.url} alt={`Visitor print by ${p.displayName || 'an anonymous visitor'}`} loading="lazy" />
              </a>
              <div className="meta">
                <span className="name">{p.displayName || <span className="muted">Anonymous visitor</span>}</span>
                <span className="small muted">
                  {formatDate(p.createdAt)} · {p.width}×{p.height} · {formatBytes(p.size)}
                </span>
                <span className="small muted">
                  {(p.meta.blocks ?? []).join(', ') || '—'} · {p.meta.stamps ?? 0} impressions
                </span>
                <span className="small">
                  {p.status === 'approved' ? (
                    <span className="badge ok">on the wall</span>
                  ) : p.status === 'rejected' ? (
                    <span className="badge hidden">rejected</span>
                  ) : (
                    <span className="badge warn">pending</span>
                  )}
                  {p.userId && <span className="muted"> · signed-in visitor</span>}
                  {p.reviewedBy && <span className="muted"> · {p.reviewedBy}</span>}
                </span>
              </div>
              <div className="actions">
                {p.status !== 'approved' && (
                  <button className="btn small primary" disabled={busy === p.id} onClick={() => setStatus(p, 'approved')}>
                    Approve
                  </button>
                )}
                {p.status !== 'rejected' && (
                  <button className="btn small" disabled={busy === p.id} onClick={() => setStatus(p, 'rejected')}>
                    Reject
                  </button>
                )}
                {p.status !== 'pending' && (
                  <button className="btn small ghost" disabled={busy === p.id} onClick={() => setStatus(p, 'pending')}>
                    Re-review
                  </button>
                )}
                <span className="spacer" />
                <button className="btn small danger" disabled={busy === p.id} onClick={() => remove(p)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
