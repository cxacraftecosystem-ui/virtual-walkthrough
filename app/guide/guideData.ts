/**
 * Guide data: loads the museum content on the server (content store → bundled fallback) and
 * groups every item into the room (zone) it stands in, in visiting order.
 *
 * Only renders content that exists — nothing here adds cultural or historical text.
 */
import 'server-only'
import type { ArtworkConfig } from '../../src/museum/config/artworks'
import type { ExhibitConfig } from '../../src/museum/config/exhibits'
import type { InfographicConfig } from '../../src/museum/config/infographics'
import { SURFACES, surfacePoint, zoneAt, type SurfaceId, type ZoneId } from '../../src/museum/config/layout'
import type { SceneObjectConfig } from '../../src/museum/config/objects'
import type { VideoConfig } from '../../src/museum/config/videos'
import { bundledContent } from '../../src/museum/content/content'
import type { MuseumContent } from '../../src/museum/content/types'
import { getContent } from '../../src/server/contentStore'
import { services } from '../../src/server/services'

/** Visiting order (entrance → galleries → court → wings). */
export const ROOM_ORDER: ZoneId[] = ['atrium', 'reception', 'passage', 'gallery-a', 'gallery-b', 'gallery-c', 'reveal', 'gallery-d', 'theatre', 'workshop', 'courtyard']

export interface GuideArtisan {
  id: string
  name: string
}

export interface GuideContent extends MuseumContent {
  artisans?: GuideArtisan[]
}

export interface RoomItems {
  zone: ZoneId
  artworks: ArtworkConfig[]
  exhibits: ExhibitConfig[]
  infographics: InfographicConfig[]
  videos: VideoConfig[]
  objects: SceneObjectConfig[]
}

const LOAD_TIMEOUT_MS = 5000

/** Content from the database, or the bundled content on any failure (no DB, timeout, bad data). */
export async function loadGuideContent(): Promise<GuideContent> {
  try {
    const doc = await Promise.race([
      services().then(({ db }) => getContent(db)),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('content store timeout')), LOAD_TIMEOUT_MS)),
    ])
    if (!Array.isArray(doc.artworks)) throw new Error('malformed content')
    const bundled = bundledContent()
    const c = doc as unknown as GuideContent
    return {
      ...c,
      // an unseeded exhibition row stores {} / empty texts — fall back to the bundled wall text
      exhibition: typeof c.exhibition?.title === 'string' && c.exhibition.title ? c.exhibition : bundled.exhibition,
      welcome: typeof c.welcome?.body === 'string' && c.welcome.body ? c.welcome : bundled.welcome,
    }
  } catch (err) {
    console.warn('[guide] using bundled content:', (err as Error).message)
    return bundledContent()
  }
}

const isZone = (v: unknown): v is ZoneId => typeof v === 'string' && (ROOM_ORDER as string[]).includes(v)

/** Zone of a wall-mounted item (surface point → zoneAt), falling back to the surface's declared zone. */
export function zoneOfPlacement(placement: { surface?: unknown; at?: unknown } | undefined): ZoneId | undefined {
  const surface = placement?.surface
  if (typeof surface !== 'string' || !(surface in SURFACES)) return undefined
  const s = SURFACES[surface as SurfaceId]
  const at = typeof placement?.at === 'number' && Number.isFinite(placement.at) ? placement.at : (s.range[0] + s.range[1]) / 2
  // 0.3 m in front of the wall face is unambiguously inside the room; the face itself can sit on a zone boundary
  const inRoom = surfacePoint(s.id, at, 0, 0.3).position
  const onWall = surfacePoint(s.id, at, 0).position
  const z = zoneAt(inRoom[0], inRoom[2]) ?? zoneAt(onWall[0], onWall[2])
  return z?.id ?? s.zone
}

/** Objects worth describing: interactive ones, or ones with text. Repeated instances are listed once. */
function describedObjects(objects: SceneObjectConfig[]): SceneObjectConfig[] {
  const seen = new Set<string>()
  const out: SceneObjectConfig[] = []
  // interactive instances first so the one that opens a panel is the one kept
  const ranked = [...objects].sort((a, b) => Number(!!b.interactive) - Number(!!a.interactive))
  for (const o of ranked) {
    if (!o || typeof o.title !== 'string') continue
    if (!o.interactive && !o.description) continue
    const key = `${o.zone}|${o.title}|${o.description ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(o)
  }
  // restore content order
  const order = new Map(objects.map((o, i) => [o, i]))
  return out.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
}

export function groupByRoom(c: GuideContent): RoomItems[] {
  const rooms = new Map<ZoneId, RoomItems>(ROOM_ORDER.map((zone) => [zone, { zone, artworks: [], exhibits: [], infographics: [], videos: [], objects: [] }]))
  const room = (zone: ZoneId | undefined) => (zone ? rooms.get(zone) : undefined)
  const list = <T>(v: T[] | undefined): T[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : [])
  for (const a of list(c.artworks)) room(zoneOfPlacement(a.placement))?.artworks.push(a)
  for (const e of list(c.exhibits)) room(zoneOfPlacement(e.placement))?.exhibits.push(e)
  for (const i of list(c.infographics)) room(zoneOfPlacement(i.placement))?.infographics.push(i)
  for (const v of list(c.videos)) room(zoneOfPlacement(v.placement) ?? (isZone(v.zone) ? v.zone : undefined))?.videos.push(v)
  for (const o of describedObjects(list(c.objects))) room(isZone(o.zone) ? o.zone : undefined)?.objects.push(o)
  return ROOM_ORDER.map((z) => rooms.get(z)!)
}

export const roomCount = (r: RoomItems) => r.artworks.length + r.exhibits.length + r.infographics.length + r.videos.length + r.objects.length
