/**
 * ARCHITECTURAL LAYOUT — derived entirely from MUSEUM constants.
 *
 * v3 master plan: one rectangular compound (a perfect cuboid) organised on a 3 × 2 grid.
 * The central spine keeps the GA-101 sequence — Grand Atrium → Reception → central
 * Passage → REVEAL WALL → Galleries A/B/C → Craft Court — scaled up for grandeur.
 *
 *        x: -31 ········· -10 ······· +10 ········· +31
 *   z -33 ┌───────────────┬────────────┬───────────────┐
 *         │               │ CRAFT COURT│               │
 *         │   GALLERY D   │ ┌────────┐ │   DYE GARDEN  │
 *         │               │ └─REVEAL─┘ │   COURTYARD   │
 *         │           ◄door  A │P│ B  door►            │
 *         │               │ [▮]│A│[▮]  │               │  [▮] = display islands
 *   z  -2 ├──────door─────┤  A │S│ C   ├─────door──────┤
 *         │               │ ─RECEPTION─│               │
 *         │   IMMERSIVE   │            │     CRAFT     │
 *         │    THEATRE  ◄door ATRIUM door►  WORKSHOP   │
 *   z 20  └───────────────┴──── ▲ ─────┴───────────────┘
 */

import { KEY, MUSEUM, type Vec3 } from './museum'

export type WallKind = 'exterior' | 'divider' | 'partition' | 'bay-divider' | 'island' | 'reveal' | 'reception' | 'wing' | 'garden' | 'glazing' | 'shell'

export interface WallBox {
  id: string
  kind: WallKind
  min: Vec3
  max: Vec3
  /** Whether this wall participates in visitor collision. Default true. */
  collide?: boolean
  /** Rendered by a specialised component (e.g. glazed facade) instead of the plaster Wall. */
  render?: false
  /** Culling: zones from which this element can be seen (omit = always rendered). */
  zones?: ZoneId[]
}

const T = MUSEUM.walls.exteriorThickness
const DIV = MUSEUM.walls.dividerThickness
const H = MUSEUM.gallery.ceilingHeight
const RH = MUSEUM.reception.ceilingHeight
const PH = MUSEUM.walls.partitionHeight
const PT = MUSEUM.walls.partitionThickness
const { gx, gzNorth, rx, rzSouth, passageHalf, partitionOuter, passageNorthZ, bayDividerZ } = KEY
const rw = MUSEUM.revealWall
const IS = MUSEUM.island
const W = MUSEUM.wings
const D = W.doors

/** Height of exterior shell above ceiling (roof slab). */
export const ROOF_THICKNESS = 0.3

/** Split a wall running along z at a doorway (centre z, width, height) into 3 boxes. */
function wallZWithDoor(id: string, kind: WallKind, x0: number, x1: number, z0: number, z1: number, h: number, door?: { z: number; width: number; height: number }): WallBox[] {
  if (!door) return [{ id, kind, min: [x0, 0, z0], max: [x1, h, z1] }]
  const a = door.z - door.width / 2
  const b = door.z + door.width / 2
  return [
    { id: `${id}-s`, kind, min: [x0, 0, b], max: [x1, h, z1] },
    { id: `${id}-n`, kind, min: [x0, 0, z0], max: [x1, h, a] },
    { id: `${id}-lintel`, kind, min: [x0, door.height, a], max: [x1, h, b], collide: false },
  ]
}

/** Split a wall running along x at a doorway (centre x, width, height). */
function wallXWithDoor(id: string, kind: WallKind, x0: number, x1: number, z0: number, z1: number, h: number, door?: { x: number; width: number; height: number }): WallBox[] {
  if (!door) return [{ id, kind, min: [x0, 0, z0], max: [x1, h, z1] }]
  const a = door.x - door.width / 2
  const b = door.x + door.width / 2
  return [
    { id: `${id}-w`, kind, min: [x0, 0, z0], max: [a, h, z1] },
    { id: `${id}-e`, kind, min: [b, 0, z0], max: [x1, h, z1] },
    { id: `${id}-lintel`, kind, min: [a, door.height, z0], max: [b, h, z1], collide: false },
  ]
}

