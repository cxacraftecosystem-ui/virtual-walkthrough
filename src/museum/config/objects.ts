/**
 * SCENE OBJECTS — craft installations, furniture, props and centrepieces placed around the
 * museum (v3 layout).
 *
 * Each object renders either:
 *   - `model`: a GLB (CC0 library download or a supplied production model), or
 *   - `kind`: a procedural model from src/museum/models/ (always available as fallback).
 * If a GLB is missing or fails to load, the procedural `kind` is shown instead.
 *
 * `footprint` [width x, depth z] (metres, before rotation) is used for collision and
 * is the size the procedural model is built to. Rotation is about +y in degrees.
 * `zone` drives render culling (ZONE_VISIBILITY) — it must be the zone the object stands in.
 */
import { COURT_CENTER, type ZoneId } from './layout'
import type { Vec3 } from './museum'
import { MUSEUM } from './museum'
import type { ContentI18n } from '../i18n/core'
import { AMENITY_OBJECTS } from './amenities'

export type ProceduralModelId =
  | 'printing-table'
  | 'dye-vat'
  | 'drying-line'
  | 'block-shelf'
  | 'pigment-station'
  | 'wash-tank'
  | 'fabric-rolls'
  | 'carving-bench'
  | 'textile-banner'
  | 'plant-bed'
  | 'tree'
  | 'water-channel'
  | 'grand-desk'
  | 'planter'
  | 'speaker'
  | 'theatre-seating'
  | 'garden-bench'
  | 'column'
  /** Small fallbacks for CC0 props (pots / vases / baskets, stools, crates). */
  | 'vessel'
  | 'stool'
  | 'crate'
  /** v3: rotating carved-block centrepiece on a tall round table (models/centrepiece.tsx). */
  | 'centrepiece'
  /** v3: India map wall installation (models/mapWall.tsx). */
  | 'map-wall'
  /** v3: glazed table vitrine with hand blocks, plaster pedestal (models/display.tsx). */
  | 'vitrine'
  | 'pedestal'
  /** "Print it yourself" studio table, Visitors' Wall (models/printStudio.tsx). */
  | 'print-studio'
  | 'visitors-wall'
  /** Volumetric artisan capture: Gaussian splat `model` (.splat) or a glowing stand-in figure (models/artisan.tsx). */
  | 'splat'
  /** Museum shop (models/shop.tsx). */
  | 'shop-shelf'
  | 'shop-table'
  | 'shop-counter'
  | 'stole-rail'
  /** Reading room & library (models/library.tsx). */
  | 'bookcase'
  | 'reading-table'
  | 'lounge-set'
  | 'pattern-lectern'
  | 'drawing-wall'
  | 'resource-board'
  /** Credits / partners wall panel (models/credits.tsx). */
  | 'credits-panel'

/** Every ProceduralModelId once (a missing or extra key fails the type check). Lists for the admin's kind select. */
const KIND_SET: Record<ProceduralModelId, true> = {
  'printing-table': true,
  'dye-vat': true,
  'drying-line': true,
  'block-shelf': true,
  'pigment-station': true,
  'wash-tank': true,
  'fabric-rolls': true,
  'carving-bench': true,
  'textile-banner': true,
  'plant-bed': true,
  tree: true,
  'water-channel': true,
  'grand-desk': true,
  planter: true,
  speaker: true,
  'theatre-seating': true,
  'garden-bench': true,
  column: true,
  vessel: true,
  stool: true,
  crate: true,
  centrepiece: true,
  'map-wall': true,
  vitrine: true,
  pedestal: true,
  'print-studio': true,
  'visitors-wall': true,
  splat: true,
  'shop-shelf': true,
  'shop-table': true,
  'shop-counter': true,
  'stole-rail': true,
  bookcase: true,
  'reading-table': true,
  'lounge-set': true,
  'pattern-lectern': true,
  'drawing-wall': true,
  'resource-board': true,
  'credits-panel': true,
}
export const PROCEDURAL_KINDS: readonly ProceduralModelId[] = Object.keys(KIND_SET) as ProceduralModelId[]

