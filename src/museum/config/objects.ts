/**
 * SCENE OBJECTS — craft installations, furniture and props placed in the v2 wings.
 *
 * Each object renders either:
 *   - `model`: a GLB (CC0 library download or a supplied production model), or
 *   - `kind`: a procedural model from src/museum/models/ (always available as fallback).
 * If a GLB is missing or fails to load, the procedural `kind` is shown instead.
 *
 * `footprint` [width x, depth z] (metres, before rotation) is used for collision and
 * is the size the procedural model is built to. Rotation is about +y in degrees.
 */
import type { Vec3 } from './museum'
import { MUSEUM } from './museum'

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
  zone: 'atrium' | 'theatre' | 'workshop' | 'courtyard'
  /** Attribution for downloaded CC0 assets. */
  credit?: { author: string; source: string; license: 'CC0' }
  placeholder?: boolean
}

const PENDING = 'Interpretive text to be supplied by the workshop.'
/** Poly Haven CC0 model path (downloaded by scripts/download-cc0-models.mjs). */
const cc0 = (id: string) => `/models/cc0/${id}/${id}_1k.gltf`
const PH = (author: string, id: string) => ({ author, source: `https://polyhaven.com/a/${id}`, license: 'CC0' as const })
const A = MUSEUM.wings.atrium
const WS = MUSEUM.wings.workshop
const CY = MUSEUM.wings.courtyard
const TH = MUSEUM.wings.theatre

