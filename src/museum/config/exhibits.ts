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
import { BAY } from './layout'
import { TRADITION } from './artworks'

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
  region?: string
  description?: string
  placeholder?: boolean
}

const NOTE =
  'Temporary procedural block modelled for layout. It will be replaced by a 3D model of the authentic carved wooden block supplied by the workshop.'

export const EXHIBITS: ExhibitConfig[] = [
  { id: 'block-01', title: 'Printing Block I', tradition: TRADITION, artworkId: 'hero-01', placement: { surface: 'gallery-a-outer', at: BAY.southZ - 1.63 }, placeholderMotif: 'rosette', inkColor: '#2c3f6b', description: NOTE, placeholder: true },
  { id: 'block-02', title: 'Printing Block II', tradition: TRADITION, artworkId: 'hero-02', placement: { surface: 'gallery-a-outer', at: BAY.northZ - 1.85 }, placeholderMotif: 'teardrop', inkColor: '#9b3326', description: NOTE, placeholder: true },
  { id: 'block-03', title: 'Printing Block III', tradition: TRADITION, artworkId: 'hero-03', placement: { surface: 'gallery-b-outer', at: BAY.northZ - 1.7 }, placeholderMotif: 'star-lattice', inkColor: '#b7862f', description: NOTE, placeholder: true },
  { id: 'block-04', title: 'Printing Block IV', tradition: TRADITION, artworkId: 'hero-04', placement: { surface: 'gallery-c-outer', at: BAY.southZ - 1.5 }, placeholderMotif: 'leaf-trail', inkColor: '#2a2522', description: NOTE, placeholder: true },
  { id: 'block-05', title: 'Printing Block V', tradition: TRADITION, artworkId: 'hero-05', placement: { surface: 'gallery-b-partition', at: BAY.northZ + 2.05 }, placeholderMotif: 'diamond', inkColor: '#2c3f6b', description: NOTE, placeholder: true },
]

/** Display table dimensions (brushed timber). */
export const DISPLAY_TABLE = { length: 0.9, depth: 0.55, height: 0.86, wallGap: 0.12 }

export function getExhibit(id: string) {
  return EXHIBITS.find((e) => e.id === id)
}