/** Island (free-standing display wall) centres: [x, z] for bays A-south, A-north, B, C. */
export const ISLANDS = {
  'a-south': { x: -KEY.bayCenterX, z: bayDividerZ / 2 },
  'a-north': { x: -KEY.bayCenterX, z: (bayDividerZ + passageNorthZ) / 2 },
  b: { x: KEY.bayCenterX, z: (bayDividerZ + passageNorthZ) / 2 },
  c: { x: KEY.bayCenterX, z: bayDividerZ / 2 },
} as const

export const WALLS: WallBox[] = [
  // ── Main gallery shell (doors to Gallery D and the Courtyard in the north bays) ──
  ...wallZWithDoor('gallery-west', 'exterior', -gx - T, -gx, gzNorth - T, DIV, H, D.galleryToGalleryD),
  ...wallZWithDoor('gallery-east', 'exterior', gx, gx + T, gzNorth - T, DIV, H, D.galleryToCourtyard),
  { id: 'gallery-north', kind: 'exterior', min: [-gx - T, 0, gzNorth - T], max: [gx + T, H, gzNorth] },

  // ── Divider between reception and gallery (passage mouth) ────────
  { id: 'divider-west', kind: 'divider', min: [-gx, 0, 0], max: [-passageHalf, H, DIV] },
  { id: 'divider-east', kind: 'divider', min: [passageHalf, 0, 0], max: [gx, H, DIV] },
  { id: 'divider-lintel', kind: 'divider', min: [-passageHalf, RH, 0], max: [passageHalf, H, DIV], collide: false },

  // ── Reception shell ───────────────────────────────────────────────
  { id: 'reception-west', kind: 'reception', min: [-rx - T, 0, DIV], max: [-rx, RH, rzSouth] },
  { id: 'reception-east', kind: 'reception', min: [rx, 0, DIV], max: [rx + T, RH, rzSouth] },

  // ── Central tunnel passage partitions (artwork display walls) ────
  { id: 'passage-west', kind: 'partition', min: [-partitionOuter, 0, passageNorthZ], max: [-passageHalf, PH, 0] },
  { id: 'passage-east', kind: 'partition', min: [passageHalf, 0, passageNorthZ], max: [partitionOuter, PH, 0] },

  // ── Perimeter returns dividing each side into two bays ───────────
  { id: 'bay-divider-west', kind: 'bay-divider', min: [-gx, 0, bayDividerZ - MUSEUM.bayDivider.thickness / 2], max: [-gx + MUSEUM.bayDivider.length, PH, bayDividerZ + MUSEUM.bayDivider.thickness / 2] },
  { id: 'bay-divider-east', kind: 'bay-divider', min: [gx - MUSEUM.bayDivider.length, 0, bayDividerZ - MUSEUM.bayDivider.thickness / 2], max: [gx, PH, bayDividerZ + MUSEUM.bayDivider.thickness / 2] },

  // ── Free-standing double-sided display islands (v3) ──────────────
  ...Object.entries(ISLANDS).map<WallBox>(([k, c]) => ({
    id: `island-${k}`,
    kind: 'island',
    min: [c.x - IS.thickness / 2, 0, c.z - IS.length / 2],
    max: [c.x + IS.thickness / 2, IS.height, c.z + IS.length / 2],
  })),

  // ── REVEAL WALL ───────────────────────────────────────────────────
  { id: 'reveal-wall', kind: 'reveal', min: [rw.offsetX - rw.width / 2, 0, KEY.revealNorthZ], max: [rw.offsetX + rw.width / 2, rw.height, KEY.revealSouthZ] },

  ...wingWalls(),
]

/* ------------------------------------------------------------------ */
/* Wings + perimeter shell                                             */
/* ------------------------------------------------------------------ */

