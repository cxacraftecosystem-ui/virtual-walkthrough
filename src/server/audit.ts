/**
 * The activity log (audit_log): one row per change made through the admin — who, what, when, and a line a
 * person can read. Every mutating admin handler writes one, inside its own transaction when it has one, so
 * a change and its log row stand or fall together. Rows are per site; the admin's Activity page and the
 * dashboard read them (GET /api/admin/activity, GET /api/admin/overview). A change to something both sites
 * share (accounts' roles, the access list) is logged under SHARED_SITE and shows in both sites' logs.
 *
 * Who reads what: the log never shows a reader more than the admin pages they may open. Curators see the
 * changes to what they edit (content, exhibitions, makers, media, prints); admins everything but the access
 * list, which only master admins see (CURATOR_LOG_KINDS, MASTER_LOG_KINDS). Summaries name no visitor-written text.
 */
import 'server-only'
import type { Role } from './auth'
import { COLLECTIONS } from './contentStore'
import { nowIso, type Param, parseJson, type Queryable } from './db'
import { siteId } from './site'

/** `site` of an audit row about something both sites share (users' roles, the access list). */
export const SHARED_SITE = 'shared'

/** Who made a change: the signed-in user, or null for a scheduled job. */
export interface Actor {
  id: string
  email: string
  role: string
}

export interface AuditInput {
  /** '<area>.<verb>', e.g. 'content.update', 'exhibition.delete', 'prints.bulk'. */
  action: string
  targetKind: string
  targetId: string
  exhibitionId?: string | null
  /** One line for people ("Saved artwork “Ajrakh yardage”"). */
  summary: string
  /** Anything a later reader may need (ids of a bulk action, the old and new role…). Kept small. */
  detail?: unknown
  /** The change applies to both sites (users, the access list): logged under SHARED_SITE. */
  shared?: boolean
}

export interface AuditEntry {
  id: number
  at: string
  actorEmail: string | null
  actorRole: string | null
  action: string
  targetKind: string
  targetId: string
  exhibitionId: string | null
  summary: string
}

interface AuditRow {
  id: number
  at: string
  actor_email: string | null
  actor_role: string | null
  action: string
  target_kind: string
  target_id: string
  exhibition_id: string | null
  summary: string
  detail?: unknown
}

const toEntry = (r: AuditRow): AuditEntry => ({
  id: Number(r.id),
  at: r.at,
  actorEmail: r.actor_email,
  actorRole: r.actor_role,
  action: r.action,
  targetKind: r.target_kind,
  targetId: r.target_id,
  exhibitionId: r.exhibition_id,
  summary: r.summary,
})

const DETAIL_MAX = 8000

/** Write one audit row for the current site. */
export async function audit(q: Queryable, actor: Actor | null, e: AuditInput): Promise<void> {
  let detail: string | null = null
  if (e.detail !== undefined && e.detail !== null) {
    const s = JSON.stringify(e.detail)
    detail = s.length <= DETAIL_MAX ? s : JSON.stringify({ truncated: true })
  }
  await q.run(
    `INSERT INTO audit_log (site, at, actor_id, actor_email, actor_role, action, target_kind, target_id, exhibition_id, summary, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      e.shared ? SHARED_SITE : siteId(),
      nowIso(),
      actor?.id ?? null,
      actor?.email ?? null,
      actor?.role ?? null,
      e.action.slice(0, 60),
      e.targetKind.slice(0, 40),
      e.targetId.slice(0, 200),
      e.exhibitionId ?? null,
      e.summary.slice(0, 300),
      detail,
    ],
  )
}

/** The target kinds a curator reads in the log: what curators can change themselves. */
export const CURATOR_LOG_KINDS: readonly string[] = ['exhibition', 'artisan', 'media', 'print', ...COLLECTIONS]
/** The target kinds only master admins read: the access list (GET /api/admin/access is theirs alone). */
export const MASTER_LOG_KINDS: readonly string[] = ['access']

export interface AuditQuery {
  /** The reader's role: rows about areas above it are left out (CURATOR_LOG_KINDS, MASTER_LOG_KINDS). Below curator: nothing. */
  role: Role
  limit?: number
  /** Only rows older than this id (the previous page's `nextBefore`). */
  before?: number | null
  /** '<kind>:<id>' — one target's history; '<kind>' alone — every target of that kind. */
  target?: string | null
  exhibitionId?: string | null
}

/** The current site's activity (and the shared rows), newest first, as far as `opts.role` may read it. */
export async function listAudit(q: Queryable, opts: AuditQuery): Promise<{ entries: AuditEntry[]; nextBefore: number | null }> {
  const limit = Math.max(1, Math.min(200, Math.round(opts.limit ?? 50) || 50))
  if (opts.role !== 'curator' && opts.role !== 'admin' && opts.role !== 'master') return { entries: [], nextBefore: null }
  const where = [`site IN ($1, '${SHARED_SITE}')`]
  const params: Param[] = [siteId()]
  const add = (sql: string, v: Param) => {
    params.push(v)
    where.push(sql.replace('?', `$${params.length}`))
  }
  const kinds = (op: 'IN' | 'NOT IN', list: readonly string[]) => {
    const marks = list.map((k) => {
      params.push(k)
      return `$${params.length}`
    })
    where.push(`target_kind ${op} (${marks.join(', ')})`)
  }
  if (opts.role === 'curator') kinds('IN', CURATOR_LOG_KINDS)
  else if (opts.role === 'admin') kinds('NOT IN', MASTER_LOG_KINDS)
  if (opts.before) add('id < ?', opts.before)
  if (opts.target) {
    const i = opts.target.indexOf(':')
    if (i < 0) add('target_kind = ?', opts.target)
    else {
      add('target_kind = ?', opts.target.slice(0, i))
      add('target_id = ?', opts.target.slice(i + 1))
    }
  }
  if (opts.exhibitionId) add('exhibition_id = ?', opts.exhibitionId)
  const rows = await q.query<AuditRow>(
    `SELECT id, at, actor_email, actor_role, action, target_kind, target_id, exhibition_id, summary
     FROM audit_log WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ${limit + 1}`,
    params,
  )
  const more = rows.length > limit
  const entries = rows.slice(0, limit).map(toEntry)
  return { entries, nextBefore: more ? entries[entries.length - 1].id : null }
}

/** A row's `detail`, parsed (tests and future readers). */
export async function auditDetail(q: Queryable, id: number): Promise<unknown> {
  const r = await q.one<{ detail: unknown }>(`SELECT detail FROM audit_log WHERE id = $1 AND site IN ($2, '${SHARED_SITE}')`, [id, siteId()])
  return r?.detail == null ? null : parseJson<unknown>(r.detail)
}
