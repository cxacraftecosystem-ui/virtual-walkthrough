/**
 * Chat hygiene: a deliberately small profanity mask (whole words, common leetspeak), control-char
 * stripping and length clamp. Applied by the sender AND every receiver (never trust the sender).
 */
const WORDS = [
  'fuck', 'fucking', 'fucker', 'shit', 'bullshit', 'bitch', 'bastard', 'asshole', 'arsehole', 'dick', 'cunt', 'cock',
  'pussy', 'slut', 'whore', 'wanker', 'twat', 'prick', 'motherfucker', 'nigger', 'nigga', 'faggot', 'retard',
  'chutiya', 'madarchod', 'bhenchod', 'behenchod', 'bhosdike', 'gandu', 'randi', 'harami', 'kamina', 'saala',
]

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i' }
const BAD = new Set(WORDS)
/** Stems also matched as prefixes (fucking, shitty …) — only ones with no innocent English words. */
const STEMS = ['fuck', 'shit', 'bitch', 'cunt', 'wank', 'bhenchod', 'madarchod', 'chutiya']
// eslint-disable-next-line no-control-regex
const CONTROL_RE = new RegExp('[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e]', 'g')

function normalise(w: string) {
  return w
    .toLowerCase()
    .replace(/[013457@$!]/g, (c) => LEET[c] ?? c)
    .replace(/(.)\1{2,}/g, '$1$1')
    .replace(/[^a-z]/g, '')
}

export function cleanChat(input: string, maxLen: number) {
  const text = input
    // control chars, zero-width and bidi overrides
    .replace(CONTROL_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen)
  return text.replace(/[\p{L}\p{N}@$!]+/gu, (w) => {
    const n = normalise(w)
    const hit = BAD.has(n) || STEMS.some((b) => n.startsWith(b))
    return hit ? w[0] + '•'.repeat(Math.max(2, w.length - 1)) : w
  })
}

/** Per-key sliding window limiter (receiver-side flood protection). */
export function createWindowLimiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>()
  return (key: string, now = Date.now()) => {
    const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
    if (arr.length >= max) {
      hits.set(key, arr)
      return false
    }
    arr.push(now)
    hits.set(key, arr)
    return true
  }
}