function wingWalls(): WallBox[] {
  const S = W.shell
  const a = W.atrium
  const th = W.theatre
  const ws = W.workshop
  const SH = S.height
  const rd = D.receptionToAtrium.width / 2
  return [
    // ── Perimeter shell: one continuous cuboid envelope, 10 m high ──
    { id: 'shell-west', kind: 'shell', min: [S.minX - T, 0, S.minZ - T], max: [S.minX, SH, S.maxZ + T] },
    { id: 'shell-east', kind: 'shell', min: [S.maxX, 0, S.minZ - T], max: [S.maxX + T, SH, S.maxZ + T] },
    { id: 'shell-north', kind: 'shell', min: [S.minX - T, 0, S.minZ - T], max: [S.maxX + T, SH, S.minZ] },
    { id: 'shell-south-w', kind: 'shell', min: [S.minX - T, 0, S.maxZ], max: [a.minX - T, SH, S.maxZ + T] },
    { id: 'shell-south-e', kind: 'shell', min: [a.maxX + T, 0, S.maxZ], max: [S.maxX + T, SH, S.maxZ + T] },
    // glazed atrium facade (rendered by GlassFacade); collider + solid parapet above it
    { id: 'atrium-facade', kind: 'glazing', min: [a.minX - T, 0, a.maxZ], max: [a.maxX + T, a.height, a.maxZ + T], render: false },
    { id: 'shell-south-parapet', kind: 'shell', min: [a.minX - T, a.height, S.maxZ], max: [a.maxX + T, SH, S.maxZ + T], collide: false },

    // ── Grand Atrium ──
    { id: 'atrium-north-w', kind: 'wing', min: [a.minX - T, 0, rzSouth], max: [-rd, a.height, a.minZ] },
    { id: 'atrium-north-e', kind: 'wing', min: [rd, 0, rzSouth], max: [a.maxX + T, a.height, a.minZ] },
    { id: 'atrium-north-lintel', kind: 'wing', min: [-rd, D.receptionToAtrium.height, rzSouth], max: [rd, a.height, a.minZ], collide: false },
    ...wallZWithDoor('atrium-west', 'wing', a.minX - T, a.minX, a.minZ, a.maxZ, a.height, D.atriumToTheatre),
    ...wallZWithDoor('atrium-east', 'wing', a.maxX, a.maxX + T, a.minZ, a.maxZ, a.height, D.atriumToWorkshop),

    // ── Theatre (west, south row) ── west/south walls are the shell
    { id: 'theatre-east', kind: 'wing', min: [th.maxX, 0, th.minZ - T], max: [th.maxX + T, th.height, rzSouth] },
    ...wallXWithDoor('theatre-north', 'wing', th.minX, th.maxX + T, th.minZ - T, th.minZ, th.height, D.theatreToGalleryD),

    // ── Gallery D (west, north row): west/north = shell, east = gallery west wall, south = theatre north wall

    // ── Craft Workshop (east, south row) ──
    { id: 'workshop-west', kind: 'wing', min: [ws.minX - T, 0, ws.minZ - T], max: [ws.minX, ws.height, rzSouth] },
    ...wallXWithDoor('workshop-north', 'wing', ws.minX - T, ws.maxX, ws.minZ - T, ws.minZ, ws.height, D.workshopToCourtyard),
  ]
}

/* ------------------------------------------------------------------ */
/* Display surfaces — where artworks / panels can be hung             */
/* ------------------------------------------------------------------ */

export type SurfaceId =
  | 'gallery-a-outer'
  | 'gallery-a-partition'
  | 'gallery-b-outer'
  | 'gallery-b-partition'
  | 'gallery-c-outer'
  | 'gallery-c-partition'
  | 'island-a-south-inner'
  | 'island-a-south-outer'
  | 'island-a-north-inner'
  | 'island-a-north-outer'
  | 'island-b-inner'
  | 'island-b-outer'
  | 'island-c-inner'
  | 'island-c-outer'
  | 'passage-west'
  | 'passage-east'
  | 'reveal-south'
  | 'reveal-north'
  | 'product-wall'
  | 'court-west'
  | 'court-east'
  | 'reception-west'
  | 'reception-east'
  | 'atrium-north-west'
  | 'atrium-north-east'
  | 'atrium-west'
  | 'atrium-east'
  | 'theatre-screen'
  | 'theatre-north'
  | 'theatre-south'
  | 'gallery-d-west'
  | 'gallery-d-north'
  | 'gallery-d-east'
  | 'gallery-d-south'
  | 'workshop-west'
  | 'workshop-east'
  | 'workshop-south'
  | 'workshop-north'
  | 'courtyard-east'
  | 'courtyard-north'
  | 'courtyard-west'

