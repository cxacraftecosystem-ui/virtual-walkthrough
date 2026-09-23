/**
 * VISITOR AMENITIES & WAYFINDING — content only.
 *
 *   Museum Shop (zone 'shop')              craft boutique: wall shelving, display tables, stole rail,
 *                                          counter, plinths with CC0 vessels (products are PLACEHOLDERS)
 *   Reading Room & Library ('library')      bookcases, long reading table with lamps, lounge chairs,
 *                                          pattern-book lectern, wall of framed block drawings, Resources board
 *   Credits / partners wall (reception)    "Presented by" / "In collaboration with" (generic wording)
 *   Signage                                 door plaques + directional totems (i18n zone names)
 *   Discovery trail                         8 hidden motif medallions ("Find the motifs")
 *
 * Objects here are appended to SCENE_OBJECTS (objects.ts) — they get collision, culling,
 * click → info panel and deep links like every other scene object.
 * This module must only import TYPES from objects.ts (objects.ts imports it).
 */
import type { MotifId } from './exhibits'
import type { ZoneId } from './layout'
import { MUSEUM, type Vec3 } from './museum'
import type { SceneObjectConfig } from './objects'

const RH = MUSEUM.reception.ceilingHeight
const DIV = MUSEUM.walls.dividerThickness
const T = MUSEUM.walls.exteriorThickness
const rx = MUSEUM.reception.width / 2
const D = MUSEUM.wings.doors
const cc0 = (id: string) => `/models/opt/cc0/${id}.glb`
const PH = (author: string, id: string) => ({ author, source: `https://polyhaven.com/a/${id}`, license: 'CC0' as const })

/** Placeholder artisan profile the shop products point to (src/museum/content/artisans.ts). */
const MAKER = 'artisan-placeholder-01'
const MAKER_2 = 'artisan-placeholder-02'

export const PRODUCT_TEXT =
  'Product — to be supplied by the workshop. This display shows where printed pieces made by the artisans will be offered; names, makers, materials and prices will be added once supplied and approved.'

/** "Visit the maker / Buy" — PLACEHOLDER links (no URL yet; the maker profile's own links win when present). */
const PRODUCT_LINKS: NonNullable<SceneObjectConfig['links']> = [
  { label: 'Visit the maker', note: 'Link to be supplied by the workshop' },
  { label: 'Buy', note: 'Link to be supplied by the workshop' },
]

const SHOP = { minX: rx + T, maxX: MUSEUM.gallery.width / 2, minZ: DIV, maxZ: DIV + MUSEUM.reception.length }
const LIB = { minX: -MUSEUM.gallery.width / 2, maxX: -rx - T, minZ: DIV, maxZ: DIV + MUSEUM.reception.length }

const product = (o: Omit<SceneObjectConfig, 'zone' | 'interactive' | 'placeholder' | 'description' | 'links'> & { description?: string }): SceneObjectConfig => ({
  interactive: true,
  placeholder: true,
  description: PRODUCT_TEXT,
  links: PRODUCT_LINKS,
  zone: 'shop',
  ...o,
})

