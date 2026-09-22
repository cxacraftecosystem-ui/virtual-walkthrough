import 'server-only'
import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTPayload } from 'jose'
import {
  createUser,
  endSession,
  findUserByEmail,
  getUserRow,
  isEmail,
  recordSignIn,
  startSession,
  verifyPassword,
  type UserRow,
} from '../auth'
import { config } from '../config'
import { route } from '../http'
import { createRateLimiter, fail, isRecord } from '../util'

const loginLimit = createRateLimiter(10, 60_000) // per IP
const registerLimit = createRateLimiter(10, 10 * 60_000)
const googleLimit = createRateLimiter(20, 60_000)

/** POST /api/auth/register */
export const register = route(async (c) => {
  if (!registerLimit(c.ip)) return fail(429, 'Too many registrations, try again later')
  const b = await c.json()
  if (!isRecord(b)) return fail(400, 'Body must be an object')
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : ''
  const password = typeof b.password === 'string' ? b.password : ''
  const displayName = typeof b.displayName === 'string' ? b.displayName.trim() : ''
  if (!isEmail(email)) return fail(400, 'A valid email is required')
  if (password.length < 8 || password.length > 200) return fail(400, 'Password must be at least 8 characters')
  if (!displayName || displayName.length > 60) return fail(400, 'Display name is required (max 60 characters)')
  if (await findUserByEmail(c.db, email)) return fail(409, 'An account with this email already exists')
  const created = await createUser(c.db, email, password, displayName)
  await startSession(c.db, c.headers, created.id)
  c.status = 201
  return recordSignIn(c.db, created.id)
})

/** POST /api/auth/login */
export const login = route(async (c) => {
  if (!loginLimit(c.ip)) return fail(429, 'Too many login attempts, try again in a minute')
  const b = await c.json()
  if (!isRecord(b) || typeof b.email !== 'string' || typeof b.password !== 'string') return fail(400, 'Body must be { email, password }')
  const found = await findUserByEmail(c.db, b.email)
  const valid = await verifyPassword(b.password, found?.passwordHash ?? '')
  if (!found || !valid) return fail(401, 'Invalid email or password')
  await startSession(c.db, c.headers, found.id)
  return recordSignIn(c.db, found.id)
})

/** POST /api/auth/logout */
export const logout = route(async (c) => {
  await endSession(c.db, c.req, c.headers)
  return { ok: true }
})

/** GET /api/auth/me */
export const me = route(async (c) => c.requireUser())

/** GET /api/auth/session — always 200: `{ user }` or `{ user: null }` (no console noise for visitors). */
export const session = route(async (c) => ({ user: await c.user() }))

/** GET /api/auth/providers — public sign-in options: `{ google: <client id> | null }`. */
export const providers = route(async () => ({ google: config.googleClientId || null }))

/* ------------------------------------------------------------------ */
/* Google Identity Services (ID-token flow)                            */
/* ------------------------------------------------------------------ */

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com']
const g = globalThis as { __museumGoogleJwks?: ReturnType<typeof createRemoteJWKSet> }
/** Google's signing keys, fetched lazily and cached (jose honours the cache headers / key rotation). */
const googleKeys = () => (g.__museumGoogleJwks ??= createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs')))

interface GoogleClaims extends JWTPayload {
  email?: string
  email_verified?: boolean | string
  name?: string
  given_name?: string
}

async function verifyGoogleIdToken(credential: string): Promise<GoogleClaims> {
  try {
    const { payload } = await jwtVerify<GoogleClaims>(credential, googleKeys(), {
      issuer: GOOGLE_ISSUERS,
      audience: config.googleClientId,
      algorithms: ['RS256'],
      clockTolerance: 60,
      requiredClaims: ['sub', 'exp', 'iat'],
    })
    return payload
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) return fail(401, 'Google sign-in expired, please try again')
    if (err instanceof joseErrors.JOSEError) return fail(401, 'Invalid Google credential')
    throw err // network trouble fetching the JWKS → 500
  }
}

/**
 * POST /api/auth/google `{ credential }` — the ID token from the GIS button. Verifies it against
 * Google's JWKS (signature, iss, aud = GOOGLE_CLIENT_ID, exp, email_verified), then signs in:
 *  - known Google account (sub)     → that user
 *  - existing account with the email → linked to this Google account (email becomes verified).
 *    If that account was an UNVERIFIED self-registration its password is cleared and its sessions
 *    revoked: whoever registered it without owning the mailbox must not keep access.
 *  - otherwise                       → a new passwordless account
 * The role then comes from the access list (see auth.ts).
 */
export const google = route(async (c) => {
  if (!config.googleClientId) return fail(503, 'Google sign-in is not configured on this server (GOOGLE_CLIENT_ID)')
  if (!googleLimit(c.ip)) return fail(429, 'Too many sign-in attempts, try again in a minute')
  const b = await c.json({ maxBytes: 16 * 1024 })
  if (!isRecord(b) || typeof b.credential !== 'string' || !b.credential || b.credential.length > 8192) {
    return fail(400, 'Body must be { credential: <Google ID token> }')
  }
  const claims = await verifyGoogleIdToken(b.credential)
  const sub = String(claims.sub)
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : ''
  if (!email || !isEmail(email)) return fail(400, 'Your Google account has no usable email address')
  if (claims.email_verified !== true && claims.email_verified !== 'true') return fail(403, 'Your Google email address is not verified')

  const db = c.db
  let user = await db.one<UserRow>('SELECT * FROM users WHERE google_sub = $1', [sub])
  if (!user) {
    const byEmail = await db.one<UserRow>('SELECT * FROM users WHERE email = $1', [email])
    if (byEmail) {
      if (byEmail.google_sub && byEmail.google_sub !== sub) return fail(409, 'This email is linked to a different Google account')
      const takeover = Number(byEmail.email_verified) !== 1
      if (takeover) {
        await db.run("UPDATE users SET password_hash = '' WHERE id = $1", [byEmail.id])
        await db.run('DELETE FROM sessions WHERE user_id = $1', [byEmail.id])
      }
      await db.run('UPDATE users SET google_sub = $1, email_verified = 1 WHERE id = $2', [sub, byEmail.id])
      user = await getUserRow(db, byEmail.id)
    } else {
      const name = (typeof claims.name === 'string' && claims.name.trim()) || email.slice(0, email.indexOf('@'))
      try {
        const created = await createUser(db, email, null, name.slice(0, 60), { emailVerified: true, googleSub: sub })
        user = await getUserRow(db, created.id)
      } catch {
        // concurrent first sign-in with the same account
        user = await db.one<UserRow>('SELECT * FROM users WHERE google_sub = $1', [sub])
      }
    }
  } else if (user.email !== email && !(await findUserByEmail(db, email))) {
    // the Google account's address changed: follow it (it is verified by Google)
    await db.run('UPDATE users SET email = $1, email_verified = 1 WHERE id = $2', [email, user.id])
  }
  if (!user) return fail(500, 'Could not create the account, please try again')
  await startSession(db, c.headers, user.id)
  return recordSignIn(db, user.id)
})