export interface SceneObjectConfig {
  id: string
  title: string
  kind: ProceduralModelId
  /** Optional GLB/glTF path (e.g. '/models/cc0/potted_plant_01/potted_plant_01_1k.gltf'); `kind` is the fallback. */
  model?: string
  /** Uniform GLB scale. Omitted → the GLB is scaled so its height equals `height`. */
  modelScale?: number
  /** Floor point (y = 0) or the surface it stands on (e.g. a desk top). Banners: y is the TOP. */
  position: Vec3
  rotationDeg?: number
  /** [x, z] footprint in metres (collision + procedural sizing). Omit = no collision. */
  footprint?: [number, number]
  /** Height hint (m) for procedural models. */
  height?: number
  /** Free-form props for the procedural model (colours, image, count…). */
  props?: Record<string, string | number | boolean>
  /** Clickable → information panel. */
  interactive?: boolean
  /** Opens in the 3D inspection viewer. */
  inspectable?: boolean
  description?: string
  /** Zone the object stands in ('reveal' = the craft court). */
  zone: ZoneId
  /** Attribution for downloaded CC0 assets. */
  credit?: { author: string; source: string; license: 'CC0' }
  placeholder?: boolean
  /** Alternative text describing the object (guide, screen readers). */
  alt?: string
  /** Optional Hindi / Bengali overrides of the text fields. */
  i18n?: ContentI18n<'title' | 'description' | 'alt'>
  /** "Meet the maker" profile (src/museum/content/artisans.ts), e.g. for shop products. */
  artisanId?: string
  /** Links listed in the info panel (shop "Visit the maker / Buy", library Resources). No href = not shown. */
  links?: { label: string; href?: string; note?: string }[]
}

/**
 * Poly Haven CC0 model: the optimised single-file GLB (meshopt + WebP, scripts/optimize-assets.mjs,
 * verified by scripts/verify-optimized-models.mjs); sources in /models/cc0/<id>/ (download-cc0-models.mjs).
 */
const cc0 = (id: string) => `/models/opt/cc0/${id}.glb`
const PH = (author: string, id: string) => ({ author, source: `https://polyhaven.com/a/${id}`, license: 'CC0' as const })
const A = MUSEUM.wings.atrium
const WS = MUSEUM.wings.workshop
const CY = MUSEUM.wings.courtyard
const TH = MUSEUM.wings.theatre
const GD = MUSEUM.wings.galleryD
const D = MUSEUM.wings.doors
const COURT = COURT_CENTER
const GDX = (GD.minX + GD.maxX) / 2
const ART = (f: string) => `/artworks/${f}.jpg`

const CENTREPIECE_TEXT =
  'A large carved printing block, turning slowly on its table so the relief can be seen from every side: the mirrored central motif, the ring of small motifs and the ruled border band, with a brass-bound face and a turned handle with brass ferrules. The block was modelled for this exhibition.'
const MAP_TEXT =
  'A relief map of India, in the official Government of India depiction.'
const VITRINE_TEXT = 'A table vitrine of printing blocks, each beside a trial impression of its motif. The blocks were modelled for this exhibition.'

/** Theatre seating: two blocks of six either side of a centre aisle, six rows (x), facing the screen (west). */
const THEATRE_ROWS = [0, 1, 2, 3, 4, 5].flatMap((r) =>
  [-1, 1].map<SceneObjectConfig>((side) => ({
    id: `theatre-row-${r + 1}${side < 0 ? 'n' : 's'}`,
    title: 'Theatre seating',
    kind: 'theatre-seating',
    position: [TH.minX + 6.6 + r * 1.2, 0, (TH.minZ + TH.maxZ) / 2 + side * 3.5],
    rotationDeg: -90,
    footprint: [5.4, 0.62],
    props: { seats: 6 },
    zone: 'theatre',
  })),
)

/**
 * Gallery D — pieces from the workshop's team on six mini pedestals (0.4 m square, all TEAM_GRID.pedestalHeight
 * high, under the 0.52 m glass hood, so the piece sits near eye level); models from scripts/import-team-models.mjs
 * (public/models/team/). Placeholder: makers, places, dates and materials are for the curators to add.
 *
 * Layout: a 2 × 3 grid — two columns running north–south (parallel to the long east and west walls),
 * TEAM_GRID.columnGap apart and centred on the room's east–west midline, so the margins to the west and east
 * walls are equal (8.45 m each); three rows TEAM_GRID.rowPitch apart. The two southern rows sit symmetrically
 * either side of the Gallery A door → map wall axis, leaving it a 3.2 m aisle centred on the doorway, and the
 * northern row stands north of the first row of drapes; with the drapes (rows 7.2 m apart, centred on the same
 * axis) every row of pedestals is midway between drapes and aisle. That puts the grid's centre 0.35 m north of
 * the room's centre: margins 11.2 m to the north wall and 11.9 m to the south wall — the room's exact centre
 * would push a row into the doorway's width (or a pedestal under a drape). Chosen by searching every 2 × 3 grid
 * (both orientations, 0.1 m steps) against the real colliders and pathing: ≥ 0.8 m walking room to every
 * collider, the door and theatre-door approaches, the map wall and the wall works' viewing areas kept free,
 * the tour stops' views and the door → block-under-glass sightline open, and a route to the front of every
 * piece (tests/unit/team-pieces.test.ts). Every piece faces east, toward the Gallery A door, so a visitor
 * coming in sees each front; the square bamboo frame stays square to its hood.
 */
