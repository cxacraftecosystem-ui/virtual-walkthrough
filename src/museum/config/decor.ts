/**
 * WALL FINISHES & DECOR — content only (rendering: architecture/WallDecor.tsx).
 *
 * Design intent: museum-grade, sympathetic to Indian craft architecture, never kitsch.
 * The main galleries stay calm and light so the textiles read; the richness is
 * concentrated in specific sections:
 *
 *   Grand Atrium   monumental block-print feature wall (madder + indigo on warm limewash)
 *                  framed around the welcome film and title/monumental textile, sandstone
 *                  dado, carved stone door surrounds, backlit jali screens, painted cornice frieze
 *   Reception      fluted teak panelling with brass inlay lines and a painted frieze
 *   Passage        minimal — a fine incised lozenge band at 3.9–4.2 m only
 *   Galleries A–C  sandstone skirting, slim shadow-gap bronze picture rail, linen-wrapped islands
 *   Craft court    deep madder lime behind the centrepiece (product wall), painted frieze 4.4–5.2 m
 *   Gallery D      deep indigo lime with a tone-on-tone block-print damask, brass picture rail
 *   Workshop       stained ochre limewash, terracotta dado, exposed brick lower courses (east)
 *   Courtyard      sand lime render, ashlar plinth, carved stone string course, jali band
 *   Exterior       sandstone ashlar cladding, plinth, carved frieze under the coping
 *
 * Geometry conventions (all metres, world coordinates):
 *   face   a wall-face PLANE: `axis` is the world axis the plane is perpendicular to,
 *          `plane` its coordinate, `normal` the side it faces (+1 / −1 along `axis`).
 *   run    extent along the wall (world z for x-faces, world x for z-faces).
 *   y      height range above the floor.
 * Layers are clipped automatically to the solid parts of the walls on that plane
 * (door openings stay open) unless `clip: false`.
 *
 * Offsets: finish `field` layers sit 1.5 mm proud (under every hung object's 2–4 mm
 * stand-off) with polygonOffset; `relief` elements (dados, rails, friezes, surrounds) are
 * real slabs `depth` deep and are kept clear of hung content (above 3.3 m / below 1.1 m,
 * or with `reserve` rectangles computed from the content configs).
 */
import type { QualityTier } from './quality'
import type { DecorMaterialKey } from '../materials/decorMaterials'
import { ARTWORKS } from './artworks'
import { INFOGRAPHICS } from './infographics'
import { SURFACES, type SurfaceId, type ZoneId } from './layout'
import { MUSEUM } from './museum'
import { SCENE_OBJECTS } from './objects'
import { VIDEOS } from './videos'

export type Range = [number, number]

export interface DecorFace {
  axis: 'x' | 'z'
  plane: number
  normal: 1 | -1
}

export interface DecorRect {
  run: Range
  y: Range
}

export interface DecorUV {
  /** Band mapping: v spans [y0, y1] → [0, tileHeight] (u scaled equally), for friezes. */
  band?: number
  /** Centre the pattern on the rectangle (symmetric screens). */
  center?: boolean
}

interface Base {
  face: DecorFace
  run: Range
  y: Range
  /** Rectangles on this face to leave untouched. */
  reserve?: DecorRect[]
  /** Clip to the solid wall parts on the plane (default true). */
  clip?: boolean
  /** Cut this element's rectangle out of every other treatment on the same face (surrounds, screens). */
  exclusive?: boolean
  /** Skip below this tier. */
  minTier?: QualityTier
}

/** Flat finish layer (1.5 mm proud by default). */
export interface FieldTreatment extends Base {
  type: 'field'
  material: DecorMaterialKey
  offset?: number
  uv?: DecorUV
}

/** Proud slab: dado, skirting, rail, frieze, cladding course, architrave. */
export interface ReliefTreatment extends Base {
  type: 'relief'
  material: DecorMaterialKey
  /** Material of the slab's top/bottom/end faces (default = material). */
  edgeMaterial?: DecorMaterialKey
  depth: number
  uv?: DecorUV
  /** Split into panels of `width` with `gap` reveals, measured from run[0]. */
  panels?: { width: number; gap: number }
  castShadow?: boolean
}

/** Pierced screen in a carved surround: back (glow / shadow) plane, screen, frame slabs. `run`/`y` = clear opening. */
export interface JaliTreatment extends Base {
  type: 'jali'
  screen: DecorMaterialKey
  back: DecorMaterialKey
  frame: DecorMaterialKey
  frameWidth: number
  frameDepth: number
  screenDepth: number
  /** The carved frame casts shadows (sunlit courtyard). */
  castShadow?: boolean
}

