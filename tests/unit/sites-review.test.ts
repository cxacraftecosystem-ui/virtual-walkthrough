/**
 * Two museums, one database — the gaps a review of the sites work found, pinned so they stay closed:
 *  - deploy order: the clay app does not create its default exhibition while only hand-block code from before
 *    sites has served the database (that code would read clay's default as its own);
 *  - a deliberately deleted default exhibition stays deleted across restarts;
 *  - deleting an exhibition takes its revisions (history, trash) and visitor analytics with it, and every
 *    analytics and revision query is scoped to the site, so a reused exhibition id shows nothing of the old one;
 *  - the activity log shows each role only what its admin pages show; shared changes (roles, the access list)
 *    show in both sites' logs; moderated comment text is never copied into it;
 *  - bulk actions accept only their own verbs (not 'toString', 'constructor', 'valueOf');
 *  - on Postgres, a content write locks the item before it checks the stamp, and a create-only save never
 *    replaces an item.
 *
 * Route handlers run on a throwaway SQLite file (and in-memory databases for the bootstrap cases), switching
 * sites with `runAsSite`, as tests/unit/sites.test.ts does.
 *
 * npm test
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'museum-sites-review-'))
process.env.DB_PATH = path.join(dir, 'museum.sqlite')
process.env.MEDIA_DIR = path.join(dir, 'media')
process.env.MASTER_ADMIN_EMAILS = 'master.review@example.org'
for (const k of ['DATABASE_URL', 'USE_REMOTE', 'S3_BUCKET', 'VERCEL', 'NEXT_PUBLIC_LIVE_ROOM', 'ERROR_SAMPLE_RATE', 'MASTER_ADMIN_EMAIL']) delete process.env[k]

const { SITE } = await import('../../src/site')
const { runAsSite } = await import('../../src/server/site')
type SiteInfo = import('../../src/server/site').SiteInfo
const { services, seedSite } = await import('../../src/server/services')
const { createUser, startSession } = await import('../../src/server/auth')
const store = await import('../../src/server/contentStore')
const { SqliteDb } = await import('../../src/server/db/sqlite')
const { storeBatch } = await import('../../src/server/handlers/analytics')
const curator = await import('../../src/server/handlers/curatorAnalytics')
const content = await import('../../src/server/handlers/content')
const exhibitions = await import('../../src/server/handlers/exhibitions')
const prints = await import('../../src/server/handlers/prints')
const comments = await import('../../src/server/handlers/comments')
const errors = await import('../../src/server/handlers/errors')
const users = await import('../../src/server/handlers/users')
const overview = await import('../../src/server/handlers/overview')
type Db = import('../../src/server/db').Db
type Param = import('../../src/server/db').Param
type Queryable = import('../../src/server/db').Queryable

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
const FIRST = SITE.id === HB.id ? HB : CLAY
const SECOND = FIRST === HB ? CLAY : HB

type Handler<P> = (req: Request, ctx?: { params: Promise<P> }) => Promise<Response>
interface Res {
  status: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are checked field by field
  body: any
}

async function call<P = Record<string, never>>(
  site: SiteInfo,
  handler: Handler<P>,
  method: string,
  url: string,
  opts: { body?: unknown; cookie?: string; params?: P; headers?: Record<string, string> } = {},
): Promise<Res> {
  return runAsSite(site, async () => {
    const headers: Record<string, string> = { ...opts.headers }
    if (opts.cookie) headers.cookie = opts.cookie
    let body: BodyInit | undefined
    if (opts.body !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(opts.body)
    }
    const res = await handler(new Request(`http://museum.test${url}`, { method, headers, body }), { params: Promise.resolve((opts.params ?? {}) as P) })
    const text = await res.text()
    return { status: res.status, body: (res.headers.get('content-type') ?? '').includes('json') ? JSON.parse(text) : text }
  })
}

async function signIn(db: Db, email: string, role?: 'curator' | 'admin'): Promise<string> {
  const u = await createUser(db, email, null, email.split('@')[0], { manualRole: role, emailVerified: true })
  const h = new Headers()
  await startSession(db, h, u.id)
  return h.get('set-cookie')!.split(';')[0]
}

const count = async (db: Db, sql: string, params: Param[] = []) => Number((await db.one<{ n: number }>(sql, params))?.n ?? 0)
const quiet = () => undefined

let db: Db
let master: string
let admin: string
let cur: string

before(async () => {
  db = (await runAsSite(FIRST, () => services())).db
  await runAsSite(SECOND, () => seedSite(db, quiet))
  master = await signIn(db, 'master.review@example.org')
  admin = await signIn(db, 'admin.review@example.org', 'admin')
  cur = await signIn(db, 'curator.review@example.org', 'curator')
})

after(async () => {
  await db.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('deploy order: clay waits for site-aware hand-block code', () => {
  it('refuses to create its default exhibition while only pre-sites hand-block code has served the database, then starts', async () => {
    const mem = new SqliteDb(':memory:')
    try {
      // a database hand-block code from before sites has seeded, as the sites migration leaves it: no marker yet
      await runAsSite(HB, () => store.ensureSiteExhibition(mem))
      await mem.run("INSERT INTO meta (key, value) VALUES ('seeded_at', '2026-09-23T00:00:00.000Z')")
      assert.equal(await store.getMeta(mem, store.sitesAwareKey('hand-block')), undefined)

      await assert.rejects(runAsSite(CLAY, () => seedSite(mem, quiet)), /deploy hand-block first/)
      assert.equal(await count(mem, "SELECT COUNT(*) AS n FROM exhibitions WHERE site = 'clay'"), 0, 'clay wrote no exhibition')
      assert.equal(await count(mem, "SELECT COUNT(*) AS n FROM exhibitions WHERE is_default = 1"), 1)

      await runAsSite(HB, () => seedSite(mem, quiet)) // the site-aware hand-block build starts
      assert.ok(await store.getMeta(mem, store.sitesAwareKey('hand-block')))

      await runAsSite(CLAY, () => seedSite(mem, quiet))
      const row = await mem.one<{ is_default: number; status: string }>('SELECT is_default, status FROM exhibitions WHERE id = $1', [CLAY.defaultExhibitionId])
      assert.deepEqual({ ...row, is_default: Number(row?.is_default) }, { is_default: 1, status: 'published' })
      assert.ok(await store.getMeta(mem, store.sitesAwareKey('clay')))
    } finally {
      await mem.close()
    }
  })

  it('starts at once on a database hand-block never served (a clay-only database)', async () => {
    const mem = new SqliteDb(':memory:')
    try {
      await runAsSite(CLAY, () => seedSite(mem, quiet))
      assert.equal(await count(mem, "SELECT COUNT(*) AS n FROM exhibitions WHERE site = 'clay' AND is_default = 1"), 1)
      assert.ok(await count(mem, 'SELECT COUNT(*) AS n FROM content_items WHERE exhibition_id = $1', [CLAY.defaultExhibitionId]))
    } finally {
      await mem.close()
    }
  })
})

describe('a deleted default exhibition stays deleted', () => {
  it('is not recreated by the next start, whether the delete was recorded or came from older code', async () => {
    const S = SECOND
    const make = await call(S, exhibitions.adminCreateExhibition, 'POST', '/', { cookie: admin, body: { slug: `${S.id}-next`, title: 'Next' } })
    assert.equal(make.status, 201)
    await call(S, exhibitions.adminPatchExhibition, 'PATCH', '/', { cookie: admin, params: { id: `${S.id}-next` }, body: { status: 'published' } })
    assert.equal((await call(S, exhibitions.adminSetDefaultExhibition, 'POST', '/', { cookie: admin, params: { id: `${S.id}-next` } })).status, 200)
    const del = await call(S, exhibitions.adminDeleteExhibition, 'DELETE', `/api/admin/exhibitions/${S.defaultExhibitionId}?force`, { cookie: admin, params: { id: S.defaultExhibitionId } })
    assert.equal(del.status, 200)
    assert.ok(await store.getMeta(db, `${S.metaPrefix}${store.DEFAULT_DELETED_KEY}`), 'the delete is recorded')

    await runAsSite(S, () => seedSite(db, quiet))
    assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM exhibitions WHERE id = $1', [S.defaultExhibitionId]), 0)

    // deleted by code from before the record: the site has seeded and still has exhibitions → left deleted
    await db.run('DELETE FROM meta WHERE key = $1', [`${S.metaPrefix}${store.DEFAULT_DELETED_KEY}`])
    await runAsSite(S, () => seedSite(db, quiet))
    assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM exhibitions WHERE id = $1', [S.defaultExhibitionId]), 0)
    const pub = await call(S, exhibitions.publicExhibitions, 'GET', '/api/exhibitions')
    assert.deepEqual(pub.body.map((e: { id: string }) => e.id), [`${S.id}-next`])
  })
})

describe('a reused exhibition id starts clean', () => {
  const now = Date.now()
  const day = new Date(now).toISOString().slice(0, 10)
  const range = `exhibition=reused&from=${day}&to=${day}`
  const visit = (sessionId: string) => ({
    sessionId,
    batchId: `${sessionId}-b`,
    exhibitionId: 'reused',
    events: [
      { t: now - 1000, type: 'tour_start' },
      { t: now - 1000, type: 'item_view', itemKind: 'artwork', itemId: 'old-1' },
      { t: now - 1000, type: 'pos', x: 2, z: 2, zone: 'atrium' },
    ],
  })

  it("leaves no trash, history or visitor data of the old exhibition, and never mixes in the other site's", async () => {
    // hand-block's exhibition 'reused': an item saved then deleted (trash), visitors
    assert.equal((await call(HB, exhibitions.adminCreateExhibition, 'POST', '/', { cookie: admin, body: { slug: 'reused', title: 'Old' } })).status, 201)
    const put = (site: SiteInfo, id: string) =>
      call(site, content.putContentItem, 'PUT', `/api/admin/content/artworks/${id}?exhibition=reused`, { cookie: cur, params: { collection: 'artworks', id }, body: { id, title: id } })
    assert.equal((await put(HB, 'old-1')).status, 200)
    assert.equal((await call(HB, content.deleteContentItem, 'DELETE', '/api/admin/content/artworks/old-1?exhibition=reused', { cookie: cur, params: { collection: 'artworks', id: 'old-1' } })).status, 200)
    assert.equal((await put(HB, 'old-2')).status, 200)
    await runAsSite(HB, () => storeBatch(db, visit('session-reuse-hb1'), now))
    const before = await call(HB, content.contentTrash, 'GET', '/api/admin/content/trash?exhibition=reused', { cookie: cur })
    assert.deepEqual(before.body.items.map((i: { id: string }) => i.id), ['old-1'])

    const del = await call(HB, exhibitions.adminDeleteExhibition, 'DELETE', '/', { cookie: admin, params: { id: 'reused' } })
    assert.equal(del.status, 200)
    for (const t of ['content_revisions', 'analytics_events', 'analytics_heat']) {
      assert.equal(await count(db, `SELECT COUNT(*) AS n FROM ${t} WHERE exhibition_id = 'reused'`), 0, `${t} of the deleted exhibition are gone`)
    }

    // the other site takes the id
    assert.equal((await call(CLAY, exhibitions.adminCreateExhibition, 'POST', '/', { cookie: admin, body: { slug: 'reused', title: 'New' } })).status, 201)
    const trash = await call(CLAY, content.contentTrash, 'GET', '/api/admin/content/trash?exhibition=reused', { cookie: cur })
    assert.deepEqual(trash.body.items, [])
    const hist = await call(CLAY, content.contentHistory, 'GET', '/?exhibition=reused', { cookie: cur, params: { collection: 'artworks', id: 'old-1' } })
    assert.deepEqual(hist.body.revisions, [])

    // rows hand-block still holds under the id (written by old code, or by an ingestion that resolved the id
    // just before the delete) stay out of clay's reports, and clay's samples never merge into them
    await runAsSite(HB, () => storeBatch(db, visit('session-reuse-hb2'), now))
    await db.run("INSERT INTO content_revisions (site, exhibition_id, collection, item_id, op, json, created_at) VALUES ('hand-block', 'reused', 'artworks', 'c-1', 'update', '{\"id\":\"c-1\"}', $1)", [new Date(now + 60_000).toISOString()])

    const heat = await call(CLAY, curator.heatmapRoute, 'GET', `/api/admin/analytics/heatmap?${range}`, { cookie: admin })
    assert.equal(heat.status, 200)
    assert.deepEqual(heat.body.cells, [])
    assert.deepEqual(heat.body.zones, [])
    const cur1 = await call(CLAY, curator.curatorRoute, 'GET', `/api/admin/analytics/curator?${range}`, { cookie: admin })
    assert.equal(cur1.body.funnel.starts, 0)
    assert.deepEqual(cur1.body.attention, [])
    const csv = await call(CLAY, curator.exportRoute, 'GET', `/api/admin/analytics/export?dataset=attention&${range}`, { cookie: admin })
    assert.ok(!String(csv.body).includes('old-1'))

    await runAsSite(CLAY, () => storeBatch(db, visit('session-reuse-cl1'), now))
    const cells = await db.query<{ site: string; samples: number }>("SELECT site, samples FROM analytics_heat WHERE exhibition_id = 'reused' ORDER BY site")
    assert.deepEqual(cells.map((c) => ({ site: c.site, samples: Number(c.samples) })), [{ site: 'hand-block', samples: 1 }], "hand-block's cell is not added to")
    const mine = await call(CLAY, curator.curatorRoute, 'GET', `/api/admin/analytics/curator?${range}`, { cookie: admin })
    assert.equal(mine.body.funnel.starts, 1, "clay's own events count")

    // clay's trash: its delete is the item's latest revision for clay, whatever hand-block's leftovers say
    assert.equal((await put(CLAY, 'c-1')).status, 200)
    assert.equal((await call(CLAY, content.deleteContentItem, 'DELETE', '/?exhibition=reused', { cookie: cur, params: { collection: 'artworks', id: 'c-1' } })).status, 200)
    await db.run("INSERT INTO content_revisions (site, exhibition_id, collection, item_id, op, json, created_at) VALUES ('hand-block', 'reused', 'artworks', 'c-1', 'update', '{\"id\":\"c-1\"}', $1)", [new Date(now + 120_000).toISOString()])
    const clayTrash = await call(CLAY, content.contentTrash, 'GET', '/api/admin/content/trash?exhibition=reused', { cookie: cur })
    assert.deepEqual(clayTrash.body.items.map((i: { id: string }) => i.id), ['c-1'])
  })
})

describe('activity log: who reads what', () => {
  it('shows curators content changes only, admins all but the access list, and shared changes on both sites', async () => {
    const someone = await createUser(db, 'visitor.review@example.org', null, 'visitor', { emailVerified: true })
    assert.equal((await call(CLAY, users.patchUser, 'PATCH', '/', { cookie: admin, params: { id: someone.id }, body: { role: 'curator' } })).status, 200)
    assert.equal((await call(CLAY, users.putAccess, 'POST', '/', { cookie: master, body: { pattern: '@partner.example.org', role: 'curator' } })).status, 201)
    const post = await call(HB, comments.postComment, 'POST', '/api/comments', { cookie: cur, body: { body: 'Call me on 98765 43210' } })
    assert.equal((await call(HB, comments.adminPatchComment, 'PATCH', '/', { cookie: admin, params: { id: post.body.id }, body: { hidden: true } })).status, 200)
    assert.equal((await call(HB, comments.adminDeleteComment, 'DELETE', '/', { cookie: admin, params: { id: post.body.id } })).status, 200)

    const kinds = async (cookie: string, site: SiteInfo, q = '') => {
      const r = await call(site, overview.activity, 'GET', `/api/admin/activity?limit=200${q}`, { cookie })
      assert.equal(r.status, 200)
      return new Set<string>(r.body.entries.map((e: { targetKind: string }) => e.targetKind))
    }
    const forCurator = await kinds(cur, HB)
    assert.ok(forCurator.has('artworks') && forCurator.has('exhibition'))
    for (const k of ['user', 'access', 'comment', 'error', 'analytics']) assert.ok(!forCurator.has(k), `a curator does not see ${k} entries`)
    assert.equal((await kinds(cur, HB, '&target=access')).size, 0)
    assert.equal((await kinds(cur, HB, '&target=user')).size, 0)
    const recent = await call(HB, overview.overview, 'GET', '/api/admin/overview', { cookie: cur })
    assert.ok(recent.body.recent.every((e: { targetKind: string }) => !['user', 'access', 'comment', 'error', 'analytics'].includes(e.targetKind)))

    // shared changes made on clay show on hand-block too: roles to admins, the access list to master admins only
    const forAdmin = await kinds(admin, HB)
    assert.ok(forAdmin.has('user') && forAdmin.has('comment'))
    assert.ok(!forAdmin.has('access'))
    assert.equal((await kinds(admin, HB, '&target=access')).size, 0)
    assert.ok((await kinds(master, HB)).has('access'))
    assert.ok((await kinds(master, CLAY)).has('access'))
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('users.role', 'access.put') AND site = 'shared'"), 2)

    // moderated comment text is not kept: its length only (no hash, which a short text can be recovered from)
    const rows = await db.query<{ summary: string; detail: string | null }>("SELECT summary, detail FROM audit_log WHERE target_kind = 'comment' AND target_id = $1", [post.body.id])
    assert.equal(rows.length, 2)
    for (const r of rows) {
      assert.ok(!r.summary.includes('98765') && !String(r.detail).includes('98765'), r.summary)
      assert.deepEqual(Object.keys(JSON.parse(String(r.detail))).sort(), ['length'])
    }
  })
})

describe('bulk actions take only their own verbs', () => {
  it("answers 400 for names every object has ('toString', 'constructor', 'valueOf') and changes nothing", async () => {
    const post = await call(HB, comments.postComment, 'POST', '/api/comments', { cookie: cur, body: { body: 'Hidden for now.' } })
    await call(HB, comments.adminPatchComment, 'PATCH', '/', { cookie: admin, params: { id: post.body.id }, body: { hidden: true } })
    for (const action of ['toString', 'constructor', 'valueOf', '__proto__', 'hasOwnProperty']) {
      assert.equal((await call(HB, comments.adminBulkComments, 'POST', '/', { cookie: admin, body: { ids: [post.body.id], action } })).status, 400, `comments ${action}`)
      assert.equal((await call(HB, prints.adminBulkPrints, 'POST', '/', { cookie: admin, body: { ids: ['x'], action } })).status, 400, `prints ${action}`)
      assert.equal((await call(HB, errors.bulkErrors, 'POST', '/', { cookie: admin, body: { fingerprints: ['x'], action } })).status, 400, `errors ${action}`)
    }
    assert.equal(Number((await db.one<{ hidden: number }>('SELECT hidden FROM comments WHERE id = $1', [post.body.id]))?.hidden), 1, 'still hidden')
  })
})

describe('content writes on Postgres', () => {
  /** A Postgres-dialect Db that answers from `answer` and records every statement. */
  function fakePg(answer: (sql: string, params: Param[]) => unknown) {
    const sent: string[] = []
    const q: Queryable = {
      query: async <T>(sql: string, params: Param[] = []) => (sent.push(sql), ((answer(sql, params) as T[] | undefined) ?? []) as T[]),
      one: async <T>(sql: string, params: Param[] = []) => (sent.push(sql), answer(sql, params) as T | undefined),
      run: async (sql: string, params: Param[] = []) => (sent.push(sql), Number(answer(sql, params) ?? 1)),
    }
    const fake: Db = { dialect: 'postgres', ...q, tx: (fn) => fn(q), close: async () => undefined }
    return { fake, sent }
  }
  const isStamp = (sql: string) => sql.startsWith('SELECT json, sort, updated_at, updated_by FROM content_items')
  const isLock = (sql: string) => /pg_advisory_xact_lock\(\$1, hashtext\(\$2\)\)/.test(sql)

  it('locks the item before reading its stamp, for a save and a delete', async () => {
    const row = { json: '{"id":"a"}', sort: 0, updated_at: '2026-10-01T00:00:00.000Z', updated_by: null }
    for (const write of [
      (d: Db) => store.putItem(d, 'artworks', { id: 'a', title: 'A' }, 'ex-1', { expectedUpdatedAt: row.updated_at }),
      (d: Db) => store.deleteItem(d, 'artworks', 'a', 'ex-1', { expectedUpdatedAt: row.updated_at }),
    ]) {
      const { fake, sent } = fakePg((sql) => (isStamp(sql) ? row : undefined))
      await runAsSite(HB, () => write(fake))
      const lock = sent.findIndex(isLock)
      assert.ok(lock >= 0, sent.join('\n'))
      assert.ok(lock < sent.findIndex(isStamp), 'the lock comes first')
    }
  })

  it('a create-only save never replaces an item another writer created in between: 409', async () => {
    let stampReads = 0
    const theirs = { json: '{"id":"n","title":"Theirs"}', sort: 0, updated_at: '2026-10-01T00:00:00.000Z', updated_by: 'other@example.org' }
    const { fake, sent } = fakePg((sql) => {
      if (isStamp(sql)) return stampReads++ === 0 ? undefined : theirs // absent at the check, there by the insert
      if (sql.startsWith('INSERT INTO content_items')) return 0
      return undefined
    })
    await assert.rejects(
      runAsSite(HB, () => store.putItem(fake, 'artworks', { id: 'n', title: 'Mine' }, 'ex-1', { expectedUpdatedAt: 'new' })),
      (e: { status?: number; body?: { current?: { title?: string } } }) => e.status === 409 && e.body?.current?.title === 'Theirs',
    )
    const insert = sent.find((s) => s.startsWith('INSERT INTO content_items'))!
    assert.match(insert, /ON CONFLICT \(exhibition_id, collection, id\) DO NOTHING/)
    assert.ok(!sent.some((s) => s.startsWith('INSERT INTO content_revisions')), 'no revision for a write that did not happen')
  })
})
