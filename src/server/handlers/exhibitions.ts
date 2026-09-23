/**
 * Multi-exhibition platform: the building is shared, each exhibition has its own content set.
 * Public: GET /api/exhibitions (published). Admin (role ≥ admin for structure; curators may list):
 * create / patch (title, slug, subtitle, theme, status = publish/unpublish) / delete /
 * duplicate / set default. Content inside an exhibition is edited by curators through the
 * /api/admin/content/* routes with `?exhibition=<id|slug>`.
 */
import 'server-only'
import { route } from '../http'
import { bumpVersion, DEFAULT_EXHIBITION_ID, type ExhibitionRow, findExhibition, toExhibition } from '../contentStore'
import { type Db, nowIso } from '../db'
import { fail, isRecord } from '../util'

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,59}$/
const HEX_RE = /^#[0-9a-f]{6}$/i

const withPath = (e: ReturnType<typeof toExhibition>) => ({ ...e, path: e.isDefault ? '/gallery' : `/gallery/${e.slug}` })

async function counts(db: Db) {
  const rows = await db.query<{ exhibition_id: string; n: number }>('SELECT exhibition_id, COUNT(*) AS n FROM content_items GROUP BY exhibition_id')
  return new Map(rows.map((r) => [r.exhibition_id, Number(r.n)]))
}

async function mustFind(db: Db, idOrSlug: string): Promise<ExhibitionRow> {
  const row = await findExhibition(db, decodeURIComponent(idOrSlug))
  return row ?? fail(404, 'Exhibition not found')
}

function readTheme(v: unknown): { accent?: string } {
  if (v === undefined || v === null) return {}
  if (!isRecord(v)) return fail(400, '"theme" must be an object')
  const out: { accent?: string } = {}
  if (v.accent !== undefined && v.accent !== '') {
    if (typeof v.accent !== 'string' || !HEX_RE.test(v.accent)) return fail(400, '"theme.accent" must be a #rrggbb colour')
    out.accent = v.accent.toLowerCase()
  }
  return out
}

const str = (v: unknown, name: string, max: number, required = false): string | undefined => {
  if (v === undefined) return required ? fail(400, `"${name}" is required`) : undefined
  if (typeof v !== 'string') return fail(400, `"${name}" must be a string`)
  const s = v.trim()
  if (required && !s) return fail(400, `"${name}" is required`)
  if (s.length > max) return fail(400, `"${name}" is too long (max ${max})`)
  return s
}

async function slugFree(db: Db, slug: string, exceptId?: string) {
  const hit = await db.one<{ id: string }>('SELECT id FROM exhibitions WHERE (slug = $1 OR id = $1) AND id <> $2', [slug, exceptId ?? ''])
  if (hit) fail(409, `Slug "${slug}" is already used`)
}

/** GET /api/exhibitions — published exhibitions (the default first). */
export const publicExhibitions = route(async ({ db }) => {
  const rows = await db.query<ExhibitionRow>("SELECT * FROM exhibitions WHERE status = 'published' ORDER BY is_default DESC, sort, created_at")
  return rows.map((r) => {
    const e = withPath(toExhibition(r))
    return { id: e.id, slug: e.slug, title: e.title, subtitle: e.subtitle, isDefault: e.isDefault, theme: e.theme, path: e.path }
  })
})

/** GET /api/admin/exhibitions — all (incl. drafts) with item counts; curators may read (switcher). */
export const adminListExhibitions = route(async (c) => {
  await c.requireCurator()
  const [rows, n] = await Promise.all([c.db.query<ExhibitionRow>('SELECT * FROM exhibitions ORDER BY is_default DESC, sort, created_at'), counts(c.db)])
  return rows.map((r) => ({ ...withPath(toExhibition(r)), items: n.get(r.id) ?? 0, hasTour: r.tour != null }))
})

async function insertExhibition(c: { db: Db; status: number }, b: Record<string, unknown>, from?: ExhibitionRow) {
  const slug = str(b.slug, 'slug', 60, true)!.toLowerCase()
  if (!SLUG_RE.test(slug)) return fail(400, 'Slug: 2–60 lower-case letters, digits and "-"')
  const title = str(b.title, 'title', 120) || (from ? `${from.title} (copy)` : fail(400, '"title" is required'))
  const subtitle = str(b.subtitle, 'subtitle', 200) ?? from?.subtitle ?? ''
  const theme = b.theme !== undefined ? readTheme(b.theme) : from ? (typeof from.theme === 'string' ? JSON.parse(from.theme) : from.theme) : {}
  await slugFree(c.db, slug)
  const now = nowIso()
  const emptyText = { kicker: '', title, subtitle, intro: '' }
  await c.db.tx(async (q) => {
    const max = await q.one<{ m: number | null }>('SELECT MAX(sort) AS m FROM exhibitions')
    const j = (v: unknown, fb: unknown) => (v === undefined || v === null ? JSON.stringify(fb) : typeof v === 'string' ? v : JSON.stringify(v))
    await q.run(
      `INSERT INTO exhibitions (id, slug, title, subtitle, status, is_default, theme, exhibition_text, welcome, tour, sort, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'draft', 0, $5, $6, $7, $8, $9, $10, $11)`,
      [
        slug,
        slug,
        title,
        subtitle,
        JSON.stringify(theme ?? {}),
        from ? j(from.exhibition_text, {}) : JSON.stringify(emptyText),
        from ? j(from.welcome, { title: '', body: '' }) : JSON.stringify({ title: `Welcome to ${title}`, body: '' }),
        from && from.tour != null ? j(from.tour, null) : null,
        (max?.m ?? 0) + 1,
        now,
        now,
      ],
    )
    if (from) {
      await q.run(
        `INSERT INTO content_items (exhibition_id, collection, id, json, sort, updated_at)
         SELECT $1, collection, id, json, sort, updated_at FROM content_items WHERE exhibition_id = $2`,
        [slug, from.id],
      )
    }
    await bumpVersion(q)
  })
  c.status = 201
  return withPath(toExhibition((await findExhibition(c.db, slug))!))
}

