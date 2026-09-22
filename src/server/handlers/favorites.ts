import 'server-only'
import { nowIso } from '../db'
import { route } from '../http'
import { fail, ID_RE, isItemKind } from '../util'

type Params = { itemKind: string; itemId: string }

function validate(p: Params) {
  const itemId = decodeURIComponent(p.itemId)
  if (!isItemKind(p.itemKind)) fail(400, 'itemKind must be artwork, exhibit, infographic, video or object')
  if (!ID_RE.test(itemId)) fail(400, 'Invalid itemId')
  return { itemKind: p.itemKind, itemId }
}

/** GET /api/me/favorites */
export const listFavorites = route(async (c) => {
  const user = await c.requireUser()
  return c.db.query(
    'SELECT item_kind AS "itemKind", item_id AS "itemId", created_at AS "createdAt" FROM favorites WHERE user_id = $1 ORDER BY created_at DESC',
    [user.id],
  )
})

/** PUT /api/me/favorites/:itemKind/:itemId */
export const addFavorite = route<Params>(async (c) => {
  const user = await c.requireUser()
  const { itemKind, itemId } = validate(c.params)
  await c.db.run('INSERT INTO favorites (user_id, item_kind, item_id, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [
    user.id,
    itemKind,
    itemId,
    nowIso(),
  ])
  return { ok: true }
})

/** DELETE /api/me/favorites/:itemKind/:itemId */
export const removeFavorite = route<Params>(async (c) => {
  const user = await c.requireUser()
  const { itemKind, itemId } = validate(c.params)
  await c.db.run('DELETE FROM favorites WHERE user_id = $1 AND item_kind = $2 AND item_id = $3', [user.id, itemKind, itemId])
  return { ok: true }
})
