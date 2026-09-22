/**
 * Lightweight 2D collision: the visitor is a circle on the floor plane, every
 * obstacle is an axis-aligned rectangle (all museum walls are orthogonal).
 * Robust, allocation-free and far cheaper than a physics engine.
 */
import { BENCHES, BENCH_SIZE, RECEPTION_DESK, WALLS } from '../config/layout'
import { EXHIBITS } from '../config/exhibits'
import { SCENE_OBJECTS } from '../config/objects'
import { tablePlacement, type Rect2 } from '../exhibits/placement'

export interface Collider extends Rect2 {
  id: string
}

function build(): Collider[] {
  const list: Collider[] = []
  for (const w of WALLS) {
    if (w.collide === false) continue
    list.push({ id: w.id, minX: w.min[0], maxX: w.max[0], minZ: w.min[2], maxZ: w.max[2] })
  }
  for (const b of BENCHES) {
    const hx = (b.along === 'x' ? BENCH_SIZE.length : BENCH_SIZE.depth) / 2
    const hz = (b.along === 'z' ? BENCH_SIZE.length : BENCH_SIZE.depth) / 2
    list.push({ id: b.id, minX: b.x - hx, maxX: b.x + hx, minZ: b.z - hz, maxZ: b.z + hz })
  }
  for (const e of EXHIBITS) list.push({ id: `table-${e.id}`, ...tablePlacement(e).rect })
  for (const o of SCENE_OBJECTS) {
    if (!o.footprint) continue
    const rot = (((o.rotationDeg ?? 0) % 180) + 180) % 180
    const swap = Math.abs(rot - 90) < 45
    const hx = (swap ? o.footprint[1] : o.footprint[0]) / 2
    const hz = (swap ? o.footprint[0] : o.footprint[1]) / 2
    const [x, , z] = o.position
    list.push({ id: `object-${o.id}`, minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz })
  }
  const d = RECEPTION_DESK
  list.push({ id: 'reception-desk', minX: d.x - d.depth / 2, maxX: d.x + d.depth / 2, minZ: d.z - d.length / 2, maxZ: d.z + d.length / 2 })
  return list
}

export const COLLIDERS: Collider[] = build()

/** Push a circle out of all colliders. Mutates and returns `out`. */
export function resolveCircle(x: number, z: number, radius: number, out = { x: 0, z: 0 }) {
  let px = x
  let pz = z
  for (let iter = 0; iter < 4; iter++) {
    let moved = false
    for (const c of COLLIDERS) {
      const cx = Math.max(c.minX, Math.min(px, c.maxX))
      const cz = Math.max(c.minZ, Math.min(pz, c.maxZ))
      const dx = px - cx
      const dz = pz - cz
      const d2 = dx * dx + dz * dz
      if (d2 >= radius * radius) continue
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2)
        const push = radius - d
        px += (dx / d) * push
        pz += (dz / d) * push
      } else {
        // Centre is inside the rectangle: exit via the nearest edge.
        const l = px - c.minX
        const r = c.maxX - px
        const b = pz - c.minZ
        const t = c.maxZ - pz
        const m = Math.min(l, r, b, t)
        if (m === l) px = c.minX - radius
        else if (m === r) px = c.maxX + radius
        else if (m === b) pz = c.minZ - radius
        else pz = c.maxZ + radius
      }
      moved = true
    }
    if (!moved) break
  }
  out.x = px
  out.z = pz
  return out
}

/** True if the straight segment a→b crosses any collider (used for line-of-sight checks). */
export function segmentBlocked(ax: number, az: number, bx: number, bz: number, ignore?: (c: Collider) => boolean) {
  for (const c of COLLIDERS) {
    if (ignore?.(c)) continue
    // Liang–Barsky clip against the rectangle.
    let t0 = 0
    let t1 = 1
    const dx = bx - ax
    const dz = bz - az
    const p = [-dx, dx, -dz, dz]
    const q = [ax - c.minX, c.maxX - ax, az - c.minZ, c.maxZ - az]
    let hit = true
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
    if (hit) return true
  }
  return false
}
