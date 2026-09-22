/**
 * Authentication: scrypt password hashing, random session tokens (only the SHA-256 hash is
 * stored in the DB — works statelessly across serverless invocations), 30-day HTTP-only
 * cookie `museum_session` (SameSite=Lax, Secure in production).
 *
 * Roles (RBAC): visitor < curator < admin < master. The stored `users.role` is the EFFECTIVE
 * role, recomputed (`syncRole`) on every sign-in, on access-list / role changes and at bootstrap:
 *   master — a verified account whose email is in MASTER_ADMIN_EMAILS (comma-separated; fallback
 *            MASTER_ADMIN_EMAIL, then ADMIN_EMAIL). Mirrored into the access list as role 'master'.
 *   else   — max(access-list role for the email or its @domain [verified emails only],
 *                users.manual_role set by an admin on the Users page)
 * "Verified" = has signed in with Google (email_verified) or is the env-seeded admin.
 * Self-registration has no email check, so an unverified password account never inherits an
 * access-list role (otherwise anyone could register `someone@listed-domain` and become staff).
 */
import 'server-only'
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'
import { config } from './config'
import { type Db, nowIso } from './db'
import { HttpError } from './util'

export const SESSION_COOKIE = 'museum_session'

export const ROLES = ['visitor', 'curator', 'admin', 'master'] as const
export type Role = (typeof ROLES)[number]
/** Roles an admin can assign by hand. */
export const MANUAL_ROLES = ['visitor', 'curator', 'admin'] as const
export type ManualRole = (typeof MANUAL_ROLES)[number]
/** Roles the access list can grant. */
export const ACCESS_ROLES = ['curator', 'admin'] as const
export type AccessRole = (typeof ACCESS_ROLES)[number]

const RANK: Record<Role, number> = { visitor: 0, curator: 1, admin: 2, master: 3 }
export const hasRole = (role: Role, min: Role) => (RANK[role] ?? 0) >= RANK[min]
const maxRole = (...roles: (Role | null | undefined)[]): Role =>
  roles.reduce<Role>((best, r) => (r && RANK[r] > RANK[best] ? r : best), 'visitor')

export interface User {
  id: string
  email: string
  displayName: string
  role: Role
  createdAt: string
}
export interface UserRow {
  id: string
  email: string
  display_name: string
  role: Role
  password_hash: string
  created_at: string
  manual_role: ManualRole | null
  email_verified: number
  google_sub: string | null
  last_login_at: string | null
}

export const toUser = (r: UserRow): User => ({ id: r.id, email: r.email, displayName: r.display_name, role: r.role, createdAt: r.created_at })

/* ---------------------------- passwords ---------------------------- */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 }

function scryptAsync(password: string, salt: Buffer, keylen: number, opts: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  )
}

/** Format: scrypt$N$r$p$saltB64$hashB64 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scryptAsync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p })
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$')
}

/** Same scrypt work for unknown emails (no user enumeration via timing). */
export const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64')

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  // Google-only accounts store '' → never valid, but still do the scrypt work (timing).
  const usable = stored.startsWith('scrypt$')
  const [, N, r, p, saltB64, hashB64] = (usable ? stored : DUMMY_HASH).split('$')
  if (!saltB64 || !hashB64) return false
  const expected = Buffer.from(hashB64, 'base64')
  const key = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  })
  return usable && key.length === expected.length && timingSafeEqual(key, expected)
}

/* ------------------------------ users ------------------------------ */

export async function getUserRow(db: Db, id: string) {
  return db.one<UserRow>('SELECT * FROM users WHERE id = $1', [id])
}

export async function findUserByEmail(db: Db, email: string): Promise<(User & { passwordHash: string }) | undefined> {
  const r = await db.one<UserRow>('SELECT * FROM users WHERE email = $1', [email.trim().toLowerCase()])
  return r ? { ...toUser(r), passwordHash: r.password_hash } : undefined
}

export async function createUser(
  db: Db,
  email: string,
  password: string | null,
  displayName: string,
  opts: { manualRole?: ManualRole; emailVerified?: boolean; googleSub?: string } = {},
): Promise<User> {
  const id = randomUUID()
  await db.run(
    `INSERT INTO users (id, email, display_name, role, password_hash, created_at, manual_role, email_verified, google_sub)
     VALUES ($1, $2, $3, 'visitor', $4, $5, $6, $7, $8)`,
    [
      id,
      email.trim().toLowerCase(),
      displayName.trim(),
      password === null ? '' : await hashPassword(password),
      nowIso(),
      opts.manualRole ?? null,
      opts.emailVerified ? 1 : 0,
      opts.googleSub ?? null,
    ],
  )
  await syncRole(db, id)
  return toUser((await getUserRow(db, id))!)
}

