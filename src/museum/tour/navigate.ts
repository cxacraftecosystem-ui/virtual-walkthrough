/**
 * "Go to" any item (favourites drawer, tour caption): a comfortable viewing pose in front of
 * it, reached by a collision-aware walk for short hops or a fade-teleport for long ones.
 */
import { ARTWORKS } from '../config/artworks'
import { EXHIBITS } from '../config/exhibits'
import { INFOGRAPHICS } from '../config/infographics'
import { MUSEUM } from '../config/museum'
import { SCENE_OBJECTS } from '../config/objects'
import { TOUR } from '../config/tour'
import { VIDEOS } from '../config/videos'
import { SURFACES, ZONES, surfacePoint, type SurfaceId, type ZoneId } from '../config/layout'
import { getItem } from '../interaction/registry'
import { resolveCircle } from '../navigation/collision'
import type { SelectionKind } from '../state/store'
import { teleport, visitor, type WalkTarget } from '../state/visitor'
import { travel } from '../ui/Minimap'
import { pathLength, planPath } from './pathing'

const RAD = 180 / Math.PI

export interface Pose {
  x: number
  z: number
  /** Compass heading (deg). */
  yawDeg: number
  pitchDeg: number
}

function faceFrom(x: number, z: number, cx: number, cy: number, cz: number): Pose {
  const dx = cx - x
  const dz = cz - z
  const horiz = Math.max(0.3, Math.hypot(dx, dz))
  // compass: 0 = -z, 90 = +x
  const yawDeg = (Math.atan2(dx, -dz) * RAD + 360) % 360
  const pitchDeg = Math.atan2(cy - MUSEUM.visitor.eyeHeight, horiz) * RAD * 0.85
  return { x, z, yawDeg, pitchDeg }
}

function surfacePose(surface: SurfaceId, at: number, cy: number, w: number, h: number): Pose {
  const s = SURFACES[surface]
  const dist = Math.min(3.2, Math.max(1.8, Math.max(w, h) * 1.05 + 0.85))
  const c = surfacePoint(surface, at, cy, 0)
  const p = resolveCircle(c.position[0] + s.normal[0] * dist, c.position[2] + s.normal[1] * dist, MUSEUM.visitor.collisionRadius + 0.04)
  return faceFrom(p.x, p.z, c.position[0], cy, c.position[2])
}

function zoneOf(kind: SelectionKind, id: string): ZoneId | undefined {
  const bySurface = (s?: SurfaceId) => (s ? SURFACES[s]?.zone : undefined)
  switch (kind) {
    case 'artwork':
      return bySurface(ARTWORKS.find((a) => a.id === id)?.placement.surface)
    case 'exhibit':
      return bySurface(EXHIBITS.find((e) => e.id === id)?.placement.surface)
    case 'infographic':
      return bySurface(INFOGRAPHICS.find((g) => g.id === id)?.placement.surface)
    case 'video':
      return bySurface(VIDEOS.find((v) => v.id === id)?.placement.surface)
    case 'object':
      return SCENE_OBJECTS.find((o) => o.id === id)?.zone
  }
}

/** Where to stand to look at an item (registry first, then its config placement, then its room). */
export function poseFor(kind: SelectionKind, id: string): Pose | null {
  const it = getItem(kind, id)
  if (it) {
    const [cx, cy, cz] = it.center
    const [w, h] = it.size
    const dist = it.viewDistance ?? Math.min(3.0, Math.max(1.7, Math.max(w, h) * 1.05 + 0.85))
    const p = resolveCircle(cx + it.normal[0] * dist, cz + it.normal[2] * dist, MUSEUM.visitor.collisionRadius + 0.04)
    return faceFrom(p.x, p.z, cx, cy, cz)
  }
  if (kind === 'artwork') {
    const a = ARTWORKS.find((x) => x.id === id)
    if (a) return surfacePose(a.placement.surface, a.placement.at, a.placement.centerHeight ?? MUSEUM.display.artworkCenterHeight, 1.4, 1.4)
  }
  if (kind === 'infographic') {
    const g = INFOGRAPHICS.find((x) => x.id === id)
    if (g) return surfacePose(g.placement.surface, g.placement.at, g.placement.centerHeight ?? MUSEUM.display.artworkCenterHeight, g.width, g.height)
  }
  if (kind === 'video') {
    const v = VIDEOS.find((x) => x.id === id)
    if (v) return surfacePose(v.placement.surface, v.placement.at, v.placement.centerHeight, v.width, v.width * 0.5625)
  }
  if (kind === 'exhibit') {
    const e = EXHIBITS.find((x) => x.id === id)
    if (e) return surfacePose(e.placement.surface, e.placement.at, 0.95, 1.2, 0.6)
  }
  if (kind === 'object') {
    const o = SCENE_OBJECTS.find((x) => x.id === id)
    const zone = o ? ZONES.find((z) => z.id === o.zone) : undefined
    if (o && zone) {
      // Stand between the object and the room's centre, facing the object.
      const [ox, , oz] = o.position
      const cx = (zone.rect.minX + zone.rect.maxX) / 2
      const cz = (zone.rect.minZ + zone.rect.maxZ) / 2
      const d = Math.hypot(cx - ox, cz - oz) || 1
      const reach = Math.max(o.footprint?.[0] ?? 1, o.footprint?.[1] ?? 1) / 2 + 1.6
      const p = resolveCircle(ox + ((cx - ox) / d) * reach, oz + ((cz - oz) / d) * reach, MUSEUM.visitor.collisionRadius + 0.04)
      return faceFrom(p.x, p.z, ox, Math.min(1.4, (o.height ?? 1.2) * 0.6), oz)
    }
  }
  const z = zoneOf(kind, id)
  const zone = z ? ZONES.find((x) => x.id === z) : undefined
  return zone ? { x: zone.spawn.x, z: zone.spawn.z, yawDeg: zone.spawn.yawDeg, pitchDeg: 0 } : null
}

/**
 * Take the visitor to a pose: walk (waypoint-chained, collision-aware) when close,
 * fade-teleport when far or when no route exists.
 */
export function goToPose(pose: Pose, onArrive?: () => void) {
  const from = { x: visitor.x, z: visitor.z }
  const path = planPath(from, pose)
  if (!path || pathLength(from, path) > TOUR.teleportBeyond) {
    travel(() => {
      teleport(pose.x, pose.z, pose.yawDeg, pose.pitchDeg)
      onArrive?.()
    })
    return
  }
  let i = 0
  const step = () => {
    const p = path[i]
    const last = i === path.length - 1
    const dx = p.x - visitor.x
    const dz = p.z - visitor.z
    const t: WalkTarget = last
      ? { x: p.x, z: p.z, yaw: -pose.yawDeg / RAD, pitch: pose.pitchDeg / RAD, onArrive }
      : {
          x: p.x,
          z: p.z,
          yaw: Math.atan2(-dx, -dz),
          onArrive: () => {
            i++
            step()
          },
        }
    visitor.walkTarget = t
  }
  step()
}

export function goToItem(kind: SelectionKind, id: string, onArrive?: () => void) {
  const pose = poseFor(kind, id)
  if (!pose) return false
  goToPose(pose, onArrive)
  return true
}
