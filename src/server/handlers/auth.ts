import 'server-only'
import { createUser, DUMMY_HASH, endSession, findUserByEmail, startSession, verifyPassword } from '../auth'
import { route } from '../http'
import { createRateLimiter, fail, isRecord } from '../util'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const loginLimit = createRateLimiter(10, 60_000) // per IP
const registerLimit = createRateLimiter(10, 10 * 60_000)

/** POST /api/auth/register */
export const register = route(async (c) => {
  if (!registerLimit(c.ip)) return fail(429, 'Too many registrations, try again later')
  const b = await c.json()
  if (!isRecord(b)) return fail(400, 'Body must be an object')
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : ''
  const password = typeof b.password === 'string' ? b.password : ''
  const displayName = typeof b.displayName === 'string' ? b.displayName.trim() : ''
  if (!EMAIL_RE.test(email) || email.length > 200) return fail(400, 'A valid email is required')
  if (password.length < 8 || password.length > 200) return fail(400, 'Password must be at least 8 characters')
  if (!displayName || displayName.length > 60) return fail(400, 'Display name is required (max 60 characters)')
  if (await findUserByEmail(c.db, email)) return fail(409, 'An account with this email already exists')
  const user = await createUser(c.db, email, password, displayName)
  await startSession(c.db, c.headers, user.id)
  c.status = 201
  return user
})

/** POST /api/auth/login */
export const login = route(async (c) => {
  if (!loginLimit(c.ip)) return fail(429, 'Too many login attempts, try again in a minute')
  const b = await c.json()
  if (!isRecord(b) || typeof b.email !== 'string' || typeof b.password !== 'string') return fail(400, 'Body must be { email, password }')
  const found = await findUserByEmail(c.db, b.email)
  const valid = await verifyPassword(b.password, found?.passwordHash ?? DUMMY_HASH)
  if (!found || !valid) return fail(401, 'Invalid email or password')
  await startSession(c.db, c.headers, found.id)
  const { id, email, displayName, role, createdAt } = found
  return { id, email, displayName, role, createdAt }
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