export const TEAM_GRID = { centreX: GDX, axisZ: D.galleryToGalleryD.z, columnGap: 3.4, rowPitch: 3.6, pedestalHeight: 1.0, facingDeg: 90 }
/** Pedestal centre of grid cell (column 0 = west, row 0 = north). */
export function teamGridCell(col: number, row: number) {
  const { centreX, axisZ, columnGap, rowPitch } = TEAM_GRID
  return { x: Math.round((centreX + (col - 0.5) * columnGap) * 100) / 100, z: Math.round((axisZ + (row - 1.5) * rowPitch) * 100) / 100 }
}
const TEAM_SHARED =
  'It comes from the workshop’s team. The 3D model carries no colour of its own, so the finish shown here is a stand-in; its maker, materials and story are still to be recorded.'
export const TEAM_PIECES: SceneObjectConfig[] = (
  [
    // grid order: row by row from the north, west then east — wood and bamboo, then the two figures by the aisle
    // slug, piece height, square, title, hi, bn, description, alt
    // square: reads alike from all four sides and nearly fills its hood, so it stays square to the hood
    [
      'wooden-spoon',
      0.28,
      false,
      'Wooden Spoon',
      'लकड़ी का चम्मच',
      'কাঠের চামচ',
      'A wooden spoon, displayed upright, with a deep oval bowl and a handle worked in openwork.',
      'A wooden spoon standing upright, its handle worked into an open pattern.',
    ],
    [
      'bamboo-frame-on-table',
      0.27,
      true,
      'Bamboo Frame on Table',
      'मेज़ पर बाँस का ढाँचा',
      'টেবিলের উপর বাঁশের কাঠামো',
      'An open, box-like bamboo frame on four legs, braced on every side with an octagonal ring of bamboo.',
      'An open bamboo frame on four legs, each side braced with an octagonal bamboo ring.',
    ],
    [
      'bamboo-sentinel',
      0.42,
      false,
      'Bamboo Sentinel',
      'बाँस का प्रहरी',
      'বাঁশের প্রহরী',
      'Two upright bamboo poles rise from a length of bamboo laid on split-bamboo feet; a pierced bamboo cylinder hangs from a short arm near the top.',
      'A bamboo piece: two upright poles on a bamboo base, with a pierced bamboo cylinder hung near the top.',
    ],
    [
      'bamboo-stand',
      0.38,
      false,
      'Bamboo Stand',
      'बाँस का स्टैंड',
      'বাঁশের স্ট্যান্ড',
      'A length of bamboo with a surface in low relief, raised on a central post and slender curved legs.',
      'A bamboo cylinder raised on a central post and slender curved legs.',
    ],
    [
      'ganesha',
      0.32,
      false,
      'Ganesha',
      'गणेश',
      'গণেশ',
      'A figure of Ganesha in relief on an upright panel, above a stepped base.',
      'A relief panel showing Ganesha, the elephant-headed deity, above a stepped base.',
    ],
    [
      'ganesha-statue',
      0.36,
      false,
      'Ganesha Statue',
      'गणेश प्रतिमा',
      'গণেশ মূর্তি',
      'A seated, four-armed figure of Ganesha on a lotus base, framed by a halo behind the head.',
      'A small statue of Ganesha, seated with four arms, on a lotus base with a halo behind.',
    ],
  ] as const
).flatMap<SceneObjectConfig>(([slug, ph, square, title, hi, bn, text, alt], i) => {
  const { x, z } = teamGridCell(i % 2, Math.floor(i / 2))
  const h = TEAM_GRID.pedestalHeight
  const id = `gd-team-${slug}`
  return [
    { id, title: 'Pedestal', kind: 'pedestal', position: [x, 0, z], footprint: [0.4, 0.4], height: h, props: { cover: true }, zone: 'gallery-d' },
    {
      id: `${id}-object`,
      title,
      kind: 'vessel',
      model: `/models/team/${slug}.glb`,
      position: [x, h, z],
      // the piece's front (+z of its model) faces east, toward the Gallery A door; a square piece stays square to its hood
      rotationDeg: square ? Math.round(TEAM_GRID.facingDeg / 90) * 90 : TEAM_GRID.facingDeg,
      // the glass hood's interior: the click target (inside the pedestal's collider)
      footprint: [0.34, 0.34],
      height: ph,
      interactive: true,
      inspectable: true,
      description: `${text} ${TEAM_SHARED}`,
      alt,
      zone: 'gallery-d',
      placeholder: true,
      i18n: { hi: { title: hi }, bn: { title: bn } },
    },
  ]
})

