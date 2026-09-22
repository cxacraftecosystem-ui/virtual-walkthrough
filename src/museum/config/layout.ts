/**
 * ARCHITECTURAL LAYOUT — derived entirely from MUSEUM constants (GA-101).
 *
 *            N  (-z)
 *   ┌──────────────────────────────┐  z = -18.29  ← Product wall (craft infographics)
 *   │        [ bench ]             │
 *   │   ┌──────────────────────┐   │  ← REVEAL WALL (screen wall)
 *   │   └──────────────────────┘   │
 *   │         ┌──┐ ┌──┐            │  z = -13.72  ← passage exit
 *   │ GALLERY │  │ │  │ GALLERY    │
 *   │   A     │  │ │  │   B        │
 *   │ [bench] │  │P│  │ [bench]    │
 *  ═╡         │  │A│  │         ╞═ │  z = -6.86   ← bay divider returns
 *   │ GALLERY │  │S│  │ GALLERY    │
 *   │   A     │  │S│  │   C        │
 *   │ [bench] │  │ │  │ [bench]    │
 *   └─────────┴──┘ └──┴────────────┘  z = 0
 *             │ RECEPTION │
 *             └───[door]──┘           z = +4.77
 *            S  (+z)
 */

import { KEY, MUSEUM, type Vec3 } from './museum'

export type WallKind = 'exterior' | 'divider' | 'partition' | 'bay-divider' | 'reveal' | 'reception' | 'wing' | 'garden' | 'glazing'

export interface WallBox {
  id: string
  kind: WallKind
  min: Vec3
  max: Vec3
  /** Whether this wall participates in visitor collision. Default true. */
  collide?: boolean
  /** Rendered by a specialised component (e.g. glazed facade) instead of the plaster Wall. */
  render?: false
  /** Add the recessed shadow-gap detail on these faces. */
  castShadow?: boolean
}

const T = MUSEUM.walls.exteriorThickness
const DIV = MUSEUM.walls.dividerThickness
const H = MUSEUM.gallery.ceilingHeight
const RH = MUSEUM.reception.ceilingHeight
const PH = MUSEUM.walls.partitionHeight
const PT = MUSEUM.walls.partitionThickness
const {
  gx,
  gzNorth,
  rx,
  rzSouth,
  passageHalf,
  partitionOuter,
  passageNorthZ,
  bayDividerZ,
} = KEY
const rw = MUSEUM.revealWall

/** Height of exterior shell above ceiling (roof slab). */
export const ROOF_THICKNESS = 0.3

export const WALLS: WallBox[] = [
  // ── Main gallery shell ────────────────────────────────────────────
  { id: 'gallery-west', kind: 'exterior', min: [-gx - T, 0, gzNorth - T], max: [-gx, H, DIV] },
  { id: 'gallery-east', kind: 'exterior', min: [gx, 0, gzNorth - T], max: [gx + T, H, DIV] },
  { id: 'gallery-north', kind: 'exterior', min: [-gx - T, 0, gzNorth - T], max: [gx + T, H, gzNorth] },

  // ── Divider between reception and gallery (passage mouth) ────────
  { id: 'divider-west', kind: 'divider', min: [-gx, 0, 0], max: [-passageHalf, H, DIV] },
  { id: 'divider-east', kind: 'divider', min: [passageHalf, 0, 0], max: [gx, H, DIV] },
  {
    id: 'divider-lintel',
    kind: 'divider',
    min: [-passageHalf, RH, 0],
    max: [passageHalf, H, DIV],
    collide: false,
  },

  // ── Reception shell ───────────────────────────────────────────────
  { id: 'reception-west', kind: 'reception', min: [-rx - T, 0, DIV], max: [-rx, RH, rzSouth + T] },
  { id: 'reception-east', kind: 'reception', min: [rx, 0, DIV], max: [rx + T, RH, rzSouth + T] },
  // ── Central tunnel passage partitions (artwork display walls) ────
  { id: 'passage-west', kind: 'partition', min: [-partitionOuter, 0, passageNorthZ], max: [-passageHalf, PH, 0] },
  { id: 'passage-east', kind: 'partition', min: [passageHalf, 0, passageNorthZ], max: [partitionOuter, PH, 0] },

  // ── Perimeter returns dividing each side into two bays ───────────
  {
    id: 'bay-divider-west',
    kind: 'bay-divider',
    min: [-gx, 0, bayDividerZ - MUSEUM.bayDivider.thickness / 2],
    max: [-gx + MUSEUM.bayDivider.length, PH, bayDividerZ + MUSEUM.bayDivider.thickness / 2],
  },
  {
    id: 'bay-divider-east',
    kind: 'bay-divider',
    min: [gx - MUSEUM.bayDivider.length, 0, bayDividerZ - MUSEUM.bayDivider.thickness / 2],
    max: [gx, PH, bayDividerZ + MUSEUM.bayDivider.thickness / 2],
  },

  // ── REVEAL WALL ───────────────────────────────────────────────────
  {
    id: 'reveal-wall',
    kind: 'reveal',
    min: [rw.offsetX - rw.width / 2, 0, KEY.revealNorthZ],
    max: [rw.offsetX + rw.width / 2, rw.height, KEY.revealSouthZ],
  },

  ...wingWalls(),
]

