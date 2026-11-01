/**
 * Content store: collection items as JSON rows scoped to an EXHIBITION (content_items.exhibition_id)
 * + per-exhibition texts (exhibitions.exhibition_text / welcome / tour) + a content version in `meta`
 * shared by both sites (it only ever goes up). Exhibitions belong to a site (exhibitions.site): every
 * lookup here sees only the current site's (src/server/site.ts), so one app never reads, edits or seeds
 * the other's. Item functions take an optional exhibition id; omitted = this site's default exhibition.
 *
 * Every save, delete and restore of an item also writes a content revision (history, restore, trash) and
 * stamps the row with `updated_at` / `updated_by`; a write may name the stamp it expects
 * (`expectedUpdatedAt`) and fails with a 409 conflict when someone else saved in between.
 */
import 'server-only'
import { bundledContent } from '../museum/content/content'
import { SITE } from '../site'
import type { Actor } from './audit'
import { type Db, nowIso, type Param, parseJson, type Queryable } from './db'
import { currentSite, metaKey, siteId } from './site'
import { HttpError } from './util'

export const COLLECTIONS = ['artworks', 'exhibits', 'infographics', 'videos', 'objects'] as const
export type Collection = (typeof COLLECTIONS)[number]
export const isCollection = (v: unknown): v is Collection =>
  typeof v === 'string' && (COLLECTIONS as readonly string[]).includes(v)

export type Item = Record<string, unknown> & { id: string }

/**
 * This build's own default exhibition (src/site.ts). Server code reads `currentSite().defaultExhibitionId`,
 * which a test can switch with `runAsSite`.
 */
export const DEFAULT_EXHIBITION_ID = SITE.defaultExhibitionId

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
  /** This site's maker profiles (shared by all of its exhibitions). */
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
  site?: string
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

/** This site's default exhibition row (falls back to its first row, then undefined when it has none). */
export async function defaultExhibitionRow(q: Queryable): Promise<ExhibitionRow | undefined> {
  const site = siteId()
  return (
    (await q.one<ExhibitionRow>('SELECT * FROM exhibitions WHERE site = $1 AND is_default = 1', [site])) ??
    (await q.one<ExhibitionRow>('SELECT * FROM exhibitions WHERE site = $1 ORDER BY sort, created_at LIMIT 1', [site]))
  )
}

/** Look one of this site's exhibitions up by id or slug (`undefined`/'' = the default exhibition). */
export async function findExhibition(q: Queryable, idOrSlug?: string | null): Promise<ExhibitionRow | undefined> {
  if (!idOrSlug) return defaultExhibitionRow(q)
  return q.one<ExhibitionRow>(
    'SELECT * FROM exhibitions WHERE site = $2 AND (id = $1 OR slug = $1) ORDER BY CASE WHEN id = $1 THEN 0 ELSE 1 END LIMIT 1',
    [idOrSlug, siteId()],
  )
}

async function resolveId(q: Queryable, exhibitionId?: string): Promise<string> {
  if (exhibitionId) return exhibitionId
  return (await defaultExhibitionRow(q))?.id ?? currentSite().defaultExhibitionId
}

/**
 * The site every row written before sites belongs to (the column default of supabase/migrations/
 * 20261101000000_sites.sql): the hand block museum.
 */
export const LEGACY_SITE = 'hand-block'

/**
 * Shared meta key (no site prefix) a site's bootstrap sets once its site-aware build runs. The sites migration
 * is additive for the schema, but not for the data: hand-block code from before sites reads
 * `WHERE is_default = 1` with no site, lists every exhibition and cleans up every site's analytics. The
 * moment another site writes its own default exhibition, such code would serve and edit that site's rows.
 * So another site does not create its default exhibition while hand-block has served the database and
 * hand-block's site-aware build has never started (see ensureSiteExhibition).
 */
export const sitesAwareKey = (site: string) => `sites_aware:${site}`

/**
 * Hand-block's seed marker, the same key before and after sites (its meta prefix is ''): every hand-block build
 * sets it on its first start, so it tells that hand-block code, possibly from before sites, has served this
 * database. (The hand-block exhibition row alone says nothing: an early migration inserts it everywhere.)
 */
const LEGACY_SEEDED_KEY = 'seeded_at'

