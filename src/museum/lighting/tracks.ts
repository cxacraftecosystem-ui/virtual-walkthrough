/**
 * Track-light layout (PDF: ceiling-mounted linear 3000K LED track system).
 * Rails are derived from the architecture; spot heads snap onto the nearest rail
 * so every accent light has a visible, physically plausible fixture.
 */
import { KEY, MUSEUM, type Vec3 } from '../config/museum'
import { SURFACES, type SurfaceId } from '../config/layout'
import { LIGHTING } from '../config/lighting'

const H = MUSEUM.gallery.ceilingHeight
export const RAIL_Y = H - LIGHTING.track.railDrop
/** Rails spanning the skylight hang from these extra steel beams. */
export const COURT_RAIL_Z = (KEY.revealNorthZ + KEY.gzNorth) / 2
export const REVEAL_RAIL_Z = KEY.passageNorthZ - 0.28

export interface Rail {
  id: string
  from: Vec3
  to: Vec3
}

const bx = KEY.bayCenterX
export const RAILS: Rail[] = [
  { id: 'rail-a', from: [-bx, RAIL_Y, -0.6], to: [-bx, RAIL_Y, KEY.passageNorthZ + 0.3] },
  { id: 'rail-bc', from: [bx, RAIL_Y, -0.6], to: [bx, RAIL_Y, KEY.passageNorthZ + 0.3] },
  { id: 'rail-court', from: [-KEY.gx + 0.5, RAIL_Y, COURT_RAIL_Z], to: [KEY.gx - 0.5, RAIL_Y, COURT_RAIL_Z] },
  { id: 'rail-reveal', from: [-2.4, RAIL_Y, REVEAL_RAIL_Z], to: [2.4, RAIL_Y, REVEAL_RAIL_Z] },
]

/** Extra z positions where steel beams must span the skylight to carry rails. */
export const RAIL_BEAMS_Z = [COURT_RAIL_Z, REVEAL_RAIL_Z]

const HEAD_DROP = 0.1

/**
 * Where to mount the accent light for a point on a display surface.
 * Side bays snap to their central rail, court surfaces to the court rail,
 * the reveal wall's arrival face to the reveal rail, reception uses the low ceiling.
 */
export function mountFor(surface: SurfaceId, at: number): Vec3 {
  const s = SURFACES[surface]
  const y = RAIL_Y - HEAD_DROP
  switch (surface) {
    case 'gallery-a-outer':
    case 'gallery-a-partition':
      return [-bx, y, at]
    case 'gallery-b-outer':
    case 'gallery-b-partition':
    case 'gallery-c-outer':
    case 'gallery-c-partition':
      return [bx, y, at]
    case 'reveal-north':
    case 'product-wall':
      return [at, y, COURT_RAIL_Z]
    case 'reveal-south':
      return [at, y, REVEAL_RAIL_Z]
    default: {
      // Generic: ~30° from vertical off the wall, under whatever ceiling is above.
      const ceiling = s.zone === 'reception' ? MUSEUM.reception.ceilingHeight - 0.08 : y
      const drop = ceiling - MUSEUM.display.artworkCenterHeight
      const d = Math.min(1.6, drop * Math.tan((LIGHTING.track.aimAngleDeg * Math.PI) / 180))
      const [nx, nz] = s.normal
      return s.runAxis === 'z' ? [s.face + nx * d, ceiling, at] : [at, ceiling, s.face + nz * d]
    }
  }
}