export interface DisplaySurface {
  id: SurfaceId
  label: string
  zone: ZoneId
  /** Axis the wall runs along; `at` coordinates in content configs are measured on this axis. */
  runAxis: 'x' | 'z'
  /** Coordinate of the wall face on the other horizontal axis. */
  face: number
  /** Outward face normal in XZ. */
  normal: [number, number]
  /** Usable extent along the run axis [min, max]. */
  range: [number, number]
  height: number
}

const PO = partitionOuter
const S = (id: SurfaceId, label: string, zone: ZoneId, runAxis: 'x' | 'z', face: number, normal: [number, number], range: [number, number], height: number): DisplaySurface => ({ id, label, zone, runAxis, face, normal, range, height })

function islandSurfaces() {
  const out: Partial<Record<SurfaceId, DisplaySurface>> = {}
  const zoneOf: Record<keyof typeof ISLANDS, ZoneId> = { 'a-south': 'gallery-a', 'a-north': 'gallery-a', b: 'gallery-b', c: 'gallery-c' }
  for (const [k, c] of Object.entries(ISLANDS) as [keyof typeof ISLANDS, { x: number; z: number }][]) {
    const sign = Math.sign(c.x) // +1 east bays, -1 west bays
    const range: [number, number] = [c.z - IS.length / 2, c.z + IS.length / 2]
    const inner = `island-${k}-inner` as SurfaceId
    const outer = `island-${k}-outer` as SurfaceId
    out[inner] = S(inner, `Island ${k} — inner face`, zoneOf[k], 'z', c.x - (sign * IS.thickness) / 2, [-sign, 0], range, IS.height)
    out[outer] = S(outer, `Island ${k} — outer face`, zoneOf[k], 'z', c.x + (sign * IS.thickness) / 2, [sign, 0], range, IS.height)
  }
  return out as Record<SurfaceId, DisplaySurface>
}

function wingSurfaces() {
  const a = W.atrium
  const th = W.theatre
  const gd = W.galleryD
  const ws = W.workshop
  const cy = W.courtyard
  const rd = D.receptionToAtrium.width / 2
  return {
    'atrium-north-west': S('atrium-north-west', 'Atrium — north wall (west)', 'atrium', 'x', a.minZ, [0, 1], [a.minX, -rd], a.height),
    'atrium-north-east': S('atrium-north-east', 'Atrium — north wall (east)', 'atrium', 'x', a.minZ, [0, 1], [rd, a.maxX], a.height),
    'atrium-west': S('atrium-west', 'Atrium — west wall', 'atrium', 'z', a.minX, [1, 0], [a.minZ, a.maxZ], a.height),
    'atrium-east': S('atrium-east', 'Atrium — east wall', 'atrium', 'z', a.maxX, [-1, 0], [a.minZ, a.maxZ], a.height),
    'theatre-screen': S('theatre-screen', 'Theatre — screen wall', 'theatre', 'z', th.minX, [1, 0], [th.minZ, th.maxZ], th.height),
    'theatre-north': S('theatre-north', 'Theatre — north wall', 'theatre', 'x', th.minZ, [0, 1], [th.minX, th.maxX], th.height),
    'theatre-south': S('theatre-south', 'Theatre — south wall', 'theatre', 'x', th.maxZ, [0, -1], [th.minX, th.maxX], th.height),
    'gallery-d-west': S('gallery-d-west', 'Gallery D — west wall', 'gallery-d', 'z', gd.minX, [1, 0], [gd.minZ, gd.maxZ], gd.height),
    'gallery-d-north': S('gallery-d-north', 'Gallery D — north wall', 'gallery-d', 'x', gd.minZ, [0, 1], [gd.minX, gd.maxX], gd.height),
    'gallery-d-east': S('gallery-d-east', 'Gallery D — east wall', 'gallery-d', 'z', gd.maxX, [-1, 0], [gd.minZ, gd.maxZ], gd.height),
    'gallery-d-south': S('gallery-d-south', 'Gallery D — south wall', 'gallery-d', 'x', gd.maxZ, [0, -1], [gd.minX, gd.maxX], gd.height),
    'workshop-west': S('workshop-west', 'Workshop — west wall', 'workshop', 'z', ws.minX, [1, 0], [ws.minZ, rzSouth], ws.height),
    'workshop-east': S('workshop-east', 'Workshop — east wall', 'workshop', 'z', ws.maxX, [-1, 0], [ws.minZ, ws.maxZ], ws.height),
    'workshop-south': S('workshop-south', 'Workshop — south wall', 'workshop', 'x', ws.maxZ, [0, -1], [ws.minX, ws.maxX], ws.height),
    'workshop-north': S('workshop-north', 'Workshop — north wall', 'workshop', 'x', ws.minZ, [0, 1], [ws.minX, ws.maxX], ws.height),
    'courtyard-east': S('courtyard-east', 'Courtyard — east wall', 'courtyard', 'z', cy.maxX, [-1, 0], [cy.minZ, cy.maxZ], cy.wallHeight),
    'courtyard-north': S('courtyard-north', 'Courtyard — north wall', 'courtyard', 'x', cy.minZ, [0, 1], [cy.minX, cy.maxX], cy.wallHeight),
    'courtyard-west': S('courtyard-west', 'Courtyard — west wall', 'courtyard', 'z', cy.minX, [1, 0], [cy.minZ, cy.maxZ], cy.wallHeight),
  }
}

