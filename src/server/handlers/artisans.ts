/**
 * "Meet the maker": artisan profiles (per site, shared by all of the site's exhibitions). Artworks and
 * exhibits reference a profile with `artisanId`. Curators create/edit/delete profiles.
 * The seed is placeholder-only (src/museum/content/artisans.ts) — no real people are invented.
 * Profile ids are unique across both sites: an id the other site uses is refused with a 409.
 */
import 'server-only'
import { upsertArtisan } from '../artisanSeed'
import { audit } from '../audit'
import { type ArtisanRow, bumpVersion, listArtisansPublic, toArtisan } from '../contentStore'
import { parseJson, type Queryable } from '../db'
import { route } from '../http'
import { siteId } from '../site'
import { fail, ID_RE, isRecord } from '../util'

const TEXT_FIELDS = [
  ['name', 'name', 120],
  ['cluster', 'cluster', 200],
  ['craft', 'craft', 120],
  ['bio', 'bio', 5000],
  ['portrait', 'portrait', 1000],
  ['contact', 'contact', 300],
] as const
const URL_FIELDS = [
  ['website', 'website'],
  ['shopUrl', 'shop_url'],
  ['commissionUrl', 'commission_url'],
] as const

const findArtisan = (db: Queryable, id: string) =>
  db.one<ArtisanRow>('SELECT * FROM artisans WHERE id = $1 AND site = $2', [id, siteId()])

/** GET /api/artisans — this site's public maker profiles. */
export const publicArtisans = route(async ({ db }) => listArtisansPublic(db))

/** GET /api/artisans/:id */
export const publicArtisan = route<{ id: string }>(async (c) => {
  const r = await findArtisan(c.db, decodeURIComponent(c.params.id))
  return r ? toArtisan(r) : fail(404, 'Maker not found')
})

/** GET /api/admin/artisans — curator. */
export const adminListArtisans = route(async (c) => {
  await c.requireCurator()
  return listArtisansPublic(c.db)
})

/** PUT /api/admin/artisans/:id — curator; full profile → saved profile (create or replace). */
export const adminPutArtisan = route<{ id: string }>(async (c) => {
  const user = await c.requireCurator()
  const id = decodeURIComponent(c.params.id)
  if (!ID_RE.test(id)) return fail(400, 'Invalid id (letters, digits, "_", "-", "." — max 100)')
  const b = await c.json({ maxBytes: 64 * 1024 })
  if (!isRecord(b)) return fail(400, 'Body must be a JSON object')
  if (b.id !== undefined && b.id !== id) return fail(400, 'Body id does not match URL id')
  const v: Record<string, string | number> = {}
  for (const [key, col, max] of TEXT_FIELDS) {
    const x = b[key] ?? ''
    if (typeof x !== 'string') return fail(400, `"${key}" must be a string`)
    if (x.length > max) return fail(400, `"${key}" is too long (max ${max})`)
    v[col] = x.trim()
  }
  if (!v.name) return fail(400, '"name" is required')
  for (const [key, col] of URL_FIELDS) {
    const x = b[key] ?? ''
    if (typeof x !== 'string' || x.length > 1000) return fail(400, `"${key}" must be a URL string`)
    const s = x.trim()
    if (s && !/^https?:\/\/[^\s]+$/i.test(s)) return fail(400, `"${key}" must start with http:// or https://`)
    v[col] = s
  }
  const portrait = String(v.portrait)
  if (portrait && !/^(https?:\/\/|\/)[^\s]*$/i.test(portrait)) return fail(400, '"portrait" must be an http(s) URL or a /path')
  v.verified = b.verified === true ? 1 : 0
  v.placeholder = b.placeholder === true ? 1 : 0
  v.sort = typeof b.sort === 'number' && Number.isFinite(b.sort) ? Math.round(b.sort) : 0
  const existed = !!(await findArtisan(c.db, id))
  await c.db.tx(async (q) => {
    if (!(await upsertArtisan(q, id, v))) fail(409, 'This id is already used by a maker of the other museum that shares this database. Choose another id.')
    await audit(q, user, {
      action: existed ? 'artisan.update' : 'artisan.create',
      targetKind: 'artisan',
      targetId: id,
      summary: `${existed ? 'Saved' : 'Added'} maker profile “${String(v.name)}”`,
    })
    await bumpVersion(q)
  })
  const r = await findArtisan(c.db, id)
  return toArtisan(r!)
})

/** DELETE /api/admin/artisans/:id — curator. Items keep their (now dangling) artisanId; the museum ignores it. */
export const adminDeleteArtisan = route<{ id: string }>(async (c) => {
  const user = await c.requireCurator()
  const id = decodeURIComponent(c.params.id)
  const row = await findArtisan(c.db, id)
  if (!row) return fail(404, 'Maker not found')
  await c.db.tx(async (q) => {
    const k = await q.run('DELETE FROM artisans WHERE id = $1 AND site = $2', [id, siteId()])
    if (!k) return
    await audit(q, user, { action: 'artisan.delete', targetKind: 'artisan', targetId: id, summary: `Deleted maker profile “${row.name}”` })
    await bumpVersion(q)
  })
  return { ok: true }
})

/** Items of this site's exhibitions whose `artisanId` names a maker (small tables: filtered in JS). */
export async function artisanUsage(db: Queryable, id: string) {
  const rows = await db.query<{ exhibition_id: string; collection: string; json: unknown }>(
    `SELECT ci.exhibition_id, ci.collection, ci.json FROM content_items ci JOIN exhibitions e ON e.id = ci.exhibition_id
     WHERE e.site = $1 ORDER BY e.is_default DESC, e.sort, ci.collection, ci.sort`,
    [siteId()],
  )
  return rows.flatMap((r) => {
    const item = parseJson<{ id?: unknown; title?: unknown; artisanId?: unknown }>(r.json)
    if (item.artisanId !== id) return []
    const itemId = String(item.id ?? '')
    return [{ exhibitionId: r.exhibition_id, collection: r.collection, id: itemId, title: typeof item.title === 'string' && item.title ? item.title : itemId }]
  })
}

/** GET /api/admin/artisans/:id/usage — curator → `{ usage: [{ exhibitionId, collection, id, title }] }` */
export const adminArtisanUsage = route<{ id: string }>(async (c) => {
  await c.requireCurator()
  const id = decodeURIComponent(c.params.id)
  if (!(await findArtisan(c.db, id))) return fail(404, 'Maker not found')
  return { usage: await artisanUsage(c.db, id) }
})