/** Per-site meta key set when an admin deletes the site's own default exhibition (bootstrap leaves it deleted). */
export const DEFAULT_DELETED_KEY = 'default_exhibition_deleted_at'

/** Bootstrap: record that this site runs site-aware code (sitesAwareKey). */
export async function markSiteAware(db: Db): Promise<void> {
  const key = sitesAwareKey(siteId())
  if ((await getMeta(db, key)) === undefined) await setMeta(db, key, nowIso())
}

/**
 * Bootstrap: make sure this site's own default exhibition exists (published; the site's default when it has
 * none yet) on the site's first start. Never touches another site's rows; refuses when its id or slug is
 * taken by the other site. Returns whether the exhibition exists for this site afterwards.
 *
 * It is created once only: when an admin has deleted it on purpose (DEFAULT_DELETED_KEY), or this site has
 * already seeded and still has exhibitions of its own (it was deleted by code from before that key), it stays
 * deleted rather than coming back empty and published on every cold start.
 *
 * A site other than hand-block refuses to start (throws) rather than create its default exhibition while
 * hand-block has served this database (LEGACY_SEEDED_KEY) but no site-aware hand-block build has started yet
 * (sitesAwareKey): deploy hand-block first, then this site. A database hand-block never served (a clay-only
 * one) is not held up.
 */
export async function ensureSiteExhibition(db: Db): Promise<boolean> {
  const s = currentSite()
  const have = await db.one<{ site: string }>('SELECT site FROM exhibitions WHERE id = $1', [s.defaultExhibitionId])
  if (have?.site === s.id) return true
  if ((await getMeta(db, metaKey(DEFAULT_DELETED_KEY))) !== undefined) return false
  return db.tx(async (q) => {
    if (db.dialect === 'postgres') await q.query('SELECT pg_advisory_xact_lock($1)', [SEED_LOCK])
    const row = await q.one<{ site: string }>('SELECT site FROM exhibitions WHERE id = $1 OR slug = $1 ORDER BY CASE WHEN id = $1 THEN 0 ELSE 1 END LIMIT 1', [
      s.defaultExhibitionId,
    ])
    if (row?.site === s.id) return true
    if (row) throw new Error(`exhibition "${s.defaultExhibitionId}" belongs to site "${row.site}", not "${s.id}" — give this site another defaultExhibitionId in src/site.ts`)
    if ((await getMeta(q, metaKey('seeded_at'))) !== undefined && (await q.one('SELECT id FROM exhibitions WHERE site = $1 LIMIT 1', [s.id]))) return false
    const hasDefault = await q.one('SELECT id FROM exhibitions WHERE site = $1 AND is_default = 1', [s.id])
    if (!hasDefault && s.id !== LEGACY_SITE && (await getMeta(q, LEGACY_SEEDED_KEY)) !== undefined && (await getMeta(q, sitesAwareKey(LEGACY_SITE))) === undefined) {
      throw new Error(
        `not creating "${s.defaultExhibitionId}" yet: the hand block museum has served this database, and its site-aware build has not started since the sites migration. Code from before sites would serve this site's default exhibition as its own — deploy hand-block first, then this site (infra/deploy-vercel.md)`,
      )
    }
    const now = nowIso()
    await q.run(
      `INSERT INTO exhibitions (id, slug, title, subtitle, status, is_default, theme, exhibition_text, welcome, sort, created_at, updated_at, site)
       VALUES ($1, $1, $2, $3, 'published', $4, '{}', $5, '{"title":"","body":""}', 0, $6, $6, $7)`,
      [
        s.defaultExhibitionId,
        s.defaultExhibitionTitle,
        s.defaultExhibitionSubtitle,
        hasDefault ? 0 : 1,
        JSON.stringify({ kicker: '', title: s.defaultExhibitionTitle, subtitle: s.defaultExhibitionSubtitle, intro: '' }),
        now,
        s.id,
      ],
    )
    await bumpVersion(q)
    return true
  })
}

/* ------------------------------------------------------------------ */
/* Stamps, conflicts, revisions                                        */
/* ------------------------------------------------------------------ */

export type RevisionOp = 'create' | 'update' | 'delete' | 'restore'

/** What a save, delete or restore may carry besides the item. */
export interface WriteOpts {
  actor?: Actor | null
  /**
   * The `updated_at` the editor loaded (from GET /api/admin/content/stamps), or 'new' when the item must
   * not exist yet. Omitted: last write wins, as before.
   */
  expectedUpdatedAt?: string | null
  /** Called inside the write's transaction (the audit row goes here). */
  onWrite?: (q: Queryable, r: WriteResult) => Promise<void>
}

