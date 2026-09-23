/**
 * ARTWORK CONTENT — edit this file to add, replace or move artworks.
 *
 * Frames are generated automatically from each image's intrinsic aspect ratio:
 * swap the image file (or `image` path) and the frame, mat and spotlight adapt.
 *
 * Placement: `surface` is a display-surface id from layout.ts and `at` is the
 * world coordinate ALONG that wall (z for side walls, x for the reveal/product walls).
 *
 * v3 hang (62 × 53 m compound). Curatorial rhythm, room by room:
 *   Gallery A/B/C  each 8 m bay: the HERO work + its hand-block table on the perimeter wall,
 *                  a large feature on the island's outer face, a quieter piece on its inner
 *                  face, and the partition side (salon cluster in A-south, a tall panel,
 *                  hero V, a diptych in C).
 *   Craft court    reveal wall = exhibition title + large framed feature painting; a feature
 *                  on the reveal wall's north face behind the rotating centrepiece; a tall
 *                  work + table on the west wall, a 7 m printed runner on the east wall, two
 *                  tall panels flanking the product-wall infographics.
 *   Gallery D      north-wall triptych, two large works on each long wall, one on the south
 *                  wall (the west wall centre is the India map installation — objects.ts).
 *   Atrium / reception  a monumental textile on the atrium west wall; three small studies.
 *
 * PLACEHOLDER STATUS: every image below is a procedurally generated placeholder (see
 * scripts/generate-placeholders.mjs) flagged `placeholder: true` so the UI labels it honestly.
 */

import { COURT_CENTER, BAY } from './layout'
import type { FrameConfig, FrameStyleId } from './frames'
import type { SurfaceId } from './layout'
import { MUSEUM } from './museum'
import type { ContentI18n } from '../i18n/core'

export interface ArtworkConfig {
  id: string
  title: string
  /** Traditional craft style the piece belongs to. */
  tradition: string
  artisan?: string
  /** "Meet the maker" profile id (src/museum/content/artisans.ts / admin → Makers). */
  artisanId?: string
  region?: string
  material?: string
  technique?: string
  year?: string
  description?: string
  context?: string
  /** Public path under /public. Any aspect ratio. */
  image: string
  /**
   * Optional very-high-resolution source for the full-screen "Examine closely" viewer
   * (used when there is no `deepZoom` pyramid; loaded whole, so keep it ≤ ~8k px).
   */
  highRes?: string
  /**
   * Optional Deep Zoom Image pyramid (URL of a .dzi descriptor) for the "Examine closely"
   * viewer — see docs/CONTENT_CAPTURE.md and admin → Capture tools → Deep zoom.
   */
  deepZoom?: string
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
  /** Individual wall label beside the work (default true; salon hangs share one key panel). */
  label?: boolean
  placeholder?: boolean
  metadata?: Record<string, string>
  /** Alternative text describing the image (guide, screen readers). Falls back to the title. */
  alt?: string
  /** Optional Hindi / Bengali overrides of the text fields (UI falls back to English). */
  i18n?: ContentI18n<'title' | 'tradition' | 'artisan' | 'region' | 'material' | 'technique' | 'description' | 'context' | 'alt'>
}

export const TRADITION = 'Hand Block Printing'

const PLACEHOLDER_NOTE =
  'Placeholder image generated for layout and lighting calibration. The final hero textile will be supplied by the workshop and dropped in here without any geometry changes.'
const WORK_NOTE = 'Placeholder image generated for layout and lighting calibration. The final work and its details will be supplied by the workshop.'

