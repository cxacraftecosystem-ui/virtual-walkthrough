import 'server-only'
import { randomUUID } from 'node:crypto'
import { nowIso } from '../db'
import { route } from '../http'
import { createRateLimiter, fail, ID_RE, isItemKind, isRecord } from '../util'

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
     WHERE c.item_kind = $1 AND c.item_id = $2 AND c.hidden = 0
     ORDER BY c.created_at DESC LIMIT 200`,
    [kind, id],
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
  await c.db.run('INSERT INTO comments (id, user_id, item_kind, item_id, body, hidden, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
    row.id,
    user.id,
    kind,
    id,
    body,
    hidden,
    row.created_at,
  ])
  c.status = 201
  return { ...toComment(row), pending: hidden === 1 }
})

/** GET /api/admin/comments */
export const adminListComments = route(async (c) => {
  await c.requireAdmin()
  const rows = await c.db.query<Row>(
    `SELECT c.*, u.display_name, u.email FROM comments c JOIN users u ON u.id = c.user_id
     ORDER BY c.created_at DESC LIMIT 2000`,
  )
  return rows.map((r) => ({ ...toComment(r), hidden: Number(r.hidden) === 1, userId: r.user_id, userEmail: r.email }))
})

/** PATCH /api/admin/comments/:id */
export const adminPatchComment = route<{ id: string }>(async (c) => {
  await c.requireAdmin()
  const b = await c.json()
  if (!isRecord(b) || typeof b.hidden !== 'boolean') return fail(400, 'Body must be { hidden: boolean }')
  const n = await c.db.run('UPDATE comments SET hidden = $1 WHERE id = $2', [b.hidden ? 1 : 0, c.params.id])
  if (n === 0) return fail(404, 'Comment not found')
  return { ok: true }
})

/** DELETE /api/admin/comments/:id */
export const adminDeleteComment = route<{ id: string }>(async (c) => {
  await c.requireAdmin()
  const n = await c.db.run('DELETE FROM comments WHERE id = $1', [c.params.id])
  if (n === 0) return fail(404, 'Comment not found')
  return { ok: true }
})
