/**
 * Live guided tours — docent credentials.
 *
 * Supabase Realtime broadcast channels are open to every visitor holding the public anon key, so
 * a message that *claims* to come from the docent proves nothing. Instead:
 *
 *  1. the docent's browser creates an ECDSA P-256 key pair (private key non-extractable, never
 *     leaves the tab) and POSTs the public key here;
 *  2. this route checks the session role (curator+, server-side — the client's claim is never
 *     trusted) and returns a short-lived token: base64url(claims) "." base64url(HMAC-SHA256),
 *     signed with LIVE_TOKEN_SECRET; claims bind the docent's user id, display name, room and
 *     public key;
 *  3. followers verify the token with GET /api/live/verify (the secret stays on the server), then
 *     verify every docent control message (position, pointer, mute, end) against the bound public
 *     key, with a sequence number + timestamp window against replays.
 *
 * Copying a token out of the channel is useless without the matching private key.
 */
import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { route } from '../http'
import { createRateLimiter, fail, isRecord } from '../util'

const TOKEN_TTL_SEC = 30 * 60
const ROOM_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const tokenLimit = createRateLimiter(20, 60_000)
const verifyLimit = createRateLimiter(240, 60_000)

export interface LiveClaims {
  v: 1
  /** Docent's user id. */
  sub: string
  name: string
  role: string
  room: string
  /** Docent's ECDSA P-256 public key (raw, uncompressed point, base64url). */
  pub: string
  iat: number
  exp: number
}

const b64u = (buf: Buffer) => buf.toString('base64url')

function secret(): string | null {
  const s = process.env.LIVE_TOKEN_SECRET?.trim()
  return s && s.length >= 32 ? s : null
}

function sign(payload: string, key: string) {
  return createHmac('sha256', key).update(payload).digest()
}

export function mintLiveToken(claims: LiveClaims, key: string) {
  const payload = b64u(Buffer.from(JSON.stringify(claims)))
  return `${payload}.${b64u(sign(payload, key))}`
}

export function verifyLiveToken(token: string, key: string, now = Date.now() / 1000): LiveClaims | null {
  const [payload, mac, extra] = token.split('.')
  if (!payload || !mac || extra !== undefined || token.length > 2048) return null
  const want = sign(payload, key)
  const got = Buffer.from(mac, 'base64url')
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null
  try {
    const c = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as LiveClaims
    if (c.v !== 1 || typeof c.exp !== 'number' || c.exp < now) return null
    return c
  } catch {
    return null
  }
}

/** POST /api/live/token — body { room, pub } → { token, claims }. Curator or higher. */
export const liveToken = route(async (c) => {
  const user = await c.requireCurator()
  if (!tokenLimit(user.id)) return fail(429, 'Too many token requests')
  const key = secret()
  if (!key) return fail(503, 'Live tours are not configured (LIVE_TOKEN_SECRET)')
  const b = await c.json({ maxBytes: 4096 })
  if (!isRecord(b)) return fail(400, 'Body must be { room, pub }')
  const room = typeof b.room === 'string' ? b.room : ''
  const pub = typeof b.pub === 'string' ? b.pub : ''
  if (!ROOM_RE.test(room)) return fail(400, 'Invalid room')
  // uncompressed P-256 point = 65 bytes → 87 base64url chars
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(pub) || Buffer.from(pub, 'base64url').length !== 65) return fail(400, 'Invalid public key')
  const iat = Math.floor(Date.now() / 1000)
  const claims: LiveClaims = {
    v: 1,
    sub: user.id,
    name: user.displayName.slice(0, 60),
    role: user.role,
    room,
    pub,
    iat,
    exp: iat + TOKEN_TTL_SEC,
  }
  return { token: mintLiveToken(claims, key), claims }
})

/** GET /api/live/verify?token= → { ok: true, claims } | { ok: false }. Public. */
export const liveVerify = route(async (c) => {
  if (!verifyLimit(c.ip)) return fail(429, 'Too many requests')
  const key = secret()
  if (!key) return fail(503, 'Live tours are not configured')
  const token = c.url.searchParams.get('token') ?? ''
  const claims = token ? verifyLiveToken(token, key) : null
  return claims ? { ok: true, claims } : { ok: false }
})
