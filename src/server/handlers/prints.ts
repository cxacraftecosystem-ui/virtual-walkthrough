/**
 * Visitor prints — "Print it yourself" studio → moderated Visitors' Wall.
 *
 *   POST   /api/prints               public (anonymous allowed, needs the museum session id); PNG ≤ 2 MB → pending
 *   GET    /api/prints?status=approved  public; latest approved (max 24)
 *   GET    /api/admin/prints?status=  curator+; moderation queue
 *   PATCH  /api/admin/prints/:id      curator+; { status: 'approved' | 'rejected' | 'pending' }
 *   DELETE /api/admin/prints/:id      curator+; removes the file and the row
 *
 * Images are stored through the storage driver under `prints/<uuid>.png` (local disk or S3).
 */
import 'server-only'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { nowIso, parseJson } from '../db'
import { route } from '../http'
import { createRateLimiter, fail, isRecord } from '../util'

export const PRINT_MAX_BYTES = 2 * 1024 * 1024
const PRINT_MAX_SIDE = 2400
const PUBLIC_LIMIT = 24
/** Safety valve against storage flooding: new submissions wait while this many are unreviewed. */
const MAX_PENDING = 400
const MAX_PENDING_PER_SESSION = 6

const perSession = createRateLimiter(3, 10 * 60_000) // 3 prints / 10 min / museum session
const perIp = createRateLimiter(10, 10 * 60_000) // 10 prints / 10 min / IP

const SESSION_RE = /^[A-Za-z0-9_.:-]{8,80}$/
const STATUSES = ['pending', 'approved', 'rejected'] as const
type Status = (typeof STATUSES)[number]
const isStatus = (v: unknown): v is Status => typeof v === 'string' && (STATUSES as readonly string[]).includes(v)

interface Row {
  id: string
  session_id: string
  user_id: string | null
  display_name: string
  motif: string
  meta: unknown
  storage_key: string
  url: string
  width: number
  height: number
  size: number
  status: Status
  created_at: string
  reviewed_at: string | null
  reviewed_by: string | null
}

export interface PublicPrint {
  id: string
  url: string
  displayName: string
  motif: string
  meta: Record<string, unknown>
  width: number
  height: number
  createdAt: string
}

function safeMeta(v: unknown): Record<string, unknown> {
  try {
    const m = parseJson<unknown>(v)
    return isRecord(m) ? m : {}
  } catch {
    return {}
  }
}

const toPublic = (r: Row): PublicPrint => ({
  id: r.id,
  url: r.url,
  displayName: r.display_name,
  motif: r.motif,
  meta: safeMeta(r.meta),
  width: Number(r.width),
  height: Number(r.height),
  createdAt: r.created_at,
})

const toAdmin = (r: Row) => ({
  ...toPublic(r),
  status: r.status,
  size: Number(r.size),
  sessionId: r.session_id,
  userId: r.user_id,
  reviewedAt: r.reviewed_at,
  reviewedBy: r.reviewed_by,
})

/** Control, zero-width and bidi-override code points. */
const isInvisible = (c: number) => c < 0x20 || (c >= 0x7f && c <= 0x9f) || (c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069)
const stripInvisible = (v: string) => Array.from(v).filter((ch) => !isInvisible(ch.codePointAt(0) ?? 0)).join('')

/** Printable text only, collapsed whitespace, ≤ max chars. */
function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return ''
  return stripInvisible(v)
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/** Keep only the small, known design summary fields (never trust client JSON wholesale). */
function cleanMeta(v: unknown) {
  if (!isRecord(v)) return {}
  const list = (x: unknown, n: number) => (Array.isArray(x) ? x.slice(0, n).map((s) => cleanText(s, 40)).filter(Boolean) : [])
  const stamps = typeof v.stamps === 'number' && Number.isFinite(v.stamps) ? Math.max(0, Math.min(100_000, Math.round(v.stamps))) : 0
  return { blocks: list(v.blocks, 8), dyes: list(v.dyes, 8), ground: cleanText(v.ground, 40), stamps }
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** Validates a PNG (signature + IHDR) and returns its pixel size. */
function pngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 33) return null
  for (let i = 0; i < 8; i++) if (buf[i] !== PNG_SIG[i]) return null
  if (buf.toString('latin1', 12, 16) !== 'IHDR') return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