export const SCENE_OBJECTS: SceneObjectConfig[] = [
  // ══ Grand Atrium ═════════════════════════════════════════════════
  // five printed lengths hung high over the centre of the hall (bottom edges ≈ 4.5 m)
  ...(
    [
      [-6.4, 14.8],
      [-4.6, 14.0],
      [0, 14.4],
      [4.6, 14.0],
      [6.4, 14.8],
    ] as const
  ).map<SceneObjectConfig>(([x, z], i) => ({
    id: `banner-${i + 1}`,
    title: 'Suspended Textile Installation',
    kind: 'textile-banner',
    position: [x, A.height - 0.3, z],
    height: 4.2,
    props: { width: 1.3, image: ['/artworks/hero-04.jpg', '/artworks/drape-02.jpg', '/artworks/drape-01.jpg', '/artworks/drape-03.jpg', '/artworks/hero-01.jpg'][i] },
    interactive: i === 2,
    description: 'A suspended installation of printed lengths welcoming visitors.',
    zone: 'atrium',
    placeholder: true,
  })),
  // information desk below the exhibition title on the north-east wall; visitor side faces south
  { id: 'grand-desk', title: 'Information Desk', kind: 'grand-desk', position: [5.8, 0, 11.0], footprint: [3.6, 1.0], height: 1.05, zone: 'atrium' },
  { id: 'desk-lantern', title: 'Brass lantern', kind: 'vessel', model: cc0('brass_diya_lantern'), modelScale: 1, position: [7.15, 1.05, 11.28], rotationDeg: -30, height: 0.38, zone: 'atrium', credit: PH('Bhargav Kubal', 'brass_diya_lantern') },
  { id: 'desk-vase-1', title: 'Ceramic vase', kind: 'vessel', model: cc0('ceramic_vase_03'), modelScale: 1, position: [6.8, 1.05, 11.3], height: 0.41, zone: 'atrium', credit: PH('James Ray Cock', 'ceramic_vase_03') },
  { id: 'desk-vase-2', title: 'Ceramic vase', kind: 'vessel', model: cc0('ceramic_vase_01'), modelScale: 1, position: [4.45, 1.05, 11.28], rotationDeg: 40, height: 0.4, zone: 'atrium', credit: PH('James Ray Cock', 'ceramic_vase_01') },
  { id: 'desk-succulent', title: 'Succulent', kind: 'vessel', model: cc0('potted_plant_04'), modelScale: 1, position: [4.82, 1.05, 11.3], height: 0.27, zone: 'atrium', credit: PH('James Ray Cock', 'potted_plant_04') },
  ...(
    [
      [-8.7, 9.4],
      [8.8, 9.4],
      [-7.4, 19.3],
      [7.4, 19.3],
    ] as const
  ).map<SceneObjectConfig>(([x, z], i) => ({
    id: `atrium-planter-${i + 1}`,
    title: 'Planter',
    kind: 'planter',
    model: cc0('potted_plant_01'),
    position: [x, 0, z],
    rotationDeg: i * 97,
    footprint: [1.0, 1.0],
    height: 1.6,
    zone: 'atrium',
    credit: PH('Rico Cilliers', 'potted_plant_01'),
  })),
  // four full-height timber columns framing the axis from the entrance to the reception door
  ...(
    [
      [-2.6, 12.0],
      [2.6, 12.0],
      [-2.6, 16.4],
      [2.6, 16.4],
    ] as const
  ).map<SceneObjectConfig>(([x, z], i) => ({
    id: `atrium-column-${i + 1}`,
    title: 'Timber column',
    kind: 'column',
    position: [x, 0, z],
    footprint: [0.5, 0.5],
    height: A.height,
    zone: 'atrium',
  })),
  { id: 'atrium-bench-1', title: 'Bench', kind: 'garden-bench', position: [-5.6, 0, 12.4], rotationDeg: 180, footprint: [2.4, 0.5], zone: 'atrium' },
  { id: 'atrium-bench-2', title: 'Bench', kind: 'garden-bench', position: [5.6, 0, 16.8], rotationDeg: 180, footprint: [2.4, 0.5], zone: 'atrium' },

  // ══ Immersive Theatre ════════════════════════════════════════════
  ...THEATRE_ROWS,

  // ══ Craft court — rotating centrepiece under the skylight ════════
  {
    id: 'centrepiece-court',
    title: 'The Master Block',
    kind: 'centrepiece',
    position: [COURT.x, 0, COURT.z],
    footprint: [1.5, 1.5],
    height: 1.1,
    props: { motif: 'rosette', ink: '#8a3b2b', wood: 'teak', spin: 0.15 },
    interactive: true,
    inspectable: true,
    description: CENTREPIECE_TEXT,
    zone: 'reveal',
    placeholder: true,
  },
  ...[-1, 1].map<SceneObjectConfig>((s, i) => ({
    id: `court-vitrine-${i + 1}`,
    title: 'Block Vitrine',
    kind: 'vitrine',
    position: [s * 3.6, 0, COURT.z + 3.45],
    footprint: [1.6, 0.8],
    height: 0.92,
    props: { motifs: i === 0 ? 'rosette,teardrop,diamond' : 'star-lattice,leaf-trail,rosette' },
    interactive: true,
    description: VITRINE_TEXT,
    zone: 'reveal',
    placeholder: true,
  })),

  // ══ Gallery D — regional gallery ═════════════════════════════════
  {
    id: 'india-map-wall',
    title: 'A Map of Making — India',
    kind: 'map-wall',
    position: [GD.minX + 0.075, 0, D.galleryToGalleryD.z],
    rotationDeg: 90,
    footprint: [8.1, 0.14],
    height: 5.25,
    props: {
      width: 8,
      height: 4.6,
      bottom: 0.65,
      title: 'A Map of Making',
      // stand-in pins: arbitrary layout positions (lon,lat), not drawn while the item is `placeholder`.
      pins: '73.6,25.2;78.2,22.6;81.4,19.2;86.4,23.6;76.8,13.4',
    },
    interactive: true,
    description: MAP_TEXT,
    zone: 'gallery-d',
    placeholder: true,
  },
  { id: 'gd-bench-map', title: 'Bench', kind: 'garden-bench', position: [GD.minX + 5.8, 0, D.galleryToGalleryD.z], rotationDeg: 90, footprint: [2.4, 0.5], zone: 'gallery-d' },
  // an avenue of suspended printed drapes from the doorway to the map wall
  ...[-19.8, -12.6].flatMap((z, row) =>
    [-14.4, -17.8, -21.2].map<SceneObjectConfig>((x, i) => ({
      id: `gd-drape-${row + 1}-${i + 1}`,
      title: 'Suspended Drape',
      kind: 'textile-banner',
      position: [x, GD.height - 0.4, z],
      height: 4.4,
      footprint: [1.3, 0.3],
      props: { width: 1.3, image: ART(['drape-01', 'drape-02', 'drape-03'][(i + row) % 3]) },
      interactive: row === 0 && i === 1,
      description: 'An avenue of suspended printed lengths leading to the map wall.',
      zone: 'gallery-d',
      placeholder: true,
    })),
  ),
  {
    id: 'centrepiece-gallery-d',
    title: 'Block under Glass',
    kind: 'centrepiece',
    position: [GDX, 0, -26.4],
    footprint: [1.5, 1.5],
    height: 1.05,
    props: { motif: 'star-lattice', ink: '#2c3f6b', wood: 'rosewood', dome: true, spin: 0.12, light: 0.9 },
    interactive: true,
    inspectable: true,
    description: CENTREPIECE_TEXT,
    zone: 'gallery-d',
    placeholder: true,
  },
  ...[GDX - 4.15, GDX + 2.05].map<SceneObjectConfig>((x, i) => ({
    id: `gd-vitrine-${i + 1}`,
    title: 'Block Vitrine',
    kind: 'vitrine',
    position: [x, 0, -8.2],
    footprint: [1.8, 0.9],
    height: 0.92,
    props: { motifs: i === 0 ? 'teardrop,star-lattice,diamond,rosette' : 'leaf-trail,rosette,teardrop,diamond' },
    interactive: true,
    description: VITRINE_TEXT,
    zone: 'gallery-d',
    placeholder: true,
  })),
  // plaster pedestals with CC0 vessels (the vessel sits on the pedestal top)
  ...(
    [
      ['gd-pedestal-1', -20.3, -4.6, 1.0, 'antique_ceramic_vase_01', 0.44, 'James Ray Cock', 'Antique ceramic vase'],
      ['gd-pedestal-2', -17.9, -4.6, 0.9, 'brass_pot_01', 0.29, 'Rico Cilliers', 'Brass pot'],
      ['gd-pedestal-3', GD.minX + 2.4, -10.2, 1.05, 'ceramic_vase_03', 0.41, 'James Ray Cock', 'Ceramic vase'],
    ] as const
  ).flatMap<SceneObjectConfig>(([id, x, z, h, model, mh, author, title]) => [
    { id, title: 'Pedestal', kind: 'pedestal', position: [x, 0, z], footprint: [0.55, 0.55], height: h, props: { cover: true }, zone: 'gallery-d' },
    { id: `${id}-object`, title, kind: 'vessel', model: cc0(model), modelScale: 1, position: [x, h, z], height: mh, zone: 'gallery-d', credit: PH(author, model) },
  ]),
  ...TEAM_PIECES,

  // ══ Craft Workshop Hall ══════════════════════════════════════════
  // four printing tables either side of the east–west aisle from the atrium door (z ≈ 14.3)
  ...(
    [
      [16.4, 11.0, 'rosette', '#2c3f6b'],
      [24.2, 11.0, 'teardrop', '#9b3326'],
      [16.4, 17.6, 'star-lattice', '#b7862f'],
      [24.2, 17.6, 'diamond', '#2a2522'],
    ] as const
  ).map<SceneObjectConfig>(([x, z, motif, ink], i) => ({
    id: `printing-table-${i + 1}`,
    title: `Printing Table ${['I', 'II', 'III', 'IV'][i]}`,
    kind: 'printing-table',
    position: [x, 0, z],
    footprint: [6.0, 1.3],
    height: 0.86,
    props: { motif, ink, printed: [0.62, 0.4, 0.8, 0.25][i] },
    interactive: true,
    zone: 'workshop',
    placeholder: true,
  })),
  ...(
    [
      ['dye-vat-indigo', 'Dye Vat — Indigo', 24.4, 1.3, 0.95, '#1f2d52'],
      ['dye-vat-madder', 'Dye Vat — Madder', 26.3, 1.1, 0.85, '#7c2419'],
      ['dye-vat-ochre', 'Dye Vat — Ochre', 28.1, 1.1, 0.85, '#a8741f'],
      ['dye-vat-iv', 'Dye Vat IV', 29.8, 1.0, 0.8, '#3a3526'],
    ] as const
  ).map<SceneObjectConfig>(([id, title, x, d, h, liquid]) => ({
    id,
    title,
    kind: 'dye-vat',
    position: [x, 0, WS.minZ + 2.1],
    footprint: [d, d],
    height: h,
    props: { liquid },
    interactive: true,
    inspectable: true,
    zone: 'workshop',
    placeholder: true,
  })),
  ...[4.2, 8.0, 11.8].map<SceneObjectConfig>((z, i) => ({
    id: `block-shelf-${i + 1}`,
    title: `Block Archive ${['I', 'II', 'III'][i]}`,
    kind: 'block-shelf',
    position: [WS.maxX - 0.3, 0, z],
    rotationDeg: -90,
    footprint: [3.2, 0.5],
    height: 2.4,
    interactive: true,
    inspectable: true,
    zone: 'workshop',
    placeholder: true,
  })),
  { id: 'wash-tank', title: 'Wash Tank', kind: 'wash-tank', position: [25.2, 0, 3.6], footprint: [2.6, 1.1], height: 0.8, interactive: true, zone: 'workshop', placeholder: true },
  { id: 'pigment-station', title: 'Pigment Station', kind: 'pigment-station', position: [14.8, 0, WS.minZ + 0.65], footprint: [2.2, 0.8], height: 0.9, interactive: true, inspectable: true, zone: 'workshop', placeholder: true },
  { id: 'workshop-drying-line', title: 'Drying Line', kind: 'drying-line', position: [16.4, 0, 7.0], footprint: [4.6, 0.4], height: 2.6, props: { cloths: 4, images: '/artworks/study-14.jpg,/artworks/drape-03.jpg,/artworks/study-11.jpg,/artworks/study-15.jpg' }, interactive: true, zone: 'workshop', placeholder: true },
  { id: 'workshop-vitrine', title: 'Block Vitrine', kind: 'vitrine', position: [26.0, 0, 7.2], footprint: [1.8, 0.9], height: 0.92, props: { motifs: 'diamond,teardrop,leaf-trail' }, interactive: true, description: VITRINE_TEXT, zone: 'workshop', placeholder: true },
  { id: 'workshop-film-bench', title: 'Bench', kind: 'garden-bench', position: [13.6, 0, 3.0], rotationDeg: 90, footprint: [2.4, 0.5], zone: 'workshop' },
  { id: 'fabric-rolls', title: 'Cloth Rolls', kind: 'fabric-rolls', position: [12.6, 0, 19.2], footprint: [2.0, 0.9], height: 1.4, interactive: true, zone: 'workshop', placeholder: true },
  { id: 'carving-bench', title: 'Block Carving Bench', kind: 'carving-bench', position: [29.2, 0, 16.8], rotationDeg: -90, footprint: [2.0, 0.9], height: 0.85, interactive: true, inspectable: true, zone: 'workshop', placeholder: true },
  { id: 'workshop-stool-1', title: 'Stool', kind: 'stool', model: cc0('wooden_stool_01'), modelScale: 1, position: [28.3, 0, 16.8], rotationDeg: 15, footprint: [0.45, 0.45], height: 0.44, zone: 'workshop', credit: PH('Kuutti Siitonen', 'wooden_stool_01') },
  { id: 'workshop-stool-2', title: 'Stool', kind: 'stool', model: cc0('wooden_stool_01'), modelScale: 1, position: [14.8, 0, -0.3], rotationDeg: -20, footprint: [0.45, 0.45], height: 0.44, zone: 'workshop', credit: PH('Kuutti Siitonen', 'wooden_stool_01') },
  { id: 'workshop-bucket', title: 'Wooden bucket', kind: 'vessel', model: cc0('wooden_bucket_01'), modelScale: 1, position: [27.1, 0, 3.4], rotationDeg: 60, footprint: [0.4, 0.4], height: 0.55, zone: 'workshop', credit: PH('James Ray Cock', 'wooden_bucket_01') },
  { id: 'workshop-crate', title: 'Timber crate', kind: 'crate', model: cc0('wooden_crate_01'), modelScale: 1, position: [14.4, 0, 19.6], rotationDeg: 180, footprint: [0.85, 0.44], height: 0.35, zone: 'workshop', credit: PH('James Ray Cock', 'wooden_crate_01') },
  { id: 'workshop-crate-basket', title: 'Wicker basket', kind: 'vessel', model: cc0('wicker_basket_01'), modelScale: 1, position: [14.25, 0.35, 19.6], rotationDeg: 8, height: 0.12, zone: 'workshop', credit: PH('Kuutti Siitonen', 'wicker_basket_01') },
  { id: 'workshop-brass-pot', title: 'Brass pot', kind: 'vessel', model: cc0('brass_pot_01'), modelScale: 1, position: [30.1, 0, 1.6], footprint: [0.34, 0.34], height: 0.29, zone: 'workshop', credit: PH('Rico Cilliers', 'brass_pot_01') },
  // "Print it yourself": the studio table (opens the studio overlay) in front of the Visitors' Wall (west wall)
  {
    id: 'print-studio',
    title: 'Print It Yourself — Studio Table',
    kind: 'print-studio',
    position: [13.0, 0, 8.5],
    rotationDeg: 90,
    footprint: [2.2, 1.0],
    height: 0.86,
    interactive: true,
    description: 'A printing table for visitors. Choose a block and a dye, press it onto the cloth and hang your print on the Visitors’ Wall. The blocks are designs made for this museum.',
    zone: 'workshop',
  },
  {
    id: 'visitors-wall',
    title: 'The Visitors’ Wall',
    kind: 'visitors-wall',
    position: [WS.minX + 0.02, 0, 8.6],
    rotationDeg: 90,
    footprint: [6.4, 0.08],
    height: 3.6,
    props: { cols: 8, rows: 3, width: 6.2, bottom: 1.0 },
    interactive: true,
    description: 'Prints made by visitors at the studio table, hung after review by the museum team. Make your own at the table in front of the wall.',
    zone: 'workshop',
  },
  // volumetric artisan captures (Gaussian splats) — placeholders until the captures are made
  ...(
    [
      ['artisan-capture-1', 17.2, 18.25 + 0.42, 180],
      ['artisan-capture-2', 23.4, 10.35 - 0.42, 0],
    ] as const
  ).map<SceneObjectConfig>(([id, x, z, r]) => ({
    id,
    title: 'The Printer’s Place',
    kind: 'splat',
    // model: '/models/splats/<capture>.splat',  ← set when a capture exists
    position: [x, 0, z],
    rotationDeg: r,
    footprint: [1.5, 0.7],
    height: 1.45,
    props: { seat: 0.6, tableHeight: 0.86, reach: 0.42 },
    interactive: true,
    description: 'A softly glowing figure, seated at the printing table where the work is done.',
    zone: 'workshop',
    placeholder: true,
  })),

  // ══ Dye Garden Courtyard ═════════════════════════════════════════
  // four drying lines in two pairs either side of the N–S axis from the workshop door (x ≈ 20.6),
  // clear of the E–W route from Gallery B's door (z ≈ −16.2)
  ...(
    [
      [15.8, -10.0, '/artworks/study-02.jpg,/artworks/hero-03.jpg,/artworks/study-03.jpg,/artworks/hero-05.jpg'],
      [25.4, -10.0, '/artworks/hero-01.jpg,/artworks/study-04.jpg,/artworks/hero-02.jpg,/artworks/study-01.jpg'],
      [15.8, -22.4, '/artworks/study-12.jpg,/artworks/drape-01.jpg,/artworks/study-16.jpg,/artworks/study-06.jpg'],
      [25.4, -22.4, '/artworks/study-08.jpg,/artworks/study-13.jpg,/artworks/drape-02.jpg,/artworks/study-10.jpg'],
    ] as const
  ).map<SceneObjectConfig>(([x, z, images], i) => ({
    id: `drying-line-${i + 1}`,
    title: 'Drying Lines',
    kind: 'drying-line',
    position: [x, 0, z],
    footprint: [4.6, 0.4],
    height: 2.6,
    props: { cloths: 4, images },
    interactive: true,
    zone: 'courtyard',
    placeholder: true,
  })),
  ...(
    [
      ['plant-bed-west-s', CY.minX + 0.7, -8.0, 8.0],
      ['plant-bed-west-n', CY.minX + 0.7, -25.4, 9.0],
      ['plant-bed-east-s', CY.maxX - 0.7, -8.0, 8.0],
      ['plant-bed-east-n', CY.maxX - 0.7, -25.4, 9.0],
    ] as const
  ).map<SceneObjectConfig>(([id, x, z, len]) => ({
    id,
    title: 'Dye Plant Bed',
    kind: 'plant-bed',
    position: [x, 0, z],
    rotationDeg: 90,
    footprint: [len, 1.2],
    height: 0.45,
    interactive: true,
    description: 'A planting bed for dye plants.',
    zone: 'courtyard',
    placeholder: true,
  })),
  { id: 'water-channel', title: 'Rinsing Channel', kind: 'water-channel', position: [D.workshopToCourtyard.x, 0, CY.minZ + 0.8], footprint: [10.0, 0.9], height: 0.35, interactive: true, zone: 'courtyard', placeholder: true },
  ...(
    [
      [14.2, -28.8, 6.5],
      [27.0, -28.8, 6.0],
      [14.4, -5.4, 5.5],
      [26.8, -5.4, 5.8],
    ] as const
  ).map<SceneObjectConfig>(([x, z, h], i) => ({ id: `tree-${i + 1}`, title: 'Tree', kind: 'tree', position: [x, 0, z], footprint: [0.6, 0.6], height: h, zone: 'courtyard' })),
  { id: 'garden-bench-1', title: 'Bench', kind: 'garden-bench', position: [17.4, 0, -29.6], rotationDeg: 180, footprint: [2.4, 0.5], zone: 'courtyard' },
  { id: 'garden-bench-2', title: 'Bench', kind: 'garden-bench', position: [23.8, 0, -29.6], rotationDeg: 180, footprint: [2.4, 0.5], zone: 'courtyard' },
  // long printed cloths hung high against the east wall, drying over the beds
  ...[-12.6, -16.2, -19.8].map<SceneObjectConfig>((z, i) => ({
    id: `court-drape-${i + 1}`,
    title: 'Hanging Cloths',
    kind: 'textile-banner',
    position: [CY.maxX - 0.45, 7.4, z],
    rotationDeg: -90,
    height: 5.0,
    props: { width: 1.3, image: ART(['drape-03', 'drape-01', 'drape-02'][i]) },
    interactive: i === 1,
    description: 'Printed lengths hung high against the courtyard wall.',
    zone: 'courtyard',
    placeholder: true,
  })),
  { id: 'garden-planter-1', title: 'Planter', kind: 'planter', model: cc0('potted_plant_02'), position: [12.2, 0, -3.4], footprint: [0.8, 0.8], height: 1.0, zone: 'courtyard', credit: PH('Rico Cilliers', 'potted_plant_02') },
  { id: 'garden-planter-2', title: 'Planter', kind: 'planter', model: cc0('potted_plant_02'), position: [29.0, 0, -3.4], rotationDeg: 140, footprint: [0.8, 0.8], height: 1.0, zone: 'courtyard', credit: PH('Rico Cilliers', 'potted_plant_02') },
  { id: 'garden-basket', title: 'Wicker basket', kind: 'vessel', model: cc0('wicker_basket_02'), modelScale: 1, position: [16.4, 0, -9.2], rotationDeg: 25, footprint: [0.4, 0.32], height: 0.22, zone: 'courtyard', credit: PH('Kuutti Siitonen', 'wicker_basket_02') },
  ...(
    [
      [28.3, -30.5, 0],
      [28.62, -30.31, 70],
      [28.5, -30.79, 150],
    ] as const
  ).map<SceneObjectConfig>(([x, z, r], i) => ({
    id: `garden-clay-pot-${i + 1}`,
    title: 'Clay pot',
    kind: 'vessel',
    model: cc0('planter_pot_clay'),
    modelScale: 1,
    position: [x, 0, z],
    rotationDeg: r,
    // one collider for the group
    footprint: i === 0 ? [0.8, 0.75] : undefined,
    height: 0.22,
    zone: 'courtyard',
    credit: PH('Amal Kumar', 'planter_pot_clay'),
  })),
  { id: 'garden-vase', title: 'Antique ceramic vase', kind: 'vessel', model: cc0('antique_ceramic_vase_01'), modelScale: 1, position: [28.95, 0, -30.65], rotationDeg: 20, footprint: [0.28, 0.28], height: 0.44, zone: 'courtyard', credit: PH('James Ray Cock', 'antique_ceramic_vase_01') },
  { id: 'garden-bucket', title: 'Wooden bucket', kind: 'vessel', model: cc0('wooden_bucket_01'), modelScale: 1, position: [13.4, 0, -31.6], rotationDeg: -35, footprint: [0.4, 0.4], height: 0.55, zone: 'courtyard', credit: PH('James Ray Cock', 'wooden_bucket_01') },

  // ══ Museum Shop, Reading Room & Library, credits wall (config/amenities.ts) ══
  ...AMENITY_OBJECTS,
]

export function getSceneObject(id: string) {
  return SCENE_OBJECTS.find((o) => o.id === id)
}
