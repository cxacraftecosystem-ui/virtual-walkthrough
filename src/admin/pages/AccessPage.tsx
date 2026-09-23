import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { api, ROLE_LABEL, type AccessEntry, type AccessRole, type AdminUser, type ManualRole, type User } from '../api'
import { Skeleton, errMsg, formatDate, useToast } from '../ui'

/**
 * Users (admin) + Access list (master admin).
 * Effective role = master (MASTER_ADMIN_EMAILS) or max(access-list role, manual role). Access-list
 * roles apply to verified addresses only (Google sign-in or the env-seeded admin).
 */
export function AccessPage({ me, canManageAccess }: { me: User; canManageAccess: boolean }) {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{canManageAccess ? 'Access' : 'Users'}</h1>
          <p className="muted">
            Curators edit content and media · Admins also moderate comments, see analytics and manage users
            {canManageAccess ? ' · You (master admin) also maintain the access list' : ''}.
          </p>
        </div>
      </div>
      {canManageAccess && <AccessList />}
      <UsersTable me={me} />
    </>
  )
}

/* ------------------------------------------------------------------ */

function AccessList() {
  const [data, setData] = useState<{ masters: string[]; entries: AccessEntry[] } | null>(null)
  const [error, setError] = useState('')
  const [pattern, setPattern] = useState('')
  const [role, setRole] = useState<AccessRole>('curator')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)
  const toast = useToast()

  const load = useCallback(() => {
    api.access().then(setData).catch((e) => setError(errMsg(e)))
  }, [])
  useEffect(load, [load])

  async function add(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const entry = await api.putAccess(pattern, role, note)
      toast(`${entry.pattern} → ${ROLE_LABEL[entry.role]}`)
      setPattern('')
      setNote('')
      load()
    } catch (err) {
      toast(errMsg(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function change(entry: AccessEntry, next: AccessRole) {
    try {
      await api.patchAccess(entry.pattern, { role: next })
      toast(`${entry.pattern} is now ${ROLE_LABEL[next]}`)
      load()
    } catch (e) {
      toast(errMsg(e), 'error')
    }
  }

  async function remove(entry: AccessEntry) {
    setConfirming(null)
    try {
      await api.deleteAccess(entry.pattern)
      toast(`Removed ${entry.pattern}`)
      load()
    } catch (e) {
      toast(errMsg(e), 'error')
    }
  }

  const isDomain = pattern.trim().startsWith('@')

  return (
    <section className="card">
      <h2>Access list</h2>
      <p className="muted small" style={{ marginTop: -6 }}>
        People signing in with a listed email — or any address at a listed <span className="mono">@domain</span> — get that role.
        Everyone else is a visitor. Roles apply once the address is verified (Google sign-in).
      </p>
      {error && <p className="alert">{error}</p>}
      <form className="access-add" onSubmit={add}>
        <label className="field">
          <span>Email or @domain</span>
          <input type="text" required placeholder="curator@example.org or @iitkgp.ac.in" value={pattern} onChange={(e) => setPattern(e.target.value)} aria-describedby="access-hint" />
        </label>
        <label className="field">
          <span>Role</span>
          <select value={role} onChange={(e) => setRole(e.target.value as AccessRole)}>
            <option value="curator">Curator</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <label className="field">
          <span>Note (optional)</span>
          <input type="text" maxLength={200} placeholder="e.g. Textile dept." value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button className="btn primary" disabled={busy || !pattern.trim()}>{busy ? 'Saving…' : 'Add / update'}</button>
      </form>
      <p id="access-hint" className="small muted" style={{ margin: '6px 0 14px' }}>
        {isDomain ? 'Domain entry: applies to every address ending in this domain (exact domain, not sub-domains).' : 'Tip: start with @ to grant a whole domain.'}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Email / domain</th>
              <th>Role</th>
              <th>Note</th>
              <th className="num">Accounts</th>
              <th>Added</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.masters.map((m) => (
              <tr key={m}>
                <td>
                  <span className="mono">{m}</span> <span className="badge ok">master</span>
                </td>
                <td>{ROLE_LABEL.master}</td>
                <td className="muted small">Configured by MASTER_ADMIN_EMAILS — cannot be changed here</td>
                <td className="num">—</td>
                <td />
                <td />
              </tr>
            ))}
            {!data ? (
              <tr>
                <td colSpan={6} style={{ padding: 16 }}><Skeleton rows={4} /></td>
              </tr>
            ) : data.entries.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty">No entries yet — everyone except the master admins is a visitor.</td>
              </tr>
            ) : (
              data.entries.map((e) => (
                <tr key={e.pattern}>
                  <td>
                    <span className="mono">{e.pattern}</span> {e.kind === 'domain' && <span className="badge">domain</span>}
                  </td>
                  <td>
                    <select value={e.role} onChange={(ev) => void change(e, ev.target.value as AccessRole)} aria-label={`Role for ${e.pattern}`} style={{ width: 120 }}>
                      <option value="curator">Curator</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td className="small">{e.note || <span className="muted">—</span>}</td>
                  <td className="num">{e.users}</td>
                  <td className="small muted" style={{ whiteSpace: 'nowrap' }}>
                    {formatDate(e.createdAt)}
                    {e.createdBy ? <div>{e.createdBy}</div> : null}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {confirming === e.pattern ? (
                      <>
                        <button className="btn small danger" onClick={() => void remove(e)}>Remove</button>{' '}
                        <button className="btn small ghost" onClick={() => setConfirming(null)}>Cancel</button>
                      </>
                    ) : (
                      <button className="btn small" onClick={() => setConfirming(e.pattern)}>Remove…</button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */

function UsersTable({ me }: { me: User }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [staffOnly, setStaffOnly] = useState(false)
  const toast = useToast()

  useEffect(() => {
    api.users().then(setUsers).catch((e) => setError(errMsg(e)))
  }, [])

  async function setRole(u: AdminUser, role: ManualRole) {
    try {
      const updated = await api.setUserRole(u.id, role)
      setUsers((list) => (list ?? []).map((x) => (x.id === u.id ? updated : x)))
      toast(updated.role === role || role === 'visitor' ? `${u.email}: ${ROLE_LABEL[updated.role]}` : `${u.email} stays ${ROLE_LABEL[updated.role]} (access list)`)
    } catch (e) {
      toast(errMsg(e), 'error')
    }
  }

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (users ?? []).filter(
      (u) => (!staffOnly || u.role !== 'visitor') && (!s || u.email.includes(s) || u.displayName.toLowerCase().includes(s)),
    )
  }, [users, q, staffOnly])
  const staff = (users ?? []).filter((u) => u.role !== 'visitor').length

  return (
    <section className="card">
      <div className="row" style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Users</h2>
        <span className="muted small">
          {users ? `${users.length} accounts · ${staff} staff` : ''}
        </span>
        <span className="spacer" />
        <label className="check">
          <input type="checkbox" checked={staffOnly} onChange={(e) => setStaffOnly(e.target.checked)} /> Staff only
        </label>
        <input type="search" placeholder="Search name or email…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 240 }} aria-label="Search users" />
      </div>
      {error && <p className="alert">{error}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Granted by</th>
              <th>Sign-in</th>
              <th>Last sign-in</th>
              <th>Joined</th>
              <th>Set role</th>
            </tr>
          </thead>
          <tbody>
            {!users ? (
              <tr>
                <td colSpan={7} style={{ padding: 16 }}><Skeleton rows={4} /></td>
              </tr>
            ) : shown.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty">No users match.</td>
              </tr>
            ) : (
              shown.map((u) => {
                const locked = u.isMaster || u.id === me.id
                return (
                  <tr key={u.id}>
                    <td>
                      <div>{u.displayName}{u.id === me.id && <span className="muted small"> (you)</span>}</div>
                      <div className="small muted">{u.email}</div>
                    </td>
                    <td>
                      <span className={`badge role-${u.role}`}>{ROLE_LABEL[u.role]}</span>
                    </td>
                    <td className="small">
                      {u.isMaster
                        ? 'MASTER_ADMIN_EMAILS'
                        : [u.accessRole && `access list (${u.accessRole})${u.emailVerified ? '' : ' — pending verification'}`, u.manualRole && `manual (${u.manualRole})`]
                            .filter(Boolean)
                            .join(' + ') || <span className="muted">—</span>}
                    </td>
                    <td className="small">
                      {[u.google && 'Google', u.hasPassword && 'password'].filter(Boolean).join(' + ') || '—'}
                      {u.emailVerified && <div className="muted">verified</div>}
                    </td>
                    <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{u.lastLoginAt ? formatDate(u.lastLoginAt) : 'never'}</td>
                    <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{formatDate(u.createdAt)}</td>
                    <td>
                      <select
                        value={u.manualRole ?? 'visitor'}
                        disabled={locked}
                        title={locked ? (u.isMaster ? 'Master admins are set by MASTER_ADMIN_EMAILS' : 'You cannot change your own role') : 'Manual role (the effective role is the higher of this and the access list)'}
                        onChange={(e) => void setRole(u, e.target.value as ManualRole)}
                        aria-label={`Manual role for ${u.email}`}
                        style={{ width: 120 }}
                      >
                        <option value="visitor">Visitor</option>
                        <option value="curator">Curator</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