type Place = ArtworkConfig['placement']
interface Opts {
  maxWidth: number
  maxHeight: number
  frame: FrameConfig | FrameStyleId
  hero?: boolean
  exhibitId?: string
  label?: boolean
  spotlight?: ArtworkConfig['spotlight']
}
/** Compact constructor for a placeholder work. */
function work(id: string, title: string, image: string, placement: Place, o: Opts): ArtworkConfig {
  return {
    id,
    title,
    tradition: TRADITION,
    image: `/artworks/${image}.jpg`,
    placement,
    description: o.hero ? PLACEHOLDER_NOTE : WORK_NOTE,
    placeholder: true,
    // hero placeholders ship with generated deep-zoom pyramids (scripts/generate-deepzoom.mjs)
    ...(o.hero ? { deepZoom: `/deepzoom/${image}/image.dzi` } : {}),
    ...o,
  }
}

const S = BAY.southZ // -4.5  (south bays A-south / C)
const N = BAY.northZ // -13.5 (north bays A-north / B)
const CZ = COURT_CENTER.z
const GD = MUSEUM.wings.galleryD
const GDX = (GD.minX + GD.maxX) / 2
/** Salon studies share one wide wash from the centre study's fixture (no scalloped pools). */
const SALON_WASHED = { enabled: false }
const salon = (dz: number, cy: number): Place => ({ surface: 'gallery-a-partition', at: S + dz, centerHeight: cy })