export const SCENE_OBJECTS: SceneObjectConfig[] = [
  // ── Grand Atrium ───────────────────────────────────────────────────
  ...[-6, -3, 0, 3, 6].map<SceneObjectConfig>((x, i) => ({
    id: `banner-${i + 1}`,
    title: 'Suspended Textile Installation',
    kind: 'textile-banner',
    position: [x, A.height - 0.4, 10.2 + (i % 2) * 0.8],
    height: 5.2,
    props: { width: 1.3, image: ['/artworks/hero-04.jpg', '/artworks/study-01.jpg', '/artworks/hero-01.jpg', '/artworks/study-05.jpg', '/artworks/hero-02.jpg'][i] },
    interactive: i === 2,
    description: 'A suspended installation of printed lengths welcoming visitors. (Placeholder textiles.)',
    zone: 'atrium',
    placeholder: true,
  })),
  { id: 'grand-desk', title: 'Information Desk', kind: 'grand-desk', position: [6.2, 0, 13.2], rotationDeg: -90, footprint: [3.6, 1.0], height: 1.05, zone: 'atrium' },
  ...[
    [-8.6, 6.3],
    [8.6, 6.3],
    [-8.6, 16.4],
    [8.6, 16.4],
  ].map<SceneObjectConfig>(([x, z], i) => ({
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
  // CC0 objects on the information desk's stone ledge (the desk runs along z at x ≈ 5.7–6.7)
  { id: 'desk-lantern', title: 'Brass lantern', kind: 'vessel', model: cc0('brass_diya_lantern'), modelScale: 1, position: [5.93, 1.05, 14.55], rotationDeg: -30, height: 0.38, zone: 'atrium', credit: PH('Bhargav Kubal', 'brass_diya_lantern') },
  { id: 'desk-vase-1', title: 'Ceramic vase', kind: 'vessel', model: cc0('ceramic_vase_03'), modelScale: 1, position: [5.95, 1.05, 14.2], height: 0.41, zone: 'atrium', credit: PH('James Ray Cock', 'ceramic_vase_03') },
  { id: 'desk-vase-2', title: 'Ceramic vase', kind: 'vessel', model: cc0('ceramic_vase_01'), modelScale: 1, position: [5.93, 1.05, 11.85], rotationDeg: 40, height: 0.4, zone: 'atrium', credit: PH('James Ray Cock', 'ceramic_vase_01') },
  { id: 'desk-succulent', title: 'Succulent', kind: 'vessel', model: cc0('potted_plant_04'), modelScale: 1, position: [5.97, 1.05, 12.22], height: 0.27, zone: 'atrium', credit: PH('James Ray Cock', 'potted_plant_04') },
  ...[-6.5, -2.2, 2.2, 6.5].map<SceneObjectConfig>((x, i) => ({
    id: `atrium-column-${i + 1}`,
    title: 'Timber column',
    kind: 'column',
    position: [x, 0, 7.6],
    footprint: [0.5, 0.5],
    height: A.height,
    zone: 'atrium',
  })),
  { id: 'atrium-bench-1', title: 'Bench', kind: 'garden-bench', position: [-3.2, 0, 14.4], footprint: [2.4, 0.5], zone: 'atrium' },
  { id: 'atrium-bench-2', title: 'Bench', kind: 'garden-bench', position: [-7.2, 0, 11.4], rotationDeg: 90, footprint: [2.4, 0.5], zone: 'atrium' },

  // ── Immersive Theatre ─────────────────────────────────────────────
  ...[-18.2, -16.2, -14.2].map<SceneObjectConfig>((x, i) => ({
    id: `theatre-row-${i + 1}`,
    title: 'Theatre seating',
    kind: 'theatre-seating',
    position: [x, 0, (TH.minZ + TH.maxZ) / 2 - 0.4],
    rotationDeg: 90,
    footprint: [7.2, 0.62],
    props: { seats: 8 },
    zone: 'theatre',
  })),

  // ── Craft Workshop Hall ───────────────────────────────────────────
  { id: 'printing-table-1', title: 'Printing Table I', kind: 'printing-table', position: [14.3, 0, 9.8], rotationDeg: 90, footprint: [6.0, 1.3], height: 0.86, props: { motif: 'rosette', ink: '#2c3f6b' }, interactive: true, inspectable: false, description: PENDING, zone: 'workshop', placeholder: true },
  { id: 'printing-table-2', title: 'Printing Table II', kind: 'printing-table', position: [20.9, 0, 9.8], rotationDeg: 90, footprint: [6.0, 1.3], height: 0.86, props: { motif: 'teardrop', ink: '#9b3326' }, interactive: true, description: PENDING, zone: 'workshop', placeholder: true },
  { id: 'printing-table-3', title: 'Printing Table III', kind: 'printing-table', position: [17.6, 0, 1.6], rotationDeg: 90, footprint: [6.0, 1.3], height: 0.86, props: { motif: 'star-lattice', ink: '#b7862f' }, interactive: true, description: PENDING, zone: 'workshop', placeholder: true },
  { id: 'dye-vat-indigo', title: 'Dye Vat — Indigo', kind: 'dye-vat', position: [22.4, 0, -3.1], footprint: [1.3, 1.3], height: 0.95, props: { liquid: '#1f2d52' }, interactive: true, inspectable: true, description: PENDING, zone: 'workshop', placeholder: true },
  { id: 'dye-vat-madder', title: 'Dye Vat — Madder', kind: 'dye-vat', position: [23.8, 0, -1.2], footprint: [1.1, 1.1], height: 0.85, props: { liquid: '#7c2419' }, interactive: true, inspectable: true, description: PENDING, zone: 'workshop', placeholder: true },
  { id: 'dye-vat-ochre', title: 'Dye Vat — Ochre', kind: 'dye-vat', position: [21.0, 0, -1.0], footprint: [1.1, 1.1], height: 0.85, props: { liquid: '#a8741f' }, interactive: true, inspectable: true, description: PENDING, zone: 'workshop', placeholder: true },
  { id: 'block-shelf-1', title: 'Block Archive I', kind: 'block-shelf', position: [WS.maxX - 0.3, 0, 13.4], rotationDeg: -90, footprint: [3.2, 0.5], height: 2.4, interactive: true, inspectable: true, description: PENDING, zone: 'workshop', placeholder: true },
  { id: 'block-shelf-2', title: 'Block Archive II', kind: 'block-shelf', position: [WS.maxX - 0.3, 0, 5.8], rotationDeg: -90, footprint: [3.2, 0.5], height: 2.4, interactive: true, inspectable: true, description: PENDING, zone: 'workshop', placeholder: true },
  { id: 'pigment-station', title: 'Pigment Station', kind: 'pigment-station', position: [12.0, 0, -2.6], rotationDeg: 90, footprint: [2.2, 0.8], height: 0.9, interactive: true, inspectable: true, description: PENDING, zone: 'workshop', placeholder: true },
  { id: 'wash-tank', title: 'Wash Tank', kind: 'wash-tank', position: [11.3, 0, 3.4], rotationDeg: 90, footprint: [2.6, 1.1], height: 0.8, interactive: true, description: PENDING, zone: 'workshop', placeholder: true },
  { id: 'fabric-rolls', title: 'Cloth Rolls', kind: 'fabric-rolls', position: [11.6, 0, 15.9], footprint: [2.0, 0.9], height: 1.4, interactive: true, description: PENDING, zone: 'workshop', placeholder: true },
  { id: 'carving-bench', title: 'Block Carving Bench', kind: 'carving-bench', position: [22.6, 0, 15.8], footprint: [2.0, 0.9], height: 0.85, interactive: true, inspectable: true, description: PENDING, zone: 'workshop', placeholder: true },
  { id: 'workshop-stool-1', title: 'Stool', kind: 'stool', model: cc0('wooden_stool_01'), modelScale: 1, position: [22.6, 0, 14.8], rotationDeg: 15, footprint: [0.45, 0.45], height: 0.44, zone: 'workshop', credit: PH('Kuutti Siitonen', 'wooden_stool_01') },
  { id: 'workshop-stool-2', title: 'Stool', kind: 'stool', model: cc0('wooden_stool_01'), modelScale: 1, position: [12.95, 0, -3.3], rotationDeg: -20, footprint: [0.45, 0.45], height: 0.44, zone: 'workshop', credit: PH('Kuutti Siitonen', 'wooden_stool_01') },
  { id: 'workshop-bucket', title: 'Wooden bucket', kind: 'vessel', model: cc0('wooden_bucket_01'), modelScale: 1, position: [11.15, 0, 1.55], rotationDeg: 60, footprint: [0.4, 0.4], height: 0.55, zone: 'workshop', credit: PH('James Ray Cock', 'wooden_bucket_01') },
  { id: 'workshop-crate', title: 'Timber crate', kind: 'crate', model: cc0('wooden_crate_01'), modelScale: 1, position: [13.45, 0, 16.95], rotationDeg: 180, footprint: [0.85, 0.44], height: 0.35, zone: 'workshop', credit: PH('James Ray Cock', 'wooden_crate_01') },
  { id: 'workshop-crate-basket', title: 'Wicker basket', kind: 'vessel', model: cc0('wicker_basket_01'), modelScale: 1, position: [13.3, 0.35, 16.95], rotationDeg: 8, height: 0.12, zone: 'workshop', credit: PH('Kuutti Siitonen', 'wicker_basket_01') },
  { id: 'workshop-brass-pot', title: 'Brass pot', kind: 'vessel', model: cc0('brass_pot_01'), modelScale: 1, position: [24.3, 0, -3.5], footprint: [0.34, 0.34], height: 0.29, zone: 'workshop', credit: PH('Rico Cilliers', 'brass_pot_01') },

  // ── Dye Garden Courtyard ──────────────────────────────────────────
  // two lines either side of the door axis (x = 17.6), leaving a 1.6 m passage and clear of the beds
  { id: 'drying-line-1', title: 'Drying Lines', kind: 'drying-line', position: [14.5, 0, -11.8], footprint: [4.6, 0.4], height: 2.6, props: { cloths: 4, images: '/artworks/study-02.jpg,/artworks/hero-03.jpg,/artworks/study-03.jpg,/artworks/hero-05.jpg' }, interactive: true, description: PENDING, zone: 'courtyard', placeholder: true },
  { id: 'drying-line-2', title: 'Drying Lines', kind: 'drying-line', position: [20.7, 0, -11.8], footprint: [4.6, 0.4], height: 2.6, props: { cloths: 4, images: '/artworks/hero-01.jpg,/artworks/study-04.jpg,/artworks/hero-02.jpg,/artworks/study-01.jpg' }, interactive: true, description: PENDING, zone: 'courtyard', placeholder: true },
  { id: 'plant-bed-west', title: 'Dye Plant Bed', kind: 'plant-bed', position: [CY.minX + 0.7, 0, -12.4], rotationDeg: 90, footprint: [9.0, 1.2], height: 0.45, interactive: true, description: 'Planting bed for dye plants. Species list to be supplied by the workshop.', zone: 'courtyard', placeholder: true },
  { id: 'plant-bed-east', title: 'Dye Plant Bed', kind: 'plant-bed', position: [CY.maxX - 0.7, 0, -12.4], rotationDeg: 90, footprint: [9.0, 1.2], height: 0.45, interactive: true, description: 'Planting bed for dye plants. Species list to be supplied by the workshop.', zone: 'courtyard', placeholder: true },
  { id: 'water-channel', title: 'Rinsing Channel', kind: 'water-channel', position: [17.6, 0, CY.minZ + 0.8], footprint: [10.0, 0.9], height: 0.35, interactive: true, description: PENDING, zone: 'courtyard', placeholder: true },
  { id: 'tree-1', title: 'Tree', kind: 'tree', position: [12.6, 0, -16.6], footprint: [0.6, 0.6], height: 6.5, zone: 'courtyard' },
  { id: 'tree-2', title: 'Tree', kind: 'tree', position: [22.8, 0, -7.9], footprint: [0.6, 0.6], height: 5.5, zone: 'courtyard' },
  { id: 'garden-bench-1', title: 'Bench', kind: 'garden-bench', position: [17.6, 0, -15.0], footprint: [2.4, 0.5], zone: 'courtyard' },
  { id: 'garden-planter-1', title: 'Planter', kind: 'planter', model: cc0('potted_plant_02'), position: [11.3, 0, -7.2], footprint: [0.8, 0.8], height: 1.0, zone: 'courtyard', credit: PH('Rico Cilliers', 'potted_plant_02') },
  { id: 'garden-planter-2', title: 'Planter', kind: 'planter', model: cc0('potted_plant_02'), position: [23.9, 0, -17.3], rotationDeg: 140, footprint: [0.8, 0.8], height: 1.0, zone: 'courtyard', credit: PH('Rico Cilliers', 'potted_plant_02') },
  { id: 'garden-basket', title: 'Wicker basket', kind: 'vessel', model: cc0('wicker_basket_02'), modelScale: 1, position: [12.9, 0, -10.95], rotationDeg: 25, footprint: [0.4, 0.32], height: 0.22, zone: 'courtyard', credit: PH('Kuutti Siitonen', 'wicker_basket_02') },
  ...(
    [
      [19.3, -15.05, 0],
      [19.62, -14.86, 70],
      [19.5, -15.34, 150],
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
  { id: 'garden-vase', title: 'Antique ceramic vase', kind: 'vessel', model: cc0('antique_ceramic_vase_01'), modelScale: 1, position: [19.95, 0, -15.2], rotationDeg: 20, footprint: [0.28, 0.28], height: 0.44, zone: 'courtyard', credit: PH('James Ray Cock', 'antique_ceramic_vase_01') },
  { id: 'garden-bucket', title: 'Wooden bucket', kind: 'vessel', model: cc0('wooden_bucket_01'), modelScale: 1, position: [21.6, 0, -16.95], rotationDeg: -35, footprint: [0.4, 0.4], height: 0.55, zone: 'courtyard', credit: PH('James Ray Cock', 'wooden_bucket_01') },
]

export function getSceneObject(id: string) {
  return SCENE_OBJECTS.find((o) => o.id === id)
}