export const AMENITY_OBJECTS: SceneObjectConfig[] = [
  // ══ Museum Shop ══════════════════════════════════════════════════
  // east wall: two runs of timber shelving holding folded printed lengths and cushion stacks
  ...[2.8, 6.0].map<SceneObjectConfig>((z, i) =>
    product({
      id: `shop-shelf-${i + 1}`,
      title: i === 0 ? 'Folded printed lengths' : 'Printed cushion covers & lengths',
      kind: 'shop-shelf',
      position: [SHOP.maxX - 0.225, 0, z],
      rotationDeg: -90,
      footprint: [3.0, 0.45],
      height: 2.5,
      props: { seed: i + 1, cushions: i === 1 },
      artisanId: i === 0 ? MAKER : MAKER_2,
      alt: 'A timber wall shelving unit with folded printed cloths stacked on its shelves.',
    }),
  ),
  // centre: two low display tables either side of the route from the door to the shelves
  ...[3.25, 5.75].map<SceneObjectConfig>((z, i) =>
    product({
      id: `shop-table-${i + 1}`,
      title: i === 0 ? 'Printed table linen' : 'Printed stoles & cushions',
      kind: 'shop-table',
      position: [7.4, 0, z],
      footprint: [1.6, 0.8],
      height: 0.78,
      props: { seed: 10 + i, cushions: i === 1 },
      artisanId: i === 0 ? MAKER_2 : MAKER,
      alt: 'A low timber display table with neat stacks of folded printed textiles.',
    }),
  ),
  product({
    id: 'shop-stole-rail',
    title: 'Printed stoles',
    kind: 'stole-rail',
    position: [7.6, 0, SHOP.maxZ - 0.3],
    rotationDeg: 180,
    footprint: [2.6, 0.45],
    height: 1.75,
    props: { count: 7, seed: 21 },
    artisanId: MAKER,
    alt: 'A brass and timber rail with printed stoles draped over it.',
  }),
  {
    id: 'shop-counter',
    title: 'Shop Counter',
    kind: 'shop-counter',
    position: [6.9, 0, 1.25],
    footprint: [2.2, 0.6],
    height: 1.0,
    interactive: true,
    placeholder: true,
    description:
      'The museum shop counter. Opening hours, the online shop and how purchases support the makers are to be supplied by the workshop. Everything on display here is a placeholder.',
    links: [
      { label: 'Online shop', note: 'Link to be supplied by the workshop' },
      { label: 'Meet the makers', href: '/makers/artisan-placeholder-01' },
    ],
    zone: 'shop',
    alt: 'A timber shop counter with a stone top, a folded cloth and a brass bell on it.',
  },
  // plinths with CC0 vessels (the vessel is a separate object on the plinth top)
  ...(
    [
      ['shop-plinth-1', SHOP.minX + 0.45, SHOP.maxZ - 0.55, 0.95, 'ceramic_vase_01', 0.4, 'James Ray Cock', 'Ceramic vase'],
      ['shop-plinth-2', SHOP.maxX - 0.45, 0.7, 0.85, 'brass_pot_01', 0.29, 'Rico Cilliers', 'Brass pot'],
    ] as const
  ).flatMap<SceneObjectConfig>(([id, x, z, h, model, mh, author, title]) => [
    { id, title: 'Plinth', kind: 'pedestal', position: [x, 0, z], footprint: [0.45, 0.45], height: h, zone: 'shop' },
    { id: `${id}-object`, title, kind: 'vessel', model: cc0(model), modelScale: 1, position: [x, h, z], height: mh, zone: 'shop', credit: PH(author, model) },
  ]),
  { id: 'shop-basket', title: 'Wicker basket', kind: 'vessel', model: cc0('wicker_basket_02'), modelScale: 1, position: [8.0, 0.78, 3.25], rotationDeg: 20, height: 0.22, zone: 'shop', credit: PH('Kuutti Siitonen', 'wicker_basket_02') },

  // ══ Reading Room & Library ═══════════════════════════════════════
  ...[2.35, 5.95].map<SceneObjectConfig>((z, i) => ({
    id: `library-bookcase-${i + 1}`,
    title: 'Library bookcase',
    kind: 'bookcase',
    position: [LIB.minX + 0.2, 0, z],
    rotationDeg: 90,
    footprint: [3.4, 0.4],
    height: 2.9,
    props: { seed: 31 + i },
    zone: 'library',
    alt: 'A tall timber bookcase filled with books of varied sizes and colours.',
  })),
  {
    id: 'library-reading-table',
    title: 'Reading Table',
    kind: 'reading-table',
    position: [-7.45, 0, 4.2],
    rotationDeg: 90,
    footprint: [2.6, 1.7],
    height: 0.76,
    props: { chairs: 3, lamps: 2 },
    zone: 'library',
    alt: 'A long timber reading table with six chairs and two brass reading lamps.',
  },
  {
    id: 'library-lounge',
    title: 'Lounge chairs',
    kind: 'lounge-set',
    position: [-8.0, 0, LIB.maxZ - 0.75],
    rotationDeg: 180,
    footprint: [2.6, 0.9],
    height: 0.85,
    zone: 'library',
    alt: 'Two upholstered lounge chairs either side of a small table with a lamp.',
  },
  {
    id: 'library-pattern-book',
    title: 'The Pattern Book',
    kind: 'pattern-lectern',
    position: [-5.95, 0, 1.35],
    footprint: [0.6, 0.5],
    height: 1.12,
    props: { seed: 41 },
    interactive: true,
    inspectable: true,
    placeholder: true,
    description:
      'An open sample book on a lectern: pages of printed swatches, the way printers keep a record of their designs. PLACEHOLDER — the swatches are generated for layout from the museum’s placeholder motifs; the real sample book will be supplied by the workshop.',
    zone: 'library',
    alt: 'A timber lectern holding an open book whose pages carry small printed cloth swatches.',
  },
  {
    id: 'library-drawings',
    title: 'Printing-Block Drawings',
    kind: 'drawing-wall',
    position: [-7.85, 0, LIB.minZ + 0.03],
    footprint: [3.0, 0.06],
    height: 2.6,
    props: { cols: 3, rows: 2, bottom: 0.95 },
    interactive: true,
    placeholder: true,
    description:
      'A wall of framed design drawings for printing blocks. PLACEHOLDER ART — these sheets are generated from the museum’s placeholder motifs for layout; the drawings will be supplied by the workshop.',
    zone: 'library',
    alt: 'Six framed ink drawings of block-print motifs on squared paper, hung in two rows.',
  },
  {
    id: 'library-resources',
    title: 'Resources',
    kind: 'resource-board',
    position: [LIB.maxX - 0.02, 0, 6.8],
    rotationDeg: -90,
    footprint: [0.97, 0.05],
    height: 2.2,
    props: { width: 0.9 },
    interactive: true,
    description:
      'Further reading and tools for visitors, teachers and researchers. Items marked “to be supplied” are placeholders for future publications from the workshop.',
    links: [
      { label: 'Accessible text guide', href: '/guide', note: 'Every room and item as plain text — printable, screen-reader friendly' },
      { label: 'Capture guide', note: 'How the artisans and blocks are recorded in 3D — to be supplied' },
      { label: 'Future publications', note: 'Catalogues and research papers — to be supplied by the workshop' },
    ],
    zone: 'library',
    alt: 'A framed wall board titled Resources listing the text guide, the capture guide and future publications.',
  },

  // ══ Credits / partners wall — reception south wall, flanking the atrium portal (faces north) ══
  ...(
    [
      ['credits-presented', 2.95, 'Presented by', '/brand/dc-handicrafts.png'],
      ['credits-collaboration', -2.95, 'In collaboration with', '/brand/iit-kharagpur.svg'],
    ] as const
  ).map<SceneObjectConfig>(([id, x, kicker, logo]) => ({
    id,
    title: kicker,
    kind: 'credits-panel',
    position: [x, 0, DIV + MUSEUM.reception.length - 0.021],
    rotationDeg: 180,
    footprint: [2.1, 0.05],
    height: 2.7,
    props: { kicker, logo, width: 2.1, panelHeight: 1.4, center: 1.75 },
    interactive: true,
    placeholder: true,
    description: 'Partner acknowledgement. The wording on this wall is generic placeholder text; the final credits will be confirmed by the partners.',
    zone: 'reception',
    alt: `A pale stone panel with brass fillets reading “${kicker}” above a partner logo.`,
  })),
]

