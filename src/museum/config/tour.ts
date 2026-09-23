/**
 * GUIDED TOUR — data-driven stops across the whole museum.
 *
 * Each stop is a standing point + view direction (`view`, compass yaw: 0 = north,
 * 90 = east, 180 = south, 270 = west) and an optional `item` that the caption card can
 * open ("More about this") or favourite. Captions describe what the visitor is looking at
 * in the museum — they deliberately make no historical or cultural claims.
 *
 * Walking between stops is planned over NAV_WAYPOINTS (see src/museum/tour/pathing.ts),
 * so routes always pass through doorways; hops longer than `teleportBeyond` metres use the
 * soft fade instead of a long walk.
 */
import { ARTWORKS } from './artworks'
import { COURT_CENTER, SURFACES, surfacePoint } from './layout'
import { MUSEUM } from './museum'
import { TOUR_OVERRIDE } from '../content/exhibition'
import type { SelectionKind } from '../state/store'
import type { ContentI18n, Lang } from '../i18n/core'

export interface TourView {
  x: number
  z: number
  /** Compass heading (deg). */
  yawDeg: number
  pitchDeg?: number
}

export interface TourStop {
  id: string
  /** Short room / place label shown above the title. */
  place: string
  title: string
  text: string
  view: TourView
  item?: { kind: SelectionKind; id: string }
  /** Seconds to linger before moving on (default TOUR.dwellSec). */
  dwellSec?: number
  /** Optional Hindi / Bengali captions (else src/museum/i18n/tourText.ts, else English). */
  i18n?: ContentI18n<'place' | 'title' | 'text'>
  /**
   * Optional recorded audio-guide narration per language (e.g. { en: '/audio/tour/en/atrium.mp3' }).
   * Without a file for the chosen language the caption is read with speechSynthesis.
   */
  narrationAudio?: Partial<Record<Lang, string>>
}

export const TOUR = {
  dwellSec: 11,
  /** Walks longer than this (m) fade-teleport instead. */
  teleportBeyond: 30,
  /** Speech synthesis rate (0.1–10). */
  narrationRate: 0.95,
}

/** Standing point `dist` metres in front of an artwork, facing it (follows its config placement). */
function artworkView(id: string, dist: number, fallback: TourView, pitchDeg = 2): TourView {
  const a = ARTWORKS.find((x) => x.id === id)
  if (!a) return fallback
  const s = SURFACES[a.placement.surface]
  const p = surfacePoint(a.placement.surface, a.placement.at, 0, dist)
  const [nx, nz] = s.normal
  // face opposite the wall normal
  const yawDeg = ((Math.atan2(-nx, nz) * 180) / Math.PI + 360) % 360
  return { x: p.position[0], z: p.position[2], yawDeg, pitchDeg }
}

/** Standing point (x, z) facing a target point (compass yaw). */
function lookAt(x: number, z: number, tx: number, tz: number, pitchDeg = 2): TourView {
  return { x, z, yawDeg: ((Math.atan2(tx - x, -(tz - z)) * 180) / Math.PI + 360) % 360, pitchDeg }
}
const CZ = COURT_CENTER.z
const GD = MUSEUM.wings.galleryD
const GDX = (GD.minX + GD.maxX) / 2
const TH = MUSEUM.wings.theatre
const DR = MUSEUM.wings.doors

