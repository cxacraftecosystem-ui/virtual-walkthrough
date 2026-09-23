import 'server-only'
import type { Param } from '../db'
import { HeatBatch, resolveEventExhibition, summaryExhibition } from './curatorAnalytics'
import { route } from '../http'
import { createRateLimiter, fail, isRecord } from '../util'

const EVENT_TYPES = new Set([
  'session_start',
  'zone_enter',
  'zone_dwell',
  'item_view',
  'item_dwell',
  'panel_open',
  'inspect_open',
  'video_play',
  'tour_start',
  'tour_complete',
  'tour_step',
  'pos', // rolled up into analytics_heat (see curatorAnalytics.ts), never stored raw
])
const MAX_BATCH = 200
/** Per-instance abuse guards; pair with a Vercel Firewall rule on /api/analytics/* for fleet-wide limits. */
const ipLimit = createRateLimiter(120, 60_000)
const sessionLimit = createRateLimiter(20, 60_000)
const SESSION_RE = /^[A-Za-z0-9_-]{8,64}$/
// NUL bytes are rejected by Postgres text columns.
const str = (v: unknown, max = 100): string | null => (typeof v === 'string' && v.length > 0 ? v.split(String.fromCharCode(0)).join('').slice(0, max) || null : null)

/** POST /api/analytics/events — public, batched; accepts application/json and text/plain (navigator.sendBeacon). */
export const postEvents = route(
  async (c) => {
    const db = c.db
    const b = await c.json({ allowText: true })
    if (!isRecord(b)) return fail(400, 'Body must be { sessionId, events }')
    const sessionId = str(b.sessionId)
    if (!sessionId || !SESSION_RE.test(sessionId)) return fail(400, '"sessionId" is required')
    if (!ipLimit(c.ip) || !sessionLimit(sessionId)) return fail(429, 'Too many analytics batches')
    if (!Array.isArray(b.events)) return fail(400, '"events" must be an array')
    if (b.events.length > MAX_BATCH) return fail(413, `Max ${MAX_BATCH} events per batch`)

    const now = Date.now()
    const exhibitionId = await resolveEventExhibition(db, b.exhibition)
    const rows: Param[][] = []
    const heat = new HeatBatch(exhibitionId)
    for (const e of b.events) {
      if (!isRecord(e) || typeof e.type !== 'string' || !EVENT_TYPES.has(e.type)) continue
      const t = typeof e.t === 'number' && Number.isFinite(e.t) ? Math.round(e.t) : now
      if (t > now + 86_400_000 || t < now - 30 * 86_400_000) continue // clock garbage
      if (e.type === 'pos') {
        heat.add(t, e.x, e.z, str(e.zone))
        continue
      }
      const seconds = typeof e.seconds === 'number' && Number.isFinite(e.seconds) ? Math.min(Math.max(e.seconds, 0), 3600) : null
      let meta: string | null = null
      if (e.meta !== undefined && e.meta !== null) {
        const s = JSON.stringify(e.meta).split('\\u0000').join('') // JSON escape of NUL, rejected by Postgres
        if (s.length <= 500) meta = s
      }
      rows.push([sessionId, t, e.type, str(e.zone), str(e.itemKind, 30), str(e.itemId), seconds, str(e.tier, 20), meta, now, exhibitionId])
    }
    if (rows.length) {
      const values = rows.map((_, i) => `(${Array.from({ length: 11 }, (_, j) => `$${i * 11 + j + 1}`).join(', ')})`).join(', ')
      await db.run(
        `INSERT INTO analytics_events (session_id, t, type, zone, item_kind, item_id, seconds, tier, meta, received_at, exhibition_id) VALUES ${values}`,
        rows.flat(),
      )
    }
    const cells = await heat.flush(db)
    c.status = 202
    return { ok: true, accepted: rows.length + cells }
  },
  { crossOrigin: true },
)

