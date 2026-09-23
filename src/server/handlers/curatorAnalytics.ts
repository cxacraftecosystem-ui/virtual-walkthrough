/**
 * Curator analytics: floor-plan heatmap, tour funnel, attention ranking, CSV export and the
 * retention / cleanup job. Everything is per exhibition and anonymous (random session ids only).
 *
 *  - 'pos' events (visitor position sampled every 2 s by the tracker) are NOT stored raw: they are
 *    aggregated on insert into `analytics_heat` (0.5 m cells per exhibition / UTC day / zone).
 *  - 'tour_step' events: `itemId` = tour stop id, `meta.index` = stop index.
 *  - Retention: meta 'analytics_retention_days' (default 180). Rows older than that are deleted by
 *    POST /api/admin/analytics/cleanup (admin, or `Authorization: Bearer $CRON_SECRET` for a
 *    scheduled job) and automatically at most once a day from the ingestion endpoint.
 */
import 'server-only'
import { DEFAULT_EXHIBITION_ID, defaultExhibitionRow, findExhibition, getMeta, setMeta } from '../contentStore'
import { type Db, nowIso, type Param } from '../db'
import { type Call, route } from '../http'
import { after } from 'next/server'
import { fail, isRecord } from '../util'

export const HEAT_CELL_M = 0.5
export const POS_SAMPLE_SEC = 2
export const DEFAULT_RETENTION_DAYS = 180
const COORD_LIMIT = 100 // metres; the building spans roughly ±35 m
const DAY_MS = 86_400_000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/* ------------------------------------------------------------------ */
/* Ingestion helpers (used by analytics.ts → postEvents)               */
/* ------------------------------------------------------------------ */

const exCache = new Map<string, { id: string; at: number }>()

/** Exhibition id for an ingestion batch (`exhibition` slug/id in the body); unknown/absent → default. */
export async function resolveEventExhibition(db: Db, v: unknown): Promise<string> {
  const key = typeof v === 'string' && v.length <= 100 ? v : ''
  const hit = exCache.get(key)
  if (hit && Date.now() - hit.at < 60_000) return hit.id
  const row = key ? ((await findExhibition(db, key)) ?? (await defaultExhibitionRow(db))) : await defaultExhibitionRow(db)
  const id = row?.id ?? DEFAULT_EXHIBITION_ID
  if (exCache.size > 500) exCache.clear()
  exCache.set(key, { id, at: Date.now() })
  return id
}

/** Collects 'pos' samples of one batch and upserts them into analytics_heat in one statement. */
export class HeatBatch {
  private readonly cells = new Map<string, { day: string; zone: string; cx: number; cz: number; n: number }>()
  constructor(private readonly exhibitionId: string) {}

  add(t: number, x: unknown, z: unknown, zone: string | null) {
    if (typeof x !== 'number' || typeof z !== 'number' || !Number.isFinite(x) || !Number.isFinite(z)) return
    if (Math.abs(x) > COORD_LIMIT || Math.abs(z) > COORD_LIMIT) return
    const day = new Date(t).toISOString().slice(0, 10)
    const cx = Math.floor(x / HEAT_CELL_M)
    const cz = Math.floor(z / HEAT_CELL_M)
    const zn = (zone ?? '').slice(0, 40)
    const k = `${day}|${zn}|${cx}|${cz}`
    const c = this.cells.get(k)
    if (c) c.n++
    else this.cells.set(k, { day, zone: zn, cx, cz, n: 1 })
  }

