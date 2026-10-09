/**
 * PostgresDb.tx() against a stubbed pool — no database. Two things are pinned here:
 *
 *  - the stale-socket retry: a client the pool lent from before a freeze fails at BEGIN, before any
 *    of the caller's work has run, so tx() retries once on a fresh connection. Never later, and never
 *    for a failure that is not a stale socket;
 *  - which clients go back to the pool. A client whose connection broke is released WITH the error,
 *    which makes pg destroy it; a healthy one that merely rolled back is released without one.
 *
 * npm test
 */
import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
import type pg from 'pg'
import { PostgresDb } from '../../src/server/db/postgres'

const OK = { rows: [], rowCount: 1 }

/** A pooled client whose `query` answers through `answer` (an Error is thrown); records everything. */
function fakeClient(answer: (sql: string) => unknown = () => OK) {
  const calls: string[] = []
  const released: Array<Error | boolean | undefined> = []
  const client = {
    query: async (sql: string) => {
      calls.push(sql)
      const out = answer(sql)
      if (out instanceof Error) throw out
      return out
    },
    release: (err?: Error | boolean) => {
      released.push(err)
    },
  }
  return { client: client as unknown as pg.PoolClient, calls, released }
}

/** A PostgresDb whose pool lends `lent` in order (an Error makes that connect() reject). */
function dbLending(...lent: Array<pg.PoolClient | Error>) {
  const db = new PostgresDb({ connectionString: 'postgres://user:pass@db.example.invalid:6543/postgres' })
  const connect = mock.method(db.pool, 'connect', async () => {
    const next = lent.shift()
    if (next === undefined) throw new Error('test: the pool was asked for more clients than were provided')
    if (next instanceof Error) throw next
    return next
  })
  return { db, connect }
}

const sqlError = (message: string, code: string) => Object.assign(new Error(message), { code })