/** Slim frame (e.g. brass fillet) around a rectangle: `run`/`y` = inner edge, drawn outward by `width`. */
export interface FrameTreatment extends Base {
  type: 'frame'
  material: DecorMaterialKey
  width: number
  depth: number
}

/** Wrap a free-standing wall (WALLS id) in a finish on all four sides and the top. */
export interface WrapTreatment {
  type: 'wrap'
  wallId: string
  material: DecorMaterialKey
  y: Range
  offset?: number
  minTier?: QualityTier
}

/**
 * SVG medallion hung on a display surface (curator-movable): a single-colour SVG
 * (fill="currentColor", under /public) rasterised to a crisp alpha-tested relief,
 * recoloured per location, with an optional slow "breathing" backlight halo.
 * Placements that would touch hung content or floor objects against the wall are dropped.
 */
export interface MedallionTreatment {
  type: 'medallion'
  /** Public URL of the SVG. */
  svg: string
  surface: SurfaceId
  at: number
  centerHeight: number
  /** Diameter (m). */
  size: number
  color: string
  metalness?: number
  roughness?: number
  /** Relief strength (normal-map scale, default 1). */
  relief?: number
  /**
   * 'relief' (default): alpha-tested, chased metal / carved look.
   * 'paint': alpha-blended stencil — soft, alias-free edges on light walls at a distance.
   */
  finish?: 'relief' | 'paint'
  /** Distance off the wall face (default 6 mm). */
  offset?: number
  /** Slow backlight: halo colour, peak intensity, period (s). */
  glow?: { color: string; intensity: number; period?: number }
  /**
   * Layered roundel around the mandala (all sizes are fractions of `size`):
   * a painted backing disc, a second smaller mandala rotated into the open centre
   * (optionally turning very slowly), raised brass rings and a domed centre boss.
   */
  ornate?: {
    disc?: { color: string; scale?: number; roughness?: number }
    inner?: { color: string; scale?: number; rotationDeg?: number; metalness?: number; roughness?: number; spinPeriod?: number }
    rings?: { color: string; radii: number[]; tube?: number }
    boss?: { color: string; scale?: number }
  }
  minTier?: QualityTier
}

export type DecorTreatment = FieldTreatment | ReliefTreatment | JaliTreatment | FrameTreatment | WrapTreatment | MedallionTreatment

