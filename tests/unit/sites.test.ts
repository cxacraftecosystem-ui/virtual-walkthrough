/**
 * Two museums, one database (supabase/migrations/20261101000000_sites.sql, src/server/site.ts): the hand block
 * printing museum and the clay pavilion share every table, and each app must see only its own rows.
 *
 * Runs the real route handlers on a throwaway SQLite file, switching between the two sites with `runAsSite`
 * (one process acting as both apps), and pins:
 *  - isolation of exhibitions, media, prints, comments, analytics, errors and makers;
 *  - bootstrap: each site seeds its own default exhibition and leaves the other's content alone;
 *  - optimistic concurrency (X-Expected-Updated-At → 409 with the current item);
 *  - history, restore (a deleted item too) and the trash;
 *  - an audit row for every admin change, per site; the bulk moderation endpoints;
 *  - tour validation naming the field at fault, media pagination, the live room check;
 *  - the migration runner's ledger check (sha256 mismatch refused, unknown migrations reported).
 *
 * npm test
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

// A private database and media folder, before any server module reads its configuration.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'museum-sites-'))
process.env.DB_PATH = path.join(dir, 'museum.sqlite')
process.env.MEDIA_DIR = path.join(dir, 'media')
for (const k of ['DATABASE_URL', 'USE_REMOTE', 'S3_BUCKET', 'VERCEL', 'NEXT_PUBLIC_LIVE_ROOM', 'ERROR_SAMPLE_RATE']) delete process.env[k]

const { SITE } = await import('../../src/site')
const { runAsSite } = await import('../../src/server/site')
type SiteInfo = import('../../src/server/site').SiteInfo
const { services, seedSite } = await import('../../src/server/services')
const { createUser, startSession } = await import('../../src/server/auth')
const { getContent, getMeta, readSeed } = await import('../../src/server/contentStore')
const { checkMigrationPlan, migrationSha, planMigrations } = await import('../../src/server/db')
const { storeBatch } = await import('../../src/server/handlers/analytics')
const analytics = await import('../../src/server/handlers/analytics')
const curator = await import('../../src/server/handlers/curatorAnalytics')
const content = await import('../../src/server/handlers/content')
const exhibitions = await import('../../src/server/handlers/exhibitions')
const media = await import('../../src/server/handlers/media')
const prints = await import('../../src/server/handlers/prints')
const comments = await import('../../src/server/handlers/comments')
const errors = await import('../../src/server/handlers/errors')
const artisans = await import('../../src/server/handlers/artisans')
const overview = await import('../../src/server/handlers/overview')
const live = await import('../../src/server/handlers/live')
type Db = import('../../src/server/db').Db

const HB: SiteInfo = {
  id: 'hand-block',
  defaultExhibitionId: 'hand-block-printing',
  defaultExhibitionTitle: 'Hand Block Printing',
  defaultExhibitionSubtitle: 'Carved wood, natural dye and cloth',
  liveRoom: 'hand-block-printing',
  metaPrefix: '',
}
const CLAY: SiteInfo = {
  id: 'clay',
  defaultExhibitionId: 'clay-traditions',
  defaultExhibitionTitle: 'Clay Traditions',
  defaultExhibitionSubtitle: 'Terracotta, votive plaques and black pottery',
  liveRoom: 'clay-pavilion',
  metaPrefix: 'clay:',
}
/** The site this build is (it bootstraps first), and the other one. */
const FIRST = SITE.id === HB.id ? HB : CLAY
const SECOND = FIRST === HB ? CLAY : HB

type Handler<P> = (req: Request, ctx?: { params: Promise<P> }) => Promise<Response>
interface Res {
  status: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are checked field by field
  body: any
}

/** Call a route handler as `site`. */
async function call<P = Record<string, never>>(
  site: SiteInfo,
  handler: Handler<P>,
  method: string,
  url: string,
  opts: { body?: unknown; cookie?: string; params?: P; headers?: Record<string, string>; form?: FormData } = {},
): Promise<Res> {
  return runAsSite(site, async () => {
    const headers: Record<string, string> = { ...opts.headers }
    if (opts.cookie) headers.cookie = opts.cookie
    let body: BodyInit | undefined
    if (opts.form) body = opts.form
    else if (opts.body !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(opts.body)
    }
    const res = await handler(new Request(`http://museum.test${url}`, { method, headers, body }), { params: Promise.resolve((opts.params ?? {}) as P) })
    const text = await res.text()
    return { status: res.status, body: (res.headers.get('content-type') ?? '').includes('json') ? JSON.parse(text) : text }
  })
}

async function staff(db: Db, email: string, role: 'curator' | 'admin'): Promise<string> {
  const u = await createUser(db, email, null, email.split('@')[0], { manualRole: role, emailVerified: true })
  const h = new Headers()
  await startSession(db, h, u.id)
  return h.get('set-cookie')!.split(';')[0]
}

/** A valid PNG header (signature + IHDR) of `w`×`h`: enough for the prints endpoint's checks. */
function png(w = 64, h = 64): string {
  const b = Buffer.alloc(64)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8)
  b.write('IHDR', 12, 'latin1')
  b.writeUInt32BE(w, 16)
  b.writeUInt32BE(h, 20)
  return `data:image/png;base64,${b.toString('base64')}`
}

