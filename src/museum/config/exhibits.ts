/**
 * HAND-BLOCK EXHIBITS — 3D craft objects on display tables beside their artworks.
 *
 * RAW CRAFT TOOL (carved block)  →  PROCESS (impression swatch)  →  FINISHED TEXTILE (artwork)
 *
 * To use a real scanned/modelled block, drop a GLB into /public/models and set `model`.
 * If `model` is omitted or fails to load, a clearly-labelled procedural placeholder
 * block is generated using `placeholderMotif` (the same motif as the placeholder textile).
 */

import type { SurfaceId } from './layout'
import { BAY, COURT_CENTER } from './layout'
import { TRADITION } from './artworks'
import type { ContentI18n } from '../i18n/core'

export type MotifId = 'rosette' | 'teardrop' | 'star-lattice' | 'leaf-trail' | 'diamond'

export interface ExhibitConfig {
  id: string
  title: string
  tradition: string
  /** Artwork this block relates to. */
  artworkId: string
  placement: {
    surface: SurfaceId
    /** Coordinate along the wall (see artworks.ts). */
    at: number
  }
  /** GLB/GLTF under /public/models. Optional. */
  model?: string
  /** Uniform scale applied to the GLB (models should be authored in metres). */
  modelScale?: number
  /** Placeholder generation (used when `model` is missing). */
  placeholderMotif: MotifId
  /** Carved face size of the placeholder block (m). */
  placeholderSize?: [number, number]
  /** Ink colour used for the impression swatch beside the block. */
  inkColor: string
  material?: string
  technique?: string
  artisan?: string
  /** "Meet the maker" profile id (src/museum/content/artisans.ts / admin → Makers). */
  artisanId?: string
  region?: string
  description?: string
  placeholder?: boolean
  /** Alternative text describing the block (guide, screen readers). */
  alt?: string
  /** Optional Hindi / Bengali overrides of the text fields. */
  i18n?: ContentI18n<'title' | 'tradition' | 'artisan' | 'region' | 'material' | 'technique' | 'description' | 'alt'>
}

const NOTE =
  'Temporary procedural block modelled for layout. It will be replaced by a 3D model of the authentic carved wooden block supplied by the workshop.'

/** v3: one table beside each hero work, plus the court features and two Gallery D works. */
const CZ = COURT_CENTER.z
const S = BAY.southZ
const N = BAY.northZ
const ex = (id: string, title: string, artworkId: string, surface: SurfaceId, at: number, placeholderMotif: MotifId, inkColor: string): ExhibitConfig => ({
  id,
  title,
  tradition: TRADITION,
  artworkId,
  placement: { surface, at },
  placeholderMotif,
  inkColor,
  description: NOTE,
  placeholder: true,
})

export const EXHIBITS: ExhibitConfig[] = [
  ex('block-01', 'Printing Block I', 'hero-01', 'gallery-a-outer', S + 1.78, 'rosette', '#2c3f6b'),
  ex('block-02', 'Printing Block II', 'hero-02', 'gallery-a-outer', N + 0.4, 'teardrop', '#9b3326'),
  ex('block-03', 'Printing Block III', 'hero-03', 'gallery-b-outer', N + 0.25, 'star-lattice', '#b7862f'),
  ex('block-04', 'Printing Block IV', 'hero-04', 'gallery-c-outer', S - 1.46, 'leaf-trail', '#2a2522'),
  ex('block-05', 'Printing Block V', 'hero-05', 'gallery-b-partition', N + 2.39, 'diamond', '#2c3f6b'),
  ex('block-06', 'Printing Block VI', 'feature-07', 'court-west', CZ + 2.05, 'teardrop', '#2c3f6b'),
  ex('block-07', 'Printing Block VII', 'runner-01', 'court-east', CZ + 4.5, 'rosette', '#9b3326'),
  ex('block-08', 'Printing Block VIII', 'feature-08', 'gallery-d-west', -25.0, 'star-lattice', '#1f2d4f'),
  ex('block-09', 'Printing Block IX', 'feature-10', 'gallery-d-east', -29.5, 'leaf-trail', '#7d2a20'),
]

/** Display table dimensions (brushed timber). */
export const DISPLAY_TABLE = { length: 0.9, depth: 0.55, height: 0.86, wallGap: 0.12 }

export function getExhibit(id: string) {
  return EXHIBITS.find((e) => e.id === id)
}