/**
 * POST /api/admin/exhibitions — admin. `{ slug, title, subtitle?, theme?, duplicateFrom? }`.
 * New exhibitions are drafts; without `duplicateFrom` they start with no content items.
 */
export const adminCreateExhibition = route(async (c) => {
  await c.requireAdmin()
  const b = await c.json()
  if (!isRecord(b)) return fail(400, 'Body must be an object')
  const from = typeof b.duplicateFrom === 'string' && b.duplicateFrom ? await mustFind(c.db, b.duplicateFrom) : undefined
  return insertExhibition(c, b, from)
})

/** POST /api/admin/exhibitions/:id/duplicate — admin. `{ slug, title? }` → the new draft copy (all content). */
export const adminDuplicateExhibition = route<{ id: string }>(async (c) => {
  await c.requireAdmin()
  const from = await mustFind(c.db, c.params.id)
  const b = await c.json()
  if (!isRecord(b)) return fail(400, 'Body must be { slug, title? }')
  return insertExhibition(c, b, from)
})

/** PATCH /api/admin/exhibitions/:id — admin. `{ title?, subtitle?, slug?, theme?, status?: 'draft'|'published', sort? }` */
export const adminPatchExhibition = route<{ id: string }>(async (c) => {
  await c.requireAdmin()
  const row = await mustFind(c.db, c.params.id)
  const b = await c.json()
  if (!isRecord(b)) return fail(400, 'Body must be an object')
  const sets: string[] = []
  const params: (string | number | null)[] = []
  const add = (col: string, v: string | number | null) => {
    params.push(v)
    sets.push(`${col} = $${params.length}`)
  }
  if (b.title !== undefined) add('title', str(b.title, 'title', 120, true)!)
  if (b.subtitle !== undefined) add('subtitle', str(b.subtitle, 'subtitle', 200) ?? '')
  if (b.slug !== undefined) {
    const slug = str(b.slug, 'slug', 60, true)!.toLowerCase()
    if (!SLUG_RE.test(slug)) return fail(400, 'Slug: 2–60 lower-case letters, digits and "-"')
    if (slug !== row.slug) await slugFree(c.db, slug, row.id)
    add('slug', slug)
  }
  if (b.theme !== undefined) add('theme', JSON.stringify(readTheme(b.theme)))
  if (b.status !== undefined) {
    if (b.status !== 'draft' && b.status !== 'published') return fail(400, '"status" must be "draft" or "published"')
    if (b.status === 'draft' && Number(row.is_default) === 1) return fail(409, 'The default exhibition cannot be unpublished — make another exhibition the default first')
    add('status', b.status)
  }
  if (b.sort !== undefined) {
    if (typeof b.sort !== 'number' || !Number.isFinite(b.sort)) return fail(400, '"sort" must be a number')
    add('sort', Math.round(b.sort))
  }
  if (!sets.length) return withPath(toExhibition(row))
  add('updated_at', nowIso())
  params.push(row.id)
  await c.db.tx(async (q) => {
    await q.run(`UPDATE exhibitions SET ${sets.join(', ')} WHERE id = $${params.length}`, params)
    await bumpVersion(q)
  })
  return withPath(toExhibition((await findExhibition(c.db, row.id))!))
})

/** POST /api/admin/exhibitions/:id/default — admin; the exhibition must be published. */
export const adminSetDefaultExhibition = route<{ id: string }>(async (c) => {
  await c.requireAdmin()
  const row = await mustFind(c.db, c.params.id)
  if (row.status !== 'published') return fail(409, 'Publish the exhibition before making it the default')
  await c.db.tx(async (q) => {
    await q.run('UPDATE exhibitions SET is_default = 0 WHERE is_default = 1 AND id <> $1', [row.id])
    await q.run('UPDATE exhibitions SET is_default = 1, updated_at = $1 WHERE id = $2', [nowIso(), row.id])
    await bumpVersion(q)
  })
  return withPath(toExhibition((await findExhibition(c.db, row.id))!))
})

/** DELETE /api/admin/exhibitions/:id — admin; not the default one. Removes its content items. */
export const adminDeleteExhibition = route<{ id: string }>(async (c) => {
  await c.requireAdmin()
  const row = await mustFind(c.db, c.params.id)
  if (Number(row.is_default) === 1) return fail(409, 'The default exhibition cannot be deleted')
  if (row.id === DEFAULT_EXHIBITION_ID && !c.url.searchParams.has('force')) return fail(409, `"${DEFAULT_EXHIBITION_ID}" holds the original content; add ?force=1 to delete it`)
  await c.db.tx(async (q) => {
    await q.run('DELETE FROM content_items WHERE exhibition_id = $1', [row.id])
    await q.run('DELETE FROM exhibitions WHERE id = $1', [row.id])
    await bumpVersion(q)
  })
  return { ok: true }
})