const count = async (db: Db, sql: string, params: (string | number)[] = []) => Number((await db.one<{ n: number }>(sql, params))?.n ?? 0)

let db: Db
let admin: string
let cur: string

before(async () => {
  db = (await runAsSite(FIRST, () => services())).db // bootstraps FIRST, as its app would
  admin = await staff(db, 'admin.sites@example.org', 'admin')
  cur = await staff(db, 'curator.sites@example.org', 'curator')
})

after(async () => {
  await db.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('bootstrap', () => {
  it("seeds the second site's own default exhibition and leaves the first site's content untouched", async () => {
    const firstBefore = await runAsSite(FIRST, () => getContent(db))
    const firstRows = await db.query('SELECT * FROM content_items WHERE exhibition_id = $1 ORDER BY collection, id', [FIRST.defaultExhibitionId])
    assert.ok(firstRows.length > 0, 'the first site seeded its content')

    await runAsSite(SECOND, () => seedSite(db, () => undefined))

    const ex = await db.query<{ id: string; site: string; is_default: number; status: string }>('SELECT id, site, is_default, status FROM exhibitions WHERE id IN ($1, $2) ORDER BY id', [
      FIRST.defaultExhibitionId,
      SECOND.defaultExhibitionId,
    ])
    for (const s of [FIRST, SECOND]) {
      const row = ex.find((e) => e.id === s.defaultExhibitionId)!
      assert.deepEqual({ site: row.site, isDefault: Number(row.is_default), status: row.status }, { site: s.id, isDefault: 1, status: 'published' }, s.id)
    }
    const secondItems = await count(db, 'SELECT COUNT(*) AS n FROM content_items WHERE exhibition_id = $1', [SECOND.defaultExhibitionId])
    const seed = readSeed()
    assert.equal(secondItems, (['artworks', 'exhibits', 'infographics', 'videos', 'objects'] as const).reduce((n, k) => n + (seed[k]?.length ?? 0), 0))

    // The first site's items, texts and default are exactly as they were.
    assert.deepEqual(await db.query('SELECT * FROM content_items WHERE exhibition_id = $1 ORDER BY collection, id', [FIRST.defaultExhibitionId]), firstRows)
    const firstAfter = await runAsSite(FIRST, () => getContent(db))
    assert.deepEqual({ ...firstAfter, version: 0 }, { ...firstBefore, version: 0 })
    assert.equal(firstAfter.exhibitionMeta?.id, FIRST.defaultExhibitionId)
    assert.equal((await runAsSite(SECOND, () => getContent(db))).exhibitionMeta?.id, SECOND.defaultExhibitionId)

    // Per-site meta keys.
    assert.ok(await getMeta(db, `${HB.metaPrefix}seeded_at`))
    assert.ok(await getMeta(db, `${CLAY.metaPrefix}seeded_at`))
  })

  it('runs again without changing anything', async () => {
    const v = await getMeta(db, 'version')
    await runAsSite(SECOND, () => seedSite(db, () => undefined))
    await runAsSite(FIRST, () => seedSite(db, () => undefined))
    assert.equal(await getMeta(db, 'version'), v)
  })
})

describe('exhibitions are per site', () => {
  it('lists only its own, refuses a slug the other site uses, and keeps one default per site', async () => {
    const created = await call(CLAY, exhibitions.adminCreateExhibition, 'POST', '/api/admin/exhibitions', { cookie: admin, body: { slug: 'clay-summer', title: 'Summer clay' } })
    assert.equal(created.status, 201)

    const hbList = await call(HB, exhibitions.adminListExhibitions, 'GET', '/api/admin/exhibitions', { cookie: admin })
    const clayList = await call(CLAY, exhibitions.adminListExhibitions, 'GET', '/api/admin/exhibitions', { cookie: admin })
    assert.ok(hbList.body.every((e: { id: string }) => e.id !== 'clay-summer' && e.id !== CLAY.defaultExhibitionId))
    assert.deepEqual(clayList.body.map((e: { id: string }) => e.id).sort(), ['clay-summer', CLAY.defaultExhibitionId].sort())

    const taken = await call(HB, exhibitions.adminCreateExhibition, 'POST', '/api/admin/exhibitions', { cookie: admin, body: { slug: 'clay-summer', title: 'Mine' } })
    assert.equal(taken.status, 409)
    assert.match(taken.body.error, /other museum/)

    // the other site's exhibition is unknown here, for every by-id route
    assert.equal((await call(HB, exhibitions.adminDeleteExhibition, 'DELETE', '/api/admin/exhibitions/clay-summer', { cookie: admin, params: { id: 'clay-summer' } })).status, 404)
    assert.equal((await call(HB, content.listCollection, 'GET', '/api/admin/content/artworks?exhibition=clay-summer', { cookie: admin, params: { collection: 'artworks' } })).status, 404)
    assert.equal((await call(HB, content.publicContent, 'GET', `/api/content?exhibition=${CLAY.defaultExhibitionId}`)).status, 404)

    // a new default for clay leaves the hand-block default alone
    await call(CLAY, exhibitions.adminPatchExhibition, 'PATCH', '/api/admin/exhibitions/clay-summer', { cookie: admin, params: { id: 'clay-summer' }, body: { status: 'published' } })
    const def = await call(CLAY, exhibitions.adminSetDefaultExhibition, 'POST', '/api/admin/exhibitions/clay-summer/default', { cookie: admin, params: { id: 'clay-summer' } })
    assert.equal(def.status, 200)
    const defaults = (await db.query<{ id: string; site: string }>('SELECT id, site FROM exhibitions WHERE is_default = 1 ORDER BY site')).map((r) => ({ ...r }))
    assert.deepEqual(defaults, [
      { id: 'clay-summer', site: 'clay' },
      { id: HB.defaultExhibitionId, site: 'hand-block' },
    ])
    const pub = await call(HB, exhibitions.publicExhibitions, 'GET', '/api/exhibitions')
    assert.ok(pub.body.every((e: { id: string }) => e.id !== 'clay-summer'))

    // back to the seeded default, then remove the extra exhibition
    await call(CLAY, exhibitions.adminSetDefaultExhibition, 'POST', '/', { cookie: admin, params: { id: CLAY.defaultExhibitionId } })
    assert.equal((await call(CLAY, exhibitions.adminDeleteExhibition, 'DELETE', '/', { cookie: admin, params: { id: 'clay-summer' } })).status, 200)
  })
})

describe('content: concurrency, history, restore, trash', () => {
  const path = (id: string) => `/api/admin/content/artworks/${id}`
  const put = (body: Record<string, unknown>, expected?: string) =>
    call(HB, content.putContentItem, 'PUT', path(String(body.id)), {
      cookie: cur,
      params: { collection: 'artworks', id: String(body.id) },
      body,
      headers: expected ? { 'x-expected-updated-at': expected } : {},
    })

  it('refuses a stale save or delete with 409 and the current item', async () => {
    const first = await put({ id: 'cc-1', title: 'First' }, 'new')
    assert.equal(first.status, 200)
    assert.equal(first.body.updatedBy, 'curator.sites@example.org')
    const stamp = first.body.updatedAt as string

    const stamps = await call(HB, content.contentStamps, 'GET', '/api/admin/content/stamps', { cookie: cur })
    assert.deepEqual(stamps.body.stamps['artworks/cc-1'], { updatedAt: stamp, updatedBy: 'curator.sites@example.org' })

    const again = await put({ id: 'cc-1', title: 'Second' }, stamp)
    assert.equal(again.status, 200)
    assert.notEqual(again.body.updatedAt, stamp, 'every save moves the stamp, even within a millisecond')

    const stale = await put({ id: 'cc-1', title: 'Stale' }, stamp)
    assert.equal(stale.status, 409)
    assert.equal(stale.body.error, 'conflict')
    assert.match(stale.body.message, /changed by curator\.sites@example\.org/)
    assert.equal(stale.body.current.title, 'Second')
    assert.equal(stale.body.updatedAt, again.body.updatedAt)
    assert.equal(stale.body.updatedBy, 'curator.sites@example.org')

    const exists = await put({ id: 'cc-1', title: 'New?' }, 'new')
    assert.equal(exists.status, 409)

    const delStale = await call(HB, content.deleteContentItem, 'DELETE', path('cc-1'), { cookie: cur, params: { collection: 'artworks', id: 'cc-1' }, headers: { 'x-expected-updated-at': stamp } })
    assert.equal(delStale.status, 409)
    assert.equal((await put({ id: 'cc-1', title: 'Bad stamp' }, 'yesterday')).status, 400)
    // stamps never end up inside the stored item
    await put({ id: 'cc-1', title: 'Third', updatedAt: 'x', updatedBy: 'y' })
    const row = await db.one<{ json: string }>("SELECT json FROM content_items WHERE exhibition_id = $1 AND collection = 'artworks' AND id = 'cc-1'", [HB.defaultExhibitionId])
    assert.deepEqual(JSON.parse(row!.json), { id: 'cc-1', title: 'Third' })
  })

  it('keeps every version, restores one, and brings a deleted item back from the trash', async () => {
    await put({ id: 'hr-1', title: 'Version one' })
    await put({ id: 'hr-1', title: 'Version two' })
    const del = await call(HB, content.deleteContentItem, 'DELETE', path('hr-1'), { cookie: cur, params: { collection: 'artworks', id: 'hr-1' } })
    assert.equal(del.status, 200)

    const hist = await call(HB, content.contentHistory, 'GET', `${path('hr-1')}/history`, { cookie: cur, params: { collection: 'artworks', id: 'hr-1' } })
    assert.deepEqual(
      hist.body.revisions.map((r: { op: string; item: { title: string } }) => [r.op, r.item.title]),
      [
        ['delete', 'Version two'],
        ['update', 'Version two'],
        ['create', 'Version one'],
      ],
    )
    const trash = await call(HB, content.contentTrash, 'GET', '/api/admin/content/trash', { cookie: cur })
    const inTrash = trash.body.items.find((t: { id: string }) => t.id === 'hr-1')
    assert.deepEqual({ ...inTrash, deletedAt: undefined }, { collection: 'artworks', id: 'hr-1', title: 'Version two', deletedAt: undefined, deletedBy: 'curator.sites@example.org', rev: hist.body.revisions[0].rev })

    // restore the deleted item (its delete revision holds it as it was)
    const back = await call(HB, content.contentRestore, 'POST', `${path('hr-1')}/restore`, { cookie: cur, params: { collection: 'artworks', id: 'hr-1' }, body: { rev: inTrash.rev } })
    assert.equal(back.status, 200)
    assert.equal(back.body.item.title, 'Version two')
    assert.ok(back.body.updatedAt)
    const trash2 = await call(HB, content.contentTrash, 'GET', '/api/admin/content/trash', { cookie: cur })
    assert.ok(!trash2.body.items.some((t: { id: string }) => t.id === 'hr-1'))

    // restore an older version over the current one
    const v1 = hist.body.revisions[2].rev
    await call(HB, content.contentRestore, 'POST', '/', { cookie: cur, params: { collection: 'artworks', id: 'hr-1' }, body: { rev: v1 } })
    const list = await call(HB, content.listCollection, 'GET', '/api/admin/content/artworks', { cookie: cur, params: { collection: 'artworks' } })
    assert.equal(list.body.find((i: { id: string }) => i.id === 'hr-1').title, 'Version one')
    const hist2 = await call(HB, content.contentHistory, 'GET', '/', { cookie: cur, params: { collection: 'artworks', id: 'hr-1' } })
    assert.deepEqual(hist2.body.revisions.slice(0, 2).map((r: { op: string }) => r.op), ['restore', 'restore'])

    // the other site cannot see or restore these revisions
    const other = await call(CLAY, content.contentRestore, 'POST', '/', { cookie: cur, params: { collection: 'artworks', id: 'hr-1' }, body: { rev: v1 } })
    assert.equal(other.status, 404)
    assert.equal((await call(HB, content.contentRestore, 'POST', '/', { cookie: cur, params: { collection: 'artworks', id: 'hr-1' }, body: { rev: 99999 } })).status, 404)
  })

  it('a reset puts the replaced items in the trash', async () => {
    await put({ id: 'reset-me', title: 'Only in the database' })
    const r = await call(HB, content.resetContent, 'POST', '/api/admin/content/reset', { cookie: admin })
    assert.equal(r.status, 200)
    const trash = await call(HB, content.contentTrash, 'GET', '/api/admin/content/trash', { cookie: cur })
    assert.ok(trash.body.items.some((t: { id: string }) => t.id === 'reset-me'))
    // seeded items came back, so they are not in the trash
    const seeded = readSeed().artworks[0]
    if (seeded) assert.ok(!trash.body.items.some((t: { id: string }) => t.id === seeded.id))
    // and the other site's content was not reset
    assert.ok((await count(db, 'SELECT COUNT(*) AS n FROM content_items WHERE exhibition_id = $1', [CLAY.defaultExhibitionId])) > 0)
  })

  it('validates a tour and names the field at fault', async () => {
    const stop = { id: 'a', place: 'Atrium', title: 'Hello', text: 'Look up.', view: { x: 1, z: 2, yawDeg: 90 } }
    const bad = await call(HB, content.putTour, 'PUT', '/api/admin/content/tour', { cookie: cur, body: { stops: [stop, { ...stop, id: 'b', view: { x: 1, z: 'far', yawDeg: 0 } }] } })
    assert.equal(bad.status, 400)
    assert.equal(bad.body.field, 'stops[1].view.z')
    const kind = await call(HB, content.putTour, 'PUT', '/', { cookie: cur, body: { stops: [{ ...stop, item: { kind: 'painting', id: 'x' } }] } })
    assert.equal(kind.body.field, 'stops[0].item.kind')
    const dup = await call(HB, content.putTour, 'PUT', '/', { cookie: cur, body: { stops: [stop, stop] } })
    assert.equal(dup.body.field, 'stops[1].id')
    const ok = await call(HB, content.putTour, 'PUT', '/', { cookie: cur, body: { stops: [{ ...stop, extra: 'dropped', item: { kind: 'artwork', id: 'hero-01' } }] } })
    assert.equal(ok.status, 200)
    assert.deepEqual(ok.body.stops, [{ ...stop, item: { kind: 'artwork', id: 'hero-01' } }])
    await call(HB, content.putTour, 'PUT', '/', { cookie: cur, body: { stops: null } })
  })
})

describe('media is per site', () => {
  const upload = (site: SiteInfo, name: string) => {
    const form = new FormData()
    form.append('folder', 'artworks')
    form.append('file', new Blob([Buffer.from(png().split(',')[1], 'base64')], { type: 'image/png' }), name)
    return call(site, media.uploadMedia, 'POST', '/api/admin/media', { cookie: cur, form })
  }

  it('lists, pages, finds usage of and deletes only its own files', async () => {
    const a = await upload(HB, 'indigo-one.png')
    const b = await upload(HB, 'indigo-two.png')
    const c = await upload(CLAY, 'terracotta.png')
    for (const r of [a, b, c]) assert.equal(r.status, 201, JSON.stringify(r.body))

    const hb = await call(HB, media.listMedia, 'GET', '/api/admin/media', { cookie: cur })
    assert.deepEqual(hb.body.map((m: { id: string }) => m.id).sort(), [a.body.id, b.body.id].sort())
    const clay = await call(CLAY, media.listMedia, 'GET', '/api/admin/media', { cookie: cur })
    assert.deepEqual(clay.body.map((m: { id: string }) => m.id), [c.body.id])

    // pages
    const p1 = await call(HB, media.listMedia, 'GET', '/api/admin/media?limit=1', { cookie: cur })
    assert.equal(p1.body.items.length, 1)
    assert.ok(p1.body.nextCursor)
    const p2 = await call(HB, media.listMedia, 'GET', `/api/admin/media?limit=1&cursor=${p1.body.nextCursor}`, { cookie: cur })
    assert.equal(p2.body.items.length, 1)
    assert.equal(p2.body.nextCursor, null)
    assert.notEqual(p1.body.items[0].id, p2.body.items[0].id)
    const q = await call(HB, media.listMedia, 'GET', '/api/admin/media?limit=10&q=TWO&kind=image', { cookie: cur })
    assert.deepEqual(q.body.items.map((m: { id: string }) => m.id), [b.body.id])
    assert.equal((await call(HB, media.listMedia, 'GET', '/api/admin/media?limit=10&kind=video', { cookie: cur })).body.items.length, 0)
    assert.equal((await call(HB, media.listMedia, 'GET', '/api/admin/media?limit=10&cursor=nonsense', { cookie: cur })).status, 400)

    // usage: an item that shows the file
    await call(HB, content.putContentItem, 'PUT', '/', { cookie: cur, params: { collection: 'artworks', id: 'uses-media' }, body: { title: 'Uses it', image: a.body.url, gallery: [{ src: a.body.url }] } })
    const usage = await call(HB, media.mediaUsageRoute, 'GET', '/', { cookie: cur, params: { id: a.body.id } })
    assert.deepEqual(
      usage.body.usage.map((u: { id: string; field: string }) => `${u.id}:${u.field}`),
      ['uses-media:image', 'uses-media:gallery[0].src'],
    )
    assert.equal((await call(CLAY, media.mediaUsageRoute, 'GET', '/', { cookie: cur, params: { id: a.body.id } })).status, 404)

    // the other site cannot delete it
    assert.equal((await call(CLAY, media.deleteMedia, 'DELETE', '/', { cookie: cur, params: { id: a.body.id } })).status, 404)
    assert.equal((await call(HB, media.deleteMedia, 'DELETE', '/', { cookie: cur, params: { id: a.body.id } })).status, 200)
  })
})

describe('prints are per site', () => {
  it('queues, moderates in bulk and hangs on the wall per site', async () => {
    const submit = (site: SiteInfo, sessionId: string) => call(site, prints.submitPrint, 'POST', '/api/prints', { body: { image: png(), sessionId, displayName: site.id } })
    const h1 = await submit(HB, 'session-hb-0001')
    const h2 = await submit(HB, 'session-hb-0002')
    const c1 = await submit(CLAY, 'session-clay-0001')
    for (const r of [h1, h2, c1]) assert.equal(r.status, 201, JSON.stringify(r.body))

    const hbQueue = await call(HB, prints.adminListPrints, 'GET', '/api/admin/prints?status=pending', { cookie: cur })
    assert.deepEqual(hbQueue.body.map((p: { id: string }) => p.id).sort(), [h1.body.id, h2.body.id].sort())

    // bulk with an id of the other site: only this site's prints change
    const bulk = await call(HB, prints.adminBulkPrints, 'POST', '/api/admin/prints/bulk', { cookie: cur, body: { ids: [h1.body.id, h2.body.id, c1.body.id], action: 'approve' } })
    assert.deepEqual(bulk.body, { updated: 2 })
    const wallHb = await call(HB, prints.listPrints, 'GET', '/api/prints?status=approved')
    assert.equal(wallHb.body.length, 2)
    assert.equal((await call(CLAY, prints.listPrints, 'GET', '/api/prints?status=approved')).body.length, 0)

    assert.equal((await call(CLAY, prints.adminPatchPrint, 'PATCH', '/', { cookie: cur, params: { id: h1.body.id }, body: { status: 'rejected' } })).status, 404)
    assert.equal((await call(CLAY, prints.adminDeletePrint, 'DELETE', '/', { cookie: cur, params: { id: h1.body.id } })).status, 404)
    assert.equal((await call(CLAY, prints.adminPatchPrint, 'PATCH', '/', { cookie: cur, params: { id: c1.body.id }, body: { status: 'approved' } })).status, 200)

    const del = await call(HB, prints.adminBulkPrints, 'POST', '/', { cookie: cur, body: { ids: [h2.body.id], action: 'delete' } })
    assert.deepEqual(del.body, { updated: 1 })
    assert.equal((await call(HB, prints.adminBulkPrints, 'POST', '/', { cookie: cur, body: { ids: Array.from({ length: 201 }, (_, i) => `id-${i}`), action: 'delete' } })).status, 400)
    assert.equal((await call(HB, prints.adminBulkPrints, 'POST', '/', { cookie: cur, body: { ids: [h1.body.id], action: 'burn' } })).status, 400)
  })
})

describe('comments are per site', () => {
  it('lists and moderates only its own', async () => {
    const post = (site: SiteInfo, body: string) => call(site, comments.postComment, 'POST', '/api/comments', { cookie: cur, body: { body } })
    const h = await post(HB, 'Lovely indigo.')
    const c = await post(CLAY, 'Lovely terracotta.')
    assert.equal(h.status, 201)
    assert.equal(c.status, 201)

    const book = await call(HB, comments.listComments, 'GET', '/api/comments')
    assert.deepEqual(book.body.map((x: { body: string }) => x.body), ['Lovely indigo.'])
    const adminList = await call(CLAY, comments.adminListComments, 'GET', '/api/admin/comments', { cookie: admin })
    assert.deepEqual(adminList.body.map((x: { id: string }) => x.id), [c.body.id])

    assert.equal((await call(CLAY, comments.adminPatchComment, 'PATCH', '/', { cookie: admin, params: { id: h.body.id }, body: { hidden: true } })).status, 404)
    assert.equal((await call(CLAY, comments.adminDeleteComment, 'DELETE', '/', { cookie: admin, params: { id: h.body.id } })).status, 404)
    const bulk = await call(HB, comments.adminBulkComments, 'POST', '/api/admin/comments/bulk', { cookie: admin, body: { ids: [h.body.id, c.body.id], action: 'hide' } })
    assert.deepEqual(bulk.body, { updated: 1 })
    assert.equal((await call(HB, comments.listComments, 'GET', '/api/comments')).body.length, 0)
    assert.equal((await call(CLAY, comments.listComments, 'GET', '/api/comments')).body.length, 1)
    // curators may not moderate comments
    assert.equal((await call(HB, comments.adminBulkComments, 'POST', '/', { cookie: cur, body: { ids: [h.body.id], action: 'unhide' } })).status, 403)
  })
})

describe('analytics are per site', () => {
  it('stores, summarises and cleans up per site', async () => {
    const now = Date.now()
    const batch = (sessionId: string, exhibitionId: string, t: number) => ({
      sessionId,
      batchId: `${sessionId}-b`,
      exhibitionId,
      events: [
        { t, type: 'zone_enter', zone: 'atrium' },
        { t, type: 'pos', x: 1, z: 1, zone: 'atrium' },
      ],
    })
    await runAsSite(HB, () => storeBatch(db, batch('session-hb-aaaa', HB.defaultExhibitionId, now - 1000), now))
    await runAsSite(CLAY, () => storeBatch(db, batch('session-clay-aaa', CLAY.defaultExhibitionId, now - 1000), now))
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM analytics_events WHERE site = 'clay'"), 1)
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM analytics_heat WHERE site = 'clay'"), 1)

    const sumHb = await call(HB, analytics.summary, 'GET', '/api/admin/analytics/summary?days=7', { cookie: admin })
    const sumClay = await call(CLAY, analytics.summary, 'GET', '/api/admin/analytics/summary?days=7', { cookie: admin })
    assert.equal(sumHb.body.sessions, 1)
    assert.equal(sumClay.body.sessions, 1)
    // an unknown exhibition slug falls back to this site's default, never the other's
    assert.equal(await runAsSite(CLAY, () => curator.resolveEventExhibition(db, 'no-such-slug')), CLAY.defaultExhibitionId)
    assert.equal(await runAsSite(HB, () => curator.resolveEventExhibition(db, CLAY.defaultExhibitionId)), HB.defaultExhibitionId)

    // old rows of both sites; hand-block keeps 30 days, its cleanup leaves clay's rows alone
    const old = now - 400 * 86_400_000
    for (const site of ['hand-block', 'clay']) {
      await db.run("INSERT INTO analytics_events (session_id, t, type, received_at, exhibition_id, site) VALUES ('old-session', $1, 'zone_enter', $1, 'x', $2)", [old, site])
    }
    const set = await call(HB, curator.putRetention, 'PUT', '/api/admin/analytics/retention', { cookie: admin, body: { days: 30 } })
    assert.equal(set.body.days, 30)
    assert.equal((await call(CLAY, curator.getRetention, 'GET', '/', { cookie: admin })).body.days, curator.DEFAULT_RETENTION_DAYS)
    const clean = await call(HB, curator.cleanupRoute, 'POST', '/api/admin/analytics/cleanup', { cookie: admin })
    assert.equal(clean.body.deletedEvents, 1)
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM analytics_events WHERE session_id = 'old-session'"), 1)
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM analytics_events WHERE session_id = 'old-session' AND site = 'clay'"), 1)
  })
})

describe('errors are per site', () => {
  it('groups the same error separately per site and moderates only its own', async () => {
    const report = { kind: 'error', message: 'WebGL context lost 3 times', stack: 'at draw (app.js:10:5)' }
    const h = await call(HB, errors.postError, 'POST', '/api/errors', { body: report })
    const c = await call(CLAY, errors.postError, 'POST', '/api/errors', { body: report })
    assert.notEqual(h.body.fingerprint, c.body.fingerprint)
    // hand-block keeps the fingerprint it had before sites existed
    assert.equal(h.body.fingerprint, errors.fingerprint('error', report.message, report.stack, 'hand-block'))

    const hbList = await call(HB, errors.listErrors, 'GET', '/api/admin/errors?status=open', { cookie: admin })
    assert.deepEqual(hbList.body.groups.map((g: { fingerprint: string }) => g.fingerprint), [h.body.fingerprint])
    assert.equal(hbList.body.open, 1)
    assert.equal((await call(CLAY, errors.getError, 'GET', '/', { cookie: admin, params: { fingerprint: h.body.fingerprint } })).status, 404)
    assert.equal((await call(CLAY, errors.patchError, 'PATCH', '/', { cookie: admin, params: { fingerprint: h.body.fingerprint }, body: { resolved: true } })).status, 404)

    const bulk = await call(HB, errors.bulkErrors, 'POST', '/api/admin/errors/bulk', { cookie: admin, body: { fingerprints: [h.body.fingerprint, c.body.fingerprint], action: 'resolve' } })
    assert.deepEqual(bulk.body, { updated: 1 })
    assert.equal((await call(CLAY, errors.listErrors, 'GET', '/api/admin/errors?status=open', { cookie: admin })).body.open, 1)
    assert.equal((await call(HB, errors.bulkErrors, 'POST', '/', { cookie: admin, body: { fingerprints: ['not-a-fingerprint'], action: 'resolve' } })).status, 400)
    const gone = await call(CLAY, errors.bulkErrors, 'POST', '/', { cookie: admin, body: { fingerprints: [c.body.fingerprint], action: 'delete' } })
    assert.deepEqual(gone.body, { updated: 1 })
    assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM client_errors WHERE fingerprint = $1', [c.body.fingerprint]), 0)
  })
})

describe('makers are per site', () => {
  it('lists, edits and finds usage of only its own, and refuses an id the other site uses', async () => {
    const profile = { name: 'Placeholder maker', placeholder: true }
    assert.equal((await call(CLAY, artisans.adminPutArtisan, 'PUT', '/', { cookie: cur, params: { id: 'clay-maker-01' }, body: profile })).status, 200)
    assert.equal((await call(HB, artisans.adminPutArtisan, 'PUT', '/', { cookie: cur, params: { id: 'hb-maker-01' }, body: profile })).status, 200)

    const hb = await call(HB, artisans.adminListArtisans, 'GET', '/', { cookie: cur })
    const clay = await call(CLAY, artisans.adminListArtisans, 'GET', '/', { cookie: cur })
    assert.ok(hb.body.some((a: { id: string }) => a.id === 'hb-maker-01'))
    assert.ok(!hb.body.some((a: { id: string }) => a.id === 'clay-maker-01'))
    assert.ok(clay.body.some((a: { id: string }) => a.id === 'clay-maker-01'))
    assert.ok(!clay.body.some((a: { id: string }) => a.id === 'hb-maker-01'))

    const steal = await call(HB, artisans.adminPutArtisan, 'PUT', '/', { cookie: cur, params: { id: 'clay-maker-01' }, body: { name: 'Overwritten' } })
    assert.equal(steal.status, 409)
    assert.equal((await db.one<{ name: string }>("SELECT name FROM artisans WHERE id = 'clay-maker-01'"))?.name, 'Placeholder maker')
    assert.equal((await call(HB, artisans.publicArtisan, 'GET', '/', { params: { id: 'clay-maker-01' } })).status, 404)
    assert.equal((await call(HB, artisans.adminDeleteArtisan, 'DELETE', '/', { cookie: cur, params: { id: 'clay-maker-01' } })).status, 404)

    await call(CLAY, content.putContentItem, 'PUT', '/', { cookie: cur, params: { collection: 'exhibits', id: 'plaque-1' }, body: { title: 'Votive plaque', artisanId: 'clay-maker-01' } })
    const usage = await call(CLAY, artisans.adminArtisanUsage, 'GET', '/', { cookie: cur, params: { id: 'clay-maker-01' } })
    assert.deepEqual(usage.body.usage, [{ exhibitionId: CLAY.defaultExhibitionId, collection: 'exhibits', id: 'plaque-1', title: 'Votive plaque' }])
    assert.equal((await call(HB, artisans.adminArtisanUsage, 'GET', '/', { cookie: cur, params: { id: 'clay-maker-01' } })).status, 404)
  })
})

describe('activity log and dashboard', () => {
  it('writes an audit row for every admin change, per site', async () => {
    const hb = await call(HB, overview.activity, 'GET', '/api/admin/activity?limit=200', { cookie: admin })
    const actions = new Set(hb.body.entries.map((e: { action: string }) => e.action))
    for (const a of [
      'content.create',
      'content.update',
      'content.delete',
      'content.restore',
      'content.reset',
      'content.tour',
      'media.upload',
      'media.delete',
      'prints.bulk',
      'comments.bulk',
      'errors.bulk',
      'artisan.create',
      'analytics.retention',
      'analytics.cleanup',
    ]) {
      assert.ok(actions.has(a), `hand-block activity has ${a}`)
    }
    const clay = await call(CLAY, overview.activity, 'GET', '/api/admin/activity?limit=200', { cookie: admin })
    const clayActions = new Set(clay.body.entries.map((e: { action: string }) => e.action))
    for (const a of ['exhibition.create', 'exhibition.update', 'exhibition.default', 'exhibition.delete', 'prints.status', 'errors.bulk']) assert.ok(clayActions.has(a), `clay activity has ${a}`)
    assert.ok(!clayActions.has('content.reset'), 'the hand-block reset is not in the clay log')
    assert.ok(hb.body.entries.every((e: { actorEmail: string | null; summary: string }) => e.summary.length > 0))

    const one = hb.body.entries.find((e: { action: string }) => e.action === 'content.restore')
    assert.equal(one.actorEmail, 'curator.sites@example.org')
    assert.equal(one.actorRole, 'curator')

    // one target's history, and paging
    const target = await call(HB, overview.activity, 'GET', '/api/admin/activity?target=artworks:hr-1', { cookie: cur })
    assert.deepEqual(target.body.entries.map((e: { action: string }) => e.action), ['content.restore', 'content.restore', 'content.delete', 'content.update', 'content.create'])
    const page = await call(HB, overview.activity, 'GET', '/api/admin/activity?limit=2', { cookie: cur })
    assert.equal(page.body.entries.length, 2)
    const next = await call(HB, overview.activity, 'GET', `/api/admin/activity?limit=2&before=${page.body.nextBefore}`, { cookie: cur })
    assert.ok(next.body.entries[0].id < page.body.entries[1].id + 1 && next.body.entries[0].id !== page.body.entries[1].id)
  })

  it('counts the work waiting for this site only', async () => {
    const asCurator = await call(CLAY, overview.overview, 'GET', '/api/admin/overview', { cookie: cur })
    assert.equal(asCurator.status, 200)
    assert.equal(asCurator.body.site, 'clay')
    assert.equal(asCurator.body.exhibition.id, CLAY.defaultExhibitionId)
    assert.equal(asCurator.body.counts.openErrors, null)
    assert.equal(asCurator.body.counts.users, null)
    assert.equal(asCurator.body.counts.comments7d, 1)
    assert.equal(asCurator.body.counts.pendingPrints, 0)
    assert.ok(asCurator.body.recent.length > 0 && asCurator.body.recent.length <= 12)
    const asAdmin = await call(HB, overview.overview, 'GET', '/api/admin/overview', { cookie: admin })
    assert.equal(asAdmin.body.counts.openErrors, 0)
    assert.ok(asAdmin.body.counts.users >= 2)
    assert.equal(asAdmin.body.counts.hiddenComments, 1)
    assert.ok(asAdmin.body.counts.items > 0)
  })
})

describe('live tours', () => {
  it("mints a docent token only for this site's room", async () => {
    process.env.LIVE_TOKEN_SECRET = 'x'.repeat(40)
    const pub = Buffer.alloc(65, 4).toString('base64url')
    const other = await call(HB, live.liveToken, 'POST', '/api/live/token', { cookie: cur, body: { room: CLAY.liveRoom, pub } })
    assert.equal(other.status, 400)
    const mine = await call(HB, live.liveToken, 'POST', '/api/live/token', { cookie: cur, body: { room: HB.liveRoom, pub } })
    assert.equal(mine.status, 200)
    assert.equal(mine.body.claims.room, HB.liveRoom)
    delete process.env.LIVE_TOKEN_SECRET
  })
})

describe('migration ledger', () => {
  const files = [
    { name: '20260923000000_init.sql', sha256: migrationSha('create table a ();') },
    { name: '20261101000000_sites.sql', sha256: migrationSha('alter table a add column site text;') },
  ]

  it('applies what is missing, in order, and fills in hashes recorded before they were kept', () => {
    const plan = planMigrations(files, [{ name: '20260923000000_init.sql', sha256: null }])
    assert.deepEqual(plan.pending, ['20261101000000_sites.sql'])
    assert.deepEqual(plan.backfill, [{ name: '20260923000000_init.sql', sha256: files[0].sha256 }])
    assert.equal(checkMigrationPlan(plan), null)
  })

  it('refuses to start when an applied file has changed', () => {
    const plan = planMigrations(files, [{ name: '20260923000000_init.sql', sha256: migrationSha('create table b ();') }])
    assert.equal(plan.mismatched.length, 1)
    assert.throws(() => checkMigrationPlan(plan), /refusing to start: migration file\(s\) changed after they were applied: 20260923000000_init\.sql/)
  })

  it('warns about migrations the database has and this build lacks', () => {
    const plan = planMigrations(files, [
      { name: '20260923000000_init.sql', sha256: files[0].sha256 },
      { name: '20261101000000_sites.sql', sha256: files[1].sha256 },
      { name: '20261201000000_from_the_other_app.sql', sha256: 'abc' },
    ])
    assert.deepEqual(plan.unknown, ['20261201000000_from_the_other_app.sql'])
    assert.deepEqual(plan.pending, [])
    assert.match(checkMigrationPlan(plan)!, /database has migrations this build lacks: 20261201000000_from_the_other_app\.sql/)
  })

  it('hashes a file the same with Windows and Unix line endings', () => {
    assert.equal(migrationSha('a;\r\nb;\r\n'), migrationSha('a;\nb;\n'))
  })

  it('the SQLite mirror has the sites migration (every per-site table has its column)', async () => {
    for (const t of ['exhibitions', 'artisans', 'media', 'visitor_prints', 'comments', 'favorites', 'analytics_events', 'analytics_heat', 'client_errors', 'client_error_groups', 'content_revisions', 'audit_log']) {
      const cols = await db.query<{ name: string }>(`PRAGMA table_info(${t})`)
      assert.ok(cols.some((c) => c.name === 'site'), `${t}.site`)
    }
    const fav = await db.query<{ name: string; pk: number }>('PRAGMA table_info(favorites)')
    assert.deepEqual(fav.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name), ['user_id', 'site', 'item_kind', 'item_id'])
  })
})
