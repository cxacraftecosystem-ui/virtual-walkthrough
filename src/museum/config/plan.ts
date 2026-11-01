/**
 * The floor plan as plain SVG paths, for anything that draws the building from above (the admin
 * heatmap, the museum minimap). Each building builds this from its own layout, so the drawing code
 * never needs to know whether walls are boxes or arcs. World metres throughout: x → svg x, z → svg y
 * (north is up, the entrance is toward +z).
 *
 * This building: every wall is an axis-aligned box (layout.ts WALLS) and every zone a rectangle
 * (layout.ts ZONES), so each becomes a closed rectangle path.
 */
import { WALLS, ZONES } from './layout'

export interface PlanBounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}
/** One wall footprint; `kind` is the layout's wall kind ('exterior', 'glazing', …), `d` an SVG path. */
export interface PlanWall {
  id: string
  kind: string
  d: string
}
/** One zone outline with the point its label sits on. */
export interface PlanZone {
  id: string
  name: string
  d: string
  cx: number
  cz: number
}

const r2 = (n: number) => Math.round(n * 100) / 100
const rect = (minX: number, minZ: number, maxX: number, maxZ: number) => `M${r2(minX)} ${r2(minZ)}H${r2(maxX)}V${r2(maxZ)}H${r2(minX)}Z`
/** Hairline walls (thinner than this) are drawn at this width so they stay visible. */
const MIN_W = 0.08

const walls: PlanWall[] = WALLS.map((w) => {
  const cx = (w.min[0] + w.max[0]) / 2
  const cz = (w.min[2] + w.max[2]) / 2
  const hx = Math.max(w.max[0] - w.min[0], MIN_W) / 2
  const hz = Math.max(w.max[2] - w.min[2], MIN_W) / 2
  return { id: w.id, kind: w.kind, d: rect(cx - hx, cz - hz, cx + hx, cz + hz) }
})

const zones: PlanZone[] = ZONES.map((z) => ({
  id: z.id,
  name: z.name,
  d: rect(z.rect.minX, z.rect.minZ, z.rect.maxX, z.rect.maxZ),
  cx: r2((z.rect.minX + z.rect.maxX) / 2),
  // labels sit near the top (north) edge of each room, clear of the heat in its middle
  cz: r2(Math.min(z.rect.minZ + 1.4, (z.rect.minZ + z.rect.maxZ) / 2)),
}))

const bounds: PlanBounds = WALLS.reduce<PlanBounds>(
  (b, w) => ({ minX: Math.min(b.minX, w.min[0]), maxX: Math.max(b.maxX, w.max[0]), minZ: Math.min(b.minZ, w.min[2]), maxZ: Math.max(b.maxZ, w.max[2]) }),
  { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity },
)

export const FLOOR_PLAN: { bounds: PlanBounds; walls: PlanWall[]; zones: PlanZone[] } = { bounds, walls, zones }
