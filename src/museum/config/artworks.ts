/**
 * ARTWORK CONTENT — edit this file to add, replace or move artworks.
 *
 * Frames are generated automatically from each image's intrinsic aspect ratio:
 * swap the image file (or `image` path) and the frame, mat and spotlight adapt.
 *
 * Placement: `surface` is a display-surface id from layout.ts and `at` is the
 * world coordinate ALONG that wall (z for side walls, x for the reveal/product walls).
 *
 * PLACEHOLDER STATUS: per the concept note (§3) the partitions stay unpopulated
 * until the workshop deliverables arrive. Every image below is a procedurally
 * generated placeholder (see scripts/generate-placeholders.mjs) and is flagged
 * `placeholder: true` so the UI labels it honestly.
 */

import type { FrameConfig, FrameStyleId } from './frames'
import { BAY, type SurfaceId } from './layout'

export interface ArtworkConfig {
  id: string
  title: string
  /** Traditional craft style the piece belongs to. */
  tradition: string
  artisan?: string
  region?: string
  material?: string
  technique?: string
  year?: string
  description?: string
  context?: string
  /** Public path under /public. Any aspect ratio. */
  image: string
  /** Hero pieces: exactly 5 per tradition (PDF §4). */
  hero?: boolean
  placement: {
    surface: SurfaceId
    at: number
    /** Centre height (m). Default 1.6 (PDF). */
    centerHeight?: number
  }
  /** Maximum outer (framed) size in metres. The artwork is fitted inside without distortion. */
  maxWidth: number
  maxHeight: number
  /**
   * Optional real-world image size in metres (width). When supplied the artwork is
   * shown 1:1 instead of fitted to maxWidth/maxHeight (height derived from aspect).
   */
  physicalWidth?: number
  frame?: FrameConfig | FrameStyleId
  spotlight?: { enabled?: boolean; intensity?: number; spread?: number }
  /** Hand-block exhibit id displayed on the adjacent table (see exhibits.ts). */
  exhibitId?: string
  placeholder?: boolean
  metadata?: Record<string, string>
}

export const TRADITION = 'Hand Block Printing'

const PLACEHOLDER_NOTE =
  'Placeholder image generated for layout and lighting calibration. The final hero textile will be supplied by the workshop and dropped in here without any geometry changes.'

export const ARTWORKS: ArtworkConfig[] = [
  // ── Five hero works (Hand Block Printing) ───────────────────────────
  {
    id: 'hero-01',
    title: 'Hero Textile I',
    tradition: TRADITION,
    image: '/artworks/hero-01.jpg',
    hero: true,
    placement: { surface: 'gallery-a-outer', at: BAY.southZ },
    maxWidth: 1.45,
    maxHeight: 1.75,
    frame: 'natural-wood',
    exhibitId: 'block-01',
    description: PLACEHOLDER_NOTE,
    placeholder: true,
  },
  {
    id: 'hero-02',
    title: 'Hero Textile II',
    tradition: TRADITION,
    image: '/artworks/hero-02.jpg',
    hero: true,
    placement: { surface: 'gallery-a-outer', at: BAY.northZ },
    maxWidth: 1.9,
    maxHeight: 1.45,
    frame: 'natural-wood',
    exhibitId: 'block-02',
    description: PLACEHOLDER_NOTE,
    placeholder: true,
  },
  {
    id: 'hero-03',
    title: 'Hero Textile III',
    tradition: TRADITION,
    image: '/artworks/hero-03.jpg',
    hero: true,
    placement: { surface: 'gallery-b-outer', at: BAY.northZ },
    maxWidth: 1.5,
    maxHeight: 1.5,
    frame: 'dark-wood',
    exhibitId: 'block-03',
    description: PLACEHOLDER_NOTE,
    placeholder: true,
  },
  {
    id: 'hero-04',
    title: 'Hero Textile IV',
    tradition: TRADITION,
    image: '/artworks/hero-04.jpg',
    hero: true,
    placement: { surface: 'gallery-c-outer', at: BAY.southZ, centerHeight: 1.65 },
    maxWidth: 1.2,
    maxHeight: 2.5,
    frame: 'textile-panel',
    exhibitId: 'block-04',
    description: PLACEHOLDER_NOTE,
    placeholder: true,
  },
  {
    id: 'hero-05',
    title: 'Hero Textile V',
    tradition: TRADITION,
    image: '/artworks/hero-05.jpg',
    hero: true,
    placement: { surface: 'gallery-b-partition', at: BAY.northZ },
    maxWidth: 2.3,
    maxHeight: 1.2,
    frame: 'thin-black',
    exhibitId: 'block-05',
    description: PLACEHOLDER_NOTE,
    placeholder: true,
  },

  // ── Supporting studies ──────────────────────────────────────────────
  {
    id: 'study-01',
    title: 'Study I',
    tradition: TRADITION,
    image: '/artworks/study-01.jpg',
    placement: { surface: 'gallery-a-partition', at: BAY.southZ },
    maxWidth: 0.95,
    maxHeight: 1.2,
    frame: 'thin-black',
    description: PLACEHOLDER_NOTE,
    placeholder: true,
  },
  {
    id: 'study-02',
    title: 'Study II',
    tradition: TRADITION,
    image: '/artworks/study-02.jpg',
    placement: { surface: 'gallery-a-partition', at: BAY.northZ },
    maxWidth: 1.0,
    maxHeight: 1.0,
    frame: 'white',
    description: PLACEHOLDER_NOTE,
    placeholder: true,
  },
  {
    id: 'study-03',
    title: 'Study III',
    tradition: TRADITION,
    image: '/artworks/study-03.jpg',
    placement: { surface: 'gallery-c-partition', at: BAY.southZ },
    maxWidth: 1.25,
    maxHeight: 1.1,
    frame: 'natural-wood',
    description: PLACEHOLDER_NOTE,
    placeholder: true,
  },
  {
    id: 'study-04',
    title: 'Study IV',
    tradition: TRADITION,
    image: '/artworks/study-04.jpg',
    placement: { surface: 'reveal-north', at: 0 },
    maxWidth: 2.1,
    maxHeight: 1.3,
    frame: 'textile-panel',
    description: PLACEHOLDER_NOTE,
    placeholder: true,
  },
  {
    id: 'study-05',
    title: 'Study V',
    tradition: TRADITION,
    image: '/artworks/study-05.jpg',
    placement: { surface: 'reception-east', at: 1.35, centerHeight: 1.62 },
    maxWidth: 0.75,
    maxHeight: 1.0,
    frame: 'white',
    spotlight: { intensity: 14 },
    description: PLACEHOLDER_NOTE,
    placeholder: true,
  },
]

export function getArtwork(id: string) {
  return ARTWORKS.find((a) => a.id === id)
}
