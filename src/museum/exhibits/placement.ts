/** Shared placement math for tables/exhibits — used by both rendering and collision. */
import { DISPLAY_TABLE, type ExhibitConfig } from '../config/exhibits'
import { SURFACES, surfacePoint } from '../config/layout'

export interface Rect2 {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export function tablePlacement(exhibit: ExhibitConfig) {
  const offset = DISPLAY_TABLE.wallGap + DISPLAY_TABLE.depth / 2
  const p = surfacePoint(exhibit.placement.surface, exhibit.placement.at, 0, offset)
  const s = SURFACES[exhibit.placement.surface]
  const halfRun = DISPLAY_TABLE.length / 2
  const halfOut = DISPLAY_TABLE.depth / 2
  const [x, , z] = p.position
  const rect: Rect2 =
    s.runAxis === 'z'
      ? { minX: x - halfOut, maxX: x + halfOut, minZ: z - halfRun, maxZ: z + halfRun }
      : { minX: x - halfRun, maxX: x + halfRun, minZ: z - halfOut, maxZ: z + halfOut }
  return { position: p.position, rotationY: p.rotationY, rect }
}
