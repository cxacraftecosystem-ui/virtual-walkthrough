/**
 * Users (#/access, admin+) and the access list (master admins only).
 *
 * A person's role is the higher of two grants: their manual role (set here, per account) and the
 * access list (an email or a whole @domain, applied once the address is verified through Google).
 * Master admins come from the site's configuration and can't be changed here.
 *
 * - Users: search, All / Staff / Visitors, sort by name, role, last active or joined, 50 a page. A role
 *   change asks first and says when the access list keeps the person higher. Bulk role change
 *   (sequential; failed rows stay ticked; master admins and your own account are skipped).
 * - Access list: add or update an entry, change its role (asks), remove it (asks).
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { api, ROLE_LABEL, type AccessEntry, type AccessRole, type AdminUser, type ManualRole, type Role, type User } from '../api'
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Pagination,
  RowAction,
  RowActions,
  SearchInput,
  Select,
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
import { hashTail, plural, sortRows } from './triage'
import './operations.css'

const RANK: Record<Role, number> = { visitor: 0, curator: 1, admin: 2, master: 3 }
const PAGE = 50
const SERVER_CAP = 1000
const MANUAL_OPTIONS: { value: ManualRole; label: string }[] = [
  { value: 'visitor', label: 'Visitor' },
  { value: 'curator', label: 'Curator' },
  { value: 'admin', label: 'Admin' },
]
const ACCESS_OPTIONS: { value: AccessRole; label: string }[] = [
  { value: 'curator', label: 'Curator' },
  { value: 'admin', label: 'Admin' },
]
const ROLE_WHAT: Record<Role, string> = {
  visitor: 'no staff access',
  curator: 'edits content, makers and media, and reviews prints',
  admin: 'also moderates comments, sees analytics and errors, and manages users',
  master: 'everything, including the access list',
}

export function AccessPage({ me, canManageAccess }: { me: User; canManageAccess: boolean }) {
  return (
    <>
      <PageHeader
        icon="users"
        title={canManageAccess ? 'Users & access' : 'Users'}
        description="A curator edits content, makers and media. An admin also moderates comments, sees analytics and manages users."
      />
      {canManageAccess ? <AccessList /> : null}
      <UsersTable me={me} />
    </>
  )
}

export default AccessPage

/* ------------------------------------------------------------------ */
/* Access list (master)                                                 */
/* ------------------------------------------------------------------ */