describe('PostgresDb.tx', () => {
  it('commits and returns a healthy client to the pool', async () => {
    const c = fakeClient()
    const { db, connect } = dbLending(c.client)

    const out = await db.tx(async (q) => q.run('update items set v = 1'))

    assert.equal(out, 1)
    assert.equal(connect.mock.callCount(), 1)
    assert.deepEqual(c.calls, ['BEGIN', 'update items set v = 1', 'COMMIT'])
    assert.deepEqual(c.released, [undefined])
  })

  it('retries once on a fresh client when BEGIN meets a stale socket, and destroys the stale one', async () => {
    const stale = new Error('Connection terminated unexpectedly')
    const dead = fakeClient((sql) => (sql === 'BEGIN' ? stale : OK))
    const fresh = fakeClient()
    const { db, connect } = dbLending(dead.client, fresh.client)
    let ran = 0

    const out = await db.tx(async (q) => {
      ran++
      await q.run('update items set v = 1')
      return 'saved'
    })

    assert.equal(out, 'saved')
    assert.equal(ran, 1, 'the work runs once, on the fresh client')
    assert.equal(connect.mock.callCount(), 2)
    assert.deepEqual(dead.calls, ['BEGIN'])
    assert.deepEqual(dead.released, [stale], 'released with the error, so pg destroys it')
    assert.deepEqual(fresh.calls, ['BEGIN', 'update items set v = 1', 'COMMIT'])
    assert.deepEqual(fresh.released, [undefined])
  })

  it('retries once when connecting itself meets a stale socket', async () => {
    const fresh = fakeClient()
    const { db, connect } = dbLending(new Error('read ECONNRESET'), fresh.client)

    await db.tx(async () => undefined)

    assert.equal(connect.mock.callCount(), 2)
    assert.deepEqual(fresh.calls, ['BEGIN', 'COMMIT'])
  })

  it('gives up after one retry, destroying both clients', async () => {
    const first = fakeClient((sql) => (sql === 'BEGIN' ? new Error('Connection terminated unexpectedly') : OK))
    const second = fakeClient((sql) => (sql === 'BEGIN' ? new Error('Connection terminated unexpectedly') : OK))
    const { db, connect } = dbLending(first.client, second.client)
    let ran = 0

    await assert.rejects(
      db.tx(async () => {
        ran++
      }),
      /Connection terminated unexpectedly/,
    )

    assert.equal(ran, 0)
    assert.equal(connect.mock.callCount(), 2)
    assert.equal(first.released.length, 1)
    assert.ok(first.released[0] instanceof Error)
    assert.equal(second.released.length, 1)
    assert.ok(second.released[0] instanceof Error)
  })

  it('does not retry a failure that is not a stale socket', async () => {
    const badPassword = sqlError('password authentication failed for user "app"', '28P01')
    const refused = dbLending(badPassword)
    await assert.rejects(refused.db.tx(async () => undefined), badPassword)
    assert.equal(refused.connect.mock.callCount(), 1)

    const timeout = sqlError('canceling statement due to statement timeout', '57014')
    const c = fakeClient((sql) => (sql === 'BEGIN' ? timeout : OK))
    const slow = dbLending(c.client)
    await assert.rejects(slow.db.tx(async () => undefined), timeout)
    assert.equal(slow.connect.mock.callCount(), 1)
    assert.deepEqual(c.released, [timeout], 'a client whose BEGIN failed is never lent again')
  })

  it('rolls back and returns the client to the pool when the work fails', async () => {
    const duplicate = sqlError('duplicate key value violates unique constraint "items_pkey"', '23505')
    const c = fakeClient((sql) => (sql.startsWith('insert') ? duplicate : OK))
    const { db, connect } = dbLending(c.client)

    await assert.rejects(
      db.tx(async (q) => {
        await q.run('insert into items (id) values ($1)', ['a'])
      }),
      duplicate,
    )

    assert.equal(connect.mock.callCount(), 1, 'work that has run is never retried')
    assert.deepEqual(c.calls, ['BEGIN', 'insert into items (id) values ($1)', 'ROLLBACK'])
    assert.deepEqual(c.released, [undefined], 'the connection is healthy, so it goes back to the pool')
  })

  it('destroys the client without a ROLLBACK when the connection drops mid-transaction', async () => {
    const lost = new Error('Connection terminated unexpectedly')
    const c = fakeClient((sql) => (sql.startsWith('update') ? lost : OK))
    const { db, connect } = dbLending(c.client)
    let ran = 0

    await assert.rejects(
      db.tx(async (q) => {
        ran++
        await q.run('update items set v = 1')
      }),
      lost,
    )

    assert.equal(ran, 1)
    assert.equal(connect.mock.callCount(), 1, 'work that has run is never retried')
    assert.deepEqual(c.calls, ['BEGIN', 'update items set v = 1'])
    assert.deepEqual(c.released, [lost])
  })

  it('treats the server ending the session as a dropped connection', async () => {
    const shutdown = sqlError('terminating connection due to administrator command', '57P01')
    const c = fakeClient((sql) => (sql === 'COMMIT' ? shutdown : OK))
    const { db } = dbLending(c.client)

    await assert.rejects(db.tx(async () => undefined), shutdown)

    assert.deepEqual(c.calls, ['BEGIN', 'COMMIT'])
    assert.deepEqual(c.released, [shutdown])
  })

  it('destroys the client when the ROLLBACK itself fails', async () => {
    const divide = sqlError('division by zero', '22012')
    const rollbackFailed = new Error('Client was closed and is not queryable')
    const c = fakeClient((sql) => (sql === 'ROLLBACK' ? rollbackFailed : sql.startsWith('select') ? divide : OK))
    const { db } = dbLending(c.client)

    await assert.rejects(
      db.tx(async (q) => q.one('select 1 / 0')),
      divide,
    )

    assert.deepEqual(c.calls, ['BEGIN', 'select 1 / 0', 'ROLLBACK'])
    assert.deepEqual(c.released, [rollbackFailed])
  })
})
