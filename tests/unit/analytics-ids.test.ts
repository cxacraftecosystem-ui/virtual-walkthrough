/**
 * Analytics ids (src/museum/analytics/ids.ts). The session id comes from Web Crypto (randomUUID, or
 * getRandomValues outside a secure context) and never from Math.random; without Web Crypto at all it
 * is still unique and accepted by the server.
 *
 * npm test
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { newSessionId, secureRandomId } from '../../src/museum/analytics/ids'

/** What the server accepts as a session or batch id (src/server/handlers/analytics.ts). */
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const getRandomValues = crypto.getRandomValues.bind(crypto)
const realRandom = Math.random

afterEach(() => {
  Math.random = realRandom
})

describe('secureRandomId', () => {
  it('uses crypto.randomUUID where there is one', () => {
    assert.match(secureRandomId() ?? '', UUID_RE)
  })

  it('outside a secure context: 128 bits from getRandomValues, base64url', () => {
    let asked = 0
    const id = secureRandomId({ getRandomValues: ((a: Uint8Array) => (asked++, getRandomValues(a))) as Crypto['getRandomValues'] })
    assert.match(id ?? '', /^[A-Za-z0-9_-]{22}$/)
    assert.equal(asked, 1)
  })

  it('is null without Web Crypto, or when it throws', () => {
    assert.equal(secureRandomId({}), null)
    assert.equal(secureRandomId({ getRandomValues: () => { throw new Error('no entropy') } }), null)
  })
})

describe('newSessionId', () => {
  it('never calls Math.random, whatever crypto offers', () => {
    Math.random = () => assert.fail('Math.random must not be used for a session id')
    for (const source of [crypto, { getRandomValues }, {}]) assert.match(newSessionId(source), ID_RE)
  })

  it('is accepted by the server and does not repeat', () => {
    for (const source of [crypto, { getRandomValues }, {}]) {
      const made = Array.from({ length: 5_000 }, () => newSessionId(source))
      for (const id of made.slice(0, 50)) assert.match(id, ID_RE)
      assert.equal(new Set(made).size, made.length)
    }
  })
})
