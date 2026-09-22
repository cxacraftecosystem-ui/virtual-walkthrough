/**
 * Zone-based render culling.
 *
 * Each wing's interior/content is wrapped in <ZoneGroup zones={[...]}>. Every frame the
 * visitor's zone is resolved and ZONE_VISIBILITY (layout.ts) gives the set of zones that
 * can be seen from it (through doorways and bay openings); groups outside that set are
 * hidden — no draw calls, no shadow casting. Between zones (in a doorway) the last known
 * zone is kept, and the set of the zone being entered is merged in, so nothing pops.
 */
import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import type * as THREE from 'three'
import { ZONES, ZONE_VISIBILITY, zoneAt, type ZoneId } from '../config/layout'
import { visitor } from '../state/visitor'
import { requestShadowRefresh } from '../lighting/SkyAndSun'

const groups = new Map<THREE.Group, ZoneId[]>()
let visible = new Set<ZoneId>(ZONES.map((z) => z.id))
let current: ZoneId | null = null
const MARGIN = 1.6

function applyVisibility() {
  for (const [g, zones] of groups) g.visible = zones.some((z) => visible.has(z))
}

/** Zones whose rectangle (grown by MARGIN) contains the point — catches doorway thresholds. */
function nearbyZones(x: number, z: number): ZoneId[] {
  return ZONES.filter((zn) => x >= zn.rect.minX - MARGIN && x <= zn.rect.maxX + MARGIN && z >= zn.rect.minZ - MARGIN && z <= zn.rect.maxZ + MARGIN).map((zn) => zn.id)
}

/** Outside every room (forecourt, or inside a wall/door threshold): the closest zone rectangle. */
function nearestZone(x: number, z: number): ZoneId | null {
  let best: ZoneId | null = null
  let bestD = Infinity
  for (const zn of ZONES) {
    const dx = Math.max(zn.rect.minX - x, 0, x - zn.rect.maxX)
    const dz = Math.max(zn.rect.minZ - z, 0, z - zn.rect.maxZ)
    const d = dx * dx + dz * dz
    if (d < bestD) {
      bestD = d
      best = zn.id
    }
  }
  return best
}

export function ZoneCuller({ enabled = true }: { enabled?: boolean }) {
  const last = useRef('')
  useFrame(() => {
    if (!enabled) {
      if (last.current !== 'all') {
        visible = new Set(ZONES.map((z) => z.id))
        applyVisibility()
        last.current = 'all'
      }
      return
    }
    const here = zoneAt(visitor.x, visitor.z)?.id ?? nearestZone(visitor.x, visitor.z)
    if (here) current = here
    const set = new Set<ZoneId>()
    for (const id of current ? [current, ...nearbyZones(visitor.x, visitor.z)] : ZONES.map((z) => z.id)) {
      for (const v of ZONE_VISIBILITY[id] ?? [id]) set.add(v)
    }
    const key = [...set].sort().join(',')
    if (key !== last.current) {
      last.current = key
      visible = set
      applyVisibility()
      requestShadowRefresh(2)
    }
  })
  return null
}

/** Render children only while one of `zones` is visible from the visitor's position. */
export function ZoneGroup({ zones, children }: { zones: ZoneId[]; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null)
  const key = zones.join(',')
  useLayoutEffect(() => {
    const g = ref.current
    if (!g) return
    groups.set(g, key.split(',') as ZoneId[])
    g.visible = (key.split(',') as ZoneId[]).some((z) => visible.has(z))
    return () => {
      groups.delete(g)
    }
  }, [key])
  return <group ref={ref}>{children}</group>
}

export function isZoneVisible(z: ZoneId) {
  return visible.has(z)
}