/* ------------------------- role resolution ------------------------- */

// TLD may contain digits/hyphens (IDN "xn--…" TLDs)
const EMAIL_RE = /^[^\s@]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z0-9-]{2,}$/i
const DOMAIN_RE = /^@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z0-9-]{2,}$/
export const isEmail = (v: string) => EMAIL_RE.test(v) && v.length <= 200

/** 'Person@X.org' → 'person@x.org'; '@X.org' → '@x.org' (whole domain); null when invalid. */
export function normalizeAccessPattern(input: string): string | null {
  const p = input.trim().toLowerCase()
  if (p.startsWith('@')) return DOMAIN_RE.test(p) && p.length <= 200 ? p : null
  return isEmail(p) ? p : null
}

/** Highest access-list role for an email (its exact entry or its @domain), or null. 'master' rows are
 *  only a mirror of MASTER_ADMIN_EMAILS (the env var is authoritative) and are ignored here. */
export async function accessRoleFor(db: Db, email: string): Promise<AccessRole | null> {
  const at = email.lastIndexOf('@')
  if (at < 0) return null
  const rows = await db.query<{ role: AccessRole }>("SELECT role FROM access_list WHERE (pattern = $1 OR pattern = $2) AND role <> 'master'", [
    email,
    email.slice(at),
  ])
  const best = maxRole(...rows.map((r) => r.role))
  return best === 'visitor' ? null : (best as AccessRole)
}

export const isMasterEmail = (email: string) => config.masterAdminEmails.includes(email.trim().toLowerCase())

/**
 * Bootstrap: mirror MASTER_ADMIN_EMAILS into the access list (role 'master', not editable in the UI)
 * and drop mirrored rows for addresses no longer listed.
 */
export async function syncMasterEntries(db: Db) {
  const now = nowIso()
  for (const email of config.masterAdminEmails) {
    await db.run(
      `INSERT INTO access_list (pattern, role, note, created_by, created_at, updated_at) VALUES ($1, 'master', 'MASTER_ADMIN_EMAILS', 'env', $2, $2)
       ON CONFLICT (pattern) DO UPDATE SET role = 'master', note = 'MASTER_ADMIN_EMAILS', created_by = 'env', updated_at = excluded.updated_at
       WHERE access_list.role <> 'master'`,
      [email, now],
    )
  }
  const stale = await db.query<{ pattern: string }>("SELECT pattern FROM access_list WHERE role = 'master'")
  for (const r of stale) if (!isMasterEmail(r.pattern)) await db.run('DELETE FROM access_list WHERE pattern = $1', [r.pattern])
}

export async function computeRole(db: Db, u: Pick<UserRow, 'email' | 'email_verified' | 'manual_role'>): Promise<Role> {
  const verified = Number(u.email_verified) === 1
  if (verified && isMasterEmail(u.email)) return 'master'
  return maxRole(verified ? await accessRoleFor(db, u.email) : null, u.manual_role)
}

/** Recompute + store a user's effective role; returns it (undefined when the user is gone). */
export async function syncRole(db: Db, userId: string): Promise<Role | undefined> {
  const u = await getUserRow(db, userId)
  if (!u) return undefined
  const role = await computeRole(db, u)
  if (role !== u.role) await db.run('UPDATE users SET role = $1 WHERE id = $2', [role, userId])
  return role
}

/** Re-sync every user an access-list pattern applies to (exact email or whole domain). */
export async function syncRolesForPattern(db: Db, pattern: string) {
  const rows = pattern.startsWith('@')
    ? await db.query<{ id: string }>('SELECT id FROM users WHERE email LIKE $1', ['%' + pattern])
    : await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [pattern])
  for (const r of rows) await syncRole(db, r.id)
}

/** Bootstrap: re-sync staff, master addresses and manual roles (covers MASTER_ADMIN_EMAILS changes). */
export async function syncStaffRoles(db: Db) {
  const rows = await db.query<{ id: string }>(
    "SELECT id FROM users WHERE role <> 'visitor' OR manual_role IS NOT NULL OR email IN (SELECT pattern FROM access_list WHERE role = 'master')",
  )
  for (const r of rows) await syncRole(db, r.id)
}

