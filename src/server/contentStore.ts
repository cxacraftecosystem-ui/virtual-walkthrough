/** Content store: collection items as JSON rows + key/value meta (version, exhibition, welcome). */
import 'server-only'
import { bundledContent } from '../museum/content/content'
import { type Db, nowIso, parseJson, type Queryable } from './db'

export const COLLECTIONS = ['artworks', 'exhibits', 'infographics', 'videos', 'objects'] as const
export type Collection = (typeof COLLECTIONS)[number]
export const isCollection = (v: unknown): v is Collection =>
  typeof v === 'string' && (COLLECTIONS as readonly string[]).includes(v)

export type Item = Record<string, unknown> & { id: string }

export interface ContentDoc {
  version: number
  exhibition: Record<string, unknown>
  welcome: { title: string; body: string }
  artworks: Item[]
  exhibits: Item[]
  infographics: Item[]
  videos: Item[]
  objects: Item[]
}

async function getMeta(q: Queryable, key: string): Promise<string | undefined> {
  return (await q.one<{ value: string }>('SELECT value FROM meta WHERE key = $1', [key]))?.value
}
async function setMeta(q: Queryable, key: string, value: string) {
  await q.run('INSERT INTO meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [key, value])
}

export async function getVersion(q: Queryable): Promise<number> {
  return Number((await getMeta(q, 'version')) ?? 0)
}

/** Increment and return the content version. Call inside the write transaction. */
async function bumpVersion(q: Queryable): Promise<number> {
  // single statement → atomic even under concurrent writers
  await q.run(
    `INSERT INTO meta (key, value) VALUES ('version', '1')
     ON CONFLICT (key) DO UPDATE SET value = CAST(CAST(meta.value AS INTEGER) + 1 AS TEXT)`,
  )
  return getVersion(q)
}

export async function listItems(q: Queryable, collection: Collection): Promise<Item[]> {
  const rows = await q.query<{ json: unknown }>('SELECT json FROM content_items WHERE collection = $1 ORDER BY sort, id', [collection])
  return rows.map((r) => parseJson<Item>(r.json))
}

export async function getContent(db: Db): Promise<ContentDoc> {
  const [version, exhibition, welcome, items] = await Promise.all([
    getVersion(db),
    getMeta(db, 'exhibition'),
    getMeta(db, 'welcome'),
    db.query<{ collection: Collection; json: unknown }>('SELECT collection, json FROM content_items ORDER BY sort, id'),
  ])
  const doc: ContentDoc = {
    version,
    exhibition: JSON.parse(exhibition ?? '{}'),
    welcome: JSON.parse(welcome ?? '{"title":"","body":""}'),
    artworks: [],
    exhibits: [],
    infographics: [],
    videos: [],
    objects: [],
  }
  for (const r of items) if (isCollection(r.collection)) doc[r.collection].push(parseJson<Item>(r.json))
  return doc
}

/** Create or replace an item (keeps its sort position when replacing, appends when new). */
export function putItem(db: Db, collection: Collection, item: Item): Promise<number> {
  return db.tx(async (q) => {
    const existing = await q.one<{ sort: number }>('SELECT sort FROM content_items WHERE collection = $1 AND id = $2', [collection, item.id])
    let sort = existing?.sort
    if (sort === undefined) {
      const max = await q.one<{ m: number | null }>('SELECT MAX(sort) AS m FROM content_items WHERE collection = $1', [collection])
      sort = (max?.m ?? -1) + 1
    }
    await q.run(
      `INSERT INTO content_items (collection, id, json, sort, updated_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (collection, id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
      [collection, item.id, JSON.stringify(item), sort, nowIso()],
    )
    return bumpVersion(q)
  })
}

export function deleteItem(db: Db, collection: Collection, id: string): Promise<boolean> {
  return db.tx(async (q) => {
    const n = await q.run('DELETE FROM content_items WHERE collection = $1 AND id = $2', [collection, id])
    if (n === 0) return false
    await bumpVersion(q)
    return true
  })
}

export function putMetaJson(db: Db, key: 'exhibition' | 'welcome', value: unknown): Promise<number> {
  return db.tx(async (q) => {
    await setMeta(q, key, JSON.stringify(value))
    return bumpVersion(q)
  })
}

/* ------------------------------------------------------------------ */
/* Seeding                                                             */
/* ------------------------------------------------------------------ */

/** The bundled frontend config (src/museum/config) is the seed. */
export function readSeed(): ContentDoc {
  return bundledContent() as unknown as ContentDoc
}

const SEED_LOCK = 72_2601

/** Replace ALL content with the seed. The version keeps increasing (clients compare versions). */
export function seedContent(db: Db, seed: ContentDoc, onlyIfEmpty = false): Promise<number | null> {
  return db.tx(async (q) => {
    // serialise concurrent seeders (several serverless cold starts at once)
    if (db.dialect === 'postgres') await q.query('SELECT pg_advisory_xact_lock($1)', [SEED_LOCK])
    if (onlyIfEmpty && (await getMeta(q, 'seeded_at')) !== undefined) return null
    await q.run('DELETE FROM content_items')
    const now = nowIso()
    for (const c of COLLECTIONS) {
      const items = seed[c] ?? []
      for (let i = 0; i < items.length; i++) {
        await q.run('INSERT INTO content_items (collection, id, json, sort, updated_at) VALUES ($1, $2, $3, $4, $5)', [
          c,
          String(items[i].id),
          JSON.stringify(items[i]),
          i,
          now,
        ])
      }
    }
    await setMeta(q, 'exhibition', JSON.stringify(seed.exhibition ?? {}))
    await setMeta(q, 'welcome', JSON.stringify(seed.welcome ?? { title: '', body: '' }))
    await setMeta(q, 'seeded_at', now)
    return bumpVersion(q)
  })
}

export async function isSeeded(db: Db): Promise<boolean> {
  return (await getMeta(db, 'seeded_at')) !== undefined
}
