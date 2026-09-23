import 'server-only'
import { hasRole } from '../auth'
import { API_VERSION } from '../config'
import {
  deleteItem,
  type ExhibitionRow,
  findExhibition,
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
import { type Call, route } from '../http'
import { fail, ID_RE, isRecord } from '../util'

const EXHIBITION_KEYS = ['kicker', 'title', 'subtitle', 'intro'] as const

/** Optional `i18n: { hi?: {field: string}, bn?: {...} }` — only known languages/fields, strings only. */
function cleanI18n(v: unknown, fields: readonly string[]): Record<string, Record<string, string>> | undefined {
  if (!isRecord(v)) return undefined
  const out: Record<string, Record<string, string>> = {}
  for (const lang of ['hi', 'bn']) {
    const l = v[lang]
    if (!isRecord(l)) continue
    const o: Record<string, string> = {}
    for (const f of fields) if (typeof l[f] === 'string' && (l[f] as string).trim()) o[f] = (l[f] as string).slice(0, 5000)
    if (Object.keys(o).length) out[lang] = o
  }
  return Object.keys(out).length ? out : undefined
}

/**
 * `?exhibition=<id|slug>` on admin content routes (omitted = the default exhibition).
 * Curators may edit the content of ANY exhibition (drafts included).
 */
async function adminExhibition<P>(c: Call<P>): Promise<ExhibitionRow> {
  const ex = await findExhibition(c.db, c.url.searchParams.get('exhibition'))
  return ex ?? fail(404, 'Exhibition not found')
}

/** GET /api/health */
export const health = route(async ({ db }) => ({ ok: true, version: API_VERSION, contentVersion: await getVersion(db), db: db.dialect }))

/**
 * GET /api/content[?exhibition=<slug>] — omitted = the default exhibition (backward compatible).
 * Draft exhibitions are only served to curators and above (preview); others get 404.
 */
export const publicContent = route(async (c) => {
  const slug = c.url.searchParams.get('exhibition')
  if (!slug) return getContent(c.db)
  const ex = await findExhibition(c.db, slug)
  if (!ex) return fail(404, 'Exhibition not found')
  if (ex.status !== 'published') {
    const u = await c.user()
    if (!u || !hasRole(u.role, 'curator')) return fail(404, 'Exhibition not found')
  }
  return getContent(c.db, ex.id)
})

/** PUT /api/admin/content/exhibition[?exhibition=] */
export const putExhibition = route(async (c) => {
  await c.requireCurator()
  const ex = await adminExhibition(c)
  const b = await c.json()
  if (!isRecord(b)) return fail(400, 'Body must be an object')
  const text: Record<string, unknown> = {}
  for (const k of EXHIBITION_KEYS) {
    if (typeof b[k] !== 'string') return fail(400, `"${k}" must be a string`)
    text[k] = b[k] as string
  }
  const i18n = cleanI18n(b.i18n, EXHIBITION_KEYS)
  if (i18n) text.i18n = i18n
  await putMetaJson(c.db, 'exhibition', text, ex.id)
  return text
})

/** PUT /api/admin/content/welcome[?exhibition=] */
export const putWelcome = route(async (c) => {
  await c.requireCurator()
  const ex = await adminExhibition(c)
  const b = await c.json()
  if (!isRecord(b) || typeof b.title !== 'string' || typeof b.body !== 'string') return fail(400, 'Body must be { title: string, body: string }')
  const i18n = cleanI18n(b.i18n, ['title', 'body'])
  const welcome = { title: b.title, body: b.body, ...(i18n ? { i18n } : {}) }
  await putMetaJson(c.db, 'welcome', welcome, ex.id)
  return welcome
})

const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v)

/**
 * PUT /api/admin/content/tour[?exhibition=] — `{ stops: TourStop[] | null }` (null / [] = use the
 * bundled tour). Stop: `{ id, place, title, text, view: { x, z, yawDeg, pitchDeg? }, item?, dwellSec? }`.
 */
