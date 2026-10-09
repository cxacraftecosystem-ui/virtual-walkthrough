/**
 * The analytics tracker's outbox: events wait here, leave in batches, and come back when sending fails.
 *
 * Every batch gets an id made here in the browser, and the server stores each id once per session
 * (analytics_batches), because a failure can be a lost reply to a batch it did store. That only
 * works if what is sent again is the SAME batch, so a failed batch is kept whole, under its id, and
 * sent again before any new events are batched; nothing is ever added to it.
 *
 * No DOM and no network in here (the tracker passes both in), so tests/unit/analytics-outbox.test.ts
 * drives it directly.
 */
import type { AnalyticsEvent } from '../api/client'

export interface Batch {
  /** Made in the browser; the same on every attempt. */
  id: string
  events: AnalyticsEvent[]
}

export interface Transport {
  /** POST the batch. Rejects with `{ status }`; 0 (or none) means no response at all. */
  send(batch: Batch): Promise<unknown>
  /** navigator.sendBeacon: false when the browser will not take it. */
  beacon(batch: Batch): boolean
}

/** Events per batch, the server's limit. */
export const MAX_BATCH = 200
/** Events held at most, queued and awaiting a retry together. */
export const MAX_QUEUE = 2000

/**
 * 128 random bits. crypto.randomUUID exists only in secure contexts (HTTPS, localhost), so elsewhere
 * (a LAN address in development) the same strength comes from getRandomValues, as base64url.
 */
export function newBatchId(c: Partial<Crypto> | undefined = globalThis.crypto): string {
  if (typeof c?.randomUUID === 'function') return c.randomUUID()
  const bytes = new Uint8Array(16)
  if (typeof c?.getRandomValues === 'function') c.getRandomValues(bytes)
  // No Web Crypto at all: Math.random is guessable, but a batch id only has to be unique.
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function createOutbox(transport: Transport, newId: () => string = newBatchId) {
  /** Events not in a batch yet, oldest first. */
  let queue: AnalyticsEvent[] = []
  /** Batches whose sending failed, to be sent again exactly as they are. */
  let retry: Batch[] = []
  /** The interval's request is in flight: one at a time, so a batch is never in the air twice. */
  let busy = false

  const held = () => retry.reduce((n, b) => n + b.events.length, queue.length)
  const seal = (): Batch => ({ id: newId(), events: queue.splice(0, MAX_BATCH) })

  /** Sends, and keeps the batch for another attempt unless the server refused it for good. */
  async function attempt(batch: Batch) {
    try {
      await transport.send(batch)
    } catch (err) {
      // A 4xx other than 429 (malformed, too large) would fail forever: that batch is dropped.
      const status = (err as { status?: number } | null)?.status ?? 0
      if (status >= 400 && status < 500 && status !== 429) return
      retry.push(batch)
    }
  }

  return {
    /** Queues an event. When full, the oldest queued event makes room; a batch awaiting a retry is never cut. */
    push(ev: AnalyticsEvent) {
      while (held() >= MAX_QUEUE) {
        if (queue.length) queue.shift()
        else retry.shift() // only failed batches left: the oldest goes, whole
      }
      queue.push(ev)
    },

    /** One request: the first batch awaiting a retry, unchanged, else a new batch from the queue. */
    flush() {
      if (busy) return
      const batch = retry.shift() ?? (queue.length ? seal() : undefined)
      if (!batch) return
      busy = true
      void attempt(batch).finally(() => {
        busy = false
      })
    },

    /**
     * The page is being hidden or closed: everything, now, by sendBeacon. Batches awaiting a retry go
     * first, unchanged; one the browser will not take goes by fetch instead, under the same id.
     */
    flushAll() {
      const batches = retry.splice(0)
      while (queue.length) batches.push(seal())
      for (const batch of batches) {
        let taken = false
        try {
          taken = transport.beacon(batch)
        } catch {
          /* no beacon */
        }
        if (!taken) void attempt(batch)
      }
    },

    /** The backend is unreachable (static mode): nothing will ever be sent. */
    clear() {
      queue = []
      retry = []
    },

    /** For the tests. */
    stats: () => ({ queued: queue.length, awaitingRetry: retry.length, held: held() }),
  }
}