export interface WriteResult {
  version: number
  op: RevisionOp
  updatedAt: string
  updatedBy: string | null
  /** The item before the write (null when it did not exist). */
  previous: Item | null
  /** The item after the write (null after a delete). */
  item: Item | null
}

interface StampRow {
  json: unknown
  sort: number
  updated_at: string
  updated_by: string | null
}

/** A conflict: 409 `{ error: 'conflict', message, current, updatedAt, updatedBy }`. */
function conflict(message: string, row: StampRow | undefined): never {
  throw new HttpError(409, message, {
    error: 'conflict',
    message,
    current: row ? parseJson<Item>(row.json) : null,
    updatedAt: row?.updated_at ?? null,
    updatedBy: row?.updated_by ?? null,
  })
}

/** Throws a 409 when the row is not in the state the editor expected; 400 for a malformed expectation. */
export function checkExpected(expected: string | null | undefined, row: StampRow | undefined) {
  if (!expected) return
  if (expected === 'new') {
    if (row) conflict(`An item with this id was saved${row.updated_by ? ` by ${row.updated_by}` : ''} after you started. Open it to see their version.`, row)
    return
  }
  const want = Date.parse(expected)
  if (Number.isNaN(want)) throw new HttpError(400, 'X-Expected-Updated-At must be a timestamp from the stamps list, or "new"')
  if (!row) return conflict('This item was deleted after you opened it. Saving now would bring it back.', row)
  if (Date.parse(row.updated_at) !== want) {
    conflict(`This item was changed${row.updated_by ? ` by ${row.updated_by}` : ''} after you opened it. Review their version before saving yours.`, row)
  }
}

/** A stamp strictly after `prev`, so two saves in the same millisecond still differ. */
function nextStamp(prev?: string | null): string {
  const p = prev ? Date.parse(prev) : NaN
  const now = Date.now()
  return new Date(Number.isNaN(p) || now > p ? now : p + 1).toISOString()
}

/** Revisions kept per item (history shows them all). */
export const REVISIONS_KEPT = 100