export const SURFACES: Record<SurfaceId, DisplaySurface> = {
  ...wingSurfaces(),
  ...islandSurfaces(),
  'gallery-a-outer': S('gallery-a-outer', 'Gallery A — perimeter wall', 'gallery-a', 'z', -gx, [1, 0], [passageNorthZ, 0], H),
  'gallery-a-partition': S('gallery-a-partition', 'Gallery A — partition', 'gallery-a', 'z', -PO, [-1, 0], [passageNorthZ, 0], PH),
  'gallery-b-outer': S('gallery-b-outer', 'Gallery B — perimeter wall', 'gallery-b', 'z', gx, [-1, 0], [passageNorthZ, bayDividerZ], H),
  'gallery-b-partition': S('gallery-b-partition', 'Gallery B — partition', 'gallery-b', 'z', PO, [1, 0], [passageNorthZ, bayDividerZ], PH),
  'gallery-c-outer': S('gallery-c-outer', 'Gallery C — perimeter wall', 'gallery-c', 'z', gx, [-1, 0], [bayDividerZ, 0], H),
  'gallery-c-partition': S('gallery-c-partition', 'Gallery C — partition', 'gallery-c', 'z', PO, [1, 0], [bayDividerZ, 0], PH),
  'passage-west': S('passage-west', 'Passage — west face', 'passage', 'z', -passageHalf, [1, 0], [passageNorthZ, 0], PH),
  'passage-east': S('passage-east', 'Passage — east face', 'passage', 'z', passageHalf, [-1, 0], [passageNorthZ, 0], PH),
  'reveal-south': S('reveal-south', 'Reveal wall — arrival face', 'reveal', 'x', KEY.revealSouthZ, [0, 1], [rw.offsetX - rw.width / 2, rw.offsetX + rw.width / 2], rw.height),
  'reveal-north': S('reveal-north', 'Reveal wall — north face', 'reveal', 'x', KEY.revealNorthZ, [0, -1], [rw.offsetX - rw.width / 2, rw.offsetX + rw.width / 2], rw.height),
  'product-wall': S('product-wall', 'Product wall (north)', 'reveal', 'x', gzNorth, [0, 1], [-gx, gx], H),
  'court-west': S('court-west', 'Craft court — west wall', 'reveal', 'z', -gx, [1, 0], [gzNorth, passageNorthZ], H),
  'court-east': S('court-east', 'Craft court — east wall', 'reveal', 'z', gx, [-1, 0], [gzNorth, passageNorthZ], H),
  'reception-west': S('reception-west', 'Reception — west wall', 'reception', 'z', -rx, [1, 0], [DIV, rzSouth], RH),
  'reception-east': S('reception-east', 'Reception — east wall', 'reception', 'z', rx, [-1, 0], [DIV, rzSouth], RH),
}

