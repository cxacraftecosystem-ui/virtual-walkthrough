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
import { SURFACES, surfacePoint } from './layout'
import type { SelectionKind } from '../state/store'

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
}

export const TOUR = {
  dwellSec: 11,
  /** Walks longer than this (m) fade-teleport instead. */
  teleportBeyond: 26,
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

export const TOUR_STOPS: TourStop[] = [
  {
    id: 'atrium',
    place: 'Grand Atrium',
    title: 'Welcome to the museum',
    text: 'You are standing in the Grand Atrium, just inside the main entrance. Printed textile lengths hang overhead, and the doorway ahead leads to the reception and the galleries.',
    view: { x: 0, z: 15.2, yawDeg: 0, pitchDeg: 7 },
    item: { kind: 'object', id: 'banner-3' },
    dwellSec: 10,
  },
  {
    id: 'welcome-film',
    place: 'Grand Atrium',
    title: 'The welcome film',
    text: 'A large screen on the atrium’s north wall plays the welcome film. Its sound follows the screen, so it grows louder as you approach.',
    view: { x: -4.35, z: 9.7, yawDeg: 350, pitchDeg: 8 },
    item: { kind: 'video', id: 'welcome-film' },
  },
  {
    id: 'reception',
    place: 'Reception',
    title: 'The reception',
    text: 'A lower, quieter room between the atrium and the galleries. The first textile study hangs on the wall beside the desk.',
    view: { x: -0.85, z: 1.35, yawDeg: 90, pitchDeg: 2 },
    item: { kind: 'artwork', id: 'study-05' },
    dwellSec: 9,
  },
  {
    id: 'passage',
    place: 'Central Passage',
    title: 'The central passage',
    text: 'A long, narrow passage runs up the middle of the gallery beneath the skylight. The display bays open on either side of it at the far end.',
    view: { x: 0, z: -2.6, yawDeg: 0, pitchDeg: 4 },
    dwellSec: 9,
  },
  {
    id: 'reveal',
    place: 'Reveal Wall',
    title: 'The reveal wall',
    text: 'At the end of the passage a free-standing wall interrupts the view. Step around it on either side to reach the craft court and the galleries.',
    view: { x: 0, z: -13.25, yawDeg: 0, pitchDeg: 9 },
    dwellSec: 9,
  },
  {
    id: 'hero-01',
    place: 'Gallery A',
    title: 'Hero Textile I',
    text: 'The first of the five hero works hangs on the perimeter wall of Gallery A. Beside it, a display table holds the printing block associated with it.',
    view: artworkView('hero-01', 2.6, { x: -2.89, z: -3.43, yawDeg: 270, pitchDeg: 2 }),
    item: { kind: 'artwork', id: 'hero-01' },
  },
  {
    id: 'hero-02',
    place: 'Gallery A',
    title: 'Hero Textile II',
    text: 'Further along the same wall, the second hero work. The low bench in front of it sits on the bay’s axis, facing the textile.',
    view: artworkView('hero-02', 2.6, { x: -2.89, z: -10.29, yawDeg: 270, pitchDeg: 2 }),
    item: { kind: 'artwork', id: 'hero-02' },
  },
  {
    id: 'hero-03',
    place: 'Gallery B',
    title: 'Hero Textile III',
    text: 'Across the court, Gallery B. The third hero work is on the perimeter wall, lit by its own track spotlight.',
    view: artworkView('hero-03', 2.6, { x: 2.89, z: -10.29, yawDeg: 90, pitchDeg: 2 }),
    item: { kind: 'artwork', id: 'hero-03' },
  },
  {
    id: 'hero-05',
    place: 'Gallery B',
    title: 'Hero Textile V',
    text: 'Turning around, the fifth hero work hangs on the partition facing the bay, with its printing block on the table nearby.',
    view: artworkView('hero-05', 2.6, { x: 4.14, z: -10.29, yawDeg: 270, pitchDeg: 2 }),
    item: { kind: 'artwork', id: 'hero-05' },
    dwellSec: 9,
  },
  {
    id: 'hero-04',
    place: 'Gallery C',
    title: 'Hero Textile IV',
    text: 'Past the short return wall lies Gallery C, where the fourth hero work completes the set on the perimeter wall.',
    view: artworkView('hero-04', 2.6, { x: 2.89, z: -3.43, yawDeg: 90, pitchDeg: 2 }),
    item: { kind: 'artwork', id: 'hero-04' },
  },
  {
    id: 'product-wall',
    place: 'Craft Court',
    title: 'The product wall',
    text: 'The north wall of the craft court carries four panels about the craft. Approach any panel and open it to read its text.',
    view: { x: 0, z: -15.95, yawDeg: 0, pitchDeg: 4 },
  },
  {
    id: 'workshop',
    place: 'Craft Workshop Hall',
    title: 'The printing tables',
    text: 'The workshop hall is laid out as a working studio. Long printing tables run down the hall, with archive shelves of carved blocks along the east wall.',
    view: { x: 12.3, z: 11.2, yawDeg: 115, pitchDeg: -9 },
    item: { kind: 'object', id: 'printing-table-1' },
  },
  {
    id: 'dye-vats',
    place: 'Craft Workshop Hall',
    title: 'The dye vats',
    text: 'At the north end of the hall stand three dye vats of different colours, next to a pigment station and a wash tank.',
    view: { x: 19.4, z: 0.6, yawDeg: 52, pitchDeg: -10 },
    item: { kind: 'object', id: 'dye-vat-indigo' },
  },
  {
    id: 'courtyard',
    place: 'Dye Garden Courtyard',
    title: 'The dye garden',
    text: 'Through the north doorway is an open-air courtyard. Printed cloths hang on drying lines between planting beds and a rinsing channel.',
    view: { x: 17.6, z: -8.5, yawDeg: 0, pitchDeg: 5 },
    item: { kind: 'object', id: 'drying-line-1' },
  },
  {
    id: 'theatre',
    place: 'Immersive Theatre',
    title: 'The immersive theatre',
    text: 'The tour ends in the theatre on the west side of the atrium. A curved screen fills the far wall and surround sound plays from speakers around the room. Take a seat and stay as long as you like.',
    view: { x: -12.0, z: 11.3, yawDeg: 270, pitchDeg: 3 },
    item: { kind: 'video', id: 'theatre-film' },
    dwellSec: 14,
  },
]

/**
 * Navigation waypoints [x, z] — room centres and both sides of each doorway.
 * Only positions matter; edges are computed from the collision geometry.
 */
export const NAV_WAYPOINTS: [number, number][] = [
  // Grand Atrium
  [0, 15.6],
  [0, 9.6],
  [0, 5.9],
  [-4.2, 9.6],
  [4.2, 9.6],
  [-8.6, 14.6],
  [8.6, 10.6],
  // Atrium ↔ Theatre doorway (x ≈ -10.15, z ≈ 15)
  [-9.3, 15.0],
  [-11.1, 15.2],
  // Theatre
  [-12.0, 15.8],
  [-12.0, 11.3],
  // Atrium ↔ Workshop doorway (x ≈ 10.15, z ≈ 11)
  [9.3, 11.0],
  [11.1, 11.0],
  // Workshop hall
  [12.3, 11.2],
  [12.4, 5.6],
  [15.6, 5.6],
  [17.6, 9.8],
  [17.6, 14.4],
  [12.4, 14.4],
  [15.6, 0.2],
  [19.4, 0.6],
  [15.6, -4.6],
  [17.6, -5.0],
  // Workshop ↔ Courtyard doorway (z ≈ -6.15)
  [17.6, -7.3],
  [17.6, -8.5],
  // Reception + passage
  [0, 4.1],
  [0, 2.3],
  [0, 0.8],
  [0, -1.4],
  [0, -7.0],
  [0, -12.9],
  [0, -14.36],
  // Craft court (around the reveal wall)
  [-3.4, -14.4],
  [3.4, -14.4],
  [-3.4, -16.0],
  [3.4, -16.0],
  [0, -15.95],
  // Galleries A / B / C (partition-side aisle, behind the benches)
  [-2.42, -12.6],
  [-2.42, -6.9],
  [-2.42, -1.2],
  [2.42, -12.6],
  [2.42, -6.9],
  [2.42, -1.2],
  [4.3, -6.1],
  [-4.3, -6.1],
]