export const putTour = route(async (c) => {
  await c.requireCurator()
  const ex = await adminExhibition(c)
  const b = await c.json({ maxBytes: 256 * 1024 })
  if (!isRecord(b) || !('stops' in b)) return fail(400, 'Body must be { stops: TourStop[] | null }')
  if (b.stops === null || (Array.isArray(b.stops) && b.stops.length === 0)) {
    await putMetaJson(c.db, 'tour', null, ex.id)
    return { stops: null }
  }
  if (!Array.isArray(b.stops) || b.stops.length > 80) return fail(400, '"stops" must be an array (max 80)')
  const ids = new Set<string>()
  const stops = b.stops.map((s, i) => {
    if (!isRecord(s)) return fail(400, `stops[${i}] must be an object`)
    if (typeof s.id !== 'string' || !ID_RE.test(s.id) || ids.has(s.id)) return fail(400, `stops[${i}].id must be a unique id`)
    ids.add(s.id)
    for (const k of ['place', 'title', 'text'] as const) if (typeof s[k] !== 'string') return fail(400, `stops[${i}].${k} must be a string`)
    const v = s.view
    if (!isRecord(v) || !num(v.x) || !num(v.z) || !num(v.yawDeg) || (v.pitchDeg !== undefined && !num(v.pitchDeg))) {
      return fail(400, `stops[${i}].view must be { x, z, yawDeg, pitchDeg? } (numbers)`)
    }
    if (s.dwellSec !== undefined && (!num(s.dwellSec) || (s.dwellSec as number) < 1 || (s.dwellSec as number) > 600)) return fail(400, `stops[${i}].dwellSec must be 1–600`)
    if (s.item !== undefined && (!isRecord(s.item) || typeof s.item.kind !== 'string' || typeof s.item.id !== 'string')) return fail(400, `stops[${i}].item must be { kind, id }`)
    return s
  })
  await putMetaJson(c.db, 'tour', stops, ex.id)
  return { stops }
})

/** POST /api/admin/content/reset[?exhibition=] — admin (bulk, destructive): re-seed ONE exhibition from the bundled config. */
export const resetContent = route(async (c) => {
  await c.requireAdmin()
  const ex = await adminExhibition(c)
  await seedContent(c.db, readSeed(), false, ex.id)
  return { ok: true }
})

/** GET /api/admin/content/:collection[?exhibition=] */
export const listCollection = route<{ collection: string }>(async (c) => {
  await c.requireCurator()
  const { collection } = c.params
  if (!isCollection(collection)) return fail(404, `Unknown collection "${collection}"`)
  const ex = await adminExhibition(c)
  return listItems(c.db, collection, ex.id)
})

/** PUT /api/admin/content/:collection/:id[?exhibition=] */
export const putContentItem = route<{ collection: string; id: string }>(async (c) => {
  await c.requireCurator()
  const { collection } = c.params
  const id = decodeURIComponent(c.params.id)
  if (!isCollection(collection)) return fail(404, `Unknown collection "${collection}"`)
  if (!ID_RE.test(id)) return fail(400, 'Invalid id (letters, digits, "_", "-", "." — max 100)')
  const ex = await adminExhibition(c)
  const b = await c.json({ maxBytes: 512 * 1024 })
  if (!isRecord(b)) return fail(400, 'Body must be a JSON object')
  if (b.id !== undefined && b.id !== id) return fail(400, 'Body id does not match URL id')
  if (typeof b.title !== 'string' || !b.title.trim()) return fail(400, '"title" is required')
  const item = { ...b, id } as Item
  await putItem(c.db, collection, item, ex.id)
  return item
})

/** DELETE /api/admin/content/:collection/:id[?exhibition=] */
export const deleteContentItem = route<{ collection: string; id: string }>(async (c) => {
  await c.requireCurator()
  const { collection } = c.params
  if (!isCollection(collection)) return fail(404, `Unknown collection "${collection}"`)
  const ex = await adminExhibition(c)
  if (!(await deleteItem(c.db, collection, decodeURIComponent(c.params.id), ex.id))) return fail(404, 'Item not found')
  return { ok: true }
})

/** Any unmatched /api/* path → JSON 404 (app/api/[...slug]/route.ts). */
export const apiNotFound = route(async (c) => fail(404, `Not found: ${c.req.method} ${c.url.pathname}`), { crossOrigin: true })
