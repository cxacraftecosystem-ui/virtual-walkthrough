import 'server-only'
import { type Actor, audit } from '../audit'
import { hasRole } from '../auth'
import { API_VERSION } from '../config'
import {
  type Collection,
  deleteItem,
  type ExhibitionRow,
  findExhibition,
  getContent,
  getVersion,
  isCollection,
  itemHistory,
  listItems,
  listStamps,
  listTrash,
  putItem,
  putMetaJson,
  readSeed,
  restoreItem,
  seedContent,
  type Item,
} from '../contentStore'
import { type Call, route } from '../http'
import { fail, HttpError, ID_RE, isItemKind, isRecord, ITEM_KINDS } from '../util'

const EXHIBITION_KEYS = ['kicker', 'title', 'subtitle', 'intro'] as const

/** "artworks" → "artwork", for log lines. */
export const SINGULAR: Record<Collection, string> = { artworks: 'artwork', exhibits: 'exhibit', infographics: 'infographic', videos: 'video', objects: 'object' }
const titleOf = (item: Record<string, unknown> | null | undefined, id: string) => (typeof item?.title === 'string' && item.title.trim() ? item.title.trim() : id)

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
 * `?exhibition=<id|slug>` on admin content routes (omitted = this site's default exhibition).
 * Curators may edit the content of ANY of this site's exhibitions (drafts included); the other site's are 404.
 */
export async function adminExhibition<P>(c: Call<P>): Promise<ExhibitionRow> {
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

/** Audit a per-exhibition text write in the same transaction as the write. */
const textAudit = (actor: Actor, ex: ExhibitionRow, action: string, summary: string) => (q: Parameters<typeof audit>[0]) =>
  audit(q, actor, { action, targetKind: 'exhibition', targetId: ex.id, exhibitionId: ex.id, summary })

/** PUT /api/admin/content/exhibition[?exhibition=] */
export const putExhibition = route(async (c) => {
  const user = await c.requireCurator()
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
  await putMetaJson(c.db, 'exhibition', text, ex.id, textAudit(user, ex, 'content.exhibitionText', `Edited the gallery introduction of “${ex.title}”`))
  return text
})

/** PUT /api/admin/content/welcome[?exhibition=] */
export const putWelcome = route(async (c) => {
  const user = await c.requireCurator()
  const ex = await adminExhibition(c)
  const b = await c.json()
  if (!isRecord(b) || typeof b.title !== 'string' || typeof b.body !== 'string') return fail(400, 'Body must be { title: string, body: string }')
  const i18n = cleanI18n(b.i18n, ['title', 'body'])
  const welcome = { title: b.title, body: b.body, ...(i18n ? { i18n } : {}) }
  await putMetaJson(c.db, 'welcome', welcome, ex.id, textAudit(user, ex, 'content.welcome', `Edited the welcome text of “${ex.title}”`))
  return welcome
})

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
/** 400 naming the field at fault, e.g. `stops[2].view.x`. */
const bad = (field: string, message: string): never => {
  throw new HttpError(400, message, { field })
}

export const TOUR_MAX_STOPS = 80

/**
 * Validate a tour (PUT /api/admin/content/tour): every stop `{ id, place, title, text, view: { x, z, yawDeg,
 * pitchDeg? }, item?: { kind, id }, dwellSec?, i18n?, narrationAudio? }`. Throws a 400 whose body names the
 * field (`stops[2].view.x`); returns the stops as stored (unknown keys dropped).
 */
export function validateTour(input: unknown): Record<string, unknown>[] {
  if (!Array.isArray(input)) return bad('stops', 'A tour is a list of stops.')
  if (input.length > TOUR_MAX_STOPS) return bad('stops', `A tour has at most ${TOUR_MAX_STOPS} stops.`)
  const ids = new Set<string>()
  return input.map((s, i) => {
    const at = `stops[${i}]`
    const n = i + 1
    if (!isRecord(s)) return bad(at, `Stop ${n} couldn’t be read as a stop.`)
    if (typeof s.id !== 'string' || !ID_RE.test(s.id)) return bad(`${at}.id`, `Stop ${n} needs an “id” of letters, digits, “-” or “_”.`)
    if (ids.has(s.id)) return bad(`${at}.id`, `Stop ${n} has the same id as an earlier stop (“${s.id}”).`)
    ids.add(s.id)
    const out: Record<string, unknown> = { id: s.id }
    for (const [k, max] of [['place', 120], ['title', 200], ['text', 4000]] as const) {
      if (typeof s[k] !== 'string') return bad(`${at}.${k}`, `Stop ${n} needs a “${k}”.`)
      if ((s[k] as string).length > max) return bad(`${at}.${k}`, `Stop ${n}: “${k}” is too long (at most ${max} characters).`)
      out[k] = s[k]
    }
    const v = s.view
    if (!isRecord(v)) return bad(`${at}.view`, `Stop ${n} needs a “view” with x, z and yawDeg.`)
    for (const k of ['x', 'z', 'yawDeg'] as const) {
      if (!num(v[k])) return bad(`${at}.view.${k}`, `Stop ${n}: “view.${k}” must be a number.`)
    }
    if (Math.abs(v.x as number) > 200 || Math.abs(v.z as number) > 200) return bad(`${at}.view`, `Stop ${n}: the standing point is outside the building.`)
    if (v.pitchDeg !== undefined && (!num(v.pitchDeg) || Math.abs(v.pitchDeg) > 90)) return bad(`${at}.view.pitchDeg`, `Stop ${n}: “view.pitchDeg” must be a number between -90 and 90.`)
    out.view = { x: v.x, z: v.z, yawDeg: v.yawDeg, ...(v.pitchDeg !== undefined ? { pitchDeg: v.pitchDeg } : {}) }
    if (s.dwellSec !== undefined) {
      if (!num(s.dwellSec) || s.dwellSec < 1 || s.dwellSec > 600) return bad(`${at}.dwellSec`, `Stop ${n}: “dwellSec” must be between 1 and 600 seconds.`)
      out.dwellSec = s.dwellSec
    }
    if (s.item !== undefined && s.item !== null) {
      if (!isRecord(s.item)) return bad(`${at}.item`, `Stop ${n}: “item” needs a kind and an id.`)
      if (!isItemKind(s.item.kind)) return bad(`${at}.item.kind`, `Stop ${n}: “item.kind” must be one of ${ITEM_KINDS.join(', ')}.`)
      if (typeof s.item.id !== 'string' || !ID_RE.test(s.item.id)) return bad(`${at}.item.id`, `Stop ${n}: “item.id” must be an item id.`)
      out.item = { kind: s.item.kind, id: s.item.id }
    }
    const i18n = cleanI18n(s.i18n, ['place', 'title', 'text'])
    if (i18n) out.i18n = i18n
    if (s.narrationAudio !== undefined) {
      if (!isRecord(s.narrationAudio)) return bad(`${at}.narrationAudio`, `Stop ${n}: “narrationAudio” maps a language to an audio address.`)
      const audio: Record<string, string> = {}
      for (const [lang, url] of Object.entries(s.narrationAudio)) {
        if (!['en', 'hi', 'bn'].includes(lang)) return bad(`${at}.narrationAudio.${lang}`, `Stop ${n}: narration languages are en, hi and bn.`)
        if (typeof url !== 'string' || url.length > 1000 || !/^(https?:\/\/|\/)\S*$/i.test(url)) {
          return bad(`${at}.narrationAudio.${lang}`, `Stop ${n}: the ${lang} narration must be an http(s) address or a /path.`)
        }
        audio[lang] = url
      }
      if (Object.keys(audio).length) out.narrationAudio = audio
    }
    return out
  })
}

/**
 * PUT /api/admin/content/tour[?exhibition=] — `{ stops: TourStop[] | null }` (null / [] = use the bundled
 * tour). Validated by `validateTour`: a bad stop is a 400 `{ error, field }`.
 */
export const putTour = route(async (c) => {
  const user = await c.requireCurator()
  const ex = await adminExhibition(c)
  const b = await c.json({ maxBytes: 256 * 1024 })
  if (!isRecord(b) || !('stops' in b)) return fail(400, 'Body must be { stops: TourStop[] | null }')
  if (b.stops === null || (Array.isArray(b.stops) && b.stops.length === 0)) {
    await putMetaJson(c.db, 'tour', null, ex.id, textAudit(user, ex, 'content.tour', `Went back to the bundled tour in “${ex.title}”`))
    return { stops: null }
  }
  const stops = validateTour(b.stops)
  await putMetaJson(c.db, 'tour', stops, ex.id, textAudit(user, ex, 'content.tour', `Saved the tour of “${ex.title}” (${stops.length} stops)`))
  return { stops }
})

/** POST /api/admin/content/reset[?exhibition=] — admin (bulk, destructive): re-seed ONE exhibition from the bundled config. */
export const resetContent = route(async (c) => {
  const user = await c.requireAdmin()
  const ex = await adminExhibition(c)
  await seedContent(c.db, readSeed(), false, ex.id, user)
  await audit(c.db, user, {
    action: 'content.reset',
    targetKind: 'exhibition',
    targetId: ex.id,
    exhibitionId: ex.id,
    summary: `Reset “${ex.title}” to the bundled content (replaced items are in the trash)`,
  })
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

/** `X-Expected-Updated-At` (optimistic concurrency): an ISO stamp from /stamps, or 'new'. */
const expectedOf = <P>(c: Call<P>) => c.req.headers.get('x-expected-updated-at')?.trim() || undefined

/** Keys the API adds to a saved item (`updatedAt`, `updatedBy`); never stored inside the item. */
const STAMP_KEYS = ['updatedAt', 'updatedBy'] as const

/**
 * PUT /api/admin/content/:collection/:id[?exhibition=] — create or replace. Optional `X-Expected-Updated-At`:
 * 409 `{ error: 'conflict', message, current, updatedAt, updatedBy }` when the item changed meanwhile.
 * → the item plus `updatedAt`, `updatedBy`.
 */
export const putContentItem = route<{ collection: string; id: string }>(async (c) => {
  const user = await c.requireCurator()
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
  for (const k of STAMP_KEYS) delete item[k]
  const r = await putItem(c.db, collection, item, ex.id, {
    actor: user,
    expectedUpdatedAt: expectedOf(c),
    onWrite: (q, w) =>
      audit(q, user, {
        action: w.op === 'create' ? 'content.create' : 'content.update',
        targetKind: collection,
        targetId: id,
        exhibitionId: ex.id,
        summary: `${w.op === 'create' ? 'Added' : 'Saved'} ${SINGULAR[collection]} “${titleOf(item, id)}”`,
      }),
  })
  return { ...item, updatedAt: r.updatedAt, updatedBy: r.updatedBy }
})

/** DELETE /api/admin/content/:collection/:id[?exhibition=] — optional `X-Expected-Updated-At` as for PUT. The item goes to the trash. */
export const deleteContentItem = route<{ collection: string; id: string }>(async (c) => {
  const user = await c.requireCurator()
  const { collection } = c.params
  if (!isCollection(collection)) return fail(404, `Unknown collection "${collection}"`)
  const id = decodeURIComponent(c.params.id)
  const ex = await adminExhibition(c)
  const r = await deleteItem(c.db, collection, id, ex.id, {
    actor: user,
    expectedUpdatedAt: expectedOf(c),
    onWrite: (q, w) =>
      audit(q, user, {
        action: 'content.delete',
        targetKind: collection,
        targetId: id,
        exhibitionId: ex.id,
        summary: `Deleted ${SINGULAR[collection]} “${titleOf(w.previous, id)}”`,
      }),
  })
  if (!r) return fail(404, 'Item not found')
  return { ok: true }
})

/** GET /api/admin/content/stamps[?exhibition=] → `{ stamps: { "<collection>/<id>": { updatedAt, updatedBy } } }` */
export const contentStamps = route(async (c) => {
  await c.requireCurator()
  const ex = await adminExhibition(c)
  return { stamps: await listStamps(c.db, ex.id) }
})

function itemParams(c: Call<{ collection: string; id: string }>): { collection: Collection; id: string } {
  const { collection } = c.params
  if (!isCollection(collection)) return fail(404, `Unknown collection "${collection}"`)
  const id = decodeURIComponent(c.params.id)
  if (!ID_RE.test(id)) return fail(400, 'Invalid id')
  return { collection, id }
}

/** GET /api/admin/content/:collection/:id/history[?exhibition=] → `{ revisions: [{ rev, at, actorEmail, op, item }] }` newest first. */
export const contentHistory = route<{ collection: string; id: string }>(async (c) => {
  await c.requireCurator()
  const { collection, id } = itemParams(c)
  const ex = await adminExhibition(c)
  return { revisions: await itemHistory(c.db, ex.id, collection, id) }
})

/**
 * POST /api/admin/content/:collection/:id/restore[?exhibition=] `{ rev }` → `{ item, updatedAt }` (deleted items too).
 * Optional `X-Expected-Updated-At` as for PUT ('new' when bringing a deleted item back).
 */
export const contentRestore = route<{ collection: string; id: string }>(async (c) => {
  const user = await c.requireCurator()
  const { collection, id } = itemParams(c)
  const ex = await adminExhibition(c)
  const b = await c.json()
  if (!isRecord(b) || typeof b.rev !== 'number' || !Number.isInteger(b.rev) || b.rev < 1) return fail(400, 'Body must be { rev: number }')
  const rev = b.rev
  const { item, result } = await restoreItem(c.db, ex.id, collection, id, rev, {
    actor: user,
    expectedUpdatedAt: expectedOf(c),
    onWrite: (q, w) =>
      audit(q, user, {
        action: 'content.restore',
        targetKind: collection,
        targetId: id,
        exhibitionId: ex.id,
        summary: `${w.previous ? 'Restored an earlier version of' : 'Brought back'} ${SINGULAR[collection]} “${titleOf(w.item, id)}”`,
        detail: { rev },
      }),
  })
  return { item, updatedAt: result.updatedAt }
})

/** GET /api/admin/content/trash[?exhibition=] → `{ items: [{ collection, id, title, deletedAt, deletedBy, rev }] }` */
export const contentTrash = route(async (c) => {
  await c.requireCurator()
  const ex = await adminExhibition(c)
  return { items: await listTrash(c.db, ex.id) }
})

/** Any unmatched /api/* path → JSON 404 (app/api/[...slug]/route.ts). */
export const apiNotFound = route(async (c) => fail(404, `Not found: ${c.req.method} ${c.url.pathname}`), { crossOrigin: true })