export const TOUR_STOPS: TourStop[] = [
  {
    id: 'atrium',
    place: 'Grand Atrium',
    title: 'Welcome to the museum',
    text: 'You are standing in the Grand Atrium, just inside the main entrance. Printed textile lengths hang high overhead, and the doorway ahead, between the timber columns, leads to the reception and the galleries.',
    view: { x: 0, z: 17.8, yawDeg: 0, pitchDeg: 9 },
    item: { kind: 'object', id: 'banner-3' },
    dwellSec: 10,
  },
  {
    id: 'welcome-film',
    place: 'Grand Atrium',
    title: 'The welcome film',
    text: 'A large screen on the atrium’s north wall plays the welcome film, with a bench in front of it. Its sound follows the screen, so it grows louder as you approach.',
    view: lookAt(-3.7, 14.0, -5.6, 8.5, 8),
    item: { kind: 'video', id: 'welcome-film' },
  },
  {
    id: 'atrium-textile',
    place: 'Grand Atrium',
    title: 'The monumental textile',
    text: 'On the west wall of the hall hangs a six-metre printed textile; the exhibition title is across the hall above the information desk.',
    view: lookAt(-2.6, 13.2, -10, 12.0, 12),
    item: { kind: 'artwork', id: 'feature-13' },
    dwellSec: 9,
  },
  {
    id: 'reception',
    place: 'Reception',
    title: 'The reception',
    text: 'A lower, quieter room between the atrium and the galleries. Small studies hang on either side, and the welcome text is on the north wall, beside the passage.',
    view: artworkView('study-12', 2.4, { x: 2.6, z: 1.5, yawDeg: 90 }),
    item: { kind: 'artwork', id: 'study-12' },
    dwellSec: 9,
  },
  {
    id: 'credits',
    place: 'Reception',
    title: 'The partners wall',
    text: 'Turning back towards the atrium, two stone panels either side of the doorway acknowledge the partners who present the exhibition.',
    view: lookAt(0, 4.9, 0, 8.2, 3),
    item: { kind: 'object', id: 'credits-presented' },
    dwellSec: 8,
  },
  {
    id: 'shop',
    place: 'Museum Shop',
    title: 'The museum shop',
    text: 'Through the east doorway of the reception is the museum shop: timber shelves and low tables of folded printed cloth, cushions and stoles. The products shown are placeholders, to be supplied by the workshop.',
    view: lookAt(5.9, 4.5, 9.6, 4.4, -6),
    item: { kind: 'object', id: 'shop-table-1' },
    dwellSec: 10,
  },
  {
    id: 'library',
    place: 'Reading Room & Library',
    title: 'The reading room',
    text: 'Across the reception is a quiet reading room: bookcases along the west wall, a long reading table with lamps, framed drawings for printing blocks, and a lectern holding an open sample book. The Resources board by the door lists the text guide and other material.',
    view: lookAt(-5.95, 6.0, -8.4, 2.2, -5),
    item: { kind: 'object', id: 'library-pattern-book' },
    dwellSec: 11,
  },
  {
    id: 'passage',
    place: 'Central Passage',
    title: 'The central passage',
    text: 'A long, narrow passage runs up the middle of the gallery beneath the skylight. The display bays open on either side of it.',
    view: { x: 0, z: -2.6, yawDeg: 0, pitchDeg: 4 },
    dwellSec: 9,
  },
  {
    id: 'reveal',
    place: 'Reveal Wall',
    title: 'The reveal wall',
    text: 'At the end of the passage a free-standing wall interrupts the view. It carries the exhibition title and a large framed feature painting. Step around it on either side to reach the craft court.',
    view: { x: 0.4, z: -15.4, yawDeg: 0, pitchDeg: 6 },
    item: { kind: 'artwork', id: 'feature-01' },
    dwellSec: 10,
  },
  {
    id: 'hero-01',
    place: 'Gallery A',
    title: 'Hero Textile I',
    text: 'The first of the five hero works hangs on the perimeter wall of Gallery A. Beside it, a display table holds the printing block associated with it.',
    view: artworkView('hero-01', 2.8, { x: -7.2, z: -4.5, yawDeg: 270 }),
    item: { kind: 'artwork', id: 'hero-01' },
  },
  {
    id: 'salon',
    place: 'Gallery A',
    title: 'A salon hang',
    text: 'On the passage partition, seven small studies are hung together as one cluster. A key panel beside them carries their captions.',
    view: { x: -4.5, z: -4.5, yawDeg: 90, pitchDeg: 3 },
    item: { kind: 'infographic', id: 'info-salon' },
    dwellSec: 9,
  },
  {
    id: 'hero-02',
    place: 'Gallery A',
    title: 'Hero Textile II',
    text: 'In the north bay of Gallery A, the second hero work. The doorway beyond it leads west into Gallery D.',
    view: artworkView('hero-02', 2.9, { x: -7.1, z: -11, yawDeg: 270 }),
    item: { kind: 'artwork', id: 'hero-02' },
  },
  {
    id: 'map-wall',
    place: 'Gallery D',
    title: 'The map wall',
    text: 'Through the doorway, an avenue of suspended printed drapes leads to a large relief map of India on the far wall. Its numbered pins are placeholders: the cluster locations are still to be confirmed by the workshop.',
    view: { x: GD.minX + 7.6, z: DR.galleryToGalleryD.z, yawDeg: 270, pitchDeg: 6 },
    item: { kind: 'object', id: 'india-map-wall' },
    dwellSec: 13,
  },
  {
    id: 'gallery-d-centrepiece',
    place: 'Gallery D',
    title: 'A block under glass',
    text: 'At the north end of Gallery D a carved block turns slowly under a glass dome, in front of a triptych of tall printed panels.',
    view: lookAt(GDX + 0.4, -23.2, GDX, -26.4, -6),
    item: { kind: 'object', id: 'centrepiece-gallery-d' },
    dwellSec: 10,
  },
  {
    id: 'centrepiece',
    place: 'Craft Court',
    title: 'The master block',
    text: 'Back in the craft court, beneath the skylight, a large carved printing block turns slowly on a tall round table. Open it to inspect the block in 3D.',
    view: lookAt(0.6, CZ + 3.2, 0, CZ, -7),
    item: { kind: 'object', id: 'centrepiece-court' },
    dwellSec: 12,
  },
  {
    id: 'product-wall',
    place: 'Craft Court',
    title: 'The product wall',
    text: 'The north wall of the craft court carries four panels about the craft, flanked by two tall printed panels.',
    view: { x: 0, z: -29.4, yawDeg: 0, pitchDeg: 3 },
    item: { kind: 'infographic', id: 'info-technique' },
  },
  {
    id: 'runner',
    place: 'Craft Court',
    title: 'The printed runner',
    text: 'Along the east wall of the court runs a seven-metre printed runner, with a table of blocks at its end.',
    view: artworkView('runner-01', 3.1, { x: 6.9, z: CZ, yawDeg: 90 }),
    item: { kind: 'artwork', id: 'runner-01' },
    dwellSec: 9,
  },
  {
    id: 'hero-03',
    place: 'Gallery B',
    title: 'Hero Textile III',
    text: 'Gallery B opens off the court. The third hero work is on its perimeter wall, lit by its own track spotlight.',
    view: artworkView('hero-03', 2.8, { x: 7.2, z: -11.4, yawDeg: 90 }),
    item: { kind: 'artwork', id: 'hero-03' },
  },
  {
    id: 'hero-05',
    place: 'Gallery B',
    title: 'Hero Textile V',
    text: 'On the partition side of the bay hangs the fifth hero work, the widest of the five, with its printing block on the table nearby.',
    view: artworkView('hero-05', 2.8, { x: 4.7, z: -13.5, yawDeg: 270 }),
    item: { kind: 'artwork', id: 'hero-05' },
    dwellSec: 9,
  },
  {
    id: 'hero-04',
    place: 'Gallery C',
    title: 'Hero Textile IV',
    text: 'Past the short return wall lies Gallery C, where the fourth hero work completes the set on the perimeter wall.',
    view: artworkView('hero-04', 2.8, { x: 7.2, z: -4.5, yawDeg: 90 }),
    item: { kind: 'artwork', id: 'hero-04' },
  },
  {
    id: 'courtyard',
    place: 'Dye Garden Courtyard',
    title: 'The dye garden',
    text: 'Through the doorway in Gallery B is an open-air courtyard. Printed cloths hang on drying lines between planting beds, with a rinsing channel along the far wall.',
    view: { x: 20.6, z: -15.2, yawDeg: 0, pitchDeg: 5 },
    item: { kind: 'object', id: 'drying-line-3' },
  },
  {
    id: 'dye-vats',
    place: 'Craft Workshop Hall',
    title: 'The dye vats',
    text: 'South of the courtyard lies the workshop hall. Just inside, four dye vats stand along the north wall beside a wash tank.',
    view: lookAt(22.0, 2.0, 25.6, 0.2, -12),
    item: { kind: 'object', id: 'dye-vat-indigo' },
  },
  {
    id: 'workshop',
    place: 'Craft Workshop Hall',
    title: 'The printing tables',
    text: 'The hall is laid out as a working studio: four long printing tables either side of a central aisle, archive shelves of carved blocks along the east wall and a carving bench in the corner.',
    view: lookAt(21.2, 14.3, 16.4, 11.0, -10),
    item: { kind: 'object', id: 'printing-table-1' },
  },
  {
    id: 'artisan-capture',
    place: 'Craft Workshop Hall',
    title: 'An artisan capture — coming soon',
    text: 'Across the second printing table, a softly glowing seated figure marks the place where a three-dimensional recording of a printer at work will be shown. The recording has not been made yet; the figure and its card are placeholders.',
    view: lookAt(23.0, 13.4, 23.4, 9.9, -6),
    item: { kind: 'object', id: 'artisan-capture-2' },
  },
  {
    id: 'meet-the-maker',
    place: 'Craft Workshop Hall',
    title: 'Meet the maker',
    text: 'At the end of the aisle, two small portrait screens on stands will introduce makers from the workshop. For now they play placeholder films. Step close to one to hear it, or click a screen to pause it.',
    view: lookAt(24.8, 14.3, 27.75, 14.3, 0),
    item: { kind: 'video', id: 'maker-portrait-1' },
  },
  {
    id: 'print-studio',
    place: 'Craft Workshop Hall',
    title: 'Print it yourself',
    text: 'Now it is your turn. Click the small printing table to open the studio: choose a block and a dye, then click or tap the cloth to print. Hold longer for a firmer impression, use the repeat guides to line up a pattern, and download your cloth or send it to the Visitors’ Wall.',
    view: lookAt(15.4, 8.5, 13.0, 8.5, -16),
    item: { kind: 'object', id: 'print-studio' },
    dwellSec: 13,
  },
  {
    id: 'visitors-wall',
    place: 'Craft Workshop Hall',
    title: 'The Visitors’ Wall',
    text: 'Behind the studio table hang prints made by visitors, framed like small textiles. Each one appears after a member of the museum team has reviewed it; the empty frames are waiting for the next prints.',
    view: lookAt(14.6, 8.6, 10.3, 8.6, 6),
    item: { kind: 'object', id: 'visitors-wall' },
  },
  {
    id: 'theatre',
    place: 'Immersive Theatre',
    title: 'The immersive theatre',
    text: 'The tour ends in the theatre on the west side of the atrium. A curved screen fills the far wall and surround sound plays from speakers around the room. Take a seat and stay as long as you like.',
    view: { x: TH.minX + 14.0, z: (TH.minZ + TH.maxZ) / 2, yawDeg: 270, pitchDeg: 4 },
    item: { kind: 'video', id: 'theatre-film' },
    dwellSec: 14,
  },
]