/** After any successful sign-in: stamp last_login_at and refresh the role from the access list. */
export async function recordSignIn(db: Db, userId: string): Promise<User> {
  await db.run('UPDATE users SET last_login_at = $1 WHERE id = $2', [nowIso(), userId])
  await syncRole(db, userId)
  return toUser((await getUserRow(db, userId))!)
}

/**
 * Ensure the configured admin exists. When ADMIN_EMAIL + ADMIN_PASSWORD are set explicitly the
 * password is re-synchronised on start, so rotating the env var rotates the password.
 * In production without those env vars no default admin is created. The address is trusted
 * (email_verified) and gets manual role admin — or master when it is one of MASTER_ADMIN_EMAILS.
 */
export async function seedAdmin(db: Db, log: (msg: string) => void) {
  const { adminEmail, adminPassword, adminFromEnv } = config
  if (!adminFromEnv) {
    if (config.isProduction) {
      log('WARNING: ADMIN_EMAIL / ADMIN_PASSWORD not set in production; the default admin account is NOT created.')
      return
    }
    log(`WARNING: using default admin credentials (${adminEmail} / ${adminPassword}). Set ADMIN_EMAIL and ADMIN_PASSWORD for any shared deployment!`)
  }
  const existing = await findUserByEmail(db, adminEmail)
  if (!existing) {
    try {
      await createUser(db, adminEmail, adminPassword, 'Administrator', { manualRole: 'admin', emailVerified: true })
      log(`created admin user ${adminEmail}`)
    } catch {
      /* created concurrently by another instance */
    }
    return
  }
  await db.run("UPDATE users SET manual_role = 'admin', email_verified = 1 WHERE id = $1", [existing.id])
  await syncRole(db, existing.id)
  if (adminFromEnv && !(await verifyPassword(adminPassword, existing.passwordHash))) {
    await db.run('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(adminPassword), existing.id])
    await db.run('DELETE FROM sessions WHERE user_id = $1', [existing.id])
    log(`admin password for ${adminEmail} updated from ADMIN_PASSWORD (existing sessions revoked)`)
  }
}

/* ----------------------------- cookies ----------------------------- */

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get('cookie')
  if (!header) return undefined
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim())
      } catch {
        return undefined
      }
    }
  }
  return undefined
}

function sessionCookie(value: string, maxAge: number) {
  return [`${SESSION_COOKIE}=${value}`, 'Path=/', `Max-Age=${maxAge}`, 'HttpOnly', 'SameSite=Lax', ...(config.cookieSecure ? ['Secure'] : [])].join('; ')
}

/* ----------------------------- sessions ---------------------------- */

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex')

export async function startSession(db: Db, headers: Headers, userId: string) {
  const token = randomBytes(32).toString('base64url')
  const maxAge = config.sessionDays * 86400
  await db.run('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)', [
    hashToken(token),
    userId,
    nowIso(),
    Date.now() + maxAge * 1000,
  ])
  headers.append('set-cookie', sessionCookie(token, maxAge))
}

export async function endSession(db: Db, req: Request, headers: Headers) {
  const token = readCookie(req, SESSION_COOKIE)
  if (token) await db.run('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)])
  headers.append('set-cookie', sessionCookie('', 0))
}

export async function userFromRequest(db: Db, req: Request): Promise<User | null> {
  const token = readCookie(req, SESSION_COOKIE)
  if (!token || token.length > 200) return null
  const r = await db.one<UserRow>(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > $2`,
    [hashToken(token), Date.now()],
  )
  return r ? toUser(r) : null
}

export async function purgeExpiredSessions(db: Db) {
  await db.run('DELETE FROM sessions WHERE expires_at <= $1', [Date.now()])
}

export function requireUser(user: User | null): User {
  if (!user) throw new HttpError(401, 'Not logged in')
  return user
}

const ROLE_LABEL: Record<Role, string> = { visitor: 'Visitor', curator: 'Curator', admin: 'Admin', master: 'Master admin' }

/** 401 when signed out, 403 when the role is below `min`. */
export function requireRoleUser(user: User | null, min: Role): User {
  const u = requireUser(user)
  if (!hasRole(u.role, min)) throw new HttpError(403, `${ROLE_LABEL[min]} role required`)
  return u
}

export const requireAdminUser = (user: User | null) => requireRoleUser(user, 'admin')
