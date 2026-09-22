import 'server-only'
import { API_VERSION } from '../config'
import {
  deleteItem,
  getContent,
  getVersion,
  isCollection,
  listItems,
  putItem,
  putMetaJson,
  readSeed,
  seedContent,
  type Item,
} from '../contentStore'
import { route } from '../http'
import { fail, ID_RE, isRecord } from '../util'

const EXHIBITION_KEYS = ['kicker', 'title', 'subtitle', 'intro'] as const

/** GET /api/health */
export const health = route(async ({ db }) => ({ ok: true, version: API_VERSION, contentVersion: await getVersion(db), db: db.dialect }))

/** GET /api/content */
export const publicContent = route(async ({ db }) => getContent(db))

/** PUT /api/admin/content/exhibition */
export const putExhibition = route(async (c) => {
  await c.requireAdmin()
  const b = await c.json()
  if (!isRecord(b)) return fail(400, 'Body must be an object')
  const text: Record<string, string> = {}
  for (const k of EXHIBITION_KEYS) {
    if (typeof b[k] !== 'string') return fail(400, `"${k}" must be a string`)
    text[k] = b[k] as string
  }
  await putMetaJson(c.db, 'exhibition', text)
  return text
})

/** PUT /api/admin/content/welcome */
export const putWelcome = route(async (c) => {
  await c.requireAdmin()
  const b = await c.json()
  if (!isRecord(b) || typeof b.title !== 'string' || typeof b.body !== 'string') return fail(400, 'Body must be { title: string, body: string }')
  const welcome = { title: b.title, body: b.body }
  await putMetaJson(c.db, 'welcome', welcome)
  return welcome
})

/** POST /api/admin/content/reset */
export const resetContent = route(async (c) => {
  await c.requireAdmin()
  await seedContent(c.db, readSeed())
  return { ok: true }
})

/** GET /api/admin/content/:collection */
export const listCollection = route<{ collection: string }>(async (c) => {
  await c.requireAdmin()
  const { collection } = c.params
  if (!isCollection(collection)) return fail(404, `Unknown collection "${collection}"`)
  return listItems(c.db, collection)
})

/** PUT /api/admin/content/:collection/:id */
export const putContentItem = route<{ collection: string; id: string }>(async (c) => {
  await c.requireAdmin()
  const { collection } = c.params
  const id = decodeURIComponent(c.params.id)
  if (!isCollection(collection)) return fail(404, `Unknown collection "${collection}"`)
  if (!ID_RE.test(id)) return fail(400, 'Invalid id (letters, digits, "_", "-", "." — max 100)')
  const b = await c.json({ maxBytes: 512 * 1024 })
  if (!isRecord(b)) return fail(400, 'Body must be a JSON object')
  if (b.id !== undefined && b.id !== id) return fail(400, 'Body id does not match URL id')
  if (typeof b.title !== 'string' || !b.title.trim()) return fail(400, '"title" is required')
  const item = { ...b, id } as Item
  await putItem(c.db, collection, item)
  return item
})

/** DELETE /api/admin/content/:collection/:id */
export const deleteContentItem = route<{ collection: string; id: string }>(async (c) => {
  await c.requireAdmin()
  const { collection } = c.params
  if (!isCollection(collection)) return fail(404, `Unknown collection "${collection}"`)
  if (!(await deleteItem(c.db, collection, decodeURIComponent(c.params.id)))) return fail(404, 'Item not found')
  return { ok: true }
})

/** Any unmatched /api/* path → JSON 404 (app/api/[...slug]/route.ts). */
export const apiNotFound = route(async (c) => fail(404, `Not found: ${c.req.method} ${c.url.pathname}`), { crossOrigin: true })
