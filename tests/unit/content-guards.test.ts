/**
 * Content editing never overwrites a colleague's work unseen (admin → Content):
 *  - a restore (Undo of a delete, the trash, a version from the history) takes `X-Expected-Updated-At` like a
 *    save: 'new' refuses to replace an item someone has made again since, a stale stamp refuses to replace a
 *    newer version;
 *  - the admin's write guard (src/admin/pages/content/stamps.ts) fetches stamps on demand instead of sending a
 *    write unguarded, and treats an item missing from a fresh list as deleted (409);
 *  - local drafts and recent items are kept per exhibition id, never under the selection '' ("the default");
 *  - the exhibit preview picks a readable label colour on any stand-in colour.
 *
 * Server parts run the real route handlers on a throwaway SQLite file. npm test
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'museum-guards-'))
process.env.DB_PATH = path.join(dir, 'museum.sqlite')
process.env.MEDIA_DIR = path.join(dir, 'media')
for (const k of ['DATABASE_URL', 'USE_REMOTE', 'S3_BUCKET', 'VERCEL', 'NEXT_PUBLIC_LIVE_ROOM', 'ERROR_SAMPLE_RATE']) delete process.env[k]

// A Map-backed localStorage for the admin's browser-only modules.
const store = new Map<string, string>()
const localStorage = {
  get length() {
    return store.size
  },
  key: (i: number) => [...store.keys()][i] ?? null,
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
}
Object.assign(globalThis, { window: Object.assign(new EventTarget(), { localStorage }) })

const { services } = await import('../../src/server/services')
const { createUser, startSession } = await import('../../src/server/auth')
const content = await import('../../src/server/handlers/content')
const { makeExpectedFor, mergeStamps, DELETED_MESSAGE, UNCHECKED_MESSAGE } = await import('../../src/admin/pages/content/stamps')
type ConflictBody = import('../../src/admin/api').ConflictBody
/** Stands in for the page's `new ApiError(409, …)` (api.ts pulls in React, which this runner can't load). */
class Conflict extends Error {
  constructor(readonly body: ConflictBody) {
    super(body.message)
  }
}
const conflict = (body: ConflictBody) => new Conflict(body)
const drafts = await import('../../src/admin/pages/content/drafts')
const recent = await import('../../src/admin/recent')
const { contrast, textOn, DARK_TEXT, LIGHT_TEXT } = await import('../../src/admin/pages/content/colour')
type Db = import('../../src/server/db').Db

type Handler<P> = (req: Request, ctx?: { params: Promise<P> }) => Promise<Response>
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are checked field by field
type Res = { status: number; body: any }

let db: Db
let cur: string