/** POST /api/prints — body JSON `{ image: 'data:image/png;base64,…', sessionId, displayName?, motif?, meta? }` */
export const submitPrint = route(async (c) => {
  const b = await c.json({ maxBytes: Math.ceil((PRINT_MAX_BYTES * 4) / 3) + 64 * 1024 })
  if (!isRecord(b)) return fail(400, 'Body must be an object')
  const sessionId = typeof b.sessionId === 'string' ? b.sessionId.trim() : ''
  if (!SESSION_RE.test(sessionId)) return fail(400, 'A museum session id is required')
  const image = typeof b.image === 'string' ? b.image : ''
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(image)
  if (!m) return fail(415, 'image must be a PNG data URL')
  const buf = Buffer.from(m[1], 'base64')
  if (buf.length > PRINT_MAX_BYTES) return fail(413, 'Image too large (max 2 MB)')
  const dim = pngSize(buf)
  if (!dim) return fail(415, 'Not a valid PNG image')
  if (dim.width < 64 || dim.height < 64 || dim.width > PRINT_MAX_SIDE || dim.height > PRINT_MAX_SIDE) {
    return fail(400, `Image must be 64–${PRINT_MAX_SIDE} px on each side`)
  }

  if (!perIp(c.ip) || !perSession(sessionId)) return fail(429, 'You have sent several prints already — please wait a few minutes')
  const pending = await c.db.one<{ n: number }>("SELECT COUNT(*) AS n FROM visitor_prints WHERE status = 'pending'")
  if (Number(pending?.n ?? 0) >= MAX_PENDING) return fail(503, 'The wall’s review queue is full right now — please try again later')
  const mine = await c.db.one<{ n: number }>("SELECT COUNT(*) AS n FROM visitor_prints WHERE status = 'pending' AND session_id = $1", [sessionId])
  if (Number(mine?.n ?? 0) >= MAX_PENDING_PER_SESSION) return fail(429, 'Your earlier prints are still waiting for review')

  const user = await c.user()
  const displayName = cleanText(b.displayName, 40)
  const motif = cleanText(b.motif, 40)
  const meta = cleanMeta(b.meta)

  const id = randomUUID()
  const key = `prints/${id}.png`
  const stored = await c.storage.save(key, Readable.from(buf), 'image/png')
  const url = c.storage.urlFor(key)
  const createdAt = nowIso()
  try {
    await c.db.run(
      `INSERT INTO visitor_prints (id, session_id, user_id, display_name, motif, meta, storage_key, url, width, height, size, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', $12)`,
      [id, sessionId, user?.id ?? null, displayName, motif, JSON.stringify(meta), key, url, dim.width, dim.height, stored.size || buf.length, createdAt],
    )
  } catch (err) {
    await c.storage.remove(key).catch(() => undefined)
    throw err
  }
  c.status = 201
  return { id, status: 'pending' as const, createdAt }
})

/** GET /api/prints?status=approved&limit=24 — the Visitors' Wall. */
export const listPrints = route(async (c) => {
  const status = c.url.searchParams.get('status') ?? 'approved'
  if (status !== 'approved') return fail(403, 'Only approved prints are public')
  const limit = Math.max(1, Math.min(PUBLIC_LIMIT, Number(c.url.searchParams.get('limit')) || PUBLIC_LIMIT))
  const rows = await c.db.query<Row>(
    "SELECT * FROM visitor_prints WHERE status = 'approved' ORDER BY reviewed_at DESC, created_at DESC LIMIT $1",
    [limit],
  )
  c.headers.set('cache-control', 'public, max-age=30, stale-while-revalidate=120')
  return rows.map(toPublic)
})

/** GET /api/admin/prints?status=pending|approved|rejected|all */
export const adminListPrints = route(async (c) => {
  await c.requireCurator()
  const status = c.url.searchParams.get('status') ?? 'all'
  if (status !== 'all' && !isStatus(status)) return fail(400, 'Invalid status')
  const rows =
    status === 'all'
      ? await c.db.query<Row>('SELECT * FROM visitor_prints ORDER BY created_at DESC LIMIT 1000')
      : await c.db.query<Row>('SELECT * FROM visitor_prints WHERE status = $1 ORDER BY created_at DESC LIMIT 1000', [status])
  return rows.map(toAdmin)
})

/** PATCH /api/admin/prints/:id — `{ status }` */
export const adminPatchPrint = route<{ id: string }>(async (c) => {
  const user = await c.requireCurator()
  const b = await c.json()
  if (!isRecord(b) || !isStatus(b.status)) return fail(400, "Body must be { status: 'pending' | 'approved' | 'rejected' }")
  const reviewed = b.status === 'pending' ? null : nowIso()
  const n = await c.db.run('UPDATE visitor_prints SET status = $1, reviewed_at = $2, reviewed_by = $3 WHERE id = $4', [
    b.status,
    reviewed,
    reviewed ? user.email : null,
    c.params.id,
  ])
  if (n === 0) return fail(404, 'Print not found')
  const row = await c.db.one<Row>('SELECT * FROM visitor_prints WHERE id = $1', [c.params.id])
  return row ? toAdmin(row) : { ok: true }
})

/** DELETE /api/admin/prints/:id */
export const adminDeletePrint = route<{ id: string }>(async (c) => {
  await c.requireCurator()
  const row = await c.db.one<Row>('SELECT * FROM visitor_prints WHERE id = $1', [c.params.id])
  if (!row) return fail(404, 'Print not found')
  await c.storage.remove(row.storage_key).catch((err: unknown) => console.warn('[museum] print file removal failed:', (err as Error).message))
  await c.db.run('DELETE FROM visitor_prints WHERE id = $1', [c.params.id])
  return { ok: true }
})