export const ARTWORKS: ArtworkConfig[] = [
  // ══ Gallery A — south bay ═════════════════════════════════════════
  work('hero-01', 'Hero Textile I', 'hero-01', { surface: 'gallery-a-outer', at: S, centerHeight: 1.75 }, { hero: true, maxWidth: 1.75, maxHeight: 2.3, frame: 'natural-wood', exhibitId: 'block-01' }),
  work('feature-04', 'Printed Length — Feature', 'feature-04', { surface: 'island-a-south-outer', at: S, centerHeight: 1.65 }, { maxWidth: 2.6, maxHeight: 2.2, frame: 'dark-wood' }),
  work('study-04', 'Study IV', 'study-04', { surface: 'island-a-south-inner', at: S + 0.2 }, { maxWidth: 2.2, maxHeight: 1.4, frame: 'textile-panel' }),
  // salon hang (labels gathered on the key panel 'info-salon')
  work('salon-01', 'Salon Study I', 'study-02', salon(0, 1.75), { maxWidth: 1.0, maxHeight: 1.0, frame: 'natural-wood', label: false, spotlight: { spread: 2.3, intensity: 20 } }),
  work('salon-02', 'Salon Study II', 'study-07', salon(1.1, 2.05), { maxWidth: 0.62, maxHeight: 0.85, frame: 'thin-black', label: false, spotlight: SALON_WASHED }),
  work('salon-03', 'Salon Study III', 'study-10', salon(1.1, 1.12), { maxWidth: 0.8, maxHeight: 0.62, frame: 'white', label: false, spotlight: SALON_WASHED }),
  work('salon-04', 'Salon Study IV', 'study-05', salon(-1.1, 2.05), { maxWidth: 0.55, maxHeight: 0.8, frame: 'brass-slim', label: false, spotlight: SALON_WASHED }),
  work('salon-05', 'Salon Study V', 'study-08', salon(-1.1, 1.12), { maxWidth: 0.7, maxHeight: 0.7, frame: 'dark-wood', label: false, spotlight: SALON_WASHED }),
  work('salon-06', 'Salon Study VI', 'study-06', salon(-1.98, 1.6), { maxWidth: 0.6, maxHeight: 0.6, frame: 'thin-black', label: false, spotlight: SALON_WASHED }),
  work('salon-07', 'Salon Study VII', 'study-01', salon(1.98, 1.6), { maxWidth: 0.5, maxHeight: 0.66, frame: 'white', label: false, spotlight: SALON_WASHED }),

  // ══ Gallery A — north bay (door to Gallery D in the perimeter wall at z −16.2) ═══
  work('hero-02', 'Hero Textile II', 'hero-02', { surface: 'gallery-a-outer', at: N + 2.5, centerHeight: 1.65 }, { hero: true, maxWidth: 2.4, maxHeight: 1.7, frame: 'natural-wood', exhibitId: 'block-02' }),
  work('feature-03', 'Printed Panel — Feature', 'feature-03', { surface: 'island-a-north-outer', at: N, centerHeight: 1.72 }, { maxWidth: 1.9, maxHeight: 2.6, frame: 'float-walnut' }),
  work('study-03', 'Study III', 'study-03', { surface: 'island-a-north-inner', at: N + 0.2 }, { maxWidth: 1.3, maxHeight: 1.1, frame: 'natural-wood' }),
  work('panel-01', 'Tall Panel I', 'panel-01', { surface: 'gallery-a-partition', at: N, centerHeight: 1.8 }, { maxWidth: 1.05, maxHeight: 2.5, frame: 'textile-panel' }),

  // ══ Gallery B — north-east bay (door to the courtyard at z −16.2) ═══
  work('hero-03', 'Hero Textile III', 'hero-03', { surface: 'gallery-b-outer', at: N + 2.1, centerHeight: 1.65 }, { hero: true, maxWidth: 1.9, maxHeight: 1.9, frame: 'dark-wood', exhibitId: 'block-03' }),
  work('feature-02', 'Resist-dyed Length — Feature', 'feature-02', { surface: 'island-b-outer', at: N + 0.2, centerHeight: 1.65 }, { maxWidth: 2.6, maxHeight: 2.1, frame: 'thin-black' }),
  work('study-13', 'Study XIII', 'study-13', { surface: 'island-b-inner', at: N - 0.1 }, { maxWidth: 1.0, maxHeight: 1.3, frame: 'white' }),
  work('hero-05', 'Hero Textile V', 'hero-05', { surface: 'gallery-b-partition', at: N, centerHeight: 1.6 }, { hero: true, maxWidth: 3.0, maxHeight: 1.3, frame: 'thin-black', exhibitId: 'block-05' }),

  // ══ Gallery C — south-east bay ═════════════════════════════════════
  work('hero-04', 'Hero Textile IV', 'hero-04', { surface: 'gallery-c-outer', at: S, centerHeight: 1.75 }, { hero: true, maxWidth: 1.2, maxHeight: 2.7, frame: 'textile-panel', exhibitId: 'block-04' }),
  work('feature-05', 'Printed Panel — Feature', 'feature-05', { surface: 'island-c-outer', at: S + 0.2, centerHeight: 1.7 }, { maxWidth: 1.9, maxHeight: 2.3, frame: 'brass-slim' }),
  work('study-09', 'Study IX', 'study-09', { surface: 'island-c-inner', at: S }, { maxWidth: 1.1, maxHeight: 1.45, frame: 'white' }),
  work('study-14', 'Diptych — upper', 'study-14', { surface: 'gallery-c-partition', at: S, centerHeight: 2.2 }, { maxWidth: 1.3, maxHeight: 0.95, frame: 'dark-wood' }),
  work('study-15', 'Diptych — lower', 'study-15', { surface: 'gallery-c-partition', at: S, centerHeight: 1.1 }, { maxWidth: 1.3, maxHeight: 0.95, frame: 'dark-wood' }),

  // ══ Craft court ════════════════════════════════════════════════════
  // reveal wall arrival face: title vinyl on the left third (WallGraphics), painting on the right
  work('feature-01', 'The Reveal — Feature Painting', 'feature-01', { surface: 'reveal-south', at: 1.45, centerHeight: 1.95 }, { maxWidth: 3.7, maxHeight: 2.75, frame: 'dark-wood' }),
  work('feature-06', 'Court Feature', 'feature-06', { surface: 'reveal-north', at: 0, centerHeight: 1.95 }, { maxWidth: 4.0, maxHeight: 2.6, frame: 'natural-wood' }),
  work('feature-07', 'Standing Panel — Feature', 'feature-07', { surface: 'court-west', at: CZ, centerHeight: 2.1 }, { maxWidth: 2.3, maxHeight: 3.1, frame: 'dark-wood', exhibitId: 'block-06' }),
  work('runner-01', 'Printed Runner', 'runner-01', { surface: 'court-east', at: CZ, centerHeight: 1.75 }, { maxWidth: 7.2, maxHeight: 1.4, frame: 'textile-panel', exhibitId: 'block-07', spotlight: { spread: 1.15 } }),
  work('panel-02', 'Tall Panel II', 'panel-02', { surface: 'product-wall', at: -7.3, centerHeight: 1.95 }, { maxWidth: 1.2, maxHeight: 2.8, frame: 'textile-panel' }),
  work('panel-03', 'Tall Panel III', 'panel-03', { surface: 'product-wall', at: 7.3, centerHeight: 1.95 }, { maxWidth: 1.2, maxHeight: 2.8, frame: 'textile-panel' }),

  // ══ Gallery D — regional gallery ═══════════════════════════════════
  work('tri-01', 'Triptych — I', 'tri-01', { surface: 'gallery-d-north', at: GDX - 4.25, centerHeight: 2.35 }, { maxWidth: 1.5, maxHeight: 3.3, frame: 'textile-panel' }),
  work('tri-02', 'Triptych — II', 'tri-02', { surface: 'gallery-d-north', at: GDX, centerHeight: 2.35 }, { maxWidth: 1.5, maxHeight: 3.3, frame: 'textile-panel' }),
  work('tri-03', 'Triptych — III', 'tri-03', { surface: 'gallery-d-north', at: GDX + 4.25, centerHeight: 2.35 }, { maxWidth: 1.5, maxHeight: 3.3, frame: 'textile-panel' }),
  work('feature-08', 'Regional Feature I', 'feature-08', { surface: 'gallery-d-west', at: -27.4, centerHeight: 2.0 }, { maxWidth: 3.2, maxHeight: 2.4, frame: 'dark-wood', exhibitId: 'block-08' }),
  work('feature-09', 'Regional Feature II', 'feature-09', { surface: 'gallery-d-west', at: -6.0, centerHeight: 2.0 }, { maxWidth: 2.2, maxHeight: 2.8, frame: 'float-walnut' }),
  work('feature-10', 'Regional Feature III', 'feature-10', { surface: 'gallery-d-east', at: -27.0, centerHeight: 2.0 }, { maxWidth: 3.2, maxHeight: 2.4, frame: 'natural-wood', exhibitId: 'block-09' }),
  work('feature-11', 'Regional Feature IV', 'feature-11', { surface: 'gallery-d-east', at: -7.0, centerHeight: 1.95 }, { maxWidth: 2.0, maxHeight: 2.7, frame: 'textile-panel' }),
  work('feature-12', 'Regional Feature V', 'feature-12', { surface: 'gallery-d-south', at: -24.5, centerHeight: 1.9 }, { maxWidth: 3.6, maxHeight: 2.2, frame: 'dark-wood' }),

  // ══ Grand Atrium & reception ═══════════════════════════════════════
  work('feature-13', 'Monumental Textile', 'feature-13', { surface: 'atrium-west', at: 12.0, centerHeight: 4.6 }, { maxWidth: 6.0, maxHeight: 3.8, frame: 'textile-panel', label: false }),
  work('study-11', 'Study XI', 'study-11', { surface: 'reception-west', at: 1.6, centerHeight: 1.55 }, { maxWidth: 0.8, maxHeight: 1.0, frame: 'thin-black', spotlight: { intensity: 14 } }),
  work('study-16', 'Study XVI', 'study-16', { surface: 'reception-west', at: 7.05, centerHeight: 1.55 }, { maxWidth: 0.72, maxHeight: 0.95, frame: 'white', spotlight: { intensity: 14 } }),
  work('study-12', 'Study XII', 'study-12', { surface: 'reception-east', at: 1.5, centerHeight: 1.55 }, { maxWidth: 1.0, maxHeight: 0.8, frame: 'brass-slim', spotlight: { intensity: 14 } }),
]

export function getArtwork(id: string) {
  return ARTWORKS.find((a) => a.id === id)
}
