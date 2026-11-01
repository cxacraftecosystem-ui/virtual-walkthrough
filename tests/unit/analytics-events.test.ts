/**
 * storeBatch's event allowlist (src/server/handlers/analytics.ts): the clay pavilion's experience events
 * ('stamp', 'perch', 'cue', 'film_end', 'moment') are stored, and their fields go through the same caps
 * as every other event: unknown types are dropped, strings are cut to length, seconds are clamped,
 * oversized meta is dropped, and an event from outside the clock window is refused.
 *
 * npm test
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { SqliteDb } from '../../src/server/db/sqlite'
import { storeBatch } from '../../src/server/handlers/analytics'

const NOW = Date.UTC(2026, 9, 9, 12)
const NEW_TYPES = ['stamp', 'perch', 'cue', 'film_end', 'moment'] as const

interface Row {
  type: string
  zone: string | null
  item_kind: string | null
  item_id: string | null
  seconds: number | null
  meta: string | null
}

async function rows(db: SqliteDb): Promise<Row[]> {
  return db.query<Row>('SELECT type, zone, item_kind, item_id, seconds, meta FROM analytics_events ORDER BY t')
}

const send = (db: SqliteDb, events: unknown[], batchId = 'batch-0001') => storeBatch(db, { sessionId: 'session-aaaa', batchId, exhibitionId: 'clay', events }, NOW)

describe('storeBatch: experience events', () => {
  it('stores stamp, perch, cue, film_end and moment', async () => {
    const db = new SqliteDb(':memory:')
    const events = NEW_TYPES.map((type, i) => ({ t: NOW - 5000 + i, type, zone: 'oculus', itemKind: 'object', itemId: `${type}-1` }))
    assert.deepEqual(await send(db, events), { accepted: 5, duplicate: false })
    assert.deepEqual(
      (await rows(db)).map((r) => [r.type, r.item_id]),
      NEW_TYPES.map((t) => [t, `${t}-1`]),
    )
  })

  it('still drops types it does not know, and anything that is not an event', async () => {
    const db = new SqliteDb(':memory:')
    const events = [{ t: NOW, type: 'stamps' }, { t: NOW, type: 'STAMP' }, { t: NOW, type: 'drop table' }, { t: NOW }, 'stamp', null, [{ type: 'stamp' }]]
    assert.deepEqual(await send(db, events), { accepted: 0, duplicate: false })
    assert.equal((await rows(db)).length, 0)
  })

  it('caps their fields like any other event', async () => {
    const db = new SqliteDb(':memory:')
    const long = 'x'.repeat(5000)
    const events = [
      { t: NOW - 3, type: 'film_end', itemId: long, itemKind: long, zone: long, seconds: 1e9, meta: { note: 'ok' } },
      { t: NOW - 2, type: 'cue', seconds: -5, meta: { blob: long } },
      { t: NOW - 1, type: 'moment', seconds: 'soon', itemId: 42, zone: '' },
      { t: NOW - 400 * 86_400_000, type: 'stamp', itemId: 'too-old' },
      { t: NOW + 2 * 86_400_000, type: 'perch', itemId: 'from-the-future' },
    ]
    assert.deepEqual(await send(db, events), { accepted: 3, duplicate: false })
    const [film, cue, moment] = await rows(db)
    assert.equal(film.item_id?.length, 100)
    assert.equal(film.item_kind?.length, 30)
    assert.equal(film.zone?.length, 100)
    assert.equal(film.seconds, 3600)
    assert.equal(film.meta, '{"note":"ok"}')
    assert.equal(cue.seconds, 0)
    assert.equal(cue.meta, null)
    assert.equal(moment.seconds, null)
    assert.equal(moment.item_id, null)
    assert.equal(moment.zone, null)
  })
})
