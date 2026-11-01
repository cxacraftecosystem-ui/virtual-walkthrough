/**
 * The admin dashboard and the activity log (curator+), both scoped to this site:
 *
 *   GET /api/admin/overview[?exhibition=]  counts for the work waiting + the latest activity
 *   GET /api/admin/activity?limit=&before=&target=<kind>:<id>&exhibition=   the activity log, newest first
 */
import 'server-only'
import { listAudit } from '../audit'
import { hasRole } from '../auth'
import { findExhibition } from '../contentStore'
import { parseJson } from '../db'
import { route } from '../http'
import { siteId } from '../site'
import { fail } from '../util'
import { adminExhibition } from './content'

const DAY_MS = 86_400_000

/** GET /api/admin/overview[?exhibition=] — curator+. Error and user counts are null below admin. */
export const overview = route(async (c) => {
  const user = await c.requireCurator()
  const ex = await adminExhibition(c)
  const site = siteId()
  const admin = hasRole(user.role, 'admin')
  const n = async (sql: string, params: (string | number)[]) => Number((await c.db.one<{ n: number }>(sql, params))?.n ?? 0)
  const [pendingPrints, comments7d, hiddenComments, openErrors, errors24h, users, items, recent] = await Promise.all([
    n("SELECT COUNT(*) AS n FROM visitor_prints WHERE site = $1 AND status = 'pending'", [site]),
    n('SELECT COUNT(*) AS n FROM comments WHERE site = $1 AND created_at >= $2', [site, new Date(Date.now() - 7 * DAY_MS).toISOString()]),
    n('SELECT COUNT(*) AS n FROM comments WHERE site = $1 AND hidden = 1', [site]),
    admin ? n('SELECT COUNT(*) AS n FROM client_error_groups WHERE site = $1 AND resolved_at IS NULL', [site]) : null,
    admin ? n('SELECT COUNT(*) AS n FROM client_errors WHERE site = $1 AND created_at >= $2', [site, Date.now() - DAY_MS]) : null,
    admin ? n('SELECT COUNT(*) AS n FROM users', []) : null,
    c.db.query<{ json: unknown }>('SELECT json FROM content_items WHERE exhibition_id = $1', [ex.id]),
    listAudit(c.db, { role: user.role, limit: 12 }),
  ])
  // `placeholder: true` items are stand-ins the workshop has not confirmed yet (silent to visitors)
  const placeholders = items.filter((r) => parseJson<{ placeholder?: unknown }>(r.json).placeholder === true).length
  return {
    role: user.role,
    site,
    counts: { pendingPrints, comments7d, hiddenComments, openErrors, errors24h, users, placeholders, items: items.length },
    exhibition: { id: ex.id, title: ex.title, status: ex.status },
    recent: recent.entries,
  }
})

/**
 * GET /api/admin/activity — curator+; each reader sees the entries their role may (audit.ts LOG_KINDS). `limit` (1–200, default 50), `before` (an entry id: the previous page's
 * `nextBefore`), `target` ('<kind>:<id>' or '<kind>'), `exhibition` (id) → `{ entries, nextBefore }`.
 */
export const activity = route(async (c) => {
  const user = await c.requireCurator()
  const sp = c.url.searchParams
  const before = sp.get('before')
  const beforeId = before ? Number(before) : null
  if (beforeId !== null && (!Number.isInteger(beforeId) || beforeId < 1)) return fail(400, '"before" must be an entry id')
  const exParam = sp.get('exhibition') // an id or slug; a deleted exhibition's id still filters its old entries
  const target = sp.get('target')
  if (target && target.length > 300) return fail(400, '"target" is too long')
  return listAudit(c.db, {
    role: user.role,
    limit: Number(sp.get('limit')) || 50,
    before: beforeId,
    target: target || null,
    exhibitionId: exParam ? ((await findExhibition(c.db, exParam))?.id ?? exParam) : null,
  })
})
