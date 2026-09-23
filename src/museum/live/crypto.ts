/**
 * Docent message signing (WebCrypto ECDSA P-256 / SHA-256).
 * The private key is created non-extractable in the docent's tab; only the raw public key is sent
 * to the server, which binds it into the HMAC-signed docent token (see src/server/handlers/live.ts).
 */

const ALG = { name: 'ECDSA', namedCurve: 'P-256' } as const
const SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const

export function b64uEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function b64uDecode(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : ''
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function cryptoAvailable() {
  return typeof crypto !== 'undefined' && !!crypto.subtle
}

export async function createDocentKeys() {
  const pair = await crypto.subtle.generateKey(ALG, false, ['sign', 'verify'])
  const raw = await crypto.subtle.exportKey('raw', pair.publicKey)
  return { privateKey: pair.privateKey, pub: b64uEncode(raw) }
}

export function importDocentKey(pub: string) {
  return crypto.subtle.importKey('raw', b64uDecode(pub), ALG, false, ['verify'])
}

const enc = new TextEncoder()

/** Canonical string that is signed: every field that matters, in a fixed order. */
export function signingInput(tourId: string, seq: number, t: number, kind: string, data: string) {
  return enc.encode(`${tourId}|${seq}|${t}|${kind}|${data}`)
}

export async function signMessage(key: CryptoKey, input: Uint8Array<ArrayBuffer>) {
  return b64uEncode(await crypto.subtle.sign(SIGN, key, input))
}

export async function verifyMessage(key: CryptoKey, input: Uint8Array<ArrayBuffer>, sig: string) {
  try {
    return await crypto.subtle.verify(SIGN, key, b64uDecode(sig), input)
  } catch {
    return false
  }
}
