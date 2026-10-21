/**
 * Query-count regression tests for the admin user list, the access list, role re-syncs and the content
 * seed — each of which used to send a statement per row (per user, per access entry, per seeded item).
 *
 * Every test counts the statements a call sends through a counting wrapper around the `Db` interface, pins
 * that number at two sizes (the same at both: that is what "not N+1" means), and checks the result against
 * the per-row code path it replaced, so a count that dropped because work stopped happening fails.
 *
 * Runs on in-memory SQLite always. When TEST_DATABASE_URL names a local Postgres (the `query counts`
 * job in .github/workflows/ci.yml provides one) it runs again on Postgres, after applying
 * supabase/migrations — the access-list count is a grouped join whose SQL both dialects must accept.
 *
 * npm test
 */
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import { accessRoleFor, computeRole, syncRolesForPattern, syncStaffRoles, type UserRow } from '../../src/server/auth'
import { type ContentDoc, getContent, readSeed, seedContent } from '../../src/server/contentStore'
import { migratePostgres } from '../../src/server/db'
import { PostgresDb } from '../../src/server/db/postgres'
import { SqliteDb } from '../../src/server/db/sqlite'
import type { Db, Param, Queryable } from '../../src/server/db/types'
import { accessEntries, adminUserList } from '../../src/server/handlers/users'

/** A `Db` that records every statement sent through it, transactions included. */
function counting(db: Db): { db: Db; statements: string[]; reset: () => void } {
  const statements: string[] = []
  const wrap = (q: Queryable): Queryable => ({
    query: <T>(sql: string, params?: Param[]) => (statements.push(sql), q.query<T>(sql, params)),
    one: <T>(sql: string, params?: Param[]) => (statements.push(sql), q.one<T>(sql, params)),
    run: (sql: string, params?: Param[]) => (statements.push(sql), q.run(sql, params)),
  })
  const counted: Db = {
    dialect: db.dialect,
    ...wrap(db),
    tx: (fn) => db.tx((q) => fn(wrap(q))),
    close: () => db.close(),
  }
  return { db: counted, statements, reset: () => void statements.splice(0) }
}

/** Count what `work` sends. */
async function measure<T>(c: ReturnType<typeof counting>, work: () => Promise<T>): Promise<{ result: T; statements: string[] }> {
  c.reset()
  const result = await work()
  return { result, statements: [...c.statements] }
}

const now = '2026-10-21T00:00:00.000Z'

async function addUser(db: Db, id: string, email: string, opts: { role?: string; verified?: boolean; manual?: string | null } = {}) {
  await db.run(
    `INSERT INTO users (id, email, display_name, role, password_hash, created_at, manual_role, email_verified)
     VALUES ($1, $2, $3, $4, '', $5, $6, $7)`,
    [id, email, `User ${id}`, opts.role ?? 'visitor', now, opts.manual ?? null, opts.verified === false ? 0 : 1],
  )
}

async function addAccess(db: Db, pattern: string, role: 'curator' | 'admin' | 'master') {
  await db.run('INSERT INTO access_list (pattern, role, note, created_by, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)', [
    pattern,
    role,
    'test',
    'tester@example.org',
    now,
  ])
}

/** `count` users on a shared domain plus a few elsewhere. */
async function population(db: Db, count: number, tag: string) {
  for (let i = 0; i < count; i++) await addUser(db, `${tag}-d${i}`, `p${i}.${tag}@campus.example.org`, { verified: i % 5 !== 0 })
  await addUser(db, `${tag}-x`, `chief.${tag}@other.example.org`)
  await addUser(db, `${tag}-m`, `manual.${tag}@nowhere.example.org`, { manual: 'curator', role: 'curator' })
}

