import { Fragment, useCallback, useEffect, useState } from 'react'
import { api, type ErrorGroup, type ErrorOccurrence } from '../api'
import { Skeleton, errMsg, formatDate, useConfirm, useToast } from '../ui'

type Status = 'open' | 'resolved' | 'all'

/** Client error reports (POST /api/errors), grouped by fingerprint. Admin+. */
export function ErrorsPage() {
  const [status, setStatus] = useState<Status>('open')
  const [data, setData] = useState<{ groups: ErrorGroup[]; open: number; resolved: number } | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [detail, setDetail] = useState<ErrorOccurrence[] | null>(null)
  const toast = useToast()
  const confirm = useConfirm()

  const load = useCallback(() => {
    setError('')
    api.errors(status).then(setData).catch((e) => setError(errMsg(e)))
  }, [status])
  useEffect(load, [load])

  async function expand(g: ErrorGroup) {
    if (open === g.fingerprint) return setOpen(null)
    setOpen(g.fingerprint)
    setDetail(null)
    try {
      setDetail((await api.errorDetail(g.fingerprint)).occurrences)
    } catch (e) {
      toast(errMsg(e), 'error')
    }
  }

  async function setResolved(g: ErrorGroup, resolved: boolean) {
    try {
      await api.resolveError(g.fingerprint, resolved)
      toast(resolved ? 'Marked resolved' : 'Reopened')
      load()
    } catch (e) {
      toast(errMsg(e), 'error')
    }
  }

  async function remove(g: ErrorGroup) {
    if (!(await confirm({ title: 'Delete this error group?', body: 'The group and all of its recorded occurrences are removed. If the error happens again it reappears as new.', confirmLabel: 'Delete group', danger: true }))) return
    try {
      await api.deleteError(g.fingerprint)
      toast('Deleted')
      load()
    } catch (e) {
      toast(errMsg(e), 'error')
    }
  }

  const groups = data?.groups ?? []
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Errors</h1>
          <p className="muted">
            Client errors reported by visitors&apos; browsers (script errors, unhandled promise rejections, contained React errors, WebGL context
            loss), grouped by message and origin. No personal data is stored. A resolved error that occurs again is reopened automatically.
          </p>
        </div>
        <button className="btn ghost small" onClick={load}>Refresh</button>
      </div>
      {error && <p className="alert">{error}</p>}
      <div className="row" style={{ marginBottom: 12 }}>
        <nav className="tabs" aria-label="Filter errors">
          {(['open', 'resolved', 'all'] as const).map((s) => (
            <button key={s} className={status === s ? 'tab active' : 'tab'} onClick={() => setStatus(s)}>
              {s === 'open' ? `Open (${data?.open ?? '…'})` : s === 'resolved' ? `Resolved (${data?.resolved ?? '…'})` : 'All'}
            </button>
          ))}
        </nav>
      </div>
      <section className="card" style={{ padding: 0 }}>
        {!data ? (
          <div style={{ padding: 16 }}><Skeleton rows={5} /></div>
        ) : groups.length === 0 ? (
          <div className="empty">No {status === 'all' ? '' : status} errors.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Error</th>
                  <th>Kind</th>
                  <th style={{ textAlign: 'right' }}>Count</th>
                  <th style={{ textAlign: 'right' }}>24 h</th>
                  <th>Last seen</th>
                  <th>First seen</th>
                  <th>Last tier / GPU</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <Fragment key={g.fingerprint}>
                    <tr>
                      <td style={{ maxWidth: 420 }}>
                        <button className="btn ghost small" style={{ textAlign: 'left', whiteSpace: 'normal' }} onClick={() => expand(g)} aria-expanded={open === g.fingerprint}>
                          {open === g.fingerprint ? '▾' : '▸'} {g.message}
                        </button>
                        {g.lastUrl && <div className="small muted mono">{g.lastUrl}</div>}
                      </td>
                      <td><span className="badge">{g.kind}</span></td>
                      <td style={{ textAlign: 'right' }}>{g.count}</td>
                      <td style={{ textAlign: 'right' }}>{g.last24h ?? '–'}</td>
                      <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{formatDate(g.lastSeen)}</td>
                      <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{formatDate(g.firstSeen)}</td>
                      <td className="small">
                        {g.lastTier ?? '–'}
                        {g.lastGpu && <div className="small muted" title={g.lastGpu} style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.lastGpu}</div>}
                      </td>
                      <td>{g.resolvedAt ? <span className="badge ok">resolved</span> : <span className="badge warn">open</span>}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn small" onClick={() => setResolved(g, !g.resolvedAt)}>{g.resolvedAt ? 'Reopen' : 'Resolve'}</button>{' '}
                        <button className="btn small danger" onClick={() => remove(g)}>Delete</button>
                      </td>
                    </tr>
                    {open === g.fingerprint && (
                      <tr>
                        <td colSpan={9} style={{ background: 'var(--paper-2)' }}>
                          <div className="small muted">Fingerprint <span className="mono">{g.fingerprint}</span>{g.lastRelease ? ` · release ${g.lastRelease}` : ''}</div>
                          {g.lastUa && <div className="small muted">{g.lastUa}</div>}
                          <pre className="mono small" style={{ whiteSpace: 'pre-wrap', maxHeight: 260, overflow: 'auto', margin: '8px 0' }}>{g.lastStack ?? '(no stack)'}</pre>
                          <div className="small"><strong>Recent occurrences</strong></div>
                          {!detail ? (
                            <div className="small muted">Loading…</div>
                          ) : (
                            <table>
                              <tbody>
                                {detail.map((o) => (
                                  <tr key={o.id}>
                                    <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{formatDate(o.createdAt)}</td>
                                    <td className="small mono">{o.url ?? ''}</td>
                                    <td className="small">{o.tier ?? ''}</td>
                                    <td className="small muted">{o.gpu ?? ''}</td>
                                    <td className="small muted" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={o.ua ?? ''}>{o.ua ?? ''}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