/** GET /api/admin/analytics/summary?days=7 */
export const summary = route(async (c) => {
    await c.requireAdmin()
    const db = c.db
    const days = Math.min(Math.max(Math.round(Number(c.url.searchParams.get('days') ?? 7)) || 7, 1), 365)
    const since = Date.now() - days * 86_400_000
    // optional ?exhibition=<id|slug> filter (omitted = all exhibitions)
    const exId = await summaryExhibition(db, c.url.searchParams.get('exhibition'))
    const exWhere = exId ? ' AND exhibition_id = $2' : ''
    const sp = exId ? [since, exId] : [since]
    const dayExpr =
      db.dialect === 'postgres'
        ? `to_char(to_timestamp(t / 1000.0) AT TIME ZONE 'UTC', 'YYYY-MM-DD')`
        : `strftime('%Y-%m-%d', t / 1000, 'unixepoch')`

    const [sessions, avg, zoneDwell, topItems, quality, daily] = await Promise.all([
      db.one<{ n: number }>(`SELECT COUNT(DISTINCT session_id) AS n FROM analytics_events WHERE t >= $1${exWhere}`, sp),
      db.one<{ avg: number | null }>(
        `SELECT AVG(d) AS avg FROM (
           SELECT (MAX(t) - MIN(t)) / 1000.0 AS d FROM analytics_events WHERE t >= $1${exWhere} GROUP BY session_id
         ) s`,
        sp,
      ),
      db.query<{ zone: string; seconds: number }>(
        `SELECT zone, SUM(seconds) AS seconds FROM analytics_events
         WHERE t >= $1${exWhere} AND type = 'zone_dwell' AND zone IS NOT NULL
         GROUP BY zone ORDER BY seconds DESC`,
        sp,
      ),
      db.query<{ itemKind: string; itemId: string; views: number; dwellSec: number }>(
        `SELECT item_kind AS "itemKind", item_id AS "itemId",
                SUM(CASE WHEN type = 'item_view' THEN 1 ELSE 0 END) AS views,
                COALESCE(SUM(CASE WHEN type = 'item_dwell' THEN seconds ELSE 0 END), 0) AS "dwellSec"
         FROM analytics_events
         WHERE t >= $1${exWhere} AND item_kind IS NOT NULL AND item_id IS NOT NULL
         GROUP BY item_kind, item_id
         ORDER BY views DESC, "dwellSec" DESC
         LIMIT 20`,
        sp,
      ),
      db.query<{ tier: string; count: number }>(
        `SELECT tier, COUNT(DISTINCT session_id) AS count FROM analytics_events
         WHERE t >= $1${exWhere} AND tier IS NOT NULL GROUP BY tier ORDER BY count DESC`,
        sp,
      ),
      db.query<{ date: string; sessions: number }>(
        `SELECT ${dayExpr} AS date, COUNT(DISTINCT session_id) AS sessions FROM analytics_events
         WHERE t >= $1${exWhere} GROUP BY 1 ORDER BY 1`,
        sp,
      ),
    ])

    // fill empty days so charts have a continuous axis
    const byDate = new Map(daily.map((d) => [d.date, Number(d.sessions)]))
    const filled: { date: string; sessions: number }[] = []
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10)
      filled.push({ date, sessions: byDate.get(date) ?? 0 })
    }

    const round = (n: unknown) => Math.round(Number(n ?? 0) * 10) / 10
    return {
      days,
      sessions: Number(sessions?.n ?? 0),
      avgSessionSec: round(avg?.avg),
      zoneDwell: zoneDwell.map((z) => ({ zone: z.zone, seconds: round(z.seconds) })),
      topItems: topItems.map((r) => ({ itemKind: r.itemKind, itemId: r.itemId, views: Number(r.views), dwellSec: round(r.dwellSec) })),
      quality: quality.map((q) => ({ tier: q.tier, count: Number(q.count) })),
      daily: filled,
    }
})