const postgresUrl = process.env.TEST_DATABASE_URL ?? ''
const LOCAL_PG = /@(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//.test(postgresUrl)

const DIALECTS: { name: string; open: () => Promise<Db>; skip: string | false }[] = [
  { name: 'sqlite', open: async () => new SqliteDb(':memory:'), skip: false },
  {
    name: 'postgres',
    open: async () => {
      const db = new PostgresDb({ connectionString: postgresUrl, ssl: 'disable' })
      await migratePostgres(db, () => undefined)
      return db
    },
    skip: !postgresUrl ? 'TEST_DATABASE_URL is not set' : !LOCAL_PG ? 'TEST_DATABASE_URL is not a local database' : false,
  },
]

for (const dialect of DIALECTS) {
  describe(`query counts (${dialect.name})`, { skip: dialect.skip }, () => {
    let raw: Db
    let c: ReturnType<typeof counting>

    before(async () => {
      raw = await dialect.open()
      c = counting(raw)
    })
    after(async () => {
      await raw.close()
    })
    beforeEach(async () => {
      // Each test starts from no accounts and no access list (Postgres is a throwaway CI database).
      await raw.run('DELETE FROM sessions')
      await raw.run('DELETE FROM users')
      await raw.run('DELETE FROM access_list')
    })

    it('lists users with two statements at any length, with the same access-list role per user', async () => {
      await addAccess(raw, '@campus.example.org', 'curator')
      await addAccess(raw, 'chief.small@other.example.org', 'admin')
      await addAccess(raw, 'chief.large@other.example.org', 'admin')
      await addAccess(raw, 'ignored@master.example.org', 'master')

      await population(raw, 3, 'small')
      const small = await measure(c, () => adminUserList(c.db, ''))
      await population(raw, 40, 'large')
      const large = await measure(c, () => adminUserList(c.db, ''))

      assert.equal(small.statements.length, 2, small.statements.join('\n'))
      assert.equal(large.statements.length, 2, large.statements.join('\n'))
      assert.equal(large.result.length, 3 + 2 + 40 + 2)

      // The role each row reports is the one the per-user lookup gives.
      for (const user of large.result) assert.equal(user.accessRole, await accessRoleFor(raw, user.email), user.email)
      assert.equal(large.result.find((u) => u.email === 'chief.large@other.example.org')?.accessRole, 'admin')

      const filtered = await measure(c, () => adminUserList(c.db, ' CHIEF '))
      assert.equal(filtered.statements.length, 2)
      assert.deepEqual(filtered.result.map((u) => u.email).sort(), ['chief.large@other.example.org', 'chief.small@other.example.org'])
    })

    it('lists the access list with its account counts in one statement', async () => {
      await population(raw, 25, 'acc')
      await addAccess(raw, '@campus.example.org', 'curator')
      await addAccess(raw, 'chief.acc@other.example.org', 'admin')
      await addAccess(raw, 'nobody@other.example.org', 'curator')
      await addAccess(raw, 'ignored@master.example.org', 'master')

      const { result, statements } = await measure(c, () => accessEntries(c.db))
      assert.equal(statements.length, 1, statements.join('\n'))
      assert.deepEqual(
        result.map((e) => [e.pattern, e.kind, e.role, e.users]),
        [
          ['@campus.example.org', 'domain', 'curator', 25],
          ['chief.acc@other.example.org', 'email', 'admin', 1],
          ['nobody@other.example.org', 'email', 'curator', 0],
        ],
      )
      assert.equal(result[0]?.createdBy, 'tester@example.org')
      assert.equal(typeof result[0]?.createdAt, 'string')
    })

    it('re-syncs a whole domain with a constant number of statements and the same roles as one-by-one', async () => {
      await population(raw, 4, 'few')
      await addAccess(raw, '@campus.example.org', 'admin')
      const few = await measure(c, () => syncRolesForPattern(c.db, '@campus.example.org'))
      await population(raw, 60, 'many')
      // Roles the per-user rule gives, computed before the batch runs.
      const users = await raw.query<UserRow>("SELECT * FROM users WHERE email LIKE '%@campus.example.org'")
      const expected = new Map<string, string>()
      for (const u of users) expected.set(u.id, await computeRole(raw, u))
      const many = await measure(c, () => syncRolesForPattern(c.db, '@campus.example.org'))

      // Read the users, read the access list, one UPDATE per role that changes (here: visitor → admin).
      assert.equal(few.statements.length, 3, few.statements.join('\n'))
      assert.equal(many.statements.length, 3, many.statements.join('\n'))
      const stored = await raw.query<{ id: string; role: string }>("SELECT id, role FROM users WHERE email LIKE '%@campus.example.org'")
      for (const row of stored) assert.equal(row.role, expected.get(row.id), row.id)
      assert.ok(stored.some((row) => row.role === 'visitor'), 'an unverified address does not take the access-list role')

      // Nothing left to change: the two reads and no write.
      const settled = await measure(c, () => syncRolesForPattern(c.db, '@campus.example.org'))
      assert.equal(settled.statements.length, 2)

      // The entry removed: everybody falls back, still one UPDATE.
      await raw.run('DELETE FROM access_list WHERE pattern = $1', ['@campus.example.org'])
      const removed = await measure(c, () => syncRolesForPattern(c.db, '@campus.example.org'))
      assert.equal(removed.statements.length, 3)
      assert.equal(Number((await raw.one<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'"))?.n), 0)
    })

    it('re-syncs staff at bootstrap with a constant number of statements', async () => {
      for (let i = 0; i < 30; i++) await addUser(raw, `s${i}`, `staff${i}@team.example.org`, { role: 'curator', manual: i % 2 ? 'admin' : null })
      const { statements } = await measure(c, () => syncStaffRoles(c.db))
      // Users, access list, then curator → visitor (no manual role) and curator → admin (manual admin).
      assert.equal(statements.length, 4, statements.join('\n'))
      const roles = await raw.query<{ id: string; role: string }>('SELECT id, role FROM users ORDER BY id')
      for (const row of roles) assert.equal(row.role, Number(row.id.slice(1)) % 2 ? 'admin' : 'visitor', row.id)
    })

    it('seeds content in the same number of statements however many items there are', async () => {
      const seed = readSeed()
      const grown: ContentDoc = { ...seed }
      grown.artworks = Array.from({ length: 450 }, (_, i) => ({ ...(seed.artworks[0] ?? {}), id: `bulk-${i}`, title: `Bulk ${i}` }))

      const original = await measure(c, () => seedContent(c.db, seed))
      const contentAfterOriginal = await getContent(raw)
      const big = await measure(c, () => seedContent(c.db, grown))
      const content = await getContent(raw)

      const items = (doc: ContentDoc) => (['artworks', 'exhibits', 'infographics', 'videos', 'objects'] as const).reduce((n, k) => n + (doc[k]?.length ?? 0), 0)
      const insertsOf = (s: string[]) => s.filter((sql) => /INSERT INTO content_items/.test(sql)).length
      assert.equal(insertsOf(original.statements), Math.ceil(items(seed) / 200), original.statements.join('\n'))
      assert.equal(insertsOf(big.statements), Math.ceil(items(grown) / 200))
      assert.ok(big.statements.length <= original.statements.length + 2, `${big.statements.length} vs ${original.statements.length}`)

      // The stored content is the seed, in order.
      for (const k of ['artworks', 'exhibits', 'infographics', 'videos', 'objects'] as const) {
        assert.deepEqual(contentAfterOriginal[k].map((i) => i.id), (seed[k] ?? []).map((i) => i.id), k)
        assert.deepEqual(content[k].map((i) => i.id), (grown[k] ?? []).map((i) => i.id), k)
      }
      const stored = await raw.one<{ json: unknown }>("SELECT json FROM content_items WHERE collection = 'artworks' AND id = $1", ['bulk-7'])
      assert.deepEqual(typeof stored?.json === 'string' ? JSON.parse(stored.json) : stored?.json, grown.artworks[7])
    })
  })
}
