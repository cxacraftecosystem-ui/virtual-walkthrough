import 'server-only'
import { createHash } from 'node:crypto'
import { audit } from '../audit'
import { route } from '../http'
import { siteId } from '../site'
import { createRateLimiter, fail, inList, isRecord, readBulkIds } from '../util'

/**
 * Client error reporting (src/museum/utils/errorReporter.ts → POST /api/errors).
 * PII-free: no IP, no user id, query strings / emails / tokens scrubbed; grouped by fingerprint
 * in `client_error_groups`, raw occurrences in `client_errors` (pruned to 30 days / 50 per group).
 * Per site: the fingerprint hash includes the site, so the same error in both museums is two groups and
 * `client_error_groups.fingerprint` stays the primary key; every query and prune is scoped to this site.
 */

const KINDS = new Set(['error', 'unhandledrejection', 'react', 'webgl', 'manual'])
const ipLimit = createRateLimiter(30, 60_000)
/** Server-side sampling guard (1 = keep all). */
const SAMPLE = process.env.ERROR_SAMPLE_RATE ? Math.min(Math.max(Number(process.env.ERROR_SAMPLE_RATE) || 0, 0), 1) : 1
const RETENTION_MS = 30 * 86_400_000
const PER_GROUP = 50

function scrub(s: string): string {
  return s
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '<email>')
    .replace(/(https?:\/\/[^\s?#)'"]+)[?#][^\s)'":]*/g, '$1')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g, '<jwt>')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '<token>')
}
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? scrub(v).slice(0, max) : null)

/** Group key: site + kind + message with volatile numbers removed + first stack frame (file:line, minus hashes). */
export function fingerprint(kind: string, message: string, stack: string | null, site = siteId()) {
  const norm = message.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase()
  const frame =
    (stack ?? '')
      .split('\n')
      .map((l) => l.trim())
      .find((l) => /^at\s|@|:\d+:\d+/.test(l) && !l.startsWith('---')) ?? ''
  const f = frame.replace(/\?[^:)\s]*/g, '').replace(/[0-9a-f]{8,}/gi, '#').replace(/:\d+(?=\)?$)/, '')
  // hand-block keeps the hash it had before sites existed, so its open groups carry on
  const key = site === 'hand-block' ? `${kind}\n${norm}\n${f}` : `${site}\n${kind}\n${norm}\n${f}`
  return createHash('sha1').update(key).digest('hex').slice(0, 20)
}

let lastPrune = 0