/** World transform for a point on a display surface. */
export function surfacePoint(surfaceId: SurfaceId, at: number, y: number, standOff = 0) {
  const s = SURFACES[surfaceId]
  const [nx, nz] = s.normal
  const x = s.runAxis === 'z' ? s.face + nx * standOff : at
  const z = s.runAxis === 'z' ? at : s.face + nz * standOff
  const rotationY = Math.atan2(nx, nz)
  return { position: [x, y, z] as Vec3, rotationY, normal: [nx, 0, nz] as Vec3 }
}

/* ------------------------------------------------------------------ */
/* Zones (minimap, orientation, teleport, culling)                     */
/* ------------------------------------------------------------------ */

export type ZoneId = 'reception' | 'passage' | 'gallery-a' | 'gallery-b' | 'gallery-c' | 'gallery-d' | 'reveal' | 'atrium' | 'theatre' | 'workshop' | 'courtyard'

export interface Zone {
  id: ZoneId
  name: string
  short: string
  rect: { minX: number; maxX: number; minZ: number; maxZ: number }
  /** Where "go to" places the visitor, facing yawDeg (0 = north). */
  spawn: { x: number; z: number; yawDeg: number }
  /** Ceiling / wall height of the space (for lighting mounts). */
  height: number
}

function wingRect(w: { minX: number; maxX: number; minZ: number; maxZ: number }) {
  return { minX: w.minX, maxX: w.maxX, minZ: w.minZ, maxZ: w.maxZ }
}

export const ZONES: Zone[] = [
  { id: 'atrium', name: 'Grand Atrium', short: 'Atrium', rect: wingRect(W.atrium), spawn: { x: 0, z: MUSEUM.visitor.start.z, yawDeg: 0 }, height: W.atrium.height },
  { id: 'reception', name: 'Reception', short: 'Reception', rect: { minX: -rx, maxX: rx, minZ: DIV, maxZ: rzSouth }, spawn: { x: 0, z: rzSouth - 1.4, yawDeg: 0 }, height: RH },
  { id: 'theatre', name: 'Immersive Theatre', short: 'Theatre', rect: wingRect(W.theatre), spawn: { x: W.theatre.maxX - 1.2, z: D.atriumToTheatre.z, yawDeg: 270 }, height: W.theatre.height },
  { id: 'gallery-d', name: 'Gallery D — Regional Gallery', short: 'Gallery D', rect: wingRect(W.galleryD), spawn: { x: W.galleryD.maxX - 1.4, z: D.galleryToGalleryD.z, yawDeg: 270 }, height: W.galleryD.height },
  { id: 'workshop', name: 'Craft Workshop Hall', short: 'Workshop', rect: wingRect(W.workshop), spawn: { x: W.workshop.minX + 1.4, z: D.atriumToWorkshop.z, yawDeg: 30 }, height: W.workshop.height },
  { id: 'courtyard', name: 'Dye Garden Courtyard', short: 'Courtyard', rect: wingRect(W.courtyard), spawn: { x: D.workshopToCourtyard.x, z: W.courtyard.maxZ - 1.2, yawDeg: 0 }, height: W.courtyard.wallHeight },
  { id: 'passage', name: 'Central Passage', short: 'Passage', rect: { minX: -passageHalf, maxX: passageHalf, minZ: passageNorthZ, maxZ: 0 }, spawn: { x: 0, z: -1.4, yawDeg: 0 }, height: H },
  { id: 'reveal', name: 'Craft Court & Reveal Wall', short: 'Craft Court', rect: { minX: -gx, maxX: gx, minZ: gzNorth, maxZ: passageNorthZ }, spawn: { x: -rw.width / 2 - 1.6, z: KEY.revealSouthZ + 0.6, yawDeg: 25 }, height: H },
  { id: 'gallery-a', name: 'Gallery Display A', short: 'Gallery A', rect: { minX: -gx, maxX: -PO, minZ: passageNorthZ, maxZ: 0 }, spawn: { x: -KEY.aisleInnerX, z: passageNorthZ + 0.8, yawDeg: 180 }, height: H },
  { id: 'gallery-b', name: 'Gallery Display B', short: 'Gallery B', rect: { minX: PO, maxX: gx, minZ: passageNorthZ, maxZ: bayDividerZ }, spawn: { x: KEY.aisleInnerX, z: passageNorthZ + 0.8, yawDeg: 180 }, height: H },
  { id: 'gallery-c', name: 'Gallery Display C', short: 'Gallery C', rect: { minX: PO, maxX: gx, minZ: bayDividerZ, maxZ: 0 }, spawn: { x: KEY.aisleInnerX, z: bayDividerZ - 0.2, yawDeg: 180 }, height: H },
]