/* ------------------------------------------------------------------ */
/* Wayfinding signage                                                  */
/* ------------------------------------------------------------------ */

export type Compass = 'N' | 'E' | 'S' | 'W' | 'NE' | 'NW' | 'SE' | 'SW'

export interface SignLine {
  /** Destination zone (name from the i18n dictionary: zone.<id>). */
  zone: ZoneId
  /** World direction of the destination; the arrow is drawn relative to the viewer. Omit = no arrow (plaques). */
  dir?: Compass
}

export interface SignConfig {
  id: string
  kind: 'plaque' | 'totem'
  /** Plaques: wall-face point at the plaque centre height. Totems: floor point. */
  position: Vec3
  /** Direction the readable face looks towards (outward normal). */
  facing: Compass
  lines: SignLine[]
  /** Culling: zones from which the sign can be seen. */
  zones: ZoneId[]
}

const PLQ = 1.52
const doorZ = D.receptionToShop.z
export const SIGNS: SignConfig[] = [
  // reception ↔ shop / library (plaques north of each side door, both faces)
  { id: 'plq-rec-shop', kind: 'plaque', position: [rx - 0.004, PLQ, doorZ - 1.4], facing: 'W', lines: [{ zone: 'shop' }], zones: ['reception'] },
  { id: 'plq-rec-library', kind: 'plaque', position: [-rx + 0.004, PLQ, doorZ - 1.4], facing: 'E', lines: [{ zone: 'library' }], zones: ['reception'] },
  { id: 'plq-shop-rec', kind: 'plaque', position: [rx + T + 0.004, PLQ, doorZ - 1.4], facing: 'E', lines: [{ zone: 'reception' }], zones: ['shop'] },
  { id: 'plq-lib-rec', kind: 'plaque', position: [-rx - T - 0.004, PLQ, doorZ + 1.4], facing: 'W', lines: [{ zone: 'reception' }], zones: ['library'] },
  // atrium ↔ theatre
  { id: 'plq-atr-theatre', kind: 'plaque', position: [-10 + 0.004, PLQ, 19.4], facing: 'E', lines: [{ zone: 'theatre' }], zones: ['atrium'] },
  { id: 'plq-theatre-atr', kind: 'plaque', position: [-10.3 - 0.09, PLQ, 19.3], facing: 'W', lines: [{ zone: 'atrium' }], zones: ['theatre'] },
  // atrium ↔ workshop
  { id: 'plq-atr-workshop', kind: 'plaque', position: [10 - 0.004, PLQ, 16.8], facing: 'W', lines: [{ zone: 'workshop' }], zones: ['atrium'] },
  { id: 'plq-workshop-atr', kind: 'plaque', position: [10.3 + 0.004, PLQ, 16.65], facing: 'E', lines: [{ zone: 'atrium' }], zones: ['workshop'] },
  // Gallery A ↔ Gallery D
  { id: 'plq-ga-gd', kind: 'plaque', position: [-10 + 0.004, PLQ, -14.3], facing: 'E', lines: [{ zone: 'gallery-d' }], zones: ['gallery-a'] },
  { id: 'plq-gd-ga', kind: 'plaque', position: [-10.3 - 0.004, PLQ, -14.35], facing: 'W', lines: [{ zone: 'gallery-a' }], zones: ['gallery-d'] },
  // Gallery B ↔ courtyard
  { id: 'plq-gb-court', kind: 'plaque', position: [10 - 0.004, PLQ, -14.3], facing: 'W', lines: [{ zone: 'courtyard' }], zones: ['gallery-b'] },
  { id: 'plq-court-gb', kind: 'plaque', position: [10.3 + 0.004, PLQ, -14.1], facing: 'E', lines: [{ zone: 'gallery-b' }], zones: ['courtyard'] },
  // workshop ↔ courtyard
  { id: 'plq-ws-court', kind: 'plaque', position: [18.15, PLQ, -2 + 0.004], facing: 'S', lines: [{ zone: 'courtyard' }], zones: ['workshop'] },
  { id: 'plq-court-ws', kind: 'plaque', position: [18.1, PLQ, -2.3 - 0.004], facing: 'N', lines: [{ zone: 'workshop' }], zones: ['courtyard'] },
  // theatre ↔ Gallery D
  { id: 'plq-th-gd', kind: 'plaque', position: [-16.1, PLQ, -2 + 0.08], facing: 'S', lines: [{ zone: 'gallery-d' }], zones: ['theatre'] },
  { id: 'plq-gd-th', kind: 'plaque', position: [-16.2, PLQ, -2.3 - 0.004], facing: 'N', lines: [{ zone: 'theatre' }], zones: ['gallery-d'] },

  // directional totems at the key junctions
  {
    id: 'totem-atrium',
    kind: 'totem',
    position: [-4.3, 0, 17.3],
    facing: 'S',
    lines: [
      { zone: 'reception', dir: 'N' },
      { zone: 'gallery-a', dir: 'N' },
      { zone: 'shop', dir: 'N' },
      { zone: 'library', dir: 'N' },
      { zone: 'theatre', dir: 'W' },
      { zone: 'workshop', dir: 'E' },
    ],
    zones: ['atrium'],
  },
  {
    id: 'totem-court',
    kind: 'totem',
    position: [6.6, 0, -20.6],
    facing: 'W',
    lines: [
      { zone: 'reveal', dir: 'N' },
      { zone: 'gallery-b', dir: 'SE' },
      { zone: 'courtyard', dir: 'SE' },
      { zone: 'gallery-a', dir: 'SW' },
      { zone: 'gallery-d', dir: 'SW' },
      { zone: 'reception', dir: 'S' },
    ],
    zones: ['reveal', 'passage'],
  },
]

