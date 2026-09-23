import { useEffect, useState } from 'react'
import { api, type AdminComment } from '../api'
import { EmptyState, Skeleton, errMsg, formatDate, useConfirm, useToast } from '../ui'

type Filter = 'all' | 'visible' | 'hidden'

export function CommentsPage() {
  const [items, setItems] = useState<AdminComment[] | null>(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const toast = useToast()
  const confirm = useConfirm()

  useEffect(() => {
    api.comments().then(setItems).catch((e) => setError(errMsg(e)))
  }, [])

  async function toggle(c: AdminComment) {
    try {
      await api.setHidden(c.id, !c.hidden)
      setItems((list) => (list ?? []).map((x) => (x.id === c.id ? { ...x, hidden: !c.hidden } : x)))
      toast(c.hidden ? 'Comment is visible again' : 'Comment hidden')
    } catch (e) {
      toast(errMsg(e), 'error')
    }
  }

  async function remove(c: AdminComment) {
    if (!(await confirm({ title: 'Delete this comment?', body: `“${c.body.length > 140 ? c.body.slice(0, 137) + '…' : c.body}” by ${c.displayName} is removed permanently. Hiding it instead keeps a record.`, confirmLabel: 'Delete comment', danger: true }))) return
    try {
      await api.deleteComment(c.id)
      setItems((list) => (list ?? []).filter((x) => x.id !== c.id))
      toast('Comment deleted')
    } catch (e) {
      toast(errMsg(e), 'error')
    }
  }

  const all = items ?? []
  const shown = all.filter((c) => {
    if (filter === 'visible' && c.hidden) return false
    if (filter === 'hidden' && !c.hidden) return false
    const s = q.trim().toLowerCase()
    return !s || c.body.toLowerCase().includes(s) || c.displayName.toLowerCase().includes(s) || (c.itemId ?? 'guestbook').toLowerCase().includes(s)
  })
  const hiddenCount = all.filter((c) => c.hidden).length

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Comments</h1>
          <p className="muted">Guestbook entries and item comments. New comments are published immediately; hide anything inappropriate.</p>
        </div>
      </div>
      {error && <p className="alert">{error}</p>}
      <div className="row" style={{ marginBottom: 12 }}>
        <nav className="tabs" aria-label="Filter comments">
          {(['all', 'visible', 'hidden'] as const).map((f) => (
            <button key={f} className={filter === f ? 'tab active' : 'tab'} onClick={() => setFilter(f)}>
              {f === 'all' ? `All (${all.length})` : f === 'visible' ? `Visible (${all.length - hiddenCount})` : `Hidden (${hiddenCount})`}
            </button>
          ))}
        </nav>
        <span className="spacer" />
        <input type="search" placeholder="Search text, author, item…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} aria-label="Search comments" />
      </div>
      <section className="card" style={{ padding: 0 }}>
        {!items ? (
          <div style={{ padding: 16 }}><Skeleton rows={6} /></div>
        ) : shown.length === 0 ? (
          <EmptyState title={q ? 'No matching comments' : filter === 'hidden' ? 'Nothing hidden' : 'No comments yet'}>
            {q ? `Nothing matches “${q}”.` : filter === 'hidden' ? 'Comments you hide from visitors appear here.' : 'Guestbook entries and item comments from visitors appear here as soon as they are posted.'}
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Author</th>
                  <th>On</th>
                  <th>Comment</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.id} className={c.hidden ? 'is-hidden' : ''}>
                    <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{formatDate(c.createdAt)}</td>
                    <td>
                      <div>{c.displayName}</div>
                      {c.userEmail && <div className="small muted">{c.userEmail}</div>}
                    </td>
                    <td className="mono">{c.itemKind ? `${c.itemKind}/${c.itemId}` : 'guestbook'}</td>
                    <td className="comment-body">{c.body}</td>
                    <td>{c.hidden ? <span className="badge hidden">hidden</span> : <span className="badge ok">visible</span>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn small" onClick={() => toggle(c)}>{c.hidden ? 'Unhide' : 'Hide'}</button>{' '}
                      <button className="btn small danger" onClick={() => remove(c)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