  /** Returns the number of samples written. */
  async flush(db: Db): Promise<number> {
    if (!this.cells.size) return 0
    const list = [...this.cells.values()]
    const params: Param[] = []
    const values = list.map((c) => {
      params.push(this.exhibitionId, c.day, c.zone, c.cx, c.cz, c.n)
      const b = params.length - 6
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`
    })
    // keys are unique within the statement (aggregated above), as Postgres requires
    await db.run(
      `INSERT INTO analytics_heat (exhibition_id, day, zone, cx, cz, samples) VALUES ${values.join(', ')}
       ON CONFLICT (exhibition_id, day, zone, cx, cz) DO UPDATE SET samples = analytics_heat.samples + excluded.samples`,
      params,
    )
    // after(): keeps the function alive until cleanup finishes (a bare promise can be frozen mid-query)
    after(() => maybeAutoCleanup(db))
    return list.reduce((s, c) => s + c.n, 0)
  }
}

/** `?exhibition=` for the summary: null = all exhibitions. */
export async function summaryExhibition(db: Db, v: string | null): Promise<string | null> {
  if (!v) return null
  const row = await findExhibition(db, v)
  return row?.id ?? fail(404, 'Exhibition not found')
}

/* ------------------------------------------------------------------ */
/* Query parameters                                                    */
/* ------------------------------------------------------------------ */

interface Range {
  exhibitionId: string
  from: string
  to: string
  fromMs: number
  /** exclusive */
  toMs: number
}

async function readRange<P>(c: Call<P>): Promise<Range> {
  const sp = c.url.searchParams
  const row = await findExhibition(c.db, sp.get('exhibition'))
  if (!row) return fail(404, 'Exhibition not found')
  const today = new Date().toISOString().slice(0, 10)
  const to = sp.get('to') || today
  const from = sp.get('from') || new Date(Date.parse(to) - 29 * DAY_MS).toISOString().slice(0, 10)
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    return fail(400, '"from" / "to" must be YYYY-MM-DD')
  }
  const fromMs = Date.parse(`${from}T00:00:00Z`)
  const toMs = Date.parse(`${to}T00:00:00Z`) + DAY_MS
  if (toMs <= fromMs) return fail(400, '"from" must not be after "to"')
  if (toMs - fromMs > 400 * DAY_MS) return fail(400, 'Date range too long (max 400 days)')
  return { exhibitionId: row.id, from, to, fromMs, toMs }
}

const round1 = (n: unknown) => Math.round(Number(n ?? 0) * 10) / 10

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

async function heatmap(db: Db, r: Range, zone: string | null) {
  const zoneWhere = zone ? ' AND zone = $4' : ''
  const params: Param[] = zone ? [r.exhibitionId, r.from, r.to, zone] : [r.exhibitionId, r.from, r.to]
  const [cells, zones] = await Promise.all([
    db.query<{ cx: number; cz: number; n: number }>(
      `SELECT cx, cz, SUM(samples) AS n FROM analytics_heat
       WHERE exhibition_id = $1 AND day >= $2 AND day <= $3${zoneWhere}
       GROUP BY cx, cz`,
      params,
    ),
    db.query<{ zone: string; n: number }>(
      `SELECT zone, SUM(samples) AS n FROM analytics_heat
       WHERE exhibition_id = $1 AND day >= $2 AND day <= $3
       GROUP BY zone ORDER BY n DESC`,
      [r.exhibitionId, r.from, r.to],
    ),
  ])
  const list = cells.map((c) => [Number(c.cx), Number(c.cz), Number(c.n)] as [number, number, number])
  return {
    exhibition: r.exhibitionId,
    from: r.from,
    to: r.to,
    zone: zone ?? null,
    cellSize: HEAT_CELL_M,
    sampleSec: POS_SAMPLE_SEC,
    /** [cx, cz, samples] — the cell covers x ∈ [cx·0.5, cx·0.5 + 0.5), z likewise. */
    cells: list,
    totalSamples: list.reduce((s, c) => s + c[2], 0),
    maxSamples: list.reduce((m, c) => Math.max(m, c[2]), 0),
    zones: zones.map((z) => ({ zone: z.zone, samples: Number(z.n), seconds: Number(z.n) * POS_SAMPLE_SEC })),
  }
}

async function funnel(db: Db, r: Range) {
  const idx = db.dialect === 'postgres' ? `CASE WHEN meta->>'index' ~ '^[0-9]{1,6}$' THEN (meta->>'index')::int END` : `CAST(json_extract(meta, '$.index') AS INTEGER)`
  const base = [r.exhibitionId, r.fromMs, r.toMs]
  const [steps, ends] = await Promise.all([
    db.query<{ stopId: string; idx: number | null; sessions: number }>(
      `SELECT item_id AS "stopId", MIN(${idx}) AS idx, COUNT(DISTINCT session_id) AS sessions
       FROM analytics_events
       WHERE type = 'tour_step' AND exhibition_id = $1 AND t >= $2 AND t < $3 AND item_id IS NOT NULL
       GROUP BY item_id`,
      base,
    ),
    db.query<{ type: string; sessions: number }>(
      `SELECT type, COUNT(DISTINCT session_id) AS sessions FROM analytics_events
       WHERE type IN ('tour_start', 'tour_complete') AND exhibition_id = $1 AND t >= $2 AND t < $3
       GROUP BY type`,
      base,
    ),
  ])
  const n = (t: string) => Number(ends.find((e) => e.type === t)?.sessions ?? 0)
  const list = steps
    .map((s) => ({ stopId: s.stopId, index: s.idx === null ? 9999 : Number(s.idx), sessions: Number(s.sessions) }))
    .sort((a, b) => a.index - b.index)
  return { starts: n('tour_start'), completes: n('tour_complete'), steps: list }
}

async function attention(db: Db, r: Range, kind: string | null) {
  const kinds = ['artwork', 'exhibit', 'object', 'infographic', 'video']
  if (kind && !kinds.includes(kind)) return fail(400, `"kind" must be one of ${kinds.join(', ')}`)
  const kindWhere = kind ? ' AND item_kind = $4' : ` AND item_kind IN (${kinds.map((k) => `'${k}'`).join(', ')})`
  const params: Param[] = kind ? [r.exhibitionId, r.fromMs, r.toMs, kind] : [r.exhibitionId, r.fromMs, r.toMs]
  const rows = await db.query<{ itemKind: string; itemId: string; views: number; viewers: number; dwellSec: number }>(
    `SELECT item_kind AS "itemKind", item_id AS "itemId",
            SUM(CASE WHEN type = 'item_view' THEN 1 ELSE 0 END) AS views,
            COUNT(DISTINCT session_id) AS viewers,
            COALESCE(SUM(CASE WHEN type = 'item_dwell' THEN seconds ELSE 0 END), 0) AS "dwellSec"
     FROM analytics_events
     WHERE exhibition_id = $1 AND t >= $2 AND t < $3 AND item_id IS NOT NULL
       AND type IN ('item_view', 'item_dwell', 'panel_open', 'inspect_open')${kindWhere}
     GROUP BY item_kind, item_id
     ORDER BY "dwellSec" DESC, views DESC
     LIMIT 200`,
    params,
  )
  return rows.map((x) => {
    const viewers = Number(x.viewers)
    return {
      itemKind: x.itemKind,
      itemId: x.itemId,
      views: Number(x.views),
      viewers,
      dwellSec: round1(x.dwellSec),
      avgDwellSec: viewers ? round1(Number(x.dwellSec) / viewers) : 0,
    }
  })
}

/* ------------------------------------------------------------------ */
/* Endpoints (role ≥ admin, like the rest of analytics)                */
/* ------------------------------------------------------------------ */

/** GET /api/admin/analytics/heatmap?exhibition=&from=&to=&zone= */
export const heatmapRoute = route(async (c) => {
  await c.requireAdmin()
  return heatmap(c.db, await readRange(c), c.url.searchParams.get('zone') || null)
})

/** GET /api/admin/analytics/curator?exhibition=&from=&to=&kind= → { funnel, attention } */
export const curatorRoute = route(async (c) => {
  await c.requireAdmin()
  const r = await readRange(c)
  const [f, a] = await Promise.all([funnel(c.db, r), attention(c.db, r, c.url.searchParams.get('kind') || null)])
  return { exhibition: r.exhibitionId, from: r.from, to: r.to, funnel: f, attention: a }
})

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v)
  // quote + neutralise spreadsheet formula injection
  const safe = typeof v === 'string' && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}
const toCsv = (header: string[], rows: unknown[][]) => [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'

/** GET /api/admin/analytics/export?dataset=heatmap|zones|attention|funnel&exhibition=&from=&to=&zone=&kind= → text/csv */
export const exportRoute = route(async (c) => {
  await c.requireAdmin()
  const r = await readRange(c)
  const dataset = c.url.searchParams.get('dataset') ?? 'attention'
  let csv: string
  if (dataset === 'heatmap' || dataset === 'zones') {
    const h = await heatmap(c.db, r, c.url.searchParams.get('zone') || null)
    csv =
      dataset === 'heatmap'
        ? toCsv(
            ['cell_x', 'cell_z', 'x_min_m', 'z_min_m', 'samples', 'seconds'],
            h.cells.map(([cx, cz, n]) => [cx, cz, cx * HEAT_CELL_M, cz * HEAT_CELL_M, n, n * POS_SAMPLE_SEC]),
          )
        : toCsv(['zone', 'samples', 'seconds'], h.zones.map((z) => [z.zone, z.samples, z.seconds]))
  } else if (dataset === 'attention') {
    const a = await attention(c.db, r, c.url.searchParams.get('kind') || null)
    csv = toCsv(['item_kind', 'item_id', 'views', 'viewers', 'dwell_sec', 'avg_dwell_sec'], a.map((x) => [x.itemKind, x.itemId, x.views, x.viewers, x.dwellSec, x.avgDwellSec]))
  } else if (dataset === 'funnel') {
    const f = await funnel(c.db, r)
    csv = toCsv(
      ['step', 'stop_id', 'sessions', 'share_of_starts'],
      [
        ['start', '', f.starts, f.starts ? 1 : ''],
        ...f.steps.map((s) => [s.index, s.stopId, s.sessions, f.starts ? Math.round((s.sessions / f.starts) * 1000) / 1000 : '']),
        ['complete', '', f.completes, f.starts ? Math.round((f.completes / f.starts) * 1000) / 1000 : ''],
      ],
    )
  } else {
    return fail(400, '"dataset" must be heatmap, zones, attention or funnel')
  }
  const name = `museum-${dataset}-${r.exhibitionId}-${r.from}_${r.to}.csv`
  return new Response('﻿' + csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${name}"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
})

/* ------------------------------------------------------------------ */
/* Retention                                                           */
/* ------------------------------------------------------------------ */

export async function retentionDays(db: Db): Promise<number> {
  const v = Number(await getMeta(db, 'analytics_retention_days'))
  return Number.isFinite(v) && v >= 1 ? Math.round(v) : DEFAULT_RETENTION_DAYS
}

export async function cleanupAnalytics(db: Db) {
  const days = await retentionDays(db)
  const cutoffMs = Date.now() - days * DAY_MS
  const cutoffDay = new Date(cutoffMs).toISOString().slice(0, 10)
  const events = await db.run('DELETE FROM analytics_events WHERE t < $1', [cutoffMs])
  const heat = await db.run('DELETE FROM analytics_heat WHERE day < $1', [cutoffDay])
  const result = { retentionDays: days, cutoff: new Date(cutoffMs).toISOString(), deletedEvents: events, deletedHeatRows: heat, ranAt: nowIso() }
  await setMeta(db, 'analytics_last_cleanup', JSON.stringify(result))
  return result
}

const g = globalThis as { __museumAnalyticsCleanupAt?: number }
/** At most once per day per process (and per DB via meta), fire-and-forget from ingestion. */
async function maybeAutoCleanup(db: Db) {
  try {
    const now = Date.now()
    if (g.__museumAnalyticsCleanupAt && now - g.__museumAnalyticsCleanupAt < DAY_MS) return
    g.__museumAnalyticsCleanupAt = now
    const last = await getMeta(db, 'analytics_last_cleanup')
    const at = last ? Date.parse((JSON.parse(last) as { ranAt?: string }).ranAt ?? '') : 0
    if (at && now - at < DAY_MS) return
    await cleanupAnalytics(db)
  } catch (err) {
    console.error('[museum] analytics auto-cleanup failed:', (err as Error).message)
  }
}

async function retentionInfo(db: Db) {
  const last = await getMeta(db, 'analytics_last_cleanup')
  return { days: await retentionDays(db), defaultDays: DEFAULT_RETENTION_DAYS, lastCleanup: last ? JSON.parse(last) : null }
}

/** GET /api/admin/analytics/retention — admin. */
export const getRetention = route(async (c) => {
  await c.requireAdmin()
  return retentionInfo(c.db)
})

/** PUT /api/admin/analytics/retention — admin. `{ days: 7–1825 }` */
export const putRetention = route(async (c) => {
  await c.requireAdmin()
  const b = await c.json()
  if (!isRecord(b) || typeof b.days !== 'number' || !Number.isInteger(b.days) || b.days < 7 || b.days > 1825) {
    return fail(400, '"days" must be an integer between 7 and 1825')
  }
  await setMeta(c.db, 'analytics_retention_days', String(b.days))
  return retentionInfo(c.db)
})

/**
 * POST /api/admin/analytics/cleanup — admin, or a scheduler sending `Authorization: Bearer $CRON_SECRET`
 * (GET is accepted too for the bearer case, e.g. a Vercel Cron Job).
 */
export const cleanupRoute = route(async (c) => {
  const secret = process.env.CRON_SECRET ?? ''
  const auth = c.req.headers.get('authorization') ?? ''
  if (!(secret && auth === `Bearer ${secret}`)) {
    if (c.req.method === 'GET') return fail(401, 'Bearer token required')
    await c.requireAdmin()
  }
  return cleanupAnalytics(c.db)
})