async function addRevision(q: Queryable, ex: string, collection: string, id: string, op: RevisionOp, item: Item | null, actor: Actor | null | undefined, at: string) {
  await q.run(
    `INSERT INTO content_revisions (site, exhibition_id, collection, item_id, op, json, actor_id, actor_email, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [siteId(), ex, collection, id, op, item ? JSON.stringify(item) : null, actor?.id ?? null, actor?.email ?? null, at],
  )
  await q.run(
    `DELETE FROM content_revisions WHERE site = $4 AND exhibition_id = $1 AND collection = $2 AND item_id = $3 AND id <= (
       SELECT id FROM content_revisions WHERE site = $4 AND exhibition_id = $1 AND collection = $2 AND item_id = $3 ORDER BY id DESC LIMIT 1 OFFSET ${REVISIONS_KEPT})`,
    [ex, collection, id, siteId()],
  )
}

const stampOf = (q: Queryable, ex: string, collection: string, id: string) =>
  q.one<StampRow>('SELECT json, sort, updated_at, updated_by FROM content_items WHERE exhibition_id = $1 AND collection = $2 AND id = $3', [ex, collection, id])

/** Advisory-lock namespace (first key) for one content item's writes; the second key hashes the item. */
const ITEM_LOCK = 72_2602

/**
 * The item's stamp, read for a write that checks it. On Postgres (READ COMMITTED) a plain read would let two
 * writers both see stamp T, both pass the check and both write, the second silently replacing the first; and
 * a row lock cannot cover an item that does not exist yet ('new'). So every write of one item first takes a
 * transaction-scoped advisory lock on (exhibition, collection, id): the next writer waits, and then reads the
 * stamp the first one committed. SQLite needs nothing, its tx() is BEGIN IMMEDIATE (one writer at a time).
 */
async function lockedStampOf(db: Db, q: Queryable, ex: string, collection: string, id: string) {
  if (db.dialect === 'postgres') await q.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [ITEM_LOCK, `${ex}/${collection}/${id}`])
  return stampOf(q, ex, collection, id)
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
  const ex = row?.id ?? exhibitionId ?? currentSite().defaultExhibitionId
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

/**
 * Create or replace an item (keeps its sort position when replacing, appends when new), stamp it, and record
 * the revision. `opts.op = 'restore'` labels the revision of a restore.
 */
export function putItem(db: Db, collection: Collection, item: Item, exhibitionId?: string, opts: WriteOpts & { op?: 'restore' } = {}): Promise<WriteResult> {
  return db.tx(async (q) => {
    const ex = await resolveId(q, exhibitionId)
    const existing = await lockedStampOf(db, q, ex, collection, item.id)
    checkExpected(opts.expectedUpdatedAt, existing)
    let sort = existing?.sort
    if (sort === undefined) {
      const max = await q.one<{ m: number | null }>('SELECT MAX(sort) AS m FROM content_items WHERE exhibition_id = $1 AND collection = $2', [ex, collection])
      sort = (max?.m ?? -1) + 1
    }
    const updatedAt = nextStamp(existing?.updated_at)
    const updatedBy = opts.actor?.email ?? null
    // Create-only ('new') never replaces a row, whatever happened since the check: 0 rows written is a 409.
    const createOnly = opts.expectedUpdatedAt === 'new'
    const written = await q.run(
      `INSERT INTO content_items (exhibition_id, collection, id, json, sort, updated_at, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (exhibition_id, collection, id) DO ${createOnly ? 'NOTHING' : 'UPDATE SET json = excluded.json, updated_at = excluded.updated_at, updated_by = excluded.updated_by'}`,
      [ex, collection, item.id, JSON.stringify(item), sort, updatedAt, updatedBy],
    )
    if (createOnly && !written) checkExpected('new', await stampOf(q, ex, collection, item.id))
    const op: RevisionOp = opts.op ?? (existing ? 'update' : 'create')
    await addRevision(q, ex, collection, item.id, op, item, opts.actor, updatedAt)
    const result: WriteResult = { version: await bumpVersion(q), op, updatedAt, updatedBy, previous: existing ? parseJson<Item>(existing.json) : null, item }
    await opts.onWrite?.(q, result)
    return result
  })
}

/** Delete an item (its last state goes to the revisions, so it can be restored from the trash). null = it did not exist. */
export function deleteItem(db: Db, collection: Collection, id: string, exhibitionId?: string, opts: WriteOpts = {}): Promise<WriteResult | null> {
  return db.tx(async (q) => {
    const ex = await resolveId(q, exhibitionId)
    const existing = await lockedStampOf(db, q, ex, collection, id)
    if (!existing && !opts.expectedUpdatedAt) return null
    checkExpected(opts.expectedUpdatedAt, existing)
    if (!existing) return null
    await q.run('DELETE FROM content_items WHERE exhibition_id = $1 AND collection = $2 AND id = $3', [ex, collection, id])
    const at = nextStamp(existing.updated_at)
    const previous = parseJson<Item>(existing.json)
    await addRevision(q, ex, collection, id, 'delete', previous, opts.actor, at)
    const result: WriteResult = { version: await bumpVersion(q), op: 'delete', updatedAt: at, updatedBy: opts.actor?.email ?? null, previous, item: null }
    await opts.onWrite?.(q, result)
    return result
  })
}

/** "<collection>/<id>" → the item's stamp, for every item of the exhibition. */
export async function listStamps(q: Queryable, exhibitionId: string): Promise<Record<string, { updatedAt: string; updatedBy: string | null }>> {
  const rows = await q.query<{ collection: string; id: string; updated_at: string; updated_by: string | null }>(
    'SELECT collection, id, updated_at, updated_by FROM content_items WHERE exhibition_id = $1 ORDER BY collection, sort, id',
    [exhibitionId],
  )
  const out: Record<string, { updatedAt: string; updatedBy: string | null }> = {}
  for (const r of rows) out[`${r.collection}/${r.id}`] = { updatedAt: r.updated_at, updatedBy: r.updated_by ?? null }
  return out
}

export interface Revision {
  rev: number
  at: string
  actorEmail: string | null
  op: RevisionOp
  item: Item | null
}

interface RevisionRow {
  id: number
  collection: string
  item_id: string
  op: RevisionOp
  json: unknown
  actor_email: string | null
  created_at: string
}

const toRevision = (r: RevisionRow): Revision => ({
  rev: Number(r.id),
  at: r.created_at,
  actorEmail: r.actor_email,
  op: r.op,
  item: r.json == null ? null : parseJson<Item>(r.json),
})

/** An item's revisions, newest first (at most REVISIONS_KEPT). */
export async function itemHistory(q: Queryable, exhibitionId: string, collection: Collection, id: string): Promise<Revision[]> {
  const rows = await q.query<RevisionRow>(
    `SELECT id, collection, item_id, op, json, actor_email, created_at FROM content_revisions
     WHERE site = $1 AND exhibition_id = $2 AND collection = $3 AND item_id = $4 ORDER BY id DESC LIMIT ${REVISIONS_KEPT}`,
    [siteId(), exhibitionId, collection, id],
  )
  return rows.map(toRevision)
}

/**
 * Put an item back as it was at revision `rev` (a delete's revision holds the item as it was before the
 * delete, so a deleted item comes back too). Recorded as a 'restore' revision; 404 for an unknown revision.
 * `opts.expectedUpdatedAt` guards it like a save: 'new' when bringing back a deleted item (409 if someone
 * has made the id again since), the item's stamp when replacing the current version.
 */
export async function restoreItem(
  db: Db,
  exhibitionId: string,
  collection: Collection,
  id: string,
  rev: number,
  opts: WriteOpts = {},
): Promise<{ item: Item; result: WriteResult }> {
  const r = await db.one<RevisionRow>(
    `SELECT id, collection, item_id, op, json, actor_email, created_at FROM content_revisions
     WHERE id = $1 AND site = $2 AND exhibition_id = $3 AND collection = $4 AND item_id = $5`,
    [rev, siteId(), exhibitionId, collection, id],
  )
  if (!r) throw new HttpError(404, 'That version of this item is no longer kept.')
  if (r.json == null) throw new HttpError(409, 'That version has nothing to restore.')
  const item = { ...parseJson<Item>(r.json), id }
  const result = await putItem(db, collection, item, exhibitionId, { ...opts, op: 'restore' })
  return { item, result }
}

export interface TrashItem {
  collection: Collection
  id: string
  title: string
  deletedAt: string
  deletedBy: string | null
  rev: number
}

/** Items of the exhibition whose last revision is a delete and that have not been made again, newest first. */
export async function listTrash(q: Queryable, exhibitionId: string): Promise<TrashItem[]> {
  const rows = await q.query<RevisionRow>(
    `SELECT r.id, r.collection, r.item_id, r.op, r.json, r.actor_email, r.created_at FROM content_revisions r
     WHERE r.site = $1 AND r.exhibition_id = $2 AND r.op = 'delete'
       AND r.id = (SELECT MAX(r2.id) FROM content_revisions r2 WHERE r2.site = r.site AND r2.exhibition_id = r.exhibition_id AND r2.collection = r.collection AND r2.item_id = r.item_id)
       AND NOT EXISTS (SELECT 1 FROM content_items ci WHERE ci.exhibition_id = r.exhibition_id AND ci.collection = r.collection AND ci.id = r.item_id)
     ORDER BY r.id DESC LIMIT 500`,
    [siteId(), exhibitionId],
  )
  return rows
    .filter((r) => isCollection(r.collection))
    .map((r) => {
      const item = r.json == null ? null : parseJson<Item>(r.json)
      return {
        collection: r.collection as Collection,
        id: r.item_id,
        title: typeof item?.title === 'string' && item.title ? item.title : r.item_id,
        deletedAt: r.created_at,
        deletedBy: r.actor_email,
        rev: Number(r.id),
      }
    })
}

const TEXT_COLUMN = { exhibition: 'exhibition_text', welcome: 'welcome', tour: 'tour' } as const

/**
 * Per-exhibition JSON texts: reveal-wall text, reception welcome, tour-stop override (null clears it).
 * `onWrite` runs inside the write's transaction (the audit row).
 */
export function putMetaJson(
  db: Db,
  key: 'exhibition' | 'welcome' | 'tour',
  value: unknown,
  exhibitionId?: string,
  onWrite?: (q: Queryable) => Promise<void>,
): Promise<number> {
  return db.tx(async (q) => {
    const ex = await resolveId(q, exhibitionId)
    await q.run(`UPDATE exhibitions SET ${TEXT_COLUMN[key]} = $1, updated_at = $2 WHERE id = $3`, [value === null ? null : JSON.stringify(value), nowIso(), ex])
    await onWrite?.(q)
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

/** This site's maker profiles. */
export async function listArtisansPublic(q: Queryable): Promise<Artisan[]> {
  const rows = await q.query<ArtisanRow>('SELECT * FROM artisans WHERE site = $1 ORDER BY sort, name', [siteId()])
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

/** Content rows per seed INSERT: 7 parameters a row keeps a statement far under both drivers' parameter limits. */
const SEED_INSERT_ROWS = 200

/**
 * Replace ALL content of one of this site's exhibitions with the seed. The exhibition is always named — the
 * bootstrap passes the site's own default (`currentSite().defaultExhibitionId`), a reset the exhibition it
 * resets — and must belong to this site. With `onlyIfEmpty` it does nothing once this site has seeded
 * (meta `seeded_at`, per site). A reset (not `onlyIfEmpty`) keeps what it replaces: the old items go to the
 * revisions as deletes, so anything the seed does not bring back stays in the trash, restorable.
 * The version keeps increasing (clients compare versions).
 */
export function seedContent(db: Db, seed: ContentDoc, onlyIfEmpty: boolean, exhibitionId: string, actor?: Actor | null): Promise<number | null> {
  return db.tx(async (q) => {
    // serialise concurrent seeders (several serverless cold starts at once, both sites)
    if (db.dialect === 'postgres') await q.query('SELECT pg_advisory_xact_lock($1)', [SEED_LOCK])
    if (onlyIfEmpty && (await getMeta(q, metaKey('seeded_at'))) !== undefined) return null
    const ex = exhibitionId
    const site = siteId()
    const owner = await q.one<{ site: string }>('SELECT site FROM exhibitions WHERE id = $1', [ex])
    if (!owner) throw new Error(`seedContent: exhibition "${ex}" does not exist`)
    if (owner.site !== site) throw new Error(`seedContent: exhibition "${ex}" belongs to site "${owner.site}", not "${site}"`)
    const now = nowIso()
    const who = actor?.email ?? null
    // Postgres types a parameter in a SELECT list as text unless told otherwise.
    const [t, ts] = db.dialect === 'postgres' ? ['::text', '::timestamptz'] : ['', '']
    const revisionsFrom = (op: RevisionOp) =>
      q.run(
        `INSERT INTO content_revisions (site, exhibition_id, collection, item_id, op, json, actor_id, actor_email, created_at)
         SELECT $1${t}, exhibition_id, collection, id, '${op}', json, $2${t}, $3${t}, $4${ts} FROM content_items WHERE exhibition_id = $5`,
        [site, actor?.id ?? null, who, now, ex],
      )
    if (!onlyIfEmpty) await revisionsFrom('delete')
    await q.run('DELETE FROM content_items WHERE exhibition_id = $1', [ex])
    // Multi-row INSERTs (SEED_INSERT_ROWS a statement) rather than one round trip per item; same rows, same order.
    const rows: Param[][] = COLLECTIONS.flatMap((c) => (seed[c] ?? []).map((item, i) => [ex, c, String(item.id), JSON.stringify(item), i, now, who]))
    for (let start = 0; start < rows.length; start += SEED_INSERT_ROWS) {
      const chunk = rows.slice(start, start + SEED_INSERT_ROWS)
      const values = chunk.map((_, r) => `(${Array.from({ length: 7 }, (_, k) => `$${r * 7 + k + 1}`).join(', ')})`).join(', ')
      await q.run(`INSERT INTO content_items (exhibition_id, collection, id, json, sort, updated_at, updated_by) VALUES ${values}`, chunk.flat())
    }
    if (!onlyIfEmpty) await revisionsFrom('create')
    await q.run('UPDATE exhibitions SET exhibition_text = $1, welcome = $2, updated_at = $3 WHERE id = $4', [
      JSON.stringify(seed.exhibition ?? {}),
      JSON.stringify(seed.welcome ?? { title: '', body: '' }),
      now,
      ex,
    ])
    await setMeta(q, metaKey('seeded_at'), now)
    return bumpVersion(q)
  })
}

/** Whether this site has seeded its content (meta `seeded_at`, per site). */
export async function isSeeded(db: Db): Promise<boolean> {
  return (await getMeta(db, metaKey('seeded_at'))) !== undefined
}
