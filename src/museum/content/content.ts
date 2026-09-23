/**
 * Runtime content loading.
 *
 * The bundled config files are the default content (the museum works as a pure static
 * site). When the backend is reachable, GET /api/content replaces it before the scene
 * mounts. Arrays are replaced IN PLACE so every module that imported them sees the
 * server content (main.tsx loads content before importing the App/scene graph).
 */
import { ARTWORKS } from '../config/artworks'
import { EXHIBITS } from '../config/exhibits'
import { EXHIBITION_TITLE, INFOGRAPHICS, RECEPTION_WELCOME } from '../config/infographics'
import { SCENE_OBJECTS } from '../config/objects'
import { AMENITY_OBJECTS } from '../config/amenities'
import { VIDEOS } from '../config/videos'
import { SURFACES } from '../config/layout'
import type { MuseumContent } from './types'
import { ARTISANS, SEED_ARTISAN_LINKS, type Artisan } from './artisans'
import { CURRENT_EXHIBITION, isHexColor, TOUR_OVERRIDE, type ExhibitionInfo } from './exhibition'
import type { TourStop } from '../config/tour'

export type ContentSource = 'bundled' | 'server'
export let contentSource: ContentSource = 'bundled'
export let contentVersion = 0

/** Snapshot of the bundled content (used by the backend seed and as fallback). */
export function bundledContent(): MuseumContent {
  // placeholder maker links (src/museum/content/artisans.ts) unless the config sets its own
  const link = <T extends { id: string; artisanId?: string }>(list: T[], c: string) =>
    list.map((x) => (x.artisanId || !SEED_ARTISAN_LINKS[c]?.[x.id] ? x : { ...x, artisanId: SEED_ARTISAN_LINKS[c][x.id] }))
  return {
    version: 0,
    exhibition: { ...EXHIBITION_TITLE },
    welcome: { ...RECEPTION_WELCOME },
    artworks: link(structuredClone(ARTWORKS), 'artworks'),
    exhibits: link(structuredClone(EXHIBITS), 'exhibits'),
    infographics: structuredClone(INFOGRAPHICS),
    videos: structuredClone(VIDEOS),
    objects: structuredClone(SCENE_OBJECTS),
  }
}

/**
 * Server content is curator-edited: an item placed on a surface that no longer exists (renamed
 * wall, stale id) would throw while the scene modules build colliders and tour stops — which
 * blanks the museum for everyone. Such items are dropped (and reported) instead.
 */
function placeable(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false
  const p = (item as { placement?: { surface?: unknown; at?: unknown } }).placement
  if (!p || typeof p !== 'object' || !('surface' in p)) return true
  return typeof p.surface === 'string' && p.surface in SURFACES && (p.at === undefined || (typeof p.at === 'number' && Number.isFinite(p.at)))
}

function replace<T>(target: T[], next: T[] | undefined) {
  if (!Array.isArray(next)) return
  const ok = next.filter(placeable)
  if (ok.length !== next.length) {
    const bad = next.filter((x) => !placeable(x)).map((x) => String((x as { id?: unknown })?.id ?? '?'))
    console.warn('[museum] dropped content items with an unknown placement surface:', bad)
    void import('../utils/errorReporter').then((m) => m.reportError(new Error(`Dropped ${bad.length} misplaced content item(s)`), { kind: 'manual', extra: { ids: bad.join(',').slice(0, 300) } })).catch(() => {})
  }
  target.splice(0, target.length, ...ok)
}

export function applyContent(c: Partial<MuseumContent>) {
  replace(ARTWORKS, c.artworks)
  replace(EXHIBITS, c.exhibits)
  replace(INFOGRAPHICS, c.infographics)
  replace(VIDEOS, c.videos)
  replace(SCENE_OBJECTS, c.objects)
  // Visitor-amenity fixtures (shop, library, credits wall — config/amenities.ts) are part of the
  // building: keep them when a server content set predates them (server versions win by id).
  if (Array.isArray(c.objects)) for (const o of AMENITY_OBJECTS) if (!SCENE_OBJECTS.some((x) => x.id === o.id)) SCENE_OBJECTS.push(structuredClone(o))
  if (c.exhibition) Object.assign(EXHIBITION_TITLE, c.exhibition)
  if (c.welcome) Object.assign(RECEPTION_WELCOME, c.welcome)
  if (typeof c.version === 'number') contentVersion = c.version
  // multi-exhibition extras (server only; absent in bundled content)
  const extra = c as { exhibitionMeta?: ExhibitionInfo; artisans?: Artisan[]; tour?: TourStop[] }
  if (extra.exhibitionMeta) Object.assign(CURRENT_EXHIBITION, extra.exhibitionMeta)
  replace(ARTISANS, extra.artisans)
  TOUR_OVERRIDE.stops = Array.isArray(extra.tour) && extra.tour.length ? extra.tour : null
  const accent = CURRENT_EXHIBITION.theme?.accent
  if (typeof document !== 'undefined' && isHexColor(accent)) document.documentElement.style.setProperty('--accent', accent)
}

/**
 * Try the content API (short timeout); silently keep bundled content on any failure.
 * `exhibition` = slug of the exhibition to show (/gallery/<slug>); omitted = the default exhibition.
 * (`loadContent(timeoutMs)` is still accepted.)
 */
export async function loadContent(exhibition?: string | number, timeoutMs = 6000): Promise<ContentSource> {
  if (typeof exhibition === 'number') {
    timeoutMs = exhibition
    exhibition = undefined
  }
  if (new URLSearchParams(window.location.search).has('static')) return contentSource
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const url = exhibition ? `/api/content?exhibition=${encodeURIComponent(exhibition)}` : '/api/content'
    const res = await fetch(url, { signal: ctrl.signal, credentials: 'include' })
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return contentSource
    const data = (await res.json()) as Partial<MuseumContent>
    if (!Array.isArray(data.artworks)) return contentSource
    applyContent(data)
    contentSource = 'server'
  } catch {
    /* backend not running — static mode */
  } finally {
    clearTimeout(t)
  }
  return contentSource
}
