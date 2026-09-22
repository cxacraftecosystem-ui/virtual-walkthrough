/**
 * Authentication: scrypt password hashing, random session tokens (only the SHA-256 hash is
 * stored in the DB — works statelessly across serverless invocations), 30-day HTTP-only
 * cookie `museum_session` (SameSite=Lax, Secure in production).
 */
import 'server-only'
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'
import { config } from './config'
import { type Db, nowIso } from './db'
import { HttpError } from './util'

export const SESSION_COOKIE = 'museum_session'

export type Role = 'visitor' | 'admin'
export interface User {
  id: string
  email: string
  displayName: string
  role: Role
  createdAt: string
}
interface UserRow {
  id: string
  email: string
  display_name: string
  role: Role
  password_hash: string
  created_at: string
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

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, N, r, p, saltB64, hashB64] = stored.split('$')
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false
  const expected = Buffer.from(hashB64, 'base64')
  const key = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  })
  return key.length === expected.length && timingSafeEqual(key, expected)
}

/** Same scrypt work for unknown emails (no user enumeration via timing). */
export const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64')

/* ------------------------------ users ------------------------------ */

export async function findUserByEmail(db: Db, email: string): Promise<(User & { passwordHash: string }) | undefined> {
  const r = await db.one<UserRow>('SELECT * FROM users WHERE email = $1', [email.trim().toLowerCase()])
  return r ? { ...toUser(r), passwordHash: r.password_hash } : undefined
}

export async function createUser(db: Db, email: string, password: string, displayName: string, role: Role = 'visitor'): Promise<User> {
  const row: UserRow = {
    id: randomUUID(),
    email: email.trim().toLowerCase(),
    display_name: displayName.trim(),
    role,
    password_hash: await hashPassword(password),
    created_at: nowIso(),
  }
  await db.run('INSERT INTO users (id, email, display_name, role, password_hash, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [
    row.id,
    row.email,
    row.display_name,
    row.role,
    row.password_hash,
    row.created_at,
  ])
  return toUser(row)
}

/**
 * Ensure the configured admin exists. When ADMIN_EMAIL + ADMIN_PASSWORD are set explicitly the
 * password is re-synchronised on start, so rotating the env var rotates the password.
 * In production without those env vars no default admin is created.
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
      await createUser(db, adminEmail, adminPassword, 'Administrator', 'admin')
      log(`created admin user ${adminEmail}`)
    } catch {
      /* created concurrently by another instance */
    }
    return
  }
  if (existing.role !== 'admin') await db.run("UPDATE users SET role = 'admin' WHERE id = $1", [existing.id])
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

export function requireAdminUser(user: User | null): User {
  const u = requireUser(user)
  if (u.role !== 'admin') throw new HttpError(403, 'Admin only')
  return u
}
