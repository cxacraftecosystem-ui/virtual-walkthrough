/**
 * The analytics tracker's outbox (src/museum/analytics/outbox.ts). A batch that fails is sent again as
 * the SAME batch, with the same id and the same events and nothing added, so that the server's
 * (session, batch id) marker can tell a repeat from new data. Also pinned: a 4xx other than 429 drops
 * the batch, one request is in flight at a time, the pagehide (beacon) path keeps ids, and the outbox
 * holds a bounded number of events.
 *
 * npm test
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AnalyticsEvent } from '../../src/museum/api/client'
import { type Batch, createOutbox, MAX_QUEUE, newBatchId } from '../../src/museum/analytics/outbox'

/** What the server accepts as a session or batch id (src/server/handlers/analytics.ts). */
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/

const ev = (n: number): AnalyticsEvent => ({ t: 1_760_000_000_000 + n, type: 'pos', x: n % 50, z: 0 })
const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => ev(from + i))
const settle = () => new Promise((resolve) => setImmediate(resolve))
/** How api.analytics.send rejects: ApiError carries the status, 0 when there was no response. */
const failure = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status })

/** Sequential ids, so the tests can name batches. */
function ids() {
  let n = 0
  return () => `batch-${++n}`
}

/** A transport whose POSTs answer from `answers` in order (an Error rejects). Records a copy of every batch as sent. */
function fakeTransport(...answers: unknown[]) {
  const sent: Batch[] = []
  const beaconed: Batch[] = []
  let beaconTakes = true
  return {
    sent,
    beaconed,
    refuseBeacons: () => (beaconTakes = false),
    transport: {
      send: async (batch: Batch) => {
        sent.push(structuredClone(batch))
        const next = answers.shift()
        if (next instanceof Error) throw next
        return next ?? { ok: true }
      },
      beacon: (batch: Batch) => {
        beaconed.push(structuredClone(batch))
        return beaconTakes
      },
    },
  }
}

describe('outbox: a failed batch', () => {
  it('is sent again as the same batch: same id, same events, nothing added', async () => {
    const t = fakeTransport(failure(0), failure(429), failure(503), { ok: true }, { ok: true })
    const box = createOutbox(t.transport, ids())

    box.push(ev(1))
    box.push(ev(2))
    box.flush() // no response at all: the reply may be what was lost
    await settle()
    box.push(ev(3)) // arrives while the batch waits
    for (let i = 0; i < 4; i++) {
      box.flush()
      await settle()
    }

    assert.deepEqual(
      t.sent.map((b) => b.id),
      ['batch-1', 'batch-1', 'batch-1', 'batch-1', 'batch-2'],
    )
    for (const again of t.sent.slice(1, 4)) assert.deepEqual(again, { id: 'batch-1', events: [ev(1), ev(2)] })
    assert.deepEqual(t.sent[4].events, [ev(3)], 'the new event went in a batch of its own')
  })

  it('is dropped when the server refused it for good: a 4xx other than 429', async () => {
    for (const status of [400, 413, 415]) {
      const t = fakeTransport(failure(status), { ok: true })
      const box = createOutbox(t.transport, ids())

      box.push(ev(1))
      box.flush()
      await settle()
      box.push(ev(2))
      box.flush()
      await settle()

      assert.deepEqual(
        t.sent.map((b) => [b.id, b.events]),
        [
          ['batch-1', [ev(1)]],
          ['batch-2', [ev(2)]],
        ],
        String(status),
      )
      assert.equal(box.stats().awaitingRetry, 0)
    }
  })
})