export interface DecorGroup {
  id: string
  /** Rendered while any of these zones is visible (ZoneGroup). */
  zones: ZoneId[]
  treatments: DecorTreatment[]
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const face = (axis: 'x' | 'z', plane: number, normal: 1 | -1): DecorFace => ({ axis, plane, normal })

/** Face + usable run of a display surface (layout.ts). */
function surf(id: SurfaceId): { face: DecorFace; run: Range } {
  const s = SURFACES[id]
  const f = s.runAxis === 'z' ? face('x', s.face, s.normal[0] as 1 | -1) : face('z', s.face, s.normal[1] as 1 | -1)
  return { face: f, run: [s.range[0], s.range[1]] }
}

/** +1 when run coordinates increase to the viewer's right on this face. */
const rightSign = (f: DecorFace) => (f.axis === 'x' ? -f.normal : f.normal)

/**
 * Rectangles occupied by content hung on a surface (artworks + label, videos, infographics),
 * grown by `margin` — so decor at a real depth never covers or intersects them.
 */
export function contentReserves(id: SurfaceId, margin = 0.2): DecorRect[] {
  const out: DecorRect[] = []
  const sgn = rightSign(surf(id).face)
  const add = (at: number, cy: number, w: number, h: number, labelSide = 0) => {
    const r0 = at - w / 2 - margin
    const r1 = at + w / 2 + margin
    const lab = labelSide > 0 ? 0.62 : 0
    out.push({ run: sgn > 0 ? [r0, r1 + lab] : [r0 - lab, r1], y: [cy - h / 2 - margin, cy + h / 2 + margin] })
  }
  for (const a of ARTWORKS)
    if (a.placement.surface === id) add(a.placement.at, a.placement.centerHeight ?? MUSEUM.display.artworkCenterHeight, a.maxWidth, a.maxHeight, a.label === false ? 0 : 1)
  for (const v of VIDEOS) if (v.placement.surface === id) add(v.placement.at, v.placement.centerHeight, v.width, (v.width * 9) / 16)
  for (const g of INFOGRAPHICS) if (g.placement.surface === id) add(g.placement.at, g.placement.centerHeight ?? MUSEUM.display.artworkCenterHeight, g.width, g.height)
  return out
}

/** Bounding rectangle of several reserves (for framing a composition). */
function bounds(rs: DecorRect[]): DecorRect | null {
  if (!rs.length) return null
  return {
    run: [Math.min(...rs.map((r) => r.run[0])), Math.max(...rs.map((r) => r.run[1]))],
    y: [Math.min(...rs.map((r) => r.y[0])), Math.max(...rs.map((r) => r.y[1]))],
  }
}

/** Door architrave: two jambs + head, `exclusive` so other layers stop at it. */
function doorSurround(f: DecorFace, center: number, width: number, height: number, material: DecorMaterialKey, w: number, d: number, head = w, cast = false): ReliefTreatment[] {
  const a = center - width / 2
  const b = center + width / 2
  const base = { type: 'relief' as const, face: f, material, depth: d, exclusive: true, castShadow: cast }
  return [
    { ...base, run: [a - w, a], y: [0, height] },
    { ...base, run: [b, b + w], y: [0, height] },
    { ...base, run: [a - w, b + w], y: [height, height + head] },
  ]
}

function jali(f: DecorFace, run: Range, y: Range, o: Partial<JaliTreatment> = {}): JaliTreatment {
  return { type: 'jali', face: f, run, y, screen: 'jaliStone', back: 'jaliGlow', frame: 'stoneCladding', frameWidth: 0.16, frameDepth: 0.085, screenDepth: 0.05, exclusive: true, ...o }
}

const overlaps = (a: DecorRect, b: DecorRect) => a.run[0] < b.run[1] && b.run[0] < a.run[1] && a.y[0] < b.y[1] && b.y[0] < a.y[1]

/**
 * Keep only the treatments that stay clear of content hung on `surface` (artworks, films,
 * panels move in their own configs — screens / surrounds simply drop out rather than
 * cover them).
 */
function clearOf(surface: SurfaceId, ts: JaliTreatment[]): JaliTreatment[] {
  const busy = contentReserves(surface, 0.1)
  return ts.filter((t) => {
    const r: DecorRect = { run: [t.run[0] - t.frameWidth, t.run[1] + t.frameWidth], y: [t.y[0] - t.frameWidth, t.y[1] + t.frameWidth] }
    return !busy.some((b) => overlaps(b, r))
  })
}

/** Face of a display surface (for renderers). */
export const surfaceFace = (id: SurfaceId): DecorFace => surf(id).face

/**
 * Medallion placement, kept only if its disc (plus a margin) is clear of hung content on
 * the surface and of floor objects standing within 1 m of the wall that reach its height.
 */
function medallion(m: Omit<MedallionTreatment, 'type'>): MedallionTreatment[] {
  const o = m.ornate
  const extent = Math.max(0.5, (o?.disc?.scale ?? 0) / 2, ...(o?.rings?.radii ?? []))
  const r = m.size * extent + 0.15
  const rect: DecorRect = { run: [m.at - r, m.at + r], y: [m.centerHeight - r, m.centerHeight + r] }
  if (contentReserves(m.surface, 0.05).some((b) => overlaps(b, rect))) return []
  const s = SURFACES[m.surface]
  const blocked = SCENE_OBJECTS.some((o) => {
    if (!o.footprint) return false
    const half = Math.max(o.footprint[0], o.footprint[1]) / 2
    const [ox, oy, oz] = o.position
    const along = s.runAxis === 'z' ? oz : ox
    const across = s.runAxis === 'z' ? ox : oz
    const top = oy + (o.height ?? 1)
    return Math.abs(across - s.face) - half < 1.0 && Math.abs(along - m.at) < r + half && top > rect.y[0] && oy < rect.y[1]
  })
  return blocked ? [] : [{ type: 'medallion', ...m }]
}

const MANDALA = '/decor/mandala.svg'
/** Court roundel: gold lace on an indigo disc, a madder inner mandala turning slowly, brass rings + boss. */
const COURT_ROUNDEL: MedallionTreatment['ornate'] = {
  disc: { color: '#1f2a4f', scale: 1.02, roughness: 0.85 },
  inner: { color: '#b4462d', scale: 0.52, rotationDeg: 7.5, roughness: 0.8, spinPeriod: 180 },
  rings: { color: '#b8914a', radii: [0.515, 0.55], tube: 0.012 },
  boss: { color: '#c9a35a', scale: 0.075 },
}

/** Brass fillet frames around every piece hung on a surface (the atrium's gallery-scale works). */
function frameContent(surface: SurfaceId, f: DecorFace): FrameTreatment[] {
  return contentReserves(surface, 0.2).map((r) => ({ type: 'frame', face: f, run: r.run, y: r.y, material: 'brass', width: 0.045, depth: 0.02 }))
}

/** Painted frieze band with brass fillets above and below. */
function paintedFrieze(f: DecorFace, run: Range, y0: number, y1: number, fillet = 0.02): DecorTreatment[] {
  return [
    { type: 'relief', face: f, run, y: [y0 - fillet, y0], material: 'brass', depth: 0.018 },
    { type: 'relief', face: f, run, y: [y0, y1], material: 'friezePainted', depth: 0.012, uv: { band: 0.8 } },
    { type: 'relief', face: f, run, y: [y1, y1 + fillet], material: 'brass', depth: 0.018 },
  ]
}

/* ------------------------------------------------------------------ */
/* Spaces                                                              */
/* ------------------------------------------------------------------ */

const WG = MUSEUM.wings
const A = WG.atrium
const D = WG.doors
const S = WG.shell
const T = MUSEUM.walls.exteriorThickness

/* ── Grand Atrium ─────────────────────────────────────────────────── */

const AN = face('z', A.minZ, 1)
const AWf = face('x', A.minX, 1)
const AEf = face('x', A.maxX, -1)
const portalHalf = D.receptionToAtrium.width / 2
/** Title vinyl on atrium-north-east (Wings.tsx AtriumTitle: x 5.6, 6.4 × 3.6 m, centre 3.4 m). */
const TITLE_VINYL: DecorRect = { run: [5.6 - 3.2 - 0.2, 5.6 + 3.2 + 0.2], y: [3.4 - 1.8 - 0.2, 3.4 + 1.8 + 0.2] }
const atriumWestPanel = bounds(contentReserves('atrium-north-west'))
const atriumEastPanel = bounds([...contentReserves('atrium-north-east'), TITLE_VINYL])
const ATRIUM_PANELS = [atriumWestPanel, atriumEastPanel].filter((r): r is DecorRect => !!r)
const DADO_TOP = 1.1
const CORNICE: Range = [8.14, 8.86]

function atriumWall(f: DecorFace, run: Range, fieldMat: DecorMaterialKey, reserve: DecorRect[] = []): DecorTreatment[] {
  return [
    { type: 'relief', face: f, run, y: [0, DADO_TOP], material: 'stonePlinth', depth: 0.025 },
    { type: 'relief', face: f, run, y: [DADO_TOP, DADO_TOP + 0.06], material: 'stoneCladding', depth: 0.045 },
    { type: 'field', face: f, run, y: [DADO_TOP + 0.06, CORNICE[0] - 0.04], material: fieldMat, reserve },
    { type: 'relief', face: f, run, y: [CORNICE[0] - 0.04, CORNICE[0]], material: 'stoneCladding', depth: 0.03 },
    { type: 'relief', face: f, run, y: CORNICE, material: 'friezePainted', depth: 0.012, uv: { band: 0.8 } },
    { type: 'relief', face: f, run, y: [CORNICE[1], CORNICE[1] + 0.03], material: 'stoneCladding', depth: 0.025 },
  ]
}

const atrium: DecorTreatment[] = [
  // north: the monumental block-print wall, framed around the film and the title / textile
  ...atriumWall(AN, [A.minX, A.maxX], 'blockPrint', ATRIUM_PANELS),
  ...ATRIUM_PANELS.map<FrameTreatment>((r) => ({ type: 'frame', face: AN, run: r.run, y: r.y, material: 'brass', width: 0.045, depth: 0.02 })),
  ...doorSurround(AN, 0, D.receptionToAtrium.width, D.receptionToAtrium.height, 'stoneCladding', 0.32, 0.075, 0.36),
  jali(AN, [-portalHalf + 0.25, portalHalf - 0.25], [4.1, 7.5]),
  // west / east: warm limewash, stone surrounds to the theatre and workshop doors, jali screens
  // (screens that would clash with hung works drop out automatically)
  ...atriumWall(AWf, [A.minZ, A.maxZ], 'limePlasterWarm', contentReserves('atrium-west')),
  ...frameContent('atrium-west', AWf),
  ...doorSurround(AWf, D.atriumToTheatre.z, D.atriumToTheatre.width, D.atriumToTheatre.height, 'stoneCladding', 0.3, 0.07, 0.34),
  ...clearOf('atrium-west', [
    jali(AWf, [D.atriumToTheatre.z - 0.8, D.atriumToTheatre.z + 0.8], [4.3, 7.5]), // transom screen over the theatre door
    jali(AWf, [10.0, 11.2], [2.0, 6.2]),
    jali(AWf, [13.2, 14.4], [2.0, 6.2]),
  ]),
  ...atriumWall(AEf, [A.minZ, A.maxZ], 'limePlasterWarm', contentReserves('atrium-east')),
  ...frameContent('atrium-east', AEf),
  ...doorSurround(AEf, D.atriumToWorkshop.z, D.atriumToWorkshop.width, D.atriumToWorkshop.height, 'stoneCladding', 0.3, 0.07, 0.34),
  ...clearOf('atrium-east', [
    jali(AEf, [D.atriumToWorkshop.z - 0.8, D.atriumToWorkshop.z + 0.8], [4.7, 7.6]), // transom screen over the workshop door
    jali(AEf, [10.0, 11.2], [2.0, 6.2]),
    jali(AEf, [17.6, 18.8], [2.0, 6.2]),
  ]),
]

/* ── Exterior (the compound's outer faces, seen from the forecourt) ── */

const EXT = 0.045 // relief projection; east & west reliefs run past the corners to close them
const exteriorFaces: { f: DecorFace; run: Range; reliefRun: Range; clip: boolean }[] = [
  { f: face('z', S.maxZ + T, 1), run: [S.minX - T, S.maxX + T], reliefRun: [S.minX - T, S.maxX + T], clip: true },
  { f: face('z', S.minZ - T, -1), run: [S.minX - T, S.maxX + T], reliefRun: [S.minX - T, S.maxX + T], clip: true },
  { f: face('x', S.maxX + T, 1), run: [S.minZ - T, S.maxZ + T], reliefRun: [S.minZ - T - EXT, S.maxZ + T + EXT], clip: false },
  { f: face('x', S.minX - T, -1), run: [S.minZ - T, S.maxZ + T], reliefRun: [S.minZ - T - EXT, S.maxZ + T + EXT], clip: false },
]
const exterior: DecorTreatment[] = exteriorFaces.flatMap(({ f, run, reliefRun: rr, clip }) => [
  { type: 'field', face: f, run, y: [0.6, 8.98], material: 'stoneCladding', clip },
  { type: 'relief', face: f, run: rr, y: [0, 0.6], material: 'stonePlinth', depth: 0.04, clip },
  { type: 'relief', face: f, run: rr, y: [8.98, 9.1], material: 'stoneCladding', depth: 0.07, clip },
  { type: 'relief', face: f, run: rr, y: [9.1, 9.72], material: 'stoneFrieze', edgeMaterial: 'stoneCladding', depth: 0.035, clip, uv: { band: 0.6 } },
  { type: 'relief', face: f, run: rr, y: [9.72, 9.8], material: 'stoneCladding', depth: 0.05, clip },
  { type: 'field', face: f, run, y: [9.8, 10], material: 'stoneCladding', clip },
])

/* ── Reception ─────────────────────────────────────────────────────── */

const RH = MUSEUM.reception.ceilingHeight
const RW = surf('reception-west')
const RE = surf('reception-east')
const RN = face('z', MUSEUM.walls.dividerThickness, 1)
const RSf = face('z', MUSEUM.walls.dividerThickness + MUSEUM.reception.length, -1)
const rx = MUSEUM.reception.width / 2
const RFRIEZE: Range = [3.312, RH - 0.02]
const PANEL_TOP = 3.28

function receptionSide(f: DecorFace, run: Range): DecorTreatment[] {
  return [
    // fluted teak dado with a brass cap (kept below the lowest hung work)
    { type: 'field', face: f, run, y: [0.03, 0.74], material: 'shadowGap' },
    { type: 'relief', face: f, run, y: [0.03, 0.74], material: 'flutedTimber', depth: 0.02, panels: { width: 1.0, gap: 0.01 } },
    { type: 'relief', face: f, run, y: [0, 0.03], material: 'brass', depth: 0.022 },
    { type: 'relief', face: f, run, y: [0.74, 0.755], material: 'brass', depth: 0.026 },
    { type: 'field', face: f, run, y: [0.755, 3.3], material: 'limePlasterWarm' },
    ...paintedFrieze(f, run, RFRIEZE[0], RFRIEZE[1], 0.012).slice(0, 2),
  ]
}

function receptionEnd(f: DecorFace, openingHalf: number, openingTop: number): DecorTreatment[] {
  const run: Range = [-rx, rx]
  return [
    // full-height fluted panelling either side of the opening, brass-framed opening
    { type: 'field', face: f, run, y: [0.03, PANEL_TOP], material: 'shadowGap' },
    { type: 'relief', face: f, run, y: [0.03, PANEL_TOP], material: 'flutedTimber', depth: 0.02, panels: { width: 1.14, gap: 0.01 } },
    { type: 'relief', face: f, run, y: [0, 0.03], material: 'brass', depth: 0.022 },
    { type: 'relief', face: f, run, y: [PANEL_TOP, 3.3], material: 'brass', depth: 0.026 },
    ...doorSurround(f, 0, openingHalf * 2, openingTop, 'brass', 0.06, 0.032, 0.06),
    ...paintedFrieze(f, run, RFRIEZE[0], RFRIEZE[1], 0.012).slice(0, 2),
  ]
}

const reception: DecorTreatment[] = [
  ...receptionSide(RW.face, RW.run),
  ...receptionSide(RE.face, RE.run),
  ...receptionEnd(RN, MUSEUM.passage.clearWidth / 2, PANEL_TOP),
  ...receptionEnd(RSf, portalHalf, D.receptionToAtrium.height),
]

/* ── Passage: minimal ─────────────────────────────────────────────── */

const passage: DecorTreatment[] = (['passage-west', 'passage-east'] as const).map((id) => ({
  type: 'field' as const,
  ...surf(id),
  y: [3.9, 4.2] as Range,
  material: 'incisedBand' as const,
  uv: { band: 0.3 },
}))

/* ── Galleries A / B / C: calm ────────────────────────────────────── */

const RAIL_Y = 3.38
function galleryWall(f: DecorFace, run: Range, rail = true, railY = RAIL_Y, reserve?: DecorRect[]): DecorTreatment[] {
  const out: DecorTreatment[] = [{ type: 'relief', face: f, run, y: [0, 0.12], material: 'stonePlinth', depth: 0.012, reserve }]
  if (rail)
    out.push(
      { type: 'field', face: f, run, y: [railY - 0.022, railY], material: 'shadowGap' },
      { type: 'relief', face: f, run, y: [railY, railY + 0.014], material: 'bronze', depth: 0.012 },
    )
  return out
}
const gx = MUSEUM.gallery.width / 2
const PO = MUSEUM.passage.clearWidth / 2 + MUSEUM.walls.partitionThickness
const pz = -MUSEUM.passage.length
const bz = -MUSEUM.passage.length / 2
const bh = MUSEUM.bayDivider.thickness / 2
const bl = MUSEUM.bayDivider.length
const galleries: DecorTreatment[] = [
  ...galleryWall(face('x', -gx, 1), [pz, 0]),
  ...galleryWall(face('x', -PO, -1), [pz, 0]),
  ...galleryWall(face('x', gx, -1), [pz, 0]),
  ...galleryWall(face('x', PO, 1), [pz, 0]),
  ...galleryWall(face('z', 0, -1), [-gx, -PO]),
  ...galleryWall(face('z', 0, -1), [PO, gx]),
  // bay-divider returns
  ...galleryWall(face('z', bz - bh, -1), [-gx, -gx + bl]),
  ...galleryWall(face('z', bz + bh, 1), [-gx, -gx + bl]),
  ...galleryWall(face('x', -gx + bl, 1), [bz - bh, bz + bh]),
  ...galleryWall(face('z', bz - bh, -1), [gx - bl, gx]),
  ...galleryWall(face('z', bz + bh, 1), [gx - bl, gx]),
  ...galleryWall(face('x', gx - bl, -1), [bz - bh, bz + bh]),
  // linen-wrapped display islands
  ...['a-south', 'a-north', 'b', 'c'].map<WrapTreatment>((k) => ({ type: 'wrap', wallId: `island-${k}`, material: 'linenWrap', y: [0.022, MUSEUM.island.height] })),
]

/* ── Craft court ──────────────────────────────────────────────────── */

const CW = surf('court-west')
const CE = surf('court-east')
const CN = surf('product-wall')
const court: DecorTreatment[] = [
  ...galleryWall(CW.face, CW.run, true, 3.98),
  ...galleryWall(CE.face, CE.run, true, 3.98),
  ...galleryWall(CN.face, CN.run, false),
  // deep madder lime behind the centrepiece
  { type: 'field', ...CN, y: [0.12, 4.36], material: 'madderPlaster' },
  ...[CW, CE, CN].flatMap((s) => paintedFrieze(s.face, s.run, 4.4, 5.2)),
  // a pair of madder mandalas on lime, facing each other across the court's entry
  ...medallion({ svg: MANDALA, surface: 'court-west', at: -20.9, centerHeight: 2.3, size: 2.2, color: '#dcb66c', roughness: 0.7, relief: 0.35, finish: 'paint', ornate: COURT_ROUNDEL }),
  ...medallion({ svg: MANDALA, surface: 'court-east', at: -20.9, centerHeight: 2.3, size: 2.2, color: '#dcb66c', roughness: 0.7, relief: 0.35, finish: 'paint', ornate: COURT_ROUNDEL }),
]

/* ── Gallery D — regional gallery ─────────────────────────────────── */

const GD = WG.galleryD
const DW = face('x', GD.minX, 1)
const DN = face('z', GD.minZ, 1)
const DE = face('x', GD.maxX, -1)
const DS = face('z', GD.maxZ, -1)
/** India map installation on the west wall (objects.ts 'india-map-wall': 8.1 m wide, 5.25 m high, centred on the door axis). */
const MAP: DecorRect = { run: [D.galleryToGalleryD.z - 4.25, D.galleryToGalleryD.z + 4.25], y: [0, 5.45] }
const RAIL_D = 4.3
function galleryDWall(f: DecorFace, run: Range, reserve: DecorRect[] = []): DecorTreatment[] {
  return [
    { type: 'relief', face: f, run, y: [0, 0.16], material: 'walnut', depth: 0.014, reserve },
    { type: 'field', face: f, run, y: [0.16, RAIL_D], material: 'indigoDamask', reserve },
    { type: 'field', face: f, run, y: [RAIL_D, RAIL_D + 0.016], material: 'shadowGap', reserve },
    { type: 'relief', face: f, run, y: [RAIL_D + 0.016, RAIL_D + 0.04], material: 'brass', depth: 0.018, reserve },
    { type: 'field', face: f, run, y: [RAIL_D + 0.04, GD.height], material: 'limePlasterWarm', reserve },
  ]
}
const galleryD: DecorTreatment[] = [
  ...galleryDWall(DW, [GD.minZ, GD.maxZ], [MAP]),
  ...galleryDWall(DN, [GD.minX, GD.maxX]),
  ...galleryDWall(DE, [GD.minZ, GD.maxZ]),
  ...galleryDWall(DS, [GD.minX, GD.maxX]),
  ...doorSurround(DE, D.galleryToGalleryD.z, D.galleryToGalleryD.width, D.galleryToGalleryD.height, 'brass', 0.05, 0.022, 0.05),
  ...doorSurround(DS, D.theatreToGalleryD.x, D.theatreToGalleryD.width, D.theatreToGalleryD.height, 'brass', 0.05, 0.022, 0.05),
  // chased-brass mandala on the indigo, above the two pedestal vessels, softly backlit
  ...medallion({
    svg: MANDALA,
    surface: 'gallery-d-south',
    at: -19.1,
    centerHeight: 2.7,
    size: 2.9,
    color: '#c9a35a',
    metalness: 0.85,
    roughness: 0.34,
    relief: 1.2,
    glow: { color: '#ffc27a', intensity: 0.5, period: 9 },
    ornate: {
      disc: { color: '#5e1f17', scale: 1.02, roughness: 0.75 },
      inner: { color: '#efdfbb', scale: 0.5, rotationDeg: 7.5, roughness: 0.45, spinPeriod: 240 },
      rings: { color: '#c9a35a', radii: [0.515, 0.545], tube: 0.014 },
      boss: { color: '#d4ae62', scale: 0.08 },
    },
  }),
]

/* ── Craft workshop ───────────────────────────────────────────────── */

const WS = WG.workshop
const WW = face('x', WS.minX, 1)
const WE = face('x', WS.maxX, -1)
const WN = face('z', WS.minZ, 1)
const WSo = face('z', WS.maxZ, -1)
function workshopWall(f: DecorFace, run: Range): DecorTreatment[] {
  return [
    { type: 'field', face: f, run, y: [0, 0.95], material: 'terracottaPlaster' },
    { type: 'relief', face: f, run, y: [0.95, 1.0], material: 'timber', depth: 0.03 },
    { type: 'field', face: f, run, y: [1.0, WS.height], material: 'limewashOchre' },
  ]
}
const workshop: DecorTreatment[] = [
  ...workshopWall(WW, [WS.minZ, WS.maxZ]),
  ...workshopWall(WN, [WS.minX, WS.maxX]),
  ...workshopWall(WSo, [WS.minX, WS.maxX]),
  // east: exposed hand-made brick lower courses under a timber beam
  { type: 'relief', face: WE, run: [WS.minZ, WS.maxZ], y: [0, 2.6], material: 'brick', depth: 0.012 },
  { type: 'relief', face: WE, run: [WS.minZ, WS.maxZ], y: [2.6, 2.78], material: 'walnut', depth: 0.05 },
  { type: 'field', face: WE, run: [WS.minZ, WS.maxZ], y: [2.78, WS.height], material: 'limewashOchre' },
  ...doorSurround(WW, D.atriumToWorkshop.z, D.atriumToWorkshop.width, D.atriumToWorkshop.height, 'walnut', 0.18, 0.05, 0.22),
  ...doorSurround(WN, D.workshopToCourtyard.x, D.workshopToCourtyard.width, D.workshopToCourtyard.height, 'walnut', 0.18, 0.05, 0.22),
]

/* ── Dye garden courtyard (open air, 10 m walls) ──────────────────── */

const CY = WG.courtyard
const YE = face('x', CY.maxX, -1)
const YN = face('z', CY.minZ, 1)
const YW = face('x', CY.minX, 1)
const YS = face('z', CY.maxZ, -1)
function courtyardWall(f: DecorFace, run: Range, top: number): DecorTreatment[] {
  return [
    { type: 'relief', face: f, run, y: [0, 0.9], material: 'stoneCladding', depth: 0.03 },
    { type: 'relief', face: f, run, y: [0.9, 0.97], material: 'stoneCladding', depth: 0.055, castShadow: true },
    { type: 'field', face: f, run, y: [0.97, top - 0.15], material: 'sandRender' },
    { type: 'relief', face: f, run, y: [3.9, 4.2], material: 'stoneFrieze', edgeMaterial: 'stoneCladding', depth: 0.06, uv: { band: 0.6 }, castShadow: true },
    { type: 'relief', face: f, run, y: [top - 0.15, top], material: 'stoneCladding', depth: 0.05, castShadow: true },
  ]
}
const courtyard: DecorTreatment[] = [
  ...courtyardWall(YE, [CY.minZ, CY.maxZ], CY.wallHeight),
  ...courtyardWall(YN, [CY.minX, CY.maxX], CY.wallHeight),
  ...courtyardWall(YW, [CY.minZ, CY.maxZ], MUSEUM.gallery.ceilingHeight),
  ...courtyardWall(YS, [CY.minX, CY.maxX], WS.height),
  // pierced jali band near the top of the two 10 m perimeter walls
  jali(YE, [CY.minZ + 0.5, CY.maxZ - 0.5], [8.45, 9.25], { back: 'recessDark', frameWidth: 0.12, frameDepth: 0.07, castShadow: true }),
  jali(YN, [CY.minX + 0.5, CY.maxX - 0.5], [8.45, 9.25], { back: 'recessDark', frameWidth: 0.12, frameDepth: 0.07, castShadow: true }),
  { type: 'relief', face: YE, run: [CY.minZ, CY.maxZ], y: [9.5, 9.6], material: 'stoneCladding', depth: 0.05, castShadow: true },
  { type: 'relief', face: YN, run: [CY.minX, CY.maxX], y: [9.5, 9.6], material: 'stoneCladding', depth: 0.05, castShadow: true },
  ...doorSurround(YW, D.galleryToCourtyard.z, D.galleryToCourtyard.width, D.galleryToCourtyard.height, 'stoneCladding', 0.25, 0.06, 0.3, true),
  ...doorSurround(YS, D.workshopToCourtyard.x, D.workshopToCourtyard.width, D.workshopToCourtyard.height, 'stoneCladding', 0.25, 0.06, 0.3, true),
]

/* ------------------------------------------------------------------ */

/** Surfaces (layout.ts) lying on a decor face. */
function surfacesOn(f: DecorFace): SurfaceId[] {
  return (Object.keys(SURFACES) as SurfaceId[]).filter((id) => {
    const sf = surf(id).face
    return sf.axis === f.axis && sf.normal === f.normal && Math.abs(sf.plane - f.plane) < 1e-4
  })
}

/**
 * Safety net: every proud element (relief, frame, jali) is cut around whatever content is
 * currently hung on its wall, so moving an artwork / film / panel in its own config can
 * never bury it behind a dado, rail or frieze. (Flat 1.5 mm finish fields sit behind hung
 * content and need no cut.)
 */
function protectContent(ts: DecorTreatment[]): DecorTreatment[] {
  const cache = new Map<string, DecorRect[]>()
  const busy = (f: DecorFace) => {
    const k = `${f.axis}:${f.plane}:${f.normal}`
    let r = cache.get(k)
    if (!r) {
      r = surfacesOn(f).flatMap((id) => contentReserves(id, 0.04))
      cache.set(k, r)
    }
    return r
  }
  return ts.map((t) => {
    if (t.type === 'wrap' || t.type === 'field' || t.type === 'medallion') return t
    const b = busy(t.face)
    return b.length ? { ...t, reserve: [...(t.reserve ?? []), ...b] } : t
  })
}

const group = (id: string, zones: ZoneId[], treatments: DecorTreatment[]): DecorGroup => ({ id, zones, treatments: protectContent(treatments) })

export const DECOR: DecorGroup[] = [
  // the exterior is only seen from the forecourt, whose nearest zone is the atrium
  group('atrium', ['atrium'], [...atrium, ...exterior]),
  group('reception', ['reception'], reception),
  group('passage', ['passage'], passage),
  group('galleries', ['gallery-a', 'gallery-b', 'gallery-c'], galleries),
  group('court', ['reveal'], court),
  group('gallery-d', ['gallery-d'], galleryD),
  group('workshop', ['workshop'], workshop),
  group('courtyard', ['courtyard'], courtyard),
]
