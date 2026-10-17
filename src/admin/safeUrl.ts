/**
 * URLs typed into the admin's content fields are rendered back as <img src>, <video src/poster> and
 * <a href>. A value is only ever used after it has been parsed and its scheme checked here, so a
 * `javascript:` (or `vbscript:`, `data:text/html`, …) address saved into an item cannot run in the
 * browser of the next editor who opens it.
 *
 * Allowed: http(s) and site-relative addresses everywhere; `blob:` (a local file being previewed) for
 * images and videos; `data:` only for raster images (PNG, JPEG, GIF, WebP, AVIF). SVG is excluded
 * because an SVG document can carry script.
 */

export type UrlUse = 'image' | 'video' | 'link'

const DATA_IMAGE = /^data:image\/(?:png|jpeg|gif|webp|avif)(?:;[a-z0-9=._+-]+)*,/i

function base(): string {
  return typeof location !== 'undefined' && /^https?:$/.test(location.protocol) ? location.href : 'http://localhost/'
}

/** The normalised absolute URL when `raw` is safe to render for `use`, otherwise undefined. */
export function safeUrl(raw: unknown, use: UrlUse, baseUrl: string = base()): string | undefined {
  if (typeof raw !== 'string') return undefined
  const value = raw.trim()
  if (!value) return undefined
  let url: URL
  try {
    url = new URL(value, baseUrl)
  } catch {
    return undefined
  }
  const href = url.href
  switch (url.protocol) {
    case 'http:':
    case 'https:':
      return href
    case 'blob:':
      return use === 'link' ? undefined : href
    case 'data:':
      return use === 'image' && DATA_IMAGE.test(href) ? href : undefined
    default:
      return undefined
  }
}
