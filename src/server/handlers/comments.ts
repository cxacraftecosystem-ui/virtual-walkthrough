/**
 * Visitor comments and the guestbook. Comments belong to the site they were written in (comments.site):
 * each museum lists and moderates only its own; accounts are shared.
 */
import 'server-only'
import { randomUUID } from 'node:crypto'
import { audit } from '../audit'
import { nowIso } from '../db'
import { route } from '../http'
import { siteId } from '../site'
import { createRateLimiter, fail, ID_RE, inList, isItemKind, isRecord, readBulkIds } from '../util'

const commentLimit = createRateLimiter(5, 60_000) // 5 per minute per user

interface Row {
  id: string
  item_kind: string
  item_id: string
  body: string
  hidden: number
  created_at: string
  display_name: string
  email?: string
  user_id?: string
}

/** Guestbook entries are stored with empty item_kind/item_id and returned as null. */
const toComment = (r: Row) => ({
  id: r.id,
  itemKind: r.item_kind || null,
  itemId: r.item_id || null,
  body: r.body,
  displayName: r.display_name,
  createdAt: r.created_at,
})

/** GET /api/comments?itemKind=&itemId= */
export const listComments = route(async (c) => {
  const kind = c.url.searchParams.get('itemKind') ?? ''
  const id = c.url.searchParams.get('itemId') ?? ''
  if (Boolean(kind) !== Boolean(id)) return fail(400, 'Pass both itemKind and itemId, or neither for the guestbook')
  if (kind && !isItemKind(kind)) return fail(400, 'Invalid itemKind')
  const rows = await c.db.query<Row>(
    `SELECT c.*, u.display_name FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.site = $3 AND c.item_kind = $1 AND c.item_id = $2 AND c.hidden = 0
     ORDER BY c.created_at DESC LIMIT 200`,
    [kind, id, siteId()],
  )
  return rows.map(toComment)
})

/** POST /api/comments */
export const postComment = route(async (c) => {
  const user = await c.requireUser()
  const b = await c.json()
  if (!isRecord(b)) return fail(400, 'Body must be an object')
  const kind = b.itemKind ?? ''
  const id = b.itemId ?? ''
  if (typeof kind !== 'string' || typeof id !== 'string') return fail(400, 'itemKind/itemId must be strings')
  if (Boolean(kind) !== Boolean(id)) return fail(400, 'Pass both itemKind and itemId, or neither for the guestbook')
  if (kind && !isItemKind(kind)) return fail(400, 'Invalid itemKind')
  if (id && !ID_RE.test(id)) return fail(400, 'Invalid itemId')
  const body = typeof b.body === 'string' ? b.body.trim() : ''
  if (body.length < 1 || body.length > 1000) return fail(400, 'Comment must be 1–1000 characters')
  if (!commentLimit(user.id)) return fail(429, 'You are commenting too fast, please wait a minute')
  // Password accounts are not email-verified: their posts wait for moderation (anti-spam).
  const v = await c.db.one<{ email_verified: number }>('SELECT email_verified FROM users WHERE id = $1', [user.id])
  const hidden = user.role === 'visitor' && !Number(v?.email_verified) ? 1 : 0
  const row: Row = { id: randomUUID(), item_kind: kind, item_id: id, body, hidden, created_at: nowIso(), display_name: user.displayName }
  // The id is minted just above, so only a second run of this same statement can conflict with it, and
  // that must store nothing rather than report a saved comment as failed (23505). Nothing sends a write
  // twice today (db/postgres.ts retries reads only); this keeps a repeat harmless if anything ever does.
  await c.db.run(
    `INSERT INTO comments (id, user_id, item_kind, item_id, body, hidden, created_at, site) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO NOTHING`,
    [row.id, user.id, kind, id, body, hidden, row.created_at, siteId()],
  )
  c.status = 201
  return { ...toComment(row), pending: hidden === 1 }
})

