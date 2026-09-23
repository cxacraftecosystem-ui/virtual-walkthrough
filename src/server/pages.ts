/** Data helpers for server-rendered pages (app/gallery/[slug], app/makers/[id]). */
import 'server-only'
import { headers } from 'next/headers'
import { hasRole, userFromRequest } from './auth'
import { type ArtisanRow, findExhibition, toArtisan, toExhibition } from './contentStore'
import { parseJson } from './db'
import { services } from './services'

/** The signed-in user of the current page request (null when signed out / DB unavailable). */
export async function pageUser() {
  try {
    const { db } = await services()
    const cookie = (await headers()).get('cookie') ?? ''
    return await userFromRequest(db, new Request('http://local/', { headers: { cookie } }))
  } catch {
    return null
  }
}

/**
 * Exhibition for /gallery/<slug>: `null` = unknown slug (404); `visible` false = a draft the current
 * user may not preview (curators and above may).
 */
export async function exhibitionForPage(slug: string) {
  try {
    const { db } = await services()
    const row = await findExhibition(db, slug)
    if (!row) return null
    const ex = toExhibition(row)
    if (ex.status === 'published') return { ...ex, visible: true }
    const u = await pageUser()
    return { ...ex, visible: !!u && hasRole(u.role, 'curator') }
  } catch {
    return null
  }
}

/** Maker profile + the items (in published exhibitions) that reference it. */
export async function makerForPage(id: string) {
  const { db } = await services()
  const row = await db.one<ArtisanRow>('SELECT * FROM artisans WHERE id = $1', [id])
  if (!row) return null
  // items referencing this maker, in published exhibitions only (small tables → filter in JS)
  const items = await db.query<{ collection: string; json: unknown; slug: string; ex_title: string; is_default: number }>(
    `SELECT ci.collection, ci.json, e.slug, e.title AS ex_title, e.is_default
     FROM content_items ci JOIN exhibitions e ON e.id = ci.exhibition_id
     WHERE e.status = 'published' AND ci.collection IN ('artworks', 'exhibits')
     ORDER BY e.is_default DESC, e.sort, ci.sort`,
  )
  const works = items
    .map((r) => ({ r, item: parseJson<{ id: string; title?: string; artisanId?: string }>(r.json) }))
    .filter(({ item }) => item.artisanId === id)
    .map(({ r, item }) => ({
      collection: r.collection,
      id: item.id,
      title: String(item.title ?? item.id),
      exhibition: { slug: r.slug, title: r.ex_title, isDefault: Number(r.is_default) === 1 },
    }))
  return { maker: toArtisan(row), works }
}