function AccessList() {
  const [data, setData] = useState<{ masters: string[]; entries: AccessEntry[] } | null>(null)
  const [error, setError] = useState('')
  const [pattern, setPattern] = useState('')
  const [role, setRole] = useState<AccessRole>('curator')
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const confirm = useConfirm()

  const load = useCallback(() => {
    api
      .access()
      .then((d) => {
        setData(d)
        setError('')
      })
      .catch((e) => setError(errMsg(e)))
  }, [])
  useEffect(load, [load])

  const p = pattern.trim().toLowerCase()
  const isDomain = p.startsWith('@')
  const existing = data?.entries.find((e) => e.pattern === p)

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!p) return setFormError('Enter an email address or an @domain.')
    if (!isDomain && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p)) return setFormError('That doesn’t look like an email address. Start with @ for a whole domain.')
    if (isDomain && !/^@[a-z0-9.-]+\.[a-z]{2,}$/.test(p)) return setFormError('That doesn’t look like a domain, e.g. @museum.org.')
    if (existing && existing.role !== role) {
      const ok = await confirm({
        title: `Change ${p} to ${ROLE_LABEL[role]}?`,
        body: `It’s on the list as ${ROLE_LABEL[existing.role]}${existing.users ? `; ${plural(existing.users, 'account')} would change` : ''}.`,
        confirmLabel: `Make ${ROLE_LABEL[role]}`,
        tone: 'warning',
      })
      if (!ok) return
    }
    setFormError('')
    setBusy(true)
    try {
      const entry = await api.putAccess(p, role, note.trim())
      toast(`${entry.pattern} · ${ROLE_LABEL[entry.role]}`, 'ok', { title: existing ? 'Access updated' : 'Added to the access list' })
      setPattern('')
      setNote('')
      load()
    } catch (err) {
      setFormError(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  async function change(entry: AccessEntry, next: AccessRole) {
    if (next === entry.role) return
    const ok = await confirm({
      title: `Make ${entry.pattern} ${next === 'admin' ? 'an Admin' : 'a Curator'}?`,
      body: (
        <>
          <p>
            {next === 'admin' ? 'An admin' : 'A curator'} {ROLE_WHAT[next]}.
          </p>
          {entry.users ? <p>{plural(entry.users, 'signed-in account')} {entry.users === 1 ? 'matches' : 'match'} this entry.</p> : null}
        </>
      ),
      confirmLabel: `Make ${ROLE_LABEL[next]}`,
      tone: next === 'admin' ? 'warning' : 'neutral',
    })
    if (!ok) return
    try {
      await api.patchAccess(entry.pattern, { role: next })
      toast(`${entry.pattern} is now ${ROLE_LABEL[next]}`)
      load()
    } catch (e) {
      toast(errMsg(e), 'error')
    }
  }

  async function remove(entry: AccessEntry) {
    const ok = await confirm({
      title: `Remove ${entry.pattern}?`,
      body: (
        <>
          <p>
            {entry.users
              ? `${plural(entry.users, 'account')} ${entry.users === 1 ? 'loses' : 'lose'} the ${ROLE_LABEL[entry.role]} role from this entry. A manual role set below still applies.`
              : `No account uses this entry yet.`}
          </p>
        </>
      ),
      confirmLabel: 'Remove',
      danger: true,
    })
    if (!ok) return
    try {
      await api.deleteAccess(entry.pattern)
      toast(`Removed ${entry.pattern}`)
      load()
    } catch (e) {
      toast(errMsg(e), 'error')
    }
  }

  const columns: Column<AccessEntry>[] = [
    {
      id: 'pattern',
      header: 'Email or domain',
      sortValue: (e) => e.pattern,
      cell: (e) => (
        <span className="ops-pattern">
          <span className="mono">{e.pattern}</span>
          {e.kind === 'domain' ? <Badge tone="info">Domain</Badge> : null}
        </span>
      ),
    },
    {
      id: 'role',
      header: 'Role',
      sortValue: (e) => RANK[e.role],
      cell: (e) => <Select<AccessRole> size="sm" value={e.role} onChange={(v) => void change(e, v)} options={ACCESS_OPTIONS} aria-label={`Role for ${e.pattern}`} />,
    },
    { id: 'note', header: 'Note', hidePhone: true, cell: (e) => e.note || '–' },
    { id: 'users', header: 'Accounts', align: 'right', sortValue: (e) => e.users, cell: (e) => e.users.toLocaleString() },
    {
      id: 'added',
      header: 'Added',
      hidePhone: true,
      sortValue: (e) => e.createdAt,
      cell: (e) => (
        <>
          <time dateTime={e.createdAt} title={formatDate(e.createdAt)}>{formatRelative(e.createdAt)}</time>
          {e.createdBy ? <span className="cell-sub" style={{ display: 'block' }}>{e.createdBy}</span> : null}
        </>
      ),
    },
  ]

  return (
    <section className="card ops-section" aria-labelledby="access-h">
      <div className="card-head">
        <h2 id="access-h">Access list</h2>
      </div>
      <p className="muted" style={{ margin: '0 0 16px' }}>
        Anyone who signs in with a listed email — or any address at a listed <span className="mono">@domain</span> — gets that role once Google has verified the address.
        Everyone else is a visitor unless given a role under Users.
      </p>
      {error ? <p className="alert" role="alert">{error}</p> : null}

      <form className="ops-access-form" onSubmit={add} noValidate>
        <Field label="Email or @domain" required hint={isDomain ? 'Every address at exactly this domain (not its sub-domains).' : 'Start with @ for a whole domain.'} error={formError || undefined}>
          <Input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="curator@museum.org or @museum.org" autoComplete="off" spellCheck={false} />
        </Field>
        <Field label="Role" group>
          {(w) => <Select<AccessRole> {...w} value={role} onChange={setRole} options={ACCESS_OPTIONS} />}
        </Field>
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. Curatorial team" />
        </Field>
        <div className="ops-access-submit">
          <Button type="submit" variant="primary" icon="plus" loading={busy} loadingLabel="Saving…">
            {existing ? 'Update' : 'Add'}
          </Button>
        </div>
      </form>

      {data?.masters.length ? (
        <p className="small muted ops-masters">
          Master admins (set in the site’s configuration):{' '}
          {data.masters.map((m, i) => (
            <span key={m}>
              {i ? ', ' : ''}
              <span className="mono">{m}</span>
            </span>
          ))}
        </p>
      ) : null}

      <div className="ops-table">
        <DataTable<AccessEntry>
          rows={data ? data.entries : null}
          columns={columns}
          getRowId={(e) => e.pattern}
          caption="Access list"
          defaultSort={{ id: 'pattern', dir: 'asc' }}
          loadingRows={3}
          rowActionsLabel="Entry actions"
          rowActions={(e) => <RowActions destructive={<RowAction tone="danger" icon="trash" onClick={() => void remove(e)}>Remove</RowAction>} />}
          empty={<EmptyState as="h3" icon="users" title="No entries yet">Everyone except the master admins is a visitor until listed here or given a role below.</EmptyState>}
        />
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Users (admin)                                                       */
/* ------------------------------------------------------------------ */

type UserFilter = 'all' | 'staff' | 'visitors'

/** What a manual role change does, given the access list. */
function outcome(u: AdminUser, next: ManualRole): { role: Role; capped: boolean } {
  const fromList = u.accessRole && u.emailVerified ? RANK[u.accessRole] : 0
  const r = Math.max(RANK[next], fromList)
  const role = (Object.keys(RANK) as Role[]).find((k) => RANK[k] === r) ?? next
  return { role, capped: r > RANK[next] }
}

function grantedBy(u: AdminUser) {
  if (u.isMaster) return 'Site configuration'
  const parts = [
    u.accessRole ? `Access list (${ROLE_LABEL[u.accessRole]})${u.emailVerified ? '' : ', waiting for Google verification'}` : null,
    u.manualRole && u.manualRole !== 'visitor' ? `Manual (${ROLE_LABEL[u.manualRole]})` : null,
  ].filter(Boolean)
  return parts.join(' + ')
}

function UsersTable({ me }: { me: User }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<UserFilter>('all')
  const [sort, setSort] = useState<SortState>({ id: 'active', dir: 'desc' })
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const [flashId, setFlashId] = useState<string | null>(null)
  const toast = useToast()
  const confirm = useConfirm()

  useEffect(() => {
    api
      .users()
      .then(setUsers)
      .catch((e) => setError(errMsg(e)))
  }, [])

  const locked = useCallback((u: AdminUser) => u.isMaster || u.id === me.id, [me.id])

  const askRole = useCallback(
    async (list: AdminUser[], next: ManualRole) => {
      const capped = list.filter((u) => outcome(u, next).capped)
      const one = list.length === 1 ? list[0] : null
      return confirm({
        title: one ? `Make ${one.displayName || one.email} ${next === 'visitor' ? 'a Visitor' : next === 'admin' ? 'an Admin' : 'a Curator'}?` : `Set ${plural(list.length, 'account')} to ${ROLE_LABEL[next]}?`,
        body: (
          <>
            <p>
              {next === 'visitor' ? 'A visitor has no staff access.' : `${next === 'admin' ? 'An admin' : 'A curator'} ${ROLE_WHAT[next]}.`}
            </p>
            {capped.length ? (
              <p>
                {one
                  ? `They stay ${ROLE_LABEL[outcome(one, next).role]} while the access list gives them that role.`
                  : `${plural(capped.length, 'account')} stay${capped.length === 1 ? 's' : ''} higher because of the access list.`}
              </p>
            ) : null}
          </>
        ),
        confirmLabel: `Make ${ROLE_LABEL[next]}`,
        tone: next === 'admin' ? 'warning' : next === 'visitor' ? 'danger' : 'neutral',
        danger: next === 'visitor' && list.some((u) => u.role !== 'visitor'),
      })
    },
    [confirm],
  )

  const setRole = useCallback(
    async (u: AdminUser, next: ManualRole) => {
      if ((u.manualRole ?? 'visitor') === next) return
      if (!(await askRole([u], next))) return
      try {
        const updated = await api.setUserRole(u.id, next)
        setUsers((list) => (list ?? []).map((x) => (x.id === u.id ? updated : x)))
        toast(
          updated.role === next ? `${u.email} is now ${ROLE_LABEL[updated.role]}` : `${u.email} stays ${ROLE_LABEL[updated.role]} (access list)`,
          'ok',
          { title: 'Role changed' },
        )
      } catch (e) {
        toast(errMsg(e), 'error')
      }
    },
    [askRole, toast],
  )

  async function bulkRole(ids: string[], next: ManualRole) {
    const all = (users ?? []).filter((u) => ids.includes(u.id))
    const skipped = all.filter(locked)
    const list = all.filter((u) => !locked(u) && (u.manualRole ?? 'visitor') !== next)
    if (!list.length) {
      toast(skipped.length ? 'Master admins and your own account can’t be changed here.' : `Already ${ROLE_LABEL[next]}.`, 'info')
      return
    }
    if (!(await askRole(list, next))) return
    setBusy(true)
    const failed: string[] = []
    let lastError = ''
    for (const u of list) {
      try {
        const updated = await api.setUserRole(u.id, next)
        setUsers((cur) => (cur ?? []).map((x) => (x.id === u.id ? updated : x)))
      } catch (e) {
        failed.push(u.id)
        lastError = errMsg(e)
      }
    }
    setBusy(false)
    setSelected(new Set(failed))
    const done = list.length - failed.length
    const skipNote = skipped.length ? ` ${plural(skipped.length, 'account')} skipped (master admins and you).` : ''
    if (failed.length) toast(`${lastError} ${plural(failed.length, 'account')} stay ticked.${skipNote}`, 'error', { title: `Changed ${done}; ${failed.length} failed` })
    else toast(`Set ${plural(done, 'account')} to ${ROLE_LABEL[next]}.${skipNote}`)
  }

  const columns = useMemo<Column<AdminUser>[]>(
    () => [
      {
        id: 'user',
        header: 'User',
        sortValue: (u) => (u.displayName || u.email).toLowerCase(),
        cell: (u) => (
          <>
            <span className="cell-title">
              {u.displayName || u.email}
              {u.id === me.id ? <span className="muted small"> (you)</span> : null}
            </span>
            <span className="cell-sub truncate" style={{ display: 'block', maxWidth: 280 }}>{u.email}</span>
          </>
        ),
      },
      {
        id: 'role',
        header: 'Role',
        sortValue: (u) => RANK[u.role],
        cell: (u) => (
          <>
            <span className={`badge lg role-${u.role}`}>{ROLE_LABEL[u.role]}</span>
            {grantedBy(u) ? <span className="cell-sub" style={{ display: 'block', marginTop: 4 }}>{grantedBy(u)}</span> : null}
          </>
        ),
      },
      {
        id: 'signin',
        header: 'Sign-in',
        hidePhone: true,
        cell: (u) => (
          <>
            {[u.google && 'Google', u.hasPassword && 'Password'].filter(Boolean).join(' + ') || '–'}
            {u.emailVerified ? <span className="cell-sub" style={{ display: 'block' }}>Verified</span> : null}
          </>
        ),
      },
      {
        id: 'active',
        header: 'Last active',
        sortValue: (u) => (u.lastLoginAt ? new Date(u.lastLoginAt).getTime() : null),
        cell: (u) => (u.lastLoginAt ? <time dateTime={u.lastLoginAt} title={formatDate(u.lastLoginAt)}>{formatRelative(u.lastLoginAt)}</time> : <span className="muted">Never</span>),
      },
      {
        id: 'joined',
        header: 'Joined',
        hidePhone: true,
        sortValue: (u) => new Date(u.createdAt).getTime(),
        cell: (u) => <time dateTime={u.createdAt} title={formatDate(u.createdAt)}>{formatRelative(u.createdAt)}</time>,
      },
      {
        id: 'manual',
        header: 'Manual role',
        cell: (u) =>
          locked(u) ? (
            <span className="muted small">{u.isMaster ? 'Set by the site' : 'Your own'}</span>
          ) : (
            <Select<ManualRole> size="sm" value={u.manualRole ?? 'visitor'} onChange={(v) => void setRole(u, v)} options={MANUAL_OPTIONS} aria-label={`Manual role for ${u.email}`} />
          ),
      },
    ],
    [me.id, locked, setRole],
  )

  const all = useMemo(() => users ?? [], [users])
  const staffCount = useMemo(() => all.filter((u) => u.role !== 'visitor').length, [all])
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    const rows = all.filter(
      (u) =>
        (filter === 'all' || (filter === 'staff' ? u.role !== 'visitor' : u.role === 'visitor')) &&
        (!s || u.email.toLowerCase().includes(s) || u.displayName.toLowerCase().includes(s)),
    )
    const col = columns.find((c) => c.id === sort?.id)
    return sort ? sortRows(rows, col?.sortValue, sort.dir) : rows
  }, [all, filter, q, sort, columns])
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE))
  const curPage = Math.min(page, pages)
  const rows = useMemo(() => pageSlice(filtered, curPage, PAGE), [filtered, curPage])
  useEffect(() => setPage(1), [filter, q, sort])

  // #/access/<user id> (activity log): point at that account
  useEffect(() => {
    const id = hashTail('access')
    if (!id || !users) return
    const i = filtered.findIndex((u) => u.id === id)
    if (i < 0) return
    setPage(Math.floor(i / PAGE) + 1)
    setFlashId(id)
    const t = setTimeout(() => setFlashId(null), 1400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users])

  return (
    <section className="ops-section" aria-labelledby="users-h">
      <div className="ops-section-head">
        <h2 id="users-h">Users</h2>
        <span className="muted small">{users ? `${plural(all.length, 'account')} · ${staffCount} staff` : ''}</span>
      </div>
      {error ? <p className="alert" role="alert">{error}</p> : null}
      <Tabs<UserFilter>
        label="Show"
        value={filter}
        onChange={setFilter}
        tabs={[
          { id: 'all', label: 'All', count: users ? all.length : undefined },
          { id: 'staff', label: 'Staff', count: users ? staffCount : undefined },
          { id: 'visitors', label: 'Visitors', count: users ? all.length - staffCount : undefined },
        ]}
        className="ops-tabs"
      />
      <div className="toolbar ops-toolbar">
        <SearchInput value={q} onChange={setQ} label="Search users by name or email" placeholder="Search name or email" />
      </div>
      {users && users.length >= SERVER_CAP ? <p className="note small">Showing the first {SERVER_CAP.toLocaleString()} accounts.</p> : null}
      <div className="ops-table">
        <DataTable<AdminUser>
          rows={users ? rows : null}
          columns={columns}
          getRowId={(u) => u.id}
          caption="Users"
          sort={sort}
          onSortChange={setSort}
          selectable
          selected={selected}
          onSelectedChange={setSelected}
          flashId={flashId}
          minWidth={920}
          bulkActions={(ids) => (
            <>
              <Button size="sm" disabled={busy} onClick={() => void bulkRole(ids, 'curator')}>Make curator</Button>
              <Button size="sm" disabled={busy} onClick={() => void bulkRole(ids, 'admin')}>Make admin</Button>
              <Button size="sm" variant="danger" disabled={busy} onClick={() => void bulkRole(ids, 'visitor')}>Make visitor</Button>
            </>
          )}
          empty={<EmptyState as="h3" icon="users" title={q ? 'No matching accounts' : 'No accounts here'}>{q ? `Nothing matches “${q}”.` : undefined}</EmptyState>}
          footer={filtered.length > PAGE ? <Pagination page={curPage} pageSize={PAGE} total={filtered.length} onPage={setPage} noun="accounts" /> : null}
        />
      </div>
    </section>
  )
}