async function call<P>(handler: Handler<P>, method: string, params: P, opts: { body?: unknown; headers?: Record<string, string> } = {}): Promise<Res> {
  const headers: Record<string, string> = { cookie: cur, ...opts.headers }
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  const res = await handler(new Request('http://museum.test/api/admin/content/x', { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), {
    params: Promise.resolve(params),
  })
  const text = await res.text()
  return { status: res.status, body: (res.headers.get('content-type') ?? '').includes('json') ? JSON.parse(text) : text }
}

before(async () => {
  db = (await services()).db
  const u = await createUser(db, 'curator.guards@example.org', null, 'curator', { manualRole: 'curator', emailVerified: true })
  const h = new Headers()
  await startSession(db, h, u.id)
  cur = h.get('set-cookie')!.split(';')[0]
})

after(async () => {
  await db.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('restore is guarded like a save', () => {
  const p = (id: string) => ({ collection: 'artworks', id })
  const put = (id: string, title: string, expected?: string) =>
    call(content.putContentItem, 'PUT', p(id), { body: { id, title }, headers: expected ? { 'x-expected-updated-at': expected } : {} })
  const del = (id: string) => call(content.deleteContentItem, 'DELETE', p(id))
  const history = async (id: string) => (await call(content.contentHistory, 'GET', p(id))).body.revisions as { rev: number; op: string }[]
  const restore = (id: string, rev: number, expected?: string) =>
    call(content.contentRestore, 'POST', p(id), { body: { rev }, headers: expected ? { 'x-expected-updated-at': expected } : {} })

  it("brings a deleted item back with 'new', and refuses once someone has made the id again", async () => {
    await put('g-1', 'Original')
    assert.equal((await del('g-1')).status, 200)
    const delRev = (await history('g-1'))[0]
    assert.equal(delRev.op, 'delete')

    // a colleague makes the id again before Undo is clicked
    const theirs = await put('g-1', 'Theirs', 'new')
    assert.equal(theirs.status, 200)
    const refused = await restore('g-1', delRev.rev, 'new')
    assert.equal(refused.status, 409)
    assert.equal(refused.body.error, 'conflict')
    assert.equal(refused.body.current.title, 'Theirs')
    const list = await call(content.listCollection, 'GET', { collection: 'artworks' })
    assert.equal(list.body.find((i: { id: string }) => i.id === 'g-1').title, 'Theirs', 'their item is left as it is')

    // without a colleague in between, the same Undo works
    await put('g-2', 'Kept')
    await del('g-2')
    const back = await restore('g-2', (await history('g-2'))[0].rev, 'new')
    assert.equal(back.status, 200)
    assert.equal(back.body.item.title, 'Kept')
  })

  it('refuses to restore a version over a newer save, and restores against the current stamp', async () => {
    const v1 = await put('g-3', 'One')
    const v2 = await put('g-3', 'Two', v1.body.updatedAt)
    const oldest = (await history('g-3')).at(-1)!
    const stale = await restore('g-3', oldest.rev, v1.body.updatedAt)
    assert.equal(stale.status, 409)
    assert.equal(stale.body.current.title, 'Two')
    const ok = await restore('g-3', oldest.rev, v2.body.updatedAt)
    assert.equal(ok.status, 200)
    assert.equal(ok.body.item.title, 'One')
    // no header: last write wins, as before
    assert.equal((await restore('g-3', oldest.rev)).status, 200)
  })
})

describe('the admin write guard', () => {
  const stamp = (updatedAt: string) => ({ updatedAt, updatedBy: null })

  it('uses the held stamp without fetching', async () => {
    let loads = 0
    const expected = makeExpectedFor(
      () => ({ 'artworks/a': stamp('2026-10-01T00:00:00.000Z') }),
      async () => (loads++, {}),
      conflict,
    )
    assert.equal(await expected('artworks', 'a'), '2026-10-01T00:00:00.000Z')
    assert.equal(loads, 0)
  })

  it('fetches the stamps when they are not loaded yet (or failed), never sending a write unguarded', async () => {
    let loads = 0
    const expected = makeExpectedFor(
      () => null,
      async () => (loads++, { 'artworks/a': stamp('2026-10-02T00:00:00.000Z') }),
      conflict,
    )
    assert.equal(await expected('artworks', 'a'), '2026-10-02T00:00:00.000Z')
    assert.equal(loads, 1)
  })

  it('refuses with a 409 when a fresh list has no such item (deleted meanwhile)', async () => {
    const expected = makeExpectedFor(
      () => ({}),
      async () => ({}),
      conflict,
    )
    await assert.rejects(expected('artworks', 'gone'), (e: unknown) => e instanceof Conflict && e.body.error === 'conflict' && e.body.current === null && e.message === DELETED_MESSAGE)
  })

  it('refuses to send anything when the stamps cannot be read', async () => {
    const expected = makeExpectedFor(
      () => null,
      async () => {
        throw new Error('offline')
      },
      conflict,
    )
    await assert.rejects(expected('artworks', 'a'), { message: UNCHECKED_MESSAGE })
  })

  it('keeps a newer stamp of our own when an older list arrives late', () => {
    const merged = mergeStamps(
      { 'artworks/a': stamp('2026-10-03T00:00:00.000Z'), 'artworks/old': stamp('2026-10-01T00:00:00.000Z') },
      { 'artworks/a': stamp('2026-10-02T00:00:00.000Z'), 'artworks/b': stamp('2026-10-02T00:00:00.000Z') },
    )
    assert.deepEqual(Object.keys(merged).sort(), ['artworks/a', 'artworks/b'], 'keys only the server still has')
    assert.equal(merged['artworks/a'].updatedAt, '2026-10-03T00:00:00.000Z')
  })
})

describe('local drafts and recent items are per exhibition id', () => {
  it('never offers one exhibition’s draft in another, and keeps nothing without an id', () => {
    store.clear()
    drafts.writeDraft('exhibition-a', 'artworks', 'x', { draft: { id: 'x', title: 'Edited in A' }, isNew: false, baseUpdatedAt: '2026-10-01T00:00:00.000Z' })
    assert.equal(drafts.readDraft('exhibition-a', 'artworks', 'x')?.draft.title, 'Edited in A')
    assert.equal(drafts.readDraft('exhibition-b', 'artworks', 'x'), null, 'B (say, the new default) does not see A’s edits')
    drafts.writeDraft(null, 'artworks', 'y', { draft: { id: 'y' }, isNew: true, baseUpdatedAt: null })
    assert.equal(drafts.readDraft(null, 'artworks', 'y'), null)
    assert.ok(![...store.keys()].some((k) => k.includes(':default:') || k.includes('::')), 'no key under the selection ""')
    drafts.writeDraft('exhibition-a', 'artworks', 'n1', { draft: { id: 'n1' }, isNew: true, baseUpdatedAt: null })
    assert.deepEqual(drafts.newDrafts('exhibition-a', 'artworks').map((d) => d.id), ['n1'])
    assert.deepEqual(drafts.newDrafts('exhibition-b', 'artworks'), [])
  })

  it('lists recent items of the exhibition asked for only, and drops entries without one', () => {
    store.clear()
    store.set('museum.admin.recent', JSON.stringify([{ tab: 'artworks', id: 'legacy', title: 'Legacy', exhibition: '', at: '2026-01-01T00:00:00.000Z' }]))
    recent.recordRecent({ tab: 'artworks', id: 'x', title: 'In A' }, 'exhibition-a')
    recent.recordRecent({ tab: 'artworks', id: 'x', title: 'In B' }, 'exhibition-b')
    recent.recordRecent({ tab: 'artworks', id: 'z', title: 'Unknown' }, null)
    assert.deepEqual(recent.readRecent('exhibition-a').map((r) => r.title), ['In A'])
    assert.deepEqual(recent.readRecent('exhibition-b').map((r) => r.title), ['In B'])
    assert.deepEqual(recent.readRecent(''), [], "'' (default not known yet) lists nothing")
    assert.deepEqual(recent.readRecent().map((r) => r.id), ['x', 'x'], 'the legacy entry and the unknown one are gone')
    recent.forgetRecent('artworks', 'x', 'exhibition-a')
    assert.deepEqual(recent.readRecent().map((r) => r.exhibition), ['exhibition-b'])
  })
})

describe('preview label on a stand-in colour', () => {
  it('reads at 4.5:1 or better on light, mid and dark colours', () => {
    for (const ink of ['#ffffff', '#f2d27a', '#b7862f', '#808080', '#2c3f6b', '#000000', '#c96a58']) {
      const fg = textOn(ink)!
      assert.ok(contrast(fg, ink) >= 4.5, `${fg} on ${ink}: ${contrast(fg, ink).toFixed(2)}`)
    }
    assert.equal(textOn('#ffffff'), DARK_TEXT)
    assert.equal(textOn('#2c3f6b'), LIGHT_TEXT)
    assert.equal(textOn('not a colour'), null)
  })
})
