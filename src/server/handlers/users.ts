/**
 * User & role management (admin) and the access list (master admin). See auth.ts for how the
 * effective role is derived: master email → master; else max(access list, manual role).
 */
import 'server-only'
import {
  ACCESS_ROLES,
  type AccessRole,
  accessRoleFor,
  getUserRow,
  isMasterEmail,
  MANUAL_ROLES,
  type ManualRole,
  normalizeAccessPattern,
  syncRole,
  syncRolesForPattern,
  type UserRow,
} from '../auth'
import { config } from '../config'
import { type Db, nowIso } from '../db'
import { route } from '../http'
import { fail, isRecord } from '../util'

const isManualRole = (v: unknown): v is ManualRole => typeof v === 'string' && (MANUAL_ROLES as readonly string[]).includes(v)
const isAccessRole = (v: unknown): v is AccessRole => typeof v === 'string' && (ACCESS_ROLES as readonly string[]).includes(v)

async function toAdminUser(db: Db, r: UserRow) {
  const verified = Number(r.email_verified) === 1
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    role: r.role,
    /** role set by an admin (null = none) */
    manualRole: r.manual_role,
    /** role granted by the access list for this address (applies once the email is verified) */
    accessRole: await accessRoleFor(db, r.email),
    emailVerified: verified,
    google: Boolean(r.google_sub),
    hasPassword: r.password_hash.startsWith('scrypt$'),
    isMaster: r.role === 'master',
    createdAt: r.created_at,
    lastLoginAt: r.last_login_at,
  }
}

/* ------------------------------------------------------------------ */
/* Users (admin)                                                       */
/* ------------------------------------------------------------------ */

/** GET /api/admin/users?q= — staff first, then most recent sign-in (max 1000). */
export const listUsers = route(async (c) => {
  await c.requireAdmin()
  const q = (c.url.searchParams.get('q') ?? '').trim().toLowerCase().slice(0, 100)
  const rows = await c.db.query<UserRow>(
    `SELECT * FROM users
     WHERE $1 = '' OR email LIKE $2 OR LOWER(display_name) LIKE $2
     ORDER BY CASE role WHEN 'master' THEN 0 WHEN 'admin' THEN 1 WHEN 'curator' THEN 2 ELSE 3 END,
              COALESCE(last_login_at, created_at) DESC
     LIMIT 1000`,
    [q, `%${q}%`],
  )
  return Promise.all(rows.map((r) => toAdminUser(c.db, r)))
})

/**
 * PATCH /api/admin/users/:id `{ role: 'visitor' | 'curator' | 'admin' }` — sets the manual role.
 * The effective role is max(manual, access list): to demote someone below their access-list role,
 * the master admin edits the access list. Nobody can change their own role or the master's.
 */
export const patchUser = route<{ id: string }>(async (c) => {
  const me = await c.requireAdmin()
  const b = await c.json()
  if (!isRecord(b) || !isManualRole(b.role)) return fail(400, `Body must be { role: ${MANUAL_ROLES.join(' | ')} }`)
  const target = await getUserRow(c.db, c.params.id)
  if (!target) return fail(404, 'User not found')
  if (target.id === me.id) return fail(400, 'You cannot change your own role')
  if (target.role === 'master' || isMasterEmail(target.email)) return fail(403, 'Master admins are configured by MASTER_ADMIN_EMAILS and cannot be changed here')
  await c.db.run('UPDATE users SET manual_role = $1 WHERE id = $2', [b.role === 'visitor' ? null : b.role, target.id])
  await syncRole(c.db, target.id)
  return toAdminUser(c.db, (await getUserRow(c.db, target.id))!)
})

/* ------------------------------------------------------------------ */
/* Access list (master admin)                                          */
/* ------------------------------------------------------------------ */

interface AccessRow {
  pattern: string
  role: AccessRole
  note: string
  created_by: string | null
  created_at: string
  updated_at: string
}

