/**
 * "Meet the maker": artisan profiles (global, shared by every exhibition). Artworks and
 * exhibits reference a profile with `artisanId`. Curators create/edit/delete profiles.
 * The seed is placeholder-only (src/museum/content/artisans.ts) — no real people are invented.
 */
import 'server-only'
import { upsertArtisan } from '../artisanSeed'
import { type ArtisanRow, bumpVersion, listArtisansPublic, toArtisan } from '../contentStore'
import { route } from '../http'
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

/** GET /api/artisans — public maker profiles. */
export const publicArtisans = route(async ({ db }) => listArtisansPublic(db))

/** GET /api/artisans/:id */
export const publicArtisan = route<{ id: string }>(async (c) => {
  const r = await c.db.one<ArtisanRow>('SELECT * FROM artisans WHERE id = $1', [decodeURIComponent(c.params.id)])
  return r ? toArtisan(r) : fail(404, 'Maker not found')
})

/** GET /api/admin/artisans — curator. */
export const adminListArtisans = route(async (c) => {
  await c.requireCurator()
  return listArtisansPublic(c.db)
})

/** PUT /api/admin/artisans/:id — curator; full profile → saved profile (create or replace). */
export const adminPutArtisan = route<{ id: string }>(async (c) => {
  await c.requireCurator()
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
  await c.db.tx(async (q) => {
    await upsertArtisan(q, id, v)
    await bumpVersion(q)
  })
  const r = await c.db.one<ArtisanRow>('SELECT * FROM artisans WHERE id = $1', [id])
  return toArtisan(r!)
})

/** DELETE /api/admin/artisans/:id — curator. Items keep their (now dangling) artisanId; the museum ignores it. */
export const adminDeleteArtisan = route<{ id: string }>(async (c) => {
  await c.requireCurator()
  const id = decodeURIComponent(c.params.id)
  const n = await c.db.tx(async (q) => {
    const k = await q.run('DELETE FROM artisans WHERE id = $1', [id])
    if (k) await bumpVersion(q)
    return k
  })
  return n ? { ok: true } : fail(404, 'Maker not found')
})
