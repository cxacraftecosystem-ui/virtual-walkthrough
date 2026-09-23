/**
 * Content store: collection items as JSON rows scoped to an EXHIBITION (content_items.exhibition_id)
 * + per-exhibition texts (exhibitions.exhibition_text / welcome / tour) + a global content version
 * in `meta`. Every function takes an optional exhibition id; omitted = the default exhibition
 * ('hand-block-printing' unless another one was made default), so pre-exhibition callers keep working.
 */
import 'server-only'
import { bundledContent } from '../museum/content/content'
import { type Db, nowIso, parseJson, type Queryable } from './db'

export const COLLECTIONS = ['artworks', 'exhibits', 'infographics', 'videos', 'objects'] as const
export type Collection = (typeof COLLECTIONS)[number]
export const isCollection = (v: unknown): v is Collection =>
  typeof v === 'string' && (COLLECTIONS as readonly string[]).includes(v)

export type Item = Record<string, unknown> & { id: string }

/** Id of the exhibition the pre-existing content was migrated into. */
export const DEFAULT_EXHIBITION_ID = 'hand-block-printing'

export interface ExhibitionTheme {
  /** UI accent colour, '#rrggbb'. */
  accent?: string
}

export interface ExhibitionInfo {
  id: string
  slug: string
  title: string
  subtitle: string
  status: 'draft' | 'published'
  isDefault: boolean
  theme: ExhibitionTheme
  sort: number
  createdAt: string
  updatedAt: string
}

export interface ContentDoc {
  version: number
  exhibition: Record<string, unknown>
  welcome: { title: string; body: string }
  artworks: Item[]
  exhibits: Item[]
  infographics: Item[]
  videos: Item[]
  objects: Item[]
  /** Which exhibition this content belongs to (absent in the bundled seed). */
  exhibitionMeta?: ExhibitionInfo
  /** Tour-stop override for this exhibition (absent = the bundled tour in src/museum/config/tour.ts). */
  tour?: unknown[]
  /** Maker profiles (global, shared by all exhibitions). */
  artisans?: Record<string, unknown>[]
}