describe('outbox: the interval', () => {
  it('sends one request at a time: a tick while a batch is in flight sends nothing', async () => {
    const sent: Batch[] = []
    let answer!: () => void
    const box = createOutbox(
      {
        send: (batch) => {
          sent.push(structuredClone(batch))
          return new Promise<void>((resolve) => (answer = resolve))
        },
        beacon: () => true,
      },
      ids(),
    )

    box.push(ev(1))
    box.flush()
    box.push(ev(2))
    box.flush()
    box.flush()
    assert.equal(sent.length, 1)

    answer()
    await settle()
    box.flush()
    assert.deepEqual(
      sent.map((b) => [b.id, b.events]),
      [
        ['batch-1', [ev(1)]],
        ['batch-2', [ev(2)]],
      ],
    )
  })

  it('never puts more than 200 events in a batch', async () => {
    const t = fakeTransport()
    const box = createOutbox(t.transport, ids())
    for (const e of range(0, 450)) box.push(e)
    for (let i = 0; i < 4; i++) {
      box.flush()
      await settle()
    }
    assert.deepEqual(
      t.sent.map((b) => b.events.length),
      [200, 200, 50],
    )
  })
})

describe('outbox: pagehide (sendBeacon)', () => {
  it('sends batches awaiting a retry first and unchanged, then everything queued, 200 at most per batch', async () => {
    const t = fakeTransport(failure(0))
    const box = createOutbox(t.transport, ids())
    box.push(ev(1))
    box.flush()
    await settle()
    for (const e of range(2, 251)) box.push(e)

    box.flushAll()

    assert.deepEqual(
      t.beaconed.map((b) => [b.id, b.events.length]),
      [
        ['batch-1', 1],
        ['batch-2', 200],
        ['batch-3', 49],
      ],
    )
    assert.deepEqual(t.beaconed[0], t.sent[0], 'the batch whose POST failed, as it was')
    assert.equal(box.stats().held, 0)
  })

  it('sends a batch the browser will not beacon by fetch under the same id, and keeps it when that fails too', async () => {
    const t = fakeTransport(failure(0), { ok: true })
    t.refuseBeacons()
    const box = createOutbox(t.transport, ids())

    box.push(ev(1))
    box.flushAll()
    await settle()
    assert.deepEqual(t.sent, t.beaconed, 'the fallback is the same batch')
    assert.equal(box.stats().awaitingRetry, 1)

    box.push(ev(2))
    box.flush()
    await settle()
    assert.deepEqual(t.sent[1], { id: 'batch-1', events: [ev(1)] })
  })
})

describe('outbox: what it holds', () => {
  it(`holds ${MAX_QUEUE} events at most; the oldest queued make room, and a batch awaiting a retry is never cut`, async () => {
    const t = fakeTransport(failure(0), { ok: true }, { ok: true })
    const box = createOutbox(t.transport, ids())
    for (const e of range(0, 150)) box.push(e)
    box.flush() // 150 events, failed
    await settle()

    for (const e of range(150, 2500)) box.push(e)

    assert.deepEqual(box.stats(), { queued: MAX_QUEUE - 150, awaitingRetry: 1, held: MAX_QUEUE })
    box.flush()
    await settle()
    assert.deepEqual(t.sent[1], { id: 'batch-1', events: range(0, 150) }, 'the waiting batch, whole')
    box.flush()
    await settle()
    assert.deepEqual(t.sent[2].events, range(650, 850), 'the queue kept the newest events')
  })

  it('drops everything when the backend is unreachable (static mode)', () => {
    const box = createOutbox(fakeTransport().transport, ids())
    for (const e of range(0, 10)) box.push(e)
    box.clear()
    assert.deepEqual(box.stats(), { queued: 0, awaitingRetry: 0, held: 0 })
  })
})

describe('newBatchId', () => {
  const getRandomValues = crypto.getRandomValues.bind(crypto)

  it('is a UUID from crypto.randomUUID where there is one', () => {
    assert.match(newBatchId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('outside a secure context: 128 bits from getRandomValues, base64url', () => {
    assert.match(newBatchId({ getRandomValues }), /^[A-Za-z0-9_-]{22}$/)
    assert.match(newBatchId({}), /^[A-Za-z0-9_-]{22}$/, 'and without Web Crypto at all')
  })

  it('is accepted by the server, and does not repeat', () => {
    for (const source of [crypto, { getRandomValues }, {}]) {
      const made = Array.from({ length: 10_000 }, () => newBatchId(source))
      for (const id of made.slice(0, 50)) assert.match(id, ID_RE)
      assert.equal(new Set(made).size, made.length)
    }
  })
})
