/**
 * Optional recordings: fetch → decodeAudioData, cached per URL. Missing files (404),
 * HTML fallbacks and undecodable data resolve to null silently.
 * Only called after audio unlock (the caller passes the live context).
 */
import { debug } from './debug'

const cache = new Map<string, Promise<AudioBuffer | null>>()
const resolved = new Map<string, AudioBuffer | null>()

/** Result if already known: a buffer, null (missing), or undefined (not probed / pending). */
export function knownFile(url: string): AudioBuffer | null | undefined {
  return resolved.get(url)
}

export function isProbed(url: string) {
  return cache.has(url)
}

export function loadFile(ctx: AudioContext, url: string): Promise<AudioBuffer | null> {
  const hit = cache.get(url)
  if (hit) return hit
  debug.files[url] = 'pending'
  const p = (async (): Promise<AudioBuffer | null> => {
    try {
      if (typeof fetch !== 'function') return null
      const res = await fetch(url, { cache: 'force-cache' })
      if (!res.ok) return null
      if ((res.headers.get('content-type') ?? '').includes('text/html')) return null
      const ab = await res.arrayBuffer()
      return await new Promise<AudioBuffer | null>((resolve) => {
        try {
          const r = ctx.decodeAudioData(ab, (b) => resolve(b), () => resolve(null))
          if (r && typeof r.then === 'function') r.then((b) => resolve(b), () => resolve(null))
        } catch {
          resolve(null)
        }
      })
    } catch {
      return null
    }
  })().then((b) => {
    resolved.set(url, b)
    debug.files[url] = b ? 'ok' : 'missing'
    return b
  })
  cache.set(url, p)
  return p
}

/** First URL in the list that loads (sequential, so a hit stops further probes). */
export async function loadFirst(ctx: AudioContext, urls: readonly string[]): Promise<AudioBuffer | null> {
  for (const u of urls) {
    const b = await loadFile(ctx, u)
    if (b) return b
  }
  return null
}

/** Synchronous view of loadFirst: buffer | null (all missing) | undefined (still unknown). */
export function knownFirst(urls: readonly string[]): AudioBuffer | null | undefined {
  for (const u of urls) {
    const b = resolved.get(u)
    if (b === undefined) return undefined
    if (b) return b
  }
  return null
}

export const ambienceUrl = (name: string) => `/audio/ambience/${name}.mp3`