/** Bundled stops (the admin uses them as the template for a per-exhibition tour override). */
export const BUNDLED_TOUR_STOPS: readonly TourStop[] = TOUR_STOPS.slice()
// Per-exhibition tour override from the content API (src/museum/content/exhibition.ts).
if (TOUR_OVERRIDE.stops?.length) TOUR_STOPS.splice(0, TOUR_STOPS.length, ...TOUR_OVERRIDE.stops)

/**
 * Navigation waypoints [x, z] — room centres, aisles and both sides of each doorway.
 * Only positions matter; edges are computed from the collision geometry.
 */
export const NAV_WAYPOINTS: [number, number][] = [
  // Grand Atrium
  [0, 18.0],
  [0, 14.2],
  [-5.2, 14.2],
  [5.4, 13.4],
  [-9.0, DR.atriumToTheatre.z],
  [9.0, DR.atriumToWorkshop.z],
  [0, 9.3],
  // reception + passage
  [0, 7.4],
  [0, 4.2],
  // reception side doors → shop (east) / library (west)
  [3.7, DR.receptionToShop.z],
  [6.3, DR.receptionToShop.z],
  [-3.7, DR.receptionToLibrary.z],
  [-5.95, DR.receptionToLibrary.z],
  [0, 0.9],
  [0, -0.8],
  [0, -6.0],
  [0, -12.0],
  [0, -17.2],
  [0, -19.1],
  // craft court around the reveal wall
  [-5.2, -19.0],
  [5.2, -19.0],
  [-5.2, -22.2],
  [5.2, -22.2],
  [0, -23.2],
  [-7.6, CZ],
  [7.6, CZ],
  [-3.2, -29.6],
  [3.2, -29.6],
  [0, -29.6],
  // Gallery A (inner aisle x −3.85, outer aisle x −7.7) + cross-overs at the island ends
  [-3.85, -1.0],
  [-3.85, -9.0],
  [-3.85, -17.2],
  [-7.7, -1.0],
  [-7.4, -9.0],
  [-7.7, -17.2],
  [-5.95, -9.0],
  [-5.95, -17.7],
  [-8.9, DR.galleryToGalleryD.z],
  // Galleries B / C
  [3.85, -1.0],
  [3.85, -9.0],
  [3.85, -17.2],
  [7.7, -1.0],
  [7.4, -9.0],
  [7.7, -17.2],
  [5.95, -9.0],
  [5.95, -17.7],
  [8.9, DR.galleryToCourtyard.z],
  // Gallery D
  [-11.5, DR.galleryToGalleryD.z],
  [-16.0, DR.galleryToGalleryD.z],
  [GD.minX + 7.6, DR.galleryToGalleryD.z],
  [GDX, -22.8],
  [-14.5, -10.5],
  [-22.0, -10.5],
  [DR.theatreToGalleryD.x, GD.maxZ - 1.1],
  // Theatre
  [DR.theatreToGalleryD.x, TH.minZ + 1.1],
  [-13.6, (TH.minZ + TH.maxZ) / 2],
  [TH.minX + 14.0, (TH.minZ + TH.maxZ) / 2],
  [-13.0, DR.atriumToTheatre.z],
  [-11.4, DR.atriumToTheatre.z],
  // Craft Workshop Hall
  [11.4, DR.atriumToWorkshop.z],
  [20.3, DR.atriumToWorkshop.z],
  [20.3, 8.6],
  [15.6, 8.6], // in front of the studio table / Visitors' Wall
  [25.0, 14.3], // east end of the aisle ("Meet the maker" screens)
  [20.3, 5.4],
  [21.0, 2.0],
  [DR.workshopToCourtyard.x, MUSEUM.wings.workshop.minZ + 1.2],
  // Dye Garden Courtyard
  [DR.workshopToCourtyard.x, MUSEUM.wings.courtyard.maxZ - 1.2],
  [DR.workshopToCourtyard.x, -8.0],
  [DR.workshopToCourtyard.x, DR.galleryToCourtyard.z],
  [11.5, DR.galleryToCourtyard.z],
  [14.0, DR.galleryToCourtyard.z],
  [DR.workshopToCourtyard.x, -26.0],
]