/* ------------------------------------------------------------------ */
/* v2 expansion wings                                                  */
/* ------------------------------------------------------------------ */

function wingWalls(): WallBox[] {
  const W = MUSEUM.wings
  const a = W.atrium
  const th = W.theatre
  const ws = W.workshop
  const cy = W.courtyard
  const d = W.doors
  const zN = rzSouth // atrium north wall occupies [rzSouth, a.minZ]
  const rd = d.receptionToAtrium.width / 2
  const tz = d.atriumToTheatre
  const wz = d.atriumToWorkshop
  const cx = d.workshopToCourtyard
  return [
    // ── Grand Atrium ──
    { id: 'atrium-north-w', kind: 'wing', min: [a.minX - T, 0, zN], max: [-rd, a.height, a.minZ] },
    { id: 'atrium-north-e', kind: 'wing', min: [rd, 0, zN], max: [a.maxX + T, a.height, a.minZ] },
    { id: 'atrium-north-lintel', kind: 'wing', min: [-rd, d.receptionToAtrium.height, zN], max: [rd, a.height, a.minZ], collide: false },
    // glazed south facade (rendered by GlassFacade); collider only
    { id: 'atrium-facade', kind: 'glazing', min: [a.minX - T, 0, a.maxZ], max: [a.maxX + T, a.height, a.maxZ + T], render: false },
    { id: 'atrium-west-s', kind: 'wing', min: [a.minX - T, 0, zN], max: [a.minX, a.height, tz.z - tz.width / 2] },
    { id: 'atrium-west-n', kind: 'wing', min: [a.minX - T, 0, tz.z + tz.width / 2], max: [a.minX, a.height, a.maxZ + T] },
    { id: 'atrium-west-lintel', kind: 'wing', min: [a.minX - T, tz.height, tz.z - tz.width / 2], max: [a.minX, a.height, tz.z + tz.width / 2], collide: false },
    { id: 'atrium-east-s', kind: 'wing', min: [a.maxX, 0, zN], max: [a.maxX + T, a.height, wz.z - wz.width / 2] },
    { id: 'atrium-east-n', kind: 'wing', min: [a.maxX, 0, wz.z + wz.width / 2], max: [a.maxX + T, a.height, a.maxZ + T] },
    { id: 'atrium-east-lintel', kind: 'wing', min: [a.maxX, wz.height, wz.z - wz.width / 2], max: [a.maxX + T, a.height, wz.z + wz.width / 2], collide: false },

    // ── Immersive Theatre (west wing) ──
    { id: 'theatre-west', kind: 'wing', min: [th.minX - T, 0, zN], max: [th.minX, th.height, th.maxZ + T] },
    { id: 'theatre-north', kind: 'wing', min: [th.minX - T, 0, zN], max: [th.maxX, th.height, th.minZ] },
    { id: 'theatre-south', kind: 'wing', min: [th.minX - T, 0, th.maxZ], max: [th.maxX, th.height, th.maxZ + T] },

    // ── Craft Workshop Hall (east wing) ──
    { id: 'workshop-east', kind: 'wing', min: [ws.maxX, 0, ws.minZ - T], max: [ws.maxX + T, ws.height, ws.maxZ + T] },
    { id: 'workshop-south', kind: 'wing', min: [ws.minX, 0, ws.maxZ], max: [ws.maxX + T, ws.height, ws.maxZ + T] },
    { id: 'workshop-west', kind: 'wing', min: [ws.minX - T, 0, ws.minZ - T], max: [ws.minX, ws.height, zN] },
    { id: 'workshop-north-w', kind: 'wing', min: [ws.minX - T, 0, ws.minZ - T], max: [cx.x - cx.width / 2, ws.height, ws.minZ] },
    { id: 'workshop-north-e', kind: 'wing', min: [cx.x + cx.width / 2, 0, ws.minZ - T], max: [ws.maxX + T, ws.height, ws.minZ] },
    { id: 'workshop-north-lintel', kind: 'wing', min: [cx.x - cx.width / 2, cx.height, ws.minZ - T], max: [cx.x + cx.width / 2, ws.height, ws.minZ], collide: false },

    // ── Dye Garden Courtyard (open air) ──
    { id: 'courtyard-west', kind: 'garden', min: [cy.minX - T, 0, cy.minZ - T], max: [cy.minX, cy.wallHeight, cy.maxZ] },
    { id: 'courtyard-east', kind: 'garden', min: [cy.maxX, 0, cy.minZ - T], max: [cy.maxX + T, cy.wallHeight, cy.maxZ] },
    { id: 'courtyard-north', kind: 'garden', min: [cy.minX - T, 0, cy.minZ - T], max: [cy.maxX + T, cy.wallHeight, cy.minZ] },
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
  | 'passage-west'
  | 'passage-east'
  | 'reveal-south'
  | 'reveal-north'
  | 'product-wall'
  | 'reception-west'
  | 'reception-east'
  | 'atrium-north-west'
  | 'atrium-north-east'
  | 'atrium-west'
  | 'atrium-east'
  | 'theatre-screen'
  | 'theatre-north'
  | 'theatre-south'
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
export const SURFACES: Record<SurfaceId, DisplaySurface> = {
  ...wingSurfaces(),
  'gallery-a-outer': { id: 'gallery-a-outer', label: 'Gallery A — perimeter wall', zone: 'gallery-a', runAxis: 'z', face: -gx, normal: [1, 0], range: [passageNorthZ, 0], height: H },
  'gallery-a-partition': { id: 'gallery-a-partition', label: 'Gallery A — partition', zone: 'gallery-a', runAxis: 'z', face: -PO, normal: [-1, 0], range: [passageNorthZ, 0], height: PH },
  'gallery-b-outer': { id: 'gallery-b-outer', label: 'Gallery B — perimeter wall', zone: 'gallery-b', runAxis: 'z', face: gx, normal: [-1, 0], range: [passageNorthZ, bayDividerZ], height: H },
  'gallery-b-partition': { id: 'gallery-b-partition', label: 'Gallery B — partition', zone: 'gallery-b', runAxis: 'z', face: PO, normal: [1, 0], range: [passageNorthZ, bayDividerZ], height: PH },
  'gallery-c-outer': { id: 'gallery-c-outer', label: 'Gallery C — perimeter wall', zone: 'gallery-c', runAxis: 'z', face: gx, normal: [-1, 0], range: [bayDividerZ, 0], height: H },
  'gallery-c-partition': { id: 'gallery-c-partition', label: 'Gallery C — partition', zone: 'gallery-c', runAxis: 'z', face: PO, normal: [1, 0], range: [bayDividerZ, 0], height: PH },
  'passage-west': { id: 'passage-west', label: 'Passage — west face', zone: 'passage', runAxis: 'z', face: -passageHalf, normal: [1, 0], range: [passageNorthZ, 0], height: PH },
  'passage-east': { id: 'passage-east', label: 'Passage — east face', zone: 'passage', runAxis: 'z', face: passageHalf, normal: [-1, 0], range: [passageNorthZ, 0], height: PH },
  'reveal-south': { id: 'reveal-south', label: 'Reveal wall — arrival face', zone: 'reveal', runAxis: 'x', face: KEY.revealSouthZ, normal: [0, 1], range: [rw.offsetX - rw.width / 2, rw.offsetX + rw.width / 2], height: rw.height },
  'reveal-north': { id: 'reveal-north', label: 'Reveal wall — north face', zone: 'reveal', runAxis: 'x', face: KEY.revealNorthZ, normal: [0, -1], range: [rw.offsetX - rw.width / 2, rw.offsetX + rw.width / 2], height: rw.height },
  'product-wall': { id: 'product-wall', label: 'Product wall (north)', zone: 'reveal', runAxis: 'x', face: gzNorth, normal: [0, 1], range: [-gx, gx], height: H },
  'reception-west': { id: 'reception-west', label: 'Reception — west wall', zone: 'reception', runAxis: 'z', face: -rx, normal: [1, 0], range: [DIV, rzSouth], height: RH },
  'reception-east': { id: 'reception-east', label: 'Reception — east wall', zone: 'reception', runAxis: 'z', face: rx, normal: [-1, 0], range: [DIV, rzSouth], height: RH },
}

function wingSurfaces() {
  const W = MUSEUM.wings
  const a = W.atrium
  const th = W.theatre
  const ws = W.workshop
  const cy = W.courtyard
  const rd = W.doors.receptionToAtrium.width / 2
  const S = (id: SurfaceId, label: string, zone: ZoneId, runAxis: 'x' | 'z', face: number, normal: [number, number], range: [number, number], height: number): DisplaySurface => ({ id, label, zone, runAxis, face, normal, range, height })
  return {
    'atrium-north-west': S('atrium-north-west', 'Atrium — north wall (west)', 'atrium', 'x', a.minZ, [0, 1], [a.minX, -rd], a.height),
    'atrium-north-east': S('atrium-north-east', 'Atrium — north wall (east)', 'atrium', 'x', a.minZ, [0, 1], [rd, a.maxX], a.height),
    'atrium-west': S('atrium-west', 'Atrium — west wall', 'atrium', 'z', a.minX, [1, 0], [a.minZ, a.maxZ], a.height),
    'atrium-east': S('atrium-east', 'Atrium — east wall', 'atrium', 'z', a.maxX, [-1, 0], [a.minZ, a.maxZ], a.height),
    'theatre-screen': S('theatre-screen', 'Theatre — screen wall', 'theatre', 'z', th.minX, [1, 0], [th.minZ, th.maxZ], th.height),
    'theatre-north': S('theatre-north', 'Theatre — north wall', 'theatre', 'x', th.minZ, [0, 1], [th.minX, th.maxX], th.height),
    'theatre-south': S('theatre-south', 'Theatre — south wall', 'theatre', 'x', th.maxZ, [0, -1], [th.minX, th.maxX], th.height),
    'workshop-west': S('workshop-west', 'Workshop — west wall', 'workshop', 'z', ws.minX, [1, 0], [ws.minZ, rzSouth], ws.height),
    'workshop-east': S('workshop-east', 'Workshop — east wall', 'workshop', 'z', ws.maxX, [-1, 0], [ws.minZ, ws.maxZ], ws.height),
    'workshop-south': S('workshop-south', 'Workshop — south wall', 'workshop', 'x', ws.maxZ, [0, -1], [ws.minX, ws.maxX], ws.height),
    'workshop-north': S('workshop-north', 'Workshop — north wall', 'workshop', 'x', ws.minZ, [0, 1], [ws.minX, ws.maxX], ws.height),
    'courtyard-east': S('courtyard-east', 'Courtyard — east wall', 'courtyard', 'z', cy.maxX, [-1, 0], [cy.minZ, cy.maxZ], cy.wallHeight),
    'courtyard-north': S('courtyard-north', 'Courtyard — north wall', 'courtyard', 'x', cy.minZ, [0, 1], [cy.minX, cy.maxX], cy.wallHeight),
    'courtyard-west': S('courtyard-west', 'Courtyard — west wall', 'courtyard', 'z', cy.minX, [1, 0], [cy.minZ, cy.maxZ], cy.wallHeight),
  }
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
/* Zones (minimap, orientation, teleport)                              */
/* ------------------------------------------------------------------ */

export type ZoneId = 'reception' | 'passage' | 'gallery-a' | 'gallery-b' | 'gallery-c' | 'reveal' | 'atrium' | 'theatre' | 'workshop' | 'courtyard'

export interface Zone {
  id: ZoneId
  name: string
  short: string
  rect: { minX: number; maxX: number; minZ: number; maxZ: number }
  /** Where "go to" places the visitor, facing yawDeg (0 = north). */
  spawn: { x: number; z: number; yawDeg: number }
}

export const ZONES: Zone[] = [
  { id: 'atrium', name: 'Grand Atrium', short: 'Atrium', rect: wingRect(MUSEUM.wings.atrium), spawn: { x: 0, z: MUSEUM.visitor.start.z, yawDeg: 0 } },
  { id: 'reception', name: 'Reception', short: 'Reception', rect: { minX: -rx, maxX: rx, minZ: DIV, maxZ: rzSouth }, spawn: { x: 0, z: 3.9, yawDeg: 0 } },
  { id: 'theatre', name: 'Immersive Theatre', short: 'Theatre', rect: wingRect(MUSEUM.wings.theatre), spawn: { x: -11.4, z: 15.0, yawDeg: 270 } },
  { id: 'workshop', name: 'Craft Workshop Hall', short: 'Workshop', rect: wingRect(MUSEUM.wings.workshop), spawn: { x: 11.6, z: 11.0, yawDeg: 20 } },
  { id: 'courtyard', name: 'Dye Garden Courtyard', short: 'Courtyard', rect: wingRect(MUSEUM.wings.courtyard), spawn: { x: MUSEUM.wings.doors.workshopToCourtyard.x, z: -7.4, yawDeg: 0 } },
  { id: 'passage', name: 'Central Passage', short: 'Passage', rect: { minX: -passageHalf, maxX: passageHalf, minZ: passageNorthZ, maxZ: 0 }, spawn: { x: 0, z: -1.2, yawDeg: 0 } },
  { id: 'reveal', name: 'Reveal Court & Product Wall', short: 'Craft Court', rect: { minX: -gx, maxX: gx, minZ: gzNorth, maxZ: passageNorthZ }, spawn: { x: -3.3, z: -14.4, yawDeg: 35 } },
  { id: 'gallery-a', name: 'Gallery Display A', short: 'Gallery A', rect: { minX: -gx, maxX: -PO, minZ: passageNorthZ, maxZ: 0 }, spawn: { x: -2.9, z: -13.2, yawDeg: 180 } },
  { id: 'gallery-b', name: 'Gallery Display B', short: 'Gallery B', rect: { minX: PO, maxX: gx, minZ: passageNorthZ, maxZ: bayDividerZ }, spawn: { x: 2.9, z: -13.2, yawDeg: 180 } },
  { id: 'gallery-c', name: 'Gallery Display C', short: 'Gallery C', rect: { minX: PO, maxX: gx, minZ: bayDividerZ, maxZ: 0 }, spawn: { x: 2.9, z: -7.6, yawDeg: 180 } },
]

function wingRect(w: { minX: number; maxX: number; minZ: number; maxZ: number }) {
  return { minX: w.minX, maxX: w.maxX, minZ: w.minZ, maxZ: w.maxZ }
}

export function zoneAt(x: number, z: number): Zone | undefined {
  return ZONES.find((zn) => x >= zn.rect.minX && x <= zn.rect.maxX && z >= zn.rect.minZ && z <= zn.rect.maxZ)
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

/** Five low-height benches on the key focal axes (GA-101). */
export const BENCHES: BenchPlacement[] = [
  { id: 'bench-a-south', x: -KEY.bayCenterX, z: bayDividerZ / 2, along: 'z' },
  { id: 'bench-a-north', x: -KEY.bayCenterX, z: (bayDividerZ + passageNorthZ) / 2, along: 'z' },
  { id: 'bench-c', x: KEY.bayCenterX, z: bayDividerZ / 2, along: 'z' },
  { id: 'bench-b', x: KEY.bayCenterX, z: (bayDividerZ + passageNorthZ) / 2, along: 'z' },
  { id: 'bench-court', x: 0, z: (KEY.revealNorthZ + gzNorth) / 2, along: 'x' },
]

export const RECEPTION_DESK = {
  /** Desk sits against the east reception wall. */
  x: rx - 0.36,
  z: DIV + MUSEUM.reception.length * 0.58,
  length: 1.7,
  depth: 0.62,
  height: 1.02,
}

/** Visitor-facing sub-bay centres, handy for content placement. */
export const BAY = {
  southZ: bayDividerZ / 2,
  northZ: (bayDividerZ + passageNorthZ) / 2,
  centerX: KEY.bayCenterX,
  trackX: KEY.bayCenterX,
  partitionHeight: PH,
  partitionThickness: PT,
}
