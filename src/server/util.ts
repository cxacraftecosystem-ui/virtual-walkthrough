import 'server-only'

/** Error with an HTTP status; rendered as `{ error }` by `route()`. */
export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export const fail = (status: number, message: string): never => {
  throw new HttpError(status, message)
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Tiny fixed-window in-memory rate limiter. Returns false when over the limit.
 * Per process: on serverless it limits per warm instance (good enough against casual abuse;
 * use a shared store such as a Postgres table or Upstash for strict global limits).
 */
export function createRateLimiter(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>()
  return (key: string) => {
    const now = Date.now()
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset <= now) hits.delete(k)
    const h = hits.get(key)
    if (!h || h.reset <= now) {
      hits.set(key, { n: 1, reset: now + windowMs })
      return true
    }
    h.n++
    return h.n <= max
  }
}

export const ITEM_KINDS = ['artwork', 'exhibit', 'infographic', 'video', 'object'] as const
export type ItemKind = (typeof ITEM_KINDS)[number]
export const isItemKind = (v: unknown): v is ItemKind =>
  typeof v === 'string' && (ITEM_KINDS as readonly string[]).includes(v)

/** Allowed ids for content items / favourites (URL-safe). */
export const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/