export function zoneAt(x: number, z: number): Zone | undefined {
  return ZONES.find((zn) => x >= zn.rect.minX && x <= zn.rect.maxX && z >= zn.rect.minZ && z <= zn.rect.maxZ)
}

/**
 * Visibility graph for render culling: which zones can be SEEN from each zone
 * (through open doorways / bay openings). Always includes the zone itself.
 */
export const ZONE_VISIBILITY: Record<ZoneId, ZoneId[]> = {
  atrium: ['atrium', 'reception', 'passage', 'theatre', 'workshop'],
  reception: ['reception', 'atrium', 'passage', 'reveal'],
  passage: ['passage', 'reception', 'reveal', 'atrium'],
  reveal: ['reveal', 'passage', 'gallery-a', 'gallery-b', 'gallery-c'],
  'gallery-a': ['gallery-a', 'reveal', 'gallery-d', 'passage'],
  'gallery-b': ['gallery-b', 'gallery-c', 'reveal', 'courtyard', 'passage'],
  'gallery-c': ['gallery-c', 'gallery-b', 'reveal', 'passage'],
  'gallery-d': ['gallery-d', 'gallery-a', 'theatre'],
  theatre: ['theatre', 'atrium', 'gallery-d'],
  workshop: ['workshop', 'atrium', 'courtyard'],
  courtyard: ['courtyard', 'workshop', 'gallery-b'],
}

/* ------------------------------------------------------------------ */
/* Furniture                                                           */
/* ------------------------------------------------------------------ */

export interface BenchPlacement {
  id: string
  x: number
  z: number
  /** Long axis: 'z' runs along the bay, 'x' across. */
  along: 'x' | 'z'
}

export const BENCH_SIZE = { length: 1.8, depth: 0.42, height: 0.44 }

/** Low benches: two per bay on the island axis (facing the islands), two in the craft court. */
const courtZ = (KEY.revealNorthZ + gzNorth) / 2
export const BENCHES: BenchPlacement[] = [
  ...Object.entries(ISLANDS).flatMap(([k, c]) => [
    { id: `bench-${k}-s`, x: c.x, z: c.z + IS.length / 2 + 1.5, along: 'x' as const },
    { id: `bench-${k}-n`, x: c.x, z: c.z - IS.length / 2 - 1.5, along: 'x' as const },
  ]),
  { id: 'bench-court-w', x: -5.6, z: courtZ, along: 'z' },
  { id: 'bench-court-e', x: 5.6, z: courtZ, along: 'z' },
]

/** Centre of the craft court — reserved for the rotating centrepiece table. */
export const COURT_CENTER = { x: 0, z: courtZ }

export const RECEPTION_DESK = {
  /** Desk sits against the east reception wall. */
  x: rx - 0.5,
  z: DIV + MUSEUM.reception.length * 0.55,
  length: 3.0,
  depth: 0.75,
  height: 1.05,
}

/** Visitor-facing sub-bay centres, handy for content placement. */
export const BAY = {
  southZ: bayDividerZ / 2,
  northZ: (bayDividerZ + passageNorthZ) / 2,
  centerX: KEY.bayCenterX,
  trackX: KEY.bayCenterX,
  aisleInnerX: KEY.aisleInnerX,
  aisleOuterX: KEY.aisleOuterX,
  partitionHeight: PH,
  partitionThickness: PT,
}