/** GET /api/admin/comments */
export const adminListComments = route(async (c) => {
  await c.requireAdmin()
  const rows = await c.db.query<Row>(
    `SELECT c.*, u.display_name, u.email FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.site = $1 ORDER BY c.created_at DESC LIMIT 2000`,
    [siteId()],
  )
  return rows.map((r) => ({ ...toComment(r), hidden: Number(r.hidden) === 1, userId: r.user_id, userEmail: r.email }))
})

/**
 * What the activity log keeps of a comment: never its words (a visitor's text, maybe personal, must go when
 * the comment goes; audit rows are never purged), only its length. No hash either: a short text (a phone
 * number, an email) is recovered from an unsalted hash by trying candidates.
 */
const commentTrace = (body: string) => ({ length: body.length })
const where = (r: Pick<Row, 'item_kind' | 'item_id'>) => (r.item_kind ? `on ${r.item_kind} “${r.item_id}”` : 'in the guestbook')

/** PATCH /api/admin/comments/:id */
export const adminPatchComment = route<{ id: string }>(async (c) => {
  const user = await c.requireAdmin()
  const b = await c.json()
  if (!isRecord(b) || typeof b.hidden !== 'boolean') return fail(400, 'Body must be { hidden: boolean }')
  const hidden = b.hidden
  await c.db.tx(async (q) => {
    const row = await q.one<Row>('SELECT * FROM comments WHERE id = $1 AND site = $2', [c.params.id, siteId()])
    if (!row) return fail(404, 'Comment not found')
    await q.run('UPDATE comments SET hidden = $1 WHERE id = $2 AND site = $3', [hidden ? 1 : 0, c.params.id, siteId()])
    await audit(q, user, {
      action: hidden ? 'comments.hide' : 'comments.unhide',
      targetKind: 'comment',
      targetId: c.params.id,
      summary: `${hidden ? 'Hid' : 'Showed'} a comment ${where(row)}`,
      detail: commentTrace(row.body),
    })
  })
  return { ok: true }
})

/** DELETE /api/admin/comments/:id */
export const adminDeleteComment = route<{ id: string }>(async (c) => {
  const user = await c.requireAdmin()
  await c.db.tx(async (q) => {
    const row = await q.one<Row>('SELECT * FROM comments WHERE id = $1 AND site = $2', [c.params.id, siteId()])
    if (!row) return fail(404, 'Comment not found')
    await q.run('DELETE FROM comments WHERE id = $1 AND site = $2', [c.params.id, siteId()])
    await audit(q, user, { action: 'comments.delete', targetKind: 'comment', targetId: c.params.id, summary: `Deleted a comment ${where(row)}`, detail: commentTrace(row.body) })
  })
  return { ok: true }
})

const BULK_VERB: Record<string, string> = { hide: 'Hid', unhide: 'Showed', delete: 'Deleted' }

/** POST /api/admin/comments/bulk — admin. `{ ids: string[] (≤ 200), action: 'hide' | 'unhide' | 'delete' }` → `{ updated }` */
export const adminBulkComments = route(async (c) => {
  const user = await c.requireAdmin()
  const b = await c.json()
  if (!isRecord(b)) return fail(400, "Body must be { ids, action: 'hide' | 'unhide' | 'delete' }")
  const ids = readBulkIds(b.ids)
  const action = b.action
  if (typeof action !== 'string' || !Object.hasOwn(BULK_VERB, action)) return fail(400, '"action" must be hide, unhide or delete')
  const site = siteId()
  const updated = await c.db.tx(async (q) => {
    const n =
      action === 'delete'
        ? await q.run(`DELETE FROM comments WHERE site = $1 AND id IN (${inList(ids, 1)})`, [site, ...ids])
        : await q.run(`UPDATE comments SET hidden = $1 WHERE site = $2 AND id IN (${inList(ids, 2)})`, [action === 'hide' ? 1 : 0, site, ...ids])
    if (n) {
      await audit(q, user, {
        action: 'comments.bulk',
        targetKind: 'comment',
        targetId: ids.length === 1 ? ids[0] : '',
        summary: `${BULK_VERB[action]} ${n} comment${n === 1 ? '' : 's'}`,
        detail: { action, ids },
      })
    }
    return n
  })
  return { updated }
})
