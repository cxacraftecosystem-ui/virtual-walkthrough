/** Colour helpers for the editor's preview (WCAG 2 relative luminance and contrast). */

/** Text colours the preview can put on a curator-chosen ground: near-black ink and cream paper. */
export const DARK_TEXT = '#1b140f'
export const LIGHT_TEXT = '#fbf7f0'

/** `#rrggbb` (or `#rgb`) → [r, g, b] 0–255; null when it isn't a hex colour. */
export function parseHex(hex: unknown): [number, number, number] | null {
  if (typeof hex !== 'string') return null
  let h = hex.trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(h)) h = [...h].map((c) => c + c).join('')
  if (!/^[0-9a-f]{6}$/i.test(h)) return null
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}

/** WCAG relative luminance (0 black … 1 white). */
export function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** WCAG contrast ratio of two colours (1 … 21). */
export function contrast(a: string, b: string): number {
  const pa = parseHex(a)
  const pb = parseHex(b)
  if (!pa || !pb) return 1
  const [hi, lo] = [luminance(pa), luminance(pb)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** The text colour (dark ink or cream) that reads best on `ground`; null when `ground` isn't a hex colour. */
export function textOn(ground: unknown): string | null {
  if (!parseHex(ground)) return null
  const g = ground as string
  return contrast(DARK_TEXT, g) >= contrast(LIGHT_TEXT, g) ? DARK_TEXT : LIGHT_TEXT
}
