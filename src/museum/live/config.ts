/**
 * Live presence / guided tours configuration (Supabase Realtime).
 * NEXT_PUBLIC_* values are inlined at build time; when either is missing, or `?static` /
 * `?nolive` is in the URL, every live feature hides itself.
 */
export const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()
export const SUPABASE_ANON_KEY = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim()
/** One channel per exhibition. */
export const LIVE_ROOM = ((process.env.NEXT_PUBLIC_LIVE_ROOM ?? '').trim() || 'hand-block-printing').toLowerCase()

export function liveConfigured() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return false
  if (typeof window === 'undefined') return false
  const q = new URLSearchParams(window.location.search)
  return !q.has('static') && !q.has('nolive')
}

export const LIVE = {
  /** Position updates while moving (Hz). */
  posHz: 5,
  /** Keep-alive position update while idle (ms). */
  idleMs: 4000,
  /** Peers silent for this long are dropped (presence leave usually arrives first). */
  staleMs: 20_000,
  /** Visible avatar cap. */
  maxVisible: 40,
  /** Full silhouette + name tag within this distance; orb only beyond; hidden past `farM`. */
  nearM: 14,
  farM: 32,
  /** Docent announces the tour this often (late joiners, reconnects). */
  announceMs: 8000,
  /** Chat: sender limits (min interval, burst per window) and message length. */
  chatMinIntervalMs: 1500,
  chatBurst: 5,
  chatWindowMs: 20_000,
  chatMaxLen: 240,
  chatHistory: 80,
}
