/** Placeholder maker profiles: one-time bootstrap seed + shared upsert (used by handlers/artisans.ts). */
import 'server-only'
import { ARTISANS as BUNDLED_ARTISANS, SEED_ARTISAN_LINKS } from '../museum/content/artisans'
import { bumpVersion, DEFAULT_EXHIBITION_ID, getMeta, setMeta } from './contentStore'
import { type Db, nowIso, parseJson, type Queryable } from './db'

export async function upsertArtisan(q: Queryable, id: string, v: Record<string, string | number>, onlyNew = false) {
  const now = nowIso()
  const cols = ['name', 'cluster', 'craft', 'bio', 'portrait', 'contact', 'website', 'shop_url', 'commission_url', 'verified', 'placeholder', 'sort']
  const vals = cols.map((c) => v[c] ?? (c === 'verified' || c === 'placeholder' || c === 'sort' ? 0 : ''))
  await q.run(
    `INSERT INTO artisans (id, ${cols.join(', ')}, created_at, updated_at)
     VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}, $${cols.length + 2}, $${cols.length + 3})
     ON CONFLICT (id) DO ${onlyNew ? 'NOTHING' : `UPDATE SET ${cols.map((c) => `${c} = excluded.${c}`).join(', ')}, updated_at = excluded.updated_at`}`,
    [id, ...vals, now, now],
  )
}

/**
 * One-time bootstrap: insert the placeholder profiles and link the default exhibition's hero
 * works / blocks to them (only items without an artisanId). Recorded in meta 'artisans_seeded'.
 */
export async function ensureArtisanSeed(db: Db) {
  if ((await getMeta(db, 'artisans_seeded')) !== undefined) return
  await db.tx(async (q) => {
    if ((await getMeta(q, 'artisans_seeded')) !== undefined) return
    for (const a of BUNDLED_ARTISANS) {
      await upsertArtisan(
        q,
        a.id,
        { name: a.name, cluster: a.cluster, craft: a.craft, bio: a.bio, portrait: a.portrait, contact: a.contact, website: a.website, shop_url: a.shopUrl, commission_url: a.commissionUrl, verified: a.verified ? 1 : 0, placeholder: a.placeholder ? 1 : 0, sort: a.sort ?? 0 },
        true,
      )
    }
    for (const [collection, links] of Object.entries(SEED_ARTISAN_LINKS)) {
      for (const [itemId, artisanId] of Object.entries(links)) {
        const row = await q.one<{ json: unknown }>('SELECT json FROM content_items WHERE exhibition_id = $1 AND collection = $2 AND id = $3', [DEFAULT_EXHIBITION_ID, collection, itemId])
        if (!row) continue
        const item = parseJson<Record<string, unknown>>(row.json)
        if (item.artisanId) continue
        item.artisanId = artisanId
        await q.run('UPDATE content_items SET json = $1 WHERE exhibition_id = $2 AND collection = $3 AND id = $4', [JSON.stringify(item), DEFAULT_EXHIBITION_ID, collection, itemId])
      }
    }
    await setMeta(q, 'artisans_seeded', nowIso())
    await bumpVersion(q)
  })
}

