/**
 * Random ids for analytics. The session id names a visitor's events on the server and, with a batch id,
 * keys the server's duplicate check (src/server/handlers/analytics.ts), so it comes from Web Crypto and
 * never from Math.random: a guessable session id would let another client write into, or suppress
 * batches of, someone else's session.
 */

/**
 * 128 random bits from Web Crypto, or null when there is no Web Crypto at all. crypto.randomUUID
 * exists only in secure contexts (HTTPS, localhost), so elsewhere (a LAN address in development) the
 * same strength comes from getRandomValues, as base64url (22 characters).
 */
export function secureRandomId(c: Partial<Crypto> | undefined = globalThis.crypto): string | null {
  try {
    if (typeof c?.randomUUID === 'function') return c.randomUUID()
    if (typeof c?.getRandomValues !== 'function') return null
    const bytes = new Uint8Array(16)
    c.getRandomValues(bytes)
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  } catch {
    return null
  }
}

let fallbackSeq = 0

/**
 * A visitor's analytics session id. Every browser this museum runs in has getRandomValues; without
 * Web Crypto the id is only unique (time + a counter), never pseudo-random, so nothing pretends to
 * be unpredictable when it is not.
 */
export function newSessionId(c: Partial<Crypto> | undefined = globalThis.crypto): string {
  const id = secureRandomId(c)
  if (id) return id
  const micros = typeof performance !== 'undefined' ? Math.floor(performance.now() * 1000) : 0
  return `s-${Date.now().toString(36)}-${micros.toString(36)}-${(fallbackSeq++).toString(36)}`
}