/* ------------------------------------------------------------------ */
/* Discovery trail — "Find the motifs"                                 */
/* ------------------------------------------------------------------ */

export interface TrailMedallion {
  id: string
  motif: MotifId
  ink: string
  /** Centre of the medallion (on a wall / column face). */
  position: Vec3
  facing: Compass
  zone: ZoneId
  /** Where it is, for the progress card once found. */
  place: string
}

export const TRAIL_SIZE = 0.15
export const TRAIL: TrailMedallion[] = [
  { id: 'm1', motif: 'rosette', ink: '#8a3b2b', position: [-2.6, 1.05, 12.0 + 0.18 + 0.006], facing: 'S', zone: 'atrium', place: 'Grand Atrium' },
  { id: 'm2', motif: 'teardrop', ink: '#2c3f6b', position: [-4.8, 0.95, DIV + 0.03], facing: 'S', zone: 'reception', place: 'Reception' },
  { id: 'm3', motif: 'star-lattice', ink: '#b7862f', position: [9.35, 1.2, SHOP.maxZ - 0.006], facing: 'N', zone: 'shop', place: 'Museum Shop' },
  { id: 'm4', motif: 'leaf-trail', ink: '#3b5a3a', position: [-9.45, 1.0, LIB.minZ + 0.006], facing: 'S', zone: 'library', place: 'Reading Room & Library' },
  { id: 'm5', motif: 'diamond', ink: '#8a3b2b', position: [-MUSEUM.passage.clearWidth / 2 + 0.006, 0.72, -9.0], facing: 'E', zone: 'passage', place: 'Central Passage' },
  { id: 'm6', motif: 'rosette', ink: '#c9a35a', position: [-12.6, 1.0, -2.3 - 0.006], facing: 'N', zone: 'gallery-d', place: 'Gallery D' },
  { id: 'm7', motif: 'star-lattice', ink: '#2a2522', position: [MUSEUM.wings.workshop.maxX - 0.02, 1.2, 6.1], facing: 'W', zone: 'workshop', place: 'Craft Workshop Hall' },
  { id: 'm8', motif: 'teardrop', ink: '#7c2419', position: [MUSEUM.wings.courtyard.maxX - 0.035, 1.3, -31.6], facing: 'W', zone: 'courtyard', place: 'Dye Garden Courtyard' },
]

/** Unit outward normal [x, z] of a compass facing. */
export function compassVec(c: Compass): [number, number] {
  const s = Math.SQRT1_2
  switch (c) {
    case 'N':
      return [0, -1]
    case 'S':
      return [0, 1]
    case 'E':
      return [1, 0]
    case 'W':
      return [-1, 0]
    case 'NE':
      return [s, -s]
    case 'NW':
      return [-s, -s]
    case 'SE':
      return [s, s]
    case 'SW':
      return [-s, s]
  }
}

/** rotation.y that turns a +z-facing plane to face `c`. */
export const compassRotation = (c: Compass) => {
  const [x, z] = compassVec(c)
  return Math.atan2(x, z)
}

export { RH as AMENITY_CEILING }
