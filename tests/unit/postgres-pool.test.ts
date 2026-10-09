/**
 * PostgresDb's pool under Vercel Fluid compute. Drives the real @vercel/functions hook through the
 * request context it reads at runtime, so this fails if attachDatabasePool is dropped, attached off
 * Vercel, or left waiting on anything but the pool's 5 s idle timeout.
 *
 * Also pins what a plain query (no transaction) does when the pool lends it a stale socket, against a
 * stubbed pool.query: a read is sent once more, a write never is, because pg cannot tell whether the
 * server ran a statement whose connection dropped before the reply.
 *
 * npm test
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import { PostgresDb } from '../../src/server/db/postgres'
import type { Param } from '../../src/server/db/types'

const DATABASE_URL = 'postgres://user:pass@db.example.invalid:6543/postgres'
/** Where Vercel's runtime publishes the current request's context (`waitUntil`, `deadline`). */
const REQUEST_CONTEXT = Symbol.for('@vercel/request-context')
const VARIABLES = ['VERCEL', 'VERCEL_URL', 'VERCEL_REGION'] as const
const scope = globalThis as unknown as Record<symbol, unknown>

const settle = () => new Promise((resolve) => setImmediate(resolve))

let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  saved = Object.fromEntries(VARIABLES.map((name) => [name, process.env[name]]))
})

afterEach(() => {
  for (const name of VARIABLES) {
    if (saved[name] === undefined) delete process.env[name]
    else process.env[name] = saved[name]
  }
  delete scope[REQUEST_CONTEXT]
  mock.timers.reset()
})

describe('PostgresDb pool', () => {
  it('closes idle clients after 5 s', () => {
    const db = new PostgresDb({ connectionString: DATABASE_URL })
    assert.equal(db.pool.options.idleTimeoutMillis, 5_000)
  })

  it('on Vercel, holds the invocation open after each release until idle clients have closed', async () => {
    Object.assign(process.env, { VERCEL: '1', VERCEL_URL: 'museum.example.vercel.app', VERCEL_REGION: 'bom1' })
    const held: Array<Promise<unknown>> = []
    scope[REQUEST_CONTEXT] = { get: () => ({ waitUntil: (promise: Promise<unknown>) => held.push(promise) }) }
    mock.timers.enable({ apis: ['setTimeout'] })

    const db = new PostgresDb({ connectionString: DATABASE_URL })
    assert.equal(db.pool.listenerCount('release'), 1)

    db.pool.emit('release', undefined, {})
    assert.equal(held.length, 1, 'the release extended the invocation')

    let done = false
    void held[0].then(() => {
      done = true
    })
    // The hook waits the pool's own idle timeout plus 100 ms.
    mock.timers.tick(5_099)
    await settle()
    assert.equal(done, false)
    mock.timers.tick(1)
    await settle()
    assert.equal(done, true)
  })

  it('is not attached off Vercel', () => {
    delete process.env.VERCEL
    const db = new PostgresDb({ connectionString: DATABASE_URL })
    assert.equal(db.pool.listenerCount('release'), 0)
  })
})

/** What pg rejects with when the socket it lent had already been closed by the server or the pooler. */
const staleSocket = () => new Error('Connection terminated unexpectedly')

/** A PostgresDb whose pool.query answers with `answers` in order (an Error is a rejection). */
function dbAnswering(...answers: unknown[]) {
  const db = new PostgresDb({ connectionString: DATABASE_URL })
  const query = mock.method(db.pool, 'query', async () => {
    const next = answers.shift()
    if (next === undefined) throw new Error('test: the pool was queried more times than answers were provided')
    if (next instanceof Error) throw next
    return next
  })
  return { db, query }
}

describe('PostgresDb plain queries on a stale socket', () => {
  it('sends a read once more', async () => {
    const reads: Array<[string, Param[]]> = [
      ['SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1', ['h']],
      ['show server_version', []],
      ['WITH recent AS (SELECT id FROM comments ORDER BY created_at DESC LIMIT 5) SELECT count(*) AS n FROM recent', []],
    ]
    for (const [sql, params] of reads) {
      const { db, query } = dbAnswering(staleSocket(), { rows: [{ n: 1 }], rowCount: 1 })

      assert.deepEqual(await db.query(sql, params), [{ n: 1 }], sql)
      assert.deepEqual(
        query.mock.calls.map((call) => call.arguments[0]),
        [sql, sql],
        `${sql}: sent exactly twice`,
      )
    }
  })

  it('gives up on a read when the second attempt meets a stale socket too', async () => {
    const { db, query } = dbAnswering(staleSocket(), staleSocket())

    await assert.rejects(db.one('SELECT id FROM users WHERE id = $1', ['u1']), /Connection terminated unexpectedly/)
    assert.equal(query.mock.callCount(), 2)
  })

  it('never sends a write a second time: the server may already have run and committed it', async () => {
    const writes: Array<[string, Param[]]> = [
      ['INSERT INTO comments (id, user_id, body) VALUES ($1, $2, $3)', ['c1', 'u1', 'hello']],
      ['INSERT INTO analytics_events (session_id, t, type, received_at) VALUES ($1, $2, $3, $4)', ['s', 1, 'view', 2]],
      ['UPDATE comments SET hidden = $1 WHERE id = $2', [1, 'c1']],
      ['DELETE FROM sessions WHERE token_hash = $1', ['h']],
      // Each of these opens like a read and writes underneath.
      ['WITH gone AS (DELETE FROM sessions WHERE expires_at <= $1 RETURNING user_id) SELECT count(*) FROM gone', [0]],
      ['SELECT * INTO comments_copy FROM comments', []],
      ['SELECT 1; TRUNCATE sessions', []],
    ]
    for (const [sql, params] of writes) {
      const { db, query } = dbAnswering(staleSocket())

      await assert.rejects(db.run(sql, params), /Connection terminated unexpectedly/, sql)
      assert.equal(query.mock.callCount(), 1, `${sql}: sent once`)
    }
  })

  it('does not send a read again after any other failure', async () => {
    const timeout = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' })
    const { db, query } = dbAnswering(timeout)

    await assert.rejects(db.query('SELECT pg_sleep(60)'), timeout)
    assert.equal(query.mock.callCount(), 1)
  })
})