/** POST /api/errors — public; accepts application/json and text/plain (sendBeacon). */
export const postError = route(
  async (c) => {
    if (!ipLimit(c.ip)) fail(429, 'Too many error reports')
    const b = await c.json({ allowText: true, maxBytes: 16 * 1024 })
    if (!isRecord(b)) return fail(400, 'Body must be an error report')
    const kind = typeof b.kind === 'string' && KINDS.has(b.kind) ? b.kind : 'error'
    const message = text(b.message, 500)
    if (!message) return fail(400, '"message" is required')
    c.status = 202
    if (SAMPLE < 1 && Math.random() >= SAMPLE) return { ok: true, sampled: false }

    const stack = text(b.stack, 4000)
    let url = text(b.url, 300)
    if (url) {
      try {
        url = new URL(url, 'http://x').pathname.slice(0, 300)
      } catch {
        url = url.split(/[?#]/)[0]
      }
    }
    const ua = text(b.ua, 300) ?? text(c.req.headers.get('user-agent'), 300)
    const tier = text(b.tier, 20)
    const gpu = text(b.gpu, 200)
    const release = text(b.release, 40)
    const fp = fingerprint(kind, message, stack)
    const now = Date.now()
    const db = c.db
    const site = siteId()

    await db.run(
      `INSERT INTO client_errors (fingerprint, kind, message, stack, url, ua, tier, gpu, release, created_at, site)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [fp, kind, message, stack, url, ua, tier, gpu, release, now, site],
    )
    // resolved group that recurs → reopened (regression)
    await db.run(
      `INSERT INTO client_error_groups (fingerprint, kind, message, count, first_seen, last_seen, resolved_at, last_stack, last_url, last_ua, last_tier, last_gpu, last_release, site)
       VALUES ($1, $2, $3, 1, $4, $4, NULL, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (fingerprint) DO UPDATE SET
         count = client_error_groups.count + 1, last_seen = excluded.last_seen, resolved_at = NULL, message = excluded.message,
         last_stack = excluded.last_stack, last_url = excluded.last_url, last_ua = excluded.last_ua,
         last_tier = excluded.last_tier, last_gpu = excluded.last_gpu, last_release = excluded.last_release`,
      [fp, kind, message, now, stack, url, ua, tier, gpu, release, site],
    )
    if (now - lastPrune > 3_600_000) {
      lastPrune = now
      await db.run('DELETE FROM client_errors WHERE site = $1 AND created_at < $2', [site, now - RETENTION_MS])
      await db.run('DELETE FROM client_error_groups WHERE site = $1 AND last_seen < $2', [site, now - RETENTION_MS])
    }
    // keep at most PER_GROUP raw rows for this group
    await db.run(
      `DELETE FROM client_errors WHERE fingerprint = $1 AND id NOT IN (
         SELECT id FROM client_errors WHERE fingerprint = $1 ORDER BY created_at DESC, id DESC LIMIT ${PER_GROUP})`,
      [fp],
    )
    return { ok: true, fingerprint: fp }
  },
  { crossOrigin: true },
)

interface GroupRow {
  fingerprint: string
  kind: string
  message: string
  count: number
  firstSeen: number
  lastSeen: number
  resolvedAt: number | null
  lastStack: string | null
  lastUrl: string | null
  lastUa: string | null
  lastTier: string | null
  lastGpu: string | null
  lastRelease: string | null
  last24h?: number
}
const GROUP_COLS = `fingerprint, kind, message, count, first_seen AS "firstSeen", last_seen AS "lastSeen", resolved_at AS "resolvedAt",
  last_stack AS "lastStack", last_url AS "lastUrl", last_ua AS "lastUa", last_tier AS "lastTier", last_gpu AS "lastGpu", last_release AS "lastRelease"`
const toGroup = (r: GroupRow) => ({
  ...r,
  count: Number(r.count),
  firstSeen: new Date(Number(r.firstSeen)).toISOString(),
  lastSeen: new Date(Number(r.lastSeen)).toISOString(),
  resolvedAt: r.resolvedAt == null ? null : new Date(Number(r.resolvedAt)).toISOString(),
  ...(r.last24h !== undefined ? { last24h: Number(r.last24h) } : {}),
})
const FP_RE = /^[0-9a-f]{20}$/

/** GET /api/admin/errors?status=open|resolved|all */
export const listErrors = route(async (c) => {
  await c.requireAdmin()
  const status = c.url.searchParams.get('status') ?? 'open'
  const where = status === 'resolved' ? ' AND g.resolved_at IS NOT NULL' : status === 'all' ? '' : ' AND g.resolved_at IS NULL'
  const since = Date.now() - 86_400_000
  const rows = await c.db.query<GroupRow>(
    `SELECT ${GROUP_COLS.replace(/(^|,\s*)(\w+)/g, '$1g.$2')},
       (SELECT COUNT(*) FROM client_errors e WHERE e.fingerprint = g.fingerprint AND e.created_at >= $1) AS "last24h"
     FROM client_error_groups g WHERE g.site = $2${where} ORDER BY g.last_seen DESC LIMIT 500`,
    [since, siteId()],
  )
  const totals = await c.db.one<{ open: number; resolved: number }>(
    `SELECT SUM(CASE WHEN resolved_at IS NULL THEN 1 ELSE 0 END) AS open, SUM(CASE WHEN resolved_at IS NULL THEN 0 ELSE 1 END) AS resolved
     FROM client_error_groups WHERE site = $1`,
    [siteId()],
  )
  return { groups: rows.map(toGroup), open: Number(totals?.open ?? 0), resolved: Number(totals?.resolved ?? 0) }
})

/** GET /api/admin/errors/:fingerprint → group + last 20 occurrences */
export const getError = route<{ fingerprint: string }>(async (c) => {
  await c.requireAdmin()
  const fp = c.params.fingerprint
  if (!FP_RE.test(fp)) fail(404, 'Not found')
  const g = await c.db.one<GroupRow>(`SELECT ${GROUP_COLS} FROM client_error_groups WHERE fingerprint = $1 AND site = $2`, [fp, siteId()])
  if (!g) return fail(404, 'Not found')
  const occ = await c.db.query<{ id: number; url: string | null; ua: string | null; tier: string | null; gpu: string | null; release: string | null; stack: string | null; createdAt: number }>(
    `SELECT id, url, ua, tier, gpu, release, stack, created_at AS "createdAt" FROM client_errors WHERE fingerprint = $1 ORDER BY created_at DESC, id DESC LIMIT 20`,
    [fp],
  )
  return { group: toGroup(g), occurrences: occ.map((o) => ({ ...o, id: Number(o.id), createdAt: new Date(Number(o.createdAt)).toISOString() })) }
})

const short = (m: string) => (m.length > 80 ? `${m.slice(0, 77).trimEnd()}…` : m)

/** PATCH /api/admin/errors/:fingerprint { resolved: boolean } */
export const patchError = route<{ fingerprint: string }>(async (c) => {
  const user = await c.requireAdmin()
  const fp = c.params.fingerprint
  const b = await c.json()
  if (!isRecord(b) || typeof b.resolved !== 'boolean') return fail(400, 'Body must be { resolved: boolean }')
  const resolved = b.resolved
  await c.db.tx(async (q) => {
    const g = await q.one<{ message: string }>('SELECT message FROM client_error_groups WHERE fingerprint = $1 AND site = $2', [fp, siteId()])
    if (!g) return fail(404, 'Not found')
    await q.run('UPDATE client_error_groups SET resolved_at = $1 WHERE fingerprint = $2 AND site = $3', [resolved ? Date.now() : null, fp, siteId()])
    await audit(q, user, { action: resolved ? 'errors.resolve' : 'errors.reopen', targetKind: 'error', targetId: fp, summary: `${resolved ? 'Resolved' : 'Reopened'} error “${short(g.message)}”` })
  })
  return { ok: true }
})

/** DELETE /api/admin/errors/:fingerprint — forget a group and its occurrences */
export const deleteError = route<{ fingerprint: string }>(async (c) => {
  const user = await c.requireAdmin()
  const fp = c.params.fingerprint
  await c.db.tx(async (q) => {
    const g = await q.one<{ message: string }>('SELECT message FROM client_error_groups WHERE fingerprint = $1 AND site = $2', [fp, siteId()])
    if (!g) return fail(404, 'Not found')
    await q.run('DELETE FROM client_errors WHERE fingerprint = $1 AND site = $2', [fp, siteId()])
    await q.run('DELETE FROM client_error_groups WHERE fingerprint = $1 AND site = $2', [fp, siteId()])
    await audit(q, user, { action: 'errors.delete', targetKind: 'error', targetId: fp, summary: `Deleted error “${short(g.message)}” and its reports` })
  })
  return { ok: true }
})

const BULK_VERB: Record<string, string> = { resolve: 'Resolved', reopen: 'Reopened', delete: 'Deleted' }

/** POST /api/admin/errors/bulk — admin. `{ fingerprints: string[] (≤ 200), action: 'resolve' | 'reopen' | 'delete' }` → `{ updated }` */
export const bulkErrors = route(async (c) => {
  const user = await c.requireAdmin()
  const b = await c.json()
  if (!isRecord(b)) return fail(400, "Body must be { fingerprints, action: 'resolve' | 'reopen' | 'delete' }")
  const fps = readBulkIds(b.fingerprints, 'fingerprints', (s) => FP_RE.test(s))
  const action = b.action
  if (typeof action !== 'string' || !Object.hasOwn(BULK_VERB, action)) return fail(400, '"action" must be resolve, reopen or delete')
  const site = siteId()
  const updated = await c.db.tx(async (q) => {
    let n: number
    if (action === 'delete') {
      await q.run(`DELETE FROM client_errors WHERE site = $1 AND fingerprint IN (${inList(fps, 1)})`, [site, ...fps])
      n = await q.run(`DELETE FROM client_error_groups WHERE site = $1 AND fingerprint IN (${inList(fps, 1)})`, [site, ...fps])
    } else {
      n = await q.run(`UPDATE client_error_groups SET resolved_at = $1 WHERE site = $2 AND fingerprint IN (${inList(fps, 2)})`, [action === 'resolve' ? Date.now() : null, site, ...fps])
    }
    if (n) {
      await audit(q, user, {
        action: 'errors.bulk',
        targetKind: 'error',
        targetId: fps.length === 1 ? fps[0] : '',
        summary: `${BULK_VERB[action]} ${n} error group${n === 1 ? '' : 's'}`,
        detail: { action, fingerprints: fps },
      })
    }
    return n
  })
  return { updated }
})