async function getMeta(q: Queryable, key: string): Promise<string | undefined> {
  return (await q.one<{ value: string }>('SELECT value FROM meta WHERE key = $1', [key]))?.value
}
async function setMeta(q: Queryable, key: string, value: string) {
  await q.run('INSERT INTO meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [key, value])
}
export { getMeta, setMeta }

export async function getVersion(q: Queryable): Promise<number> {
  return Number((await getMeta(q, 'version')) ?? 0)
}

/** Increment and return the content version. Call inside the write transaction. */
export async function bumpVersion(q: Queryable): Promise<number> {
  // single statement → atomic even under concurrent writers
  await q.run(
    `INSERT INTO meta (key, value) VALUES ('version', '1')
     ON CONFLICT (key) DO UPDATE SET value = CAST(CAST(meta.value AS INTEGER) + 1 AS TEXT)`,
  )
  return getVersion(q)
}

/* ------------------------------------------------------------------ */
/* Exhibitions                                                         */
/* ------------------------------------------------------------------ */

export interface ExhibitionRow {
  id: string
  slug: string
  title: string
  subtitle: string
  status: 'draft' | 'published'
  is_default: number
  theme: unknown
  exhibition_text: unknown
  welcome: unknown
  tour: unknown
  sort: number
  created_at: string
  updated_at: string
}

export const toExhibition = (r: ExhibitionRow): ExhibitionInfo => ({
  id: r.id,
  slug: r.slug,
  title: r.title,
  subtitle: r.subtitle,
  status: r.status,
  isDefault: Number(r.is_default) === 1,
  theme: parseJson<ExhibitionTheme>(r.theme ?? '{}') ?? {},
  sort: Number(r.sort ?? 0),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})

/** The default exhibition row (falls back to any row, then undefined on an empty table). */
export async function defaultExhibitionRow(q: Queryable): Promise<ExhibitionRow | undefined> {
  return (
    (await q.one<ExhibitionRow>('SELECT * FROM exhibitions WHERE is_default = 1')) ??
    (await q.one<ExhibitionRow>('SELECT * FROM exhibitions ORDER BY sort, created_at LIMIT 1'))
  )
}

/** Look an exhibition up by id or slug (`undefined`/'' = the default exhibition). */
export async function findExhibition(q: Queryable, idOrSlug?: string | null): Promise<ExhibitionRow | undefined> {
  if (!idOrSlug) return defaultExhibitionRow(q)
  return q.one<ExhibitionRow>('SELECT * FROM exhibitions WHERE id = $1 OR slug = $1 ORDER BY CASE WHEN id = $1 THEN 0 ELSE 1 END LIMIT 1', [idOrSlug])
}

async function resolveId(q: Queryable, exhibitionId?: string): Promise<string> {
  if (exhibitionId) return exhibitionId
  return (await defaultExhibitionRow(q))?.id ?? DEFAULT_EXHIBITION_ID
}

/* ------------------------------------------------------------------ */
/* Items                                                               */
/* ------------------------------------------------------------------ */

export async function listItems(q: Queryable, collection: Collection, exhibitionId?: string): Promise<Item[]> {
  const ex = await resolveId(q, exhibitionId)
  const rows = await q.query<{ json: unknown }>('SELECT json FROM content_items WHERE exhibition_id = $1 AND collection = $2 ORDER BY sort, id', [ex, collection])
  return rows.map((r) => parseJson<Item>(r.json))
}

export async function getContent(db: Db, exhibitionId?: string): Promise<ContentDoc> {
  const row = exhibitionId ? await findExhibition(db, exhibitionId) : await defaultExhibitionRow(db)
  const ex = row?.id ?? exhibitionId ?? DEFAULT_EXHIBITION_ID
  const [version, items, artisans] = await Promise.all([
    getVersion(db),
    db.query<{ collection: Collection; json: unknown }>('SELECT collection, json FROM content_items WHERE exhibition_id = $1 ORDER BY sort, id', [ex]),
    listArtisansPublic(db),
  ])
  const doc: ContentDoc = {
    version,
    exhibition: row ? parseJson<Record<string, unknown>>(row.exhibition_text ?? '{}') : {},
    welcome: row ? parseJson<{ title: string; body: string }>(row.welcome ?? '{"title":"","body":""}') : { title: '', body: '' },
    artworks: [],
    exhibits: [],
    infographics: [],
    videos: [],
    objects: [],
    artisans,
  }
  if (row) doc.exhibitionMeta = toExhibition(row)
  const tour = row?.tour != null ? parseJson<unknown>(row.tour) : null
  if (Array.isArray(tour) && tour.length) doc.tour = tour
  for (const r of items) if (isCollection(r.collection)) doc[r.collection].push(parseJson<Item>(r.json))
  return doc
}

/** Create or replace an item (keeps its sort position when replacing, appends when new). */
export function putItem(db: Db, collection: Collection, item: Item, exhibitionId?: string): Promise<number> {
  return db.tx(async (q) => {
    const ex = await resolveId(q, exhibitionId)
    const existing = await q.one<{ sort: number }>('SELECT sort FROM content_items WHERE exhibition_id = $1 AND collection = $2 AND id = $3', [ex, collection, item.id])
    let sort = existing?.sort
    if (sort === undefined) {
      const max = await q.one<{ m: number | null }>('SELECT MAX(sort) AS m FROM content_items WHERE exhibition_id = $1 AND collection = $2', [ex, collection])
      sort = (max?.m ?? -1) + 1
    }
    await q.run(
      `INSERT INTO content_items (exhibition_id, collection, id, json, sort, updated_at) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (exhibition_id, collection, id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
      [ex, collection, item.id, JSON.stringify(item), sort, nowIso()],
    )
    return bumpVersion(q)
  })
}

export function deleteItem(db: Db, collection: Collection, id: string, exhibitionId?: string): Promise<boolean> {
  return db.tx(async (q) => {
    const ex = await resolveId(q, exhibitionId)
    const n = await q.run('DELETE FROM content_items WHERE exhibition_id = $1 AND collection = $2 AND id = $3', [ex, collection, id])
    if (n === 0) return false
    await bumpVersion(q)
    return true
  })
}

const TEXT_COLUMN = { exhibition: 'exhibition_text', welcome: 'welcome', tour: 'tour' } as const

/** Per-exhibition JSON texts: reveal-wall text, reception welcome, tour-stop override (null clears it). */
export function putMetaJson(db: Db, key: 'exhibition' | 'welcome' | 'tour', value: unknown, exhibitionId?: string): Promise<number> {
  return db.tx(async (q) => {
    const ex = await resolveId(q, exhibitionId)
    await q.run(`UPDATE exhibitions SET ${TEXT_COLUMN[key]} = $1, updated_at = $2 WHERE id = $3`, [value === null ? null : JSON.stringify(value), nowIso(), ex])
    return bumpVersion(q)
  })
}

/* ------------------------------------------------------------------ */
/* Artisans (public projection)                                        */
/* ------------------------------------------------------------------ */

export interface ArtisanRow {
  id: string
  name: string
  cluster: string
  craft: string
  bio: string
  portrait: string
  contact: string
  website: string
  shop_url: string
  commission_url: string
  verified: number
  placeholder: number
  sort: number
  created_at: string
  updated_at: string
}

export const toArtisan = (r: ArtisanRow) => ({
  id: r.id,
  name: r.name,
  cluster: r.cluster,
  craft: r.craft,
  bio: r.bio,
  portrait: r.portrait,
  contact: r.contact,
  website: r.website,
  shopUrl: r.shop_url,
  commissionUrl: r.commission_url,
  verified: Number(r.verified) === 1,
  placeholder: Number(r.placeholder) === 1,
  sort: Number(r.sort ?? 0),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})
export type Artisan = ReturnType<typeof toArtisan>

export async function listArtisansPublic(q: Queryable): Promise<Artisan[]> {
  const rows = await q.query<ArtisanRow>('SELECT * FROM artisans ORDER BY sort, name')
  return rows.map(toArtisan)
}

/* ------------------------------------------------------------------ */
/* Seeding                                                             */
/* ------------------------------------------------------------------ */

/** The bundled frontend config (src/museum/config) is the seed. */
export function readSeed(): ContentDoc {
  return bundledContent() as unknown as ContentDoc
}

const SEED_LOCK = 72_2601

/**
 * Replace ALL content of one exhibition (default: the default exhibition) with the seed.
 * The version keeps increasing (clients compare versions).
 */
export function seedContent(db: Db, seed: ContentDoc, onlyIfEmpty = false, exhibitionId?: string): Promise<number | null> {
  return db.tx(async (q) => {
    // serialise concurrent seeders (several serverless cold starts at once)
    if (db.dialect === 'postgres') await q.query('SELECT pg_advisory_xact_lock($1)', [SEED_LOCK])
    if (onlyIfEmpty && (await getMeta(q, 'seeded_at')) !== undefined) return null
    const ex = await resolveId(q, exhibitionId)
    const now = nowIso()
    // a brand-new database: the migration created the default exhibition row, but be safe
    if (!(await q.one('SELECT id FROM exhibitions LIMIT 1'))) {
      await q.run(
        `INSERT INTO exhibitions (id, slug, title, subtitle, status, is_default, theme, exhibition_text, welcome, sort, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'published', 1, $5, $6, $7, 0, $8, $9)`,
        [ex, ex, 'Hand Block Printing', '', '{"accent":"#8a5a3b"}', '{}', '{"title":"","body":""}', now, now],
      )
    }
    await q.run('DELETE FROM content_items WHERE exhibition_id = $1', [ex])
    for (const c of COLLECTIONS) {
      const items = seed[c] ?? []
      for (let i = 0; i < items.length; i++) {
        await q.run('INSERT INTO content_items (exhibition_id, collection, id, json, sort, updated_at) VALUES ($1, $2, $3, $4, $5, $6)', [
          ex,
          c,
          String(items[i].id),
          JSON.stringify(items[i]),
          i,
          now,
        ])
      }
    }
    await q.run('UPDATE exhibitions SET exhibition_text = $1, welcome = $2, updated_at = $3 WHERE id = $4', [
      JSON.stringify(seed.exhibition ?? {}),
      JSON.stringify(seed.welcome ?? { title: '', body: '' }),
      now,
      ex,
    ])
    await setMeta(q, 'seeded_at', now)
    return bumpVersion(q)
  })
}

export async function isSeeded(db: Db): Promise<boolean> {
  return (await getMeta(db, 'seeded_at')) !== undefined
}
