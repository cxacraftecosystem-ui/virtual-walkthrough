/**
 * storeBatch (src/server/handlers/analytics.ts) on SQLite, the local driver, through a real
 * transaction: a batch sent again under the same id stores nothing, neither its events nor its heatmap
 * samples; a failure halfway leaves no marker behind, so the next attempt still stores the batch; a
 * batch without an id (a tracker from before batch ids) is stored as it always was. Also pinned: why
 * markers may go after 31 days, and that the analytics cleanup removes them then and not before.
 *
 * npm test
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { SqliteDb } from '../../src/server/db/sqlite'
import { type EventBatch, storeBatch } from '../../src/server/handlers/analytics'
import { BATCH_MARKER_MS, cleanupAnalytics } from '../../src/server/handlers/curatorAnalytics'

const NOW = Date.UTC(2026, 9, 9, 12)
const DAY = 86_400_000

/** One event and two 'pos' samples that fall in the same heatmap cell. */
const batch = (over: Partial<EventBatch> = {}): EventBatch => ({
  sessionId: 'session-aaaa',
  batchId: 'batch-0001',
  exhibitionId: 'hand-block-printing',
  events: [
    { t: NOW - 3000, type: 'zone_enter', zone: 'atrium' },
    { t: NOW - 2000, type: 'pos', x: 1.2, z: -3.4, zone: 'atrium' },
    { t: NOW - 1000, type: 'pos', x: 1.3, z: -3.4, zone: 'atrium' },
  ],
  ...over,
})

async function stored(db: SqliteDb) {
  const n = async (sql: string) => Number((await db.one<{ n: number }>(sql))?.n ?? 0)
  return {
    events: await n('SELECT COUNT(*) AS n FROM analytics_events'),
    samples: await n('SELECT COALESCE(SUM(samples), 0) AS n FROM analytics_heat'),
    markers: await n('SELECT COUNT(*) AS n FROM analytics_batches'),
  }
}

describe('storeBatch: a batch is stored once', () => {
  it('sent again under the same id, it stores nothing more, heatmap samples included', async () => {
    const db = new SqliteDb(':memory:')

    assert.deepEqual(await storeBatch(db, batch(), NOW), { accepted: 3, duplicate: false })
    assert.deepEqual(await storeBatch(db, batch(), NOW + 10_000), { accepted: 0, duplicate: true })
    assert.deepEqual(await storeBatch(db, batch(), NOW + DAY), { accepted: 0, duplicate: true })

    assert.deepEqual(await stored(db), { events: 1, samples: 2, markers: 1 })
  })

  it("is keyed by session: another session's batch with the same id is another batch", async () => {
    const db = new SqliteDb(':memory:')
    await storeBatch(db, batch(), NOW)
    assert.deepEqual(await storeBatch(db, batch({ sessionId: 'session-bbbb' }), NOW), { accepted: 3, duplicate: false })
    assert.deepEqual(await stored(db), { events: 2, samples: 4, markers: 2 })
  })

  it('a failure halfway leaves nothing behind, the marker included, so the next attempt stores the batch', async () => {
    // The marker goes in first, then the events, then the heatmap cells: break either later step.
    for (const table of ['analytics_events', 'analytics_heat']) {
      const db = new SqliteDb(':memory:')
      await db.run(`ALTER TABLE ${table} RENAME TO ${table}_away`)
      await assert.rejects(storeBatch(db, batch(), NOW), new RegExp(`no such table: ${table}`))
      await db.run(`ALTER TABLE ${table}_away RENAME TO ${table}`)
      assert.deepEqual(await stored(db), { events: 0, samples: 0, markers: 0 }, table)

      assert.deepEqual(await storeBatch(db, batch(), NOW + 10_000), { accepted: 3, duplicate: false }, table)
      assert.deepEqual(await stored(db), { events: 1, samples: 2, markers: 1 }, table)
    }
  })

  it('without a batch id (a tracker from before them) it is stored as before, every time', async () => {
    const db = new SqliteDb(':memory:')
    assert.deepEqual(await storeBatch(db, batch({ batchId: null }), NOW), { accepted: 3, duplicate: false })
    assert.deepEqual(await storeBatch(db, batch({ batchId: null }), NOW), { accepted: 3, duplicate: false })
    assert.deepEqual(await stored(db), { events: 2, samples: 4, markers: 0 })
  })

  it('a batch with nothing to store leaves no marker', async () => {
    const db = new SqliteDb(':memory:')
    const junk = batch({ events: [{ type: 'unknown' }, { t: NOW - 40 * DAY, type: 'zone_enter' }, { t: NOW, type: 'pos', x: 'far', z: 0 }] })
    assert.deepEqual(await storeBatch(db, junk, NOW), { accepted: 0, duplicate: false })
    assert.deepEqual(await stored(db), { events: 0, samples: 0, markers: 0 })
  })
})

describe('batch markers are kept 31 days', () => {
  it('because by then every event the batch could have stored is too old to be stored again', async () => {
    const db = new SqliteDb(':memory:')
    // The oldest and the newest event ingestion takes (30 days back, a day ahead).
    const edges = batch({ events: [{ t: NOW - 30 * DAY, type: 'zone_enter' }, { t: NOW + DAY, type: 'zone_enter' }] })
    assert.deepEqual(await storeBatch(db, edges, NOW), { accepted: 2, duplicate: false })
    await db.run('DELETE FROM analytics_batches') // as the cleanup would, BATCH_MARKER_MS later

    assert.deepEqual(await storeBatch(db, edges, NOW + BATCH_MARKER_MS + 1), { accepted: 0, duplicate: false })
    assert.equal(BATCH_MARKER_MS, 31 * DAY)
  })

  it('and the analytics cleanup deletes them then, not before', async () => {
    const db = new SqliteDb(':memory:')
    const age = (days: number) => Date.now() - days * DAY
    for (const [id, days] of [['day-30', 30], ['day-31-less-a-minute', 31 - 1 / 1440], ['day-31-and-a-minute', 31 + 1 / 1440], ['day-90', 90]] as const) {
      await db.run('INSERT INTO analytics_batches (session_id, batch_id, received_at) VALUES ($1, $2, $3)', ['session-aaaa', id, age(days)])
    }

    const result = await cleanupAnalytics(db)

    assert.equal(result.deletedBatchMarkers, 2)
    const left = await db.query<{ batch_id: string }>('SELECT batch_id FROM analytics_batches ORDER BY batch_id')
    assert.deepEqual(
      left.map((r) => r.batch_id),
      ['day-30', 'day-31-less-a-minute'],
    )
  })
})
