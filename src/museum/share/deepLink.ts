/**
 * Deep links & sharing.
 *
 *   /gallery#artwork=<id>   #object=<id>   #exhibit=<id>   #zone=<id>
 *   (also #infographic=<id>, #video=<id>)
 *
 * On load — once the visitor has entered (also with ?autostart) — the museum walks or
 * fade-teleports to the item and opens its panel; a zone link teleports to the room.
 * The museum lives at /gallery (a landing page is at /), so links always point there.
 */
import type { SelectionKind } from '../state/store'

export type LinkKind = SelectionKind | 'zone'
export const LINK_KINDS: LinkKind[] = ['artwork', 'object', 'exhibit', 'zone', 'infographic', 'video']

export interface DeepLink {
  kind: LinkKind
  id: string
}

export const isLinkKind = (k: unknown): k is LinkKind => typeof k === 'string' && (LINK_KINDS as string[]).includes(k)

/** Absolute URL of the museum page (the landing page is at /). */
export function galleryUrl(origin?: string): string {
  const o = origin ?? (typeof location !== 'undefined' ? location.origin : '')
  return `${o}/gallery`
}

export function deepLinkUrl(kind: LinkKind, id: string, origin?: string): string {
  return `${galleryUrl(origin)}#${kind}=${encodeURIComponent(id)}`
}

/** Parse `#kind=id` (also tolerates `#/kind=id` and extra `&` params). */
export function parseDeepLink(hash: string): DeepLink | null {
  const h = hash.replace(/^#\/?/, '')
  if (!h) return null
  for (const part of h.split('&')) {
    const i = part.indexOf('=')
    if (i < 1) continue
    const k = decodeURIComponent(part.slice(0, i))
    const v = decodeURIComponent(part.slice(i + 1)).trim()
    if (isLinkKind(k) && v && v.length <= 200) return { kind: k, id: v }
  }
  return null
}

/** Printable QR label page for an item. */
export const qrLabelPath = (kind: LinkKind, id: string) => `/qr/${kind}/${encodeURIComponent(id)}`

/** Copy text: async Clipboard API, falling back to a hidden textarea + execCommand. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    ta.style.pointerEvents = 'none'
    document.body.appendChild(ta)
    ta.select()
    ta.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}
