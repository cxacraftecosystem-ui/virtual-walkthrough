/**
 * Track-light layout (PDF: ceiling-mounted linear 3000K LED track system).
 * Rails are derived from the architecture; spot heads snap onto the nearest rail
 * so every accent light has a visible, physically plausible fixture.
 *
 * v3: each 8 m gallery bay has TWO rails — one over each aisle either side of its
 * display island — so perimeter walls, partitions and both island faces are lit at
 * the museum-standard ~30° from vertical.
 */
import { KEY, MUSEUM, type Vec3 } from '../config/museum'
import { SURFACES, ZONES, type SurfaceId } from '../config/layout'
import { LIGHTING } from '../config/lighting'

const H = MUSEUM.gallery.ceilingHeight
export const RAIL_Y = H - LIGHTING.track.railDrop
/** Rails spanning the skylight hang from these extra steel beams. */
export const COURT_RAIL_Z = (KEY.revealNorthZ + KEY.gzNorth) / 2
export const REVEAL_RAIL_Z = KEY.passageNorthZ - 0.9
/** Second court rail close to the product wall. */
export const PRODUCT_RAIL_Z = KEY.gzNorth + 2.4

export interface Rail {
  id: string
  from: Vec3
  to: Vec3
}

const xi = KEY.aisleInnerX
const xo = KEY.aisleOuterX
const z0 = -0.8
const z1 = KEY.passageNorthZ + 0.4
const gxr = KEY.gx - 0.6

export const RAILS: Rail[] = [
  { id: 'rail-a-inner', from: [-xi, RAIL_Y, z0], to: [-xi, RAIL_Y, z1] },
  { id: 'rail-a-outer', from: [-xo, RAIL_Y, z0], to: [-xo, RAIL_Y, z1] },
  { id: 'rail-bc-inner', from: [xi, RAIL_Y, z0], to: [xi, RAIL_Y, z1] },
  { id: 'rail-bc-outer', from: [xo, RAIL_Y, z0], to: [xo, RAIL_Y, z1] },
  { id: 'rail-court', from: [-gxr, RAIL_Y, COURT_RAIL_Z], to: [gxr, RAIL_Y, COURT_RAIL_Z] },
  { id: 'rail-product', from: [-gxr, RAIL_Y, PRODUCT_RAIL_Z], to: [gxr, RAIL_Y, PRODUCT_RAIL_Z] },
  { id: 'rail-reveal', from: [-MUSEUM.revealWall.width / 2 - 0.4, RAIL_Y, REVEAL_RAIL_Z], to: [MUSEUM.revealWall.width / 2 + 0.4, RAIL_Y, REVEAL_RAIL_Z] },
  // court side walls
  { id: 'rail-court-west', from: [-gxr + 1.6, RAIL_Y, KEY.passageNorthZ - 1.2], to: [-gxr + 1.6, RAIL_Y, KEY.gzNorth + 1.2] },
  { id: 'rail-court-east', from: [gxr - 1.6, RAIL_Y, KEY.passageNorthZ - 1.2], to: [gxr - 1.6, RAIL_Y, KEY.gzNorth + 1.2] },
]

/** Extra z positions where steel beams must span the skylight to carry rails. */
export const RAIL_BEAMS_Z = [COURT_RAIL_Z, REVEAL_RAIL_Z, PRODUCT_RAIL_Z]

const HEAD_DROP = 0.1
const AIM = (LIGHTING.track.aimAngleDeg * Math.PI) / 180

function snap(v: number, options: number[]) {
  let best = options[0]
  for (const o of options) if (Math.abs(o - v) < Math.abs(best - v)) best = o
  return best
}

/**
 * Where to mount the accent light for a point on a display surface.
 * Gallery walls snap to the nearest aisle rail, court surfaces to the court rails,
 * elsewhere a monopoint fixture ~30° off the wall under that space's ceiling.
 */
export function mountFor(surface: SurfaceId, at: number): Vec3 {
  const s = SURFACES[surface]
  const [nx, nz] = s.normal
  const y = RAIL_Y - HEAD_DROP
  const drop = y - MUSEUM.display.artworkCenterHeight
  const ideal = drop * Math.tan(AIM)
  const inMainGallery = ['gallery-a', 'gallery-b', 'gallery-c', 'passage'].includes(s.zone)
  if (inMainGallery && s.runAxis === 'z') {
    const x = snap(s.face + nx * ideal, [-xo, -xi, xi, xo])
    return [x, y, at]
  }
  if (s.zone === 'reveal') {
    if (surface === 'reveal-south') return [at, y, REVEAL_RAIL_Z]
    if (surface === 'court-west' || surface === 'court-east') return [Math.sign(s.face) * (gxr - 1.6), y, at]
    // reveal-north + product wall: nearest of the two transverse court rails
    const z = snap(s.face + nz * ideal, [COURT_RAIL_Z, PRODUCT_RAIL_Z])
    return [at, y, z]
  }
  // Generic monopoint under the zone's ceiling.
  const zone = ZONES.find((zz) => zz.id === s.zone)
  const ceiling = Math.min(zone?.height ?? H, 7) - 0.15
  const d = Math.min(2.4, (ceiling - MUSEUM.display.artworkCenterHeight) * Math.tan(AIM))
  return s.runAxis === 'z' ? [s.face + nx * d, ceiling, at] : [at, ceiling, s.face + nz * d]
}