async function toEntry(db: Db, r: AccessRow) {
  const users = r.pattern.startsWith('@')
    ? await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM users WHERE email LIKE $1', ['%' + r.pattern])
    : await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM users WHERE email = $1', [r.pattern])
  return {
    pattern: r.pattern,
    kind: r.pattern.startsWith('@') ? ('domain' as const) : ('email' as const),
    role: r.role,
    note: r.note,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    /** existing accounts this entry applies to */
    users: Number(users?.n ?? 0),
  }
}

function parsePattern(raw: unknown) {
  if (typeof raw !== 'string') return fail(400, '"pattern" must be an email (person@example.org) or a domain (@example.org)')
  const p = normalizeAccessPattern(raw)
  if (!p) return fail(400, `"${raw.slice(0, 100)}" is not a valid email or @domain`)
  if (isMasterEmail(p)) return fail(400, 'Master admins are configured by MASTER_ADMIN_EMAILS and need no entry')
  return p
}

const noteOf = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 200) : '')

/** GET /api/admin/access → `{ masters, entries }` (masters come from MASTER_ADMIN_EMAILS, read-only) */
export const listAccess = route(async (c) => {
  await c.requireMaster()
  const rows = await c.db.query<AccessRow>("SELECT * FROM access_list WHERE role <> 'master' ORDER BY pattern")
  return { masters: config.masterAdminEmails, entries: await Promise.all(rows.map((r) => toEntry(c.db, r))) }
})

/** POST /api/admin/access `{ pattern, role, note? }` — create or update (upsert) → 201 entry. */
export const putAccess = route(async (c) => {
  const me = await c.requireMaster()
  const b = await c.json()
  if (!isRecord(b)) return fail(400, 'Body must be { pattern, role, note? }')
  const pattern = parsePattern(b.pattern)
  if (!isAccessRole(b.role)) return fail(400, `"role" must be one of ${ACCESS_ROLES.join(', ')}`)
  const now = nowIso()
  await c.db.run(
    `INSERT INTO access_list (pattern, role, note, created_by, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT (pattern) DO UPDATE SET role = excluded.role, note = excluded.note, updated_at = excluded.updated_at`,
    [pattern, b.role, noteOf(b.note), me.email, now],
  )
  await syncRolesForPattern(c.db, pattern)
  c.status = 201
  return toEntry(c.db, (await c.db.one<AccessRow>('SELECT * FROM access_list WHERE pattern = $1', [pattern]))!)
})

/** PATCH /api/admin/access/:pattern `{ role?, note? }` */
export const patchAccess = route<{ pattern: string }>(async (c) => {
  await c.requireMaster()
  const pattern = parsePattern(decodeURIComponent(c.params.pattern))
  const b = await c.json()
  if (!isRecord(b) || (b.role === undefined && b.note === undefined)) return fail(400, 'Body must be { role?, note? }')
  if (b.role !== undefined && !isAccessRole(b.role)) return fail(400, `"role" must be one of ${ACCESS_ROLES.join(', ')}`)
  const row = await c.db.one<AccessRow>("SELECT * FROM access_list WHERE pattern = $1 AND role <> 'master'", [pattern])
  if (!row) return fail(404, 'No access-list entry for this pattern')
  await c.db.run('UPDATE access_list SET role = $1, note = $2, updated_at = $3 WHERE pattern = $4', [
    (b.role as AccessRole | undefined) ?? row.role,
    b.note === undefined ? row.note : noteOf(b.note),
    nowIso(),
    pattern,
  ])
  await syncRolesForPattern(c.db, pattern)
  return toEntry(c.db, (await c.db.one<AccessRow>('SELECT * FROM access_list WHERE pattern = $1', [pattern]))!)
})

/** DELETE /api/admin/access/:pattern — affected users drop back to their manual role / visitor. */
export const deleteAccess = route<{ pattern: string }>(async (c) => {
  await c.requireMaster()
  const pattern = parsePattern(decodeURIComponent(c.params.pattern))
  const n = await c.db.run("DELETE FROM access_list WHERE pattern = $1 AND role <> 'master'", [pattern])
  if (n === 0) return fail(404, 'No access-list entry for this pattern')
  await syncRolesForPattern(c.db, pattern)
  return { ok: true }
})
