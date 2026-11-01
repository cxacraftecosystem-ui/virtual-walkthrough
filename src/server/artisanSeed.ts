/** Placeholder maker profiles: one-time bootstrap seed + shared upsert (used by handlers/artisans.ts). */
import 'server-only'
import { ARTISANS as BUNDLED_ARTISANS, SEED_ARTISAN_LINKS } from '../museum/content/artisans'
import { bumpVersion, getMeta, setMeta } from './contentStore'
import { type Db, nowIso, parseJson, type Queryable } from './db'
import { currentSite, metaKey, siteId } from './site'

/**
 * Insert or replace one of this site's maker profiles. Ids are unique across both sites (artisans.id is the
 * primary key), so a profile of the other site is never overwritten: the update only applies to a row of
 * this site. Returns false when the id already belongs to the other site (nothing written).
 */
export async function upsertArtisan(q: Queryable, id: string, v: Record<string, string | number>, onlyNew = false): Promise<boolean> {
  const now = nowIso()
  const cols = ['name', 'cluster', 'craft', 'bio', 'portrait', 'contact', 'website', 'shop_url', 'commission_url', 'verified', 'placeholder', 'sort']
  const vals = cols.map((c) => v[c] ?? (c === 'verified' || c === 'placeholder' || c === 'sort' ? 0 : ''))
  const site = siteId()
  await q.run(
    `INSERT INTO artisans (id, ${cols.join(', ')}, created_at, updated_at, site)
     VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}, $${cols.length + 2}, $${cols.length + 3}, $${cols.length + 4})
     ON CONFLICT (id) DO ${onlyNew ? 'NOTHING' : `UPDATE SET ${cols.map((c) => `${c} = excluded.${c}`).join(', ')}, updated_at = excluded.updated_at WHERE artisans.site = excluded.site`}`,
    [id, ...vals, now, now, site],
  )
  const owner = await q.one<{ site: string }>('SELECT site FROM artisans WHERE id = $1', [id])
  return owner?.site === site
}

/**
 * One-time bootstrap per site: insert the placeholder profiles and link this site's default exhibition's
 * works / blocks to them (only items without an artisanId). Recorded in meta 'artisans_seeded' (per site).
 */
export async function ensureArtisanSeed(db: Db) {
  const key = metaKey('artisans_seeded')
  if ((await getMeta(db, key)) !== undefined) return
  const exhibitionId = currentSite().defaultExhibitionId
  await db.tx(async (q) => {
    if ((await getMeta(q, key)) !== undefined) return
    for (const a of BUNDLED_ARTISANS) {
      const mine = await upsertArtisan(
        q,
        a.id,
        { name: a.name, cluster: a.cluster, craft: a.craft, bio: a.bio, portrait: a.portrait, contact: a.contact, website: a.website, shop_url: a.shopUrl, commission_url: a.commissionUrl, verified: a.verified ? 1 : 0, placeholder: a.placeholder ? 1 : 0, sort: a.sort ?? 0 },
        true,
      )
      if (!mine) console.warn(`[museum] maker id "${a.id}" is used by the other site; this site's seed profile was not added (give it a site prefix)`)
    }
    for (const [collection, links] of Object.entries(SEED_ARTISAN_LINKS)) {
      for (const [itemId, artisanId] of Object.entries(links)) {
        const row = await q.one<{ json: unknown }>('SELECT json FROM content_items WHERE exhibition_id = $1 AND collection = $2 AND id = $3', [exhibitionId, collection, itemId])
        if (!row) continue
        const item = parseJson<Record<string, unknown>>(row.json)
        if (item.artisanId) continue
        item.artisanId = artisanId
        await q.run('UPDATE content_items SET json = $1 WHERE exhibition_id = $2 AND collection = $3 AND id = $4', [JSON.stringify(item), exhibitionId, collection, itemId])
      }
    }
    await setMeta(q, key, nowIso())
    await bumpVersion(q)
  })
}
