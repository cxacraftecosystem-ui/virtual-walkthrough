/**
 * Tiny visibility-graph path planner over the collision rectangles.
 *
 * Waypoints (config/tour.ts NAV_WAYPOINTS) sit in room centres and on both sides of every
 * doorway; edges are created on demand between any two points whose straight segment keeps
 * `clearance` from every collider. Dijkstra then gives a walkable polyline, so an automatic
 * walk (guided tour, "go to" a favourite) never runs into a wall and never gets stuck.
 */
import { MUSEUM } from '../config/museum'
import { NAV_WAYPOINTS } from '../config/tour'
import { COLLIDERS, resolveCircle } from '../navigation/collision'

export interface P2 {
  x: number
  z: number
}

const CLEAR = MUSEUM.visitor.collisionRadius + 0.06

/** Segment a→b stays at least `r` away from every collider (AABBs inflated by r). */
export function segmentClear(ax: number, az: number, bx: number, bz: number, r = CLEAR) {
  const dx = bx - ax
  const dz = bz - az
  for (const c of COLLIDERS) {
    const minX = c.minX - r
    const maxX = c.maxX + r
    const minZ = c.minZ - r
    const maxZ = c.maxZ + r
    // quick reject
    if (Math.max(ax, bx) < minX || Math.min(ax, bx) > maxX || Math.max(az, bz) < minZ || Math.min(az, bz) > maxZ) continue
    let t0 = 0
    let t1 = 1
    let hit = true
    const p = [-dx, dx, -dz, dz]
    const q = [ax - minX, maxX - ax, az - minZ, maxZ - az]
    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) {
        if (q[i] < 0) {
          hit = false
          break
        }
      } else {
        const t = q[i] / p[i]
        if (p[i] < 0) t0 = Math.max(t0, t)
        else t1 = Math.min(t1, t)
        if (t0 > t1) {
          hit = false
          break
        }
      }
    }
    if (hit) return false
  }
  return true
}

function linkable(a: P2, b: P2, endpoint: boolean) {
  if (segmentClear(a.x, a.z, b.x, b.z)) return true
  // The visitor (or a goal) may stand closer than CLEAR to a wall: allow a tighter link.
  return endpoint && segmentClear(a.x, a.z, b.x, b.z, MUSEUM.visitor.collisionRadius - 0.04)
}

const dist = (a: P2, b: P2) => Math.hypot(a.x - b.x, a.z - b.z)

/**
 * Shortest walkable polyline from `from` to `to` (excluding `from`, including `to`),
 * or null when no route exists.
 */
export function planPath(from: P2, to: P2): P2[] | null {
  const goal = resolveCircle(to.x, to.z, MUSEUM.visitor.collisionRadius + 0.02)
  if (linkable(from, goal, true)) return [goal]
  const nodes: P2[] = [from, ...NAV_WAYPOINTS.map(([x, z]) => ({ x, z })), goal]
  const n = nodes.length
  const G = n - 1
  const best = new Array<number>(n).fill(Infinity)
  const prev = new Array<number>(n).fill(-1)
  const done = new Array<boolean>(n).fill(false)
  best[0] = 0
  for (;;) {
    let u = -1
    for (let i = 0; i < n; i++) if (!done[i] && best[i] < Infinity && (u < 0 || best[i] < best[u])) u = i
    if (u < 0 || u === G) break
    done[u] = true
    for (let v = 1; v < n; v++) {
      if (done[v]) continue
      const d = best[u] + dist(nodes[u], nodes[v])
      if (d >= best[v]) continue
      if (!linkable(nodes[u], nodes[v], u === 0 || v === G)) continue
      best[v] = d
      prev[v] = u
    }
  }
  if (best[G] === Infinity) return null
  const out: P2[] = []
  for (let i = G; i > 0; i = prev[i]) out.unshift(nodes[i])
  return out
}

export function pathLength(from: P2, path: P2[]) {
  let len = 0
  let p = from
  for (const q of path) {
    len += dist(p, q)
    p = q
  }
  return len
}
