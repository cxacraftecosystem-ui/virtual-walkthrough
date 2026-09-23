/**
 * Runtime info about the exhibition currently shown (multi-exhibition platform).
 * Deliberately import-free (no config modules) so config files such as tour.ts can read it
 * without changing module evaluation order: content.ts fills it BEFORE the scene is imported.
 */
import type { TourStop } from '../config/tour'

export interface ExhibitionInfo {
  id: string
  slug: string
  title: string
  subtitle: string
  status: 'draft' | 'published'
  isDefault: boolean
  theme: { accent?: string }
}

export const DEFAULT_EXHIBITION_SLUG = 'hand-block-printing'

/** Mutated in place by applyContent(). */
export const CURRENT_EXHIBITION: ExhibitionInfo = {
  id: DEFAULT_EXHIBITION_SLUG,
  slug: DEFAULT_EXHIBITION_SLUG,
  title: 'Hand Block Printing',
  subtitle: '',
  status: 'published',
  isDefault: true,
  theme: {},
}

/** Tour-stop override from the server (null = keep the bundled TOUR_STOPS). Read by config/tour.ts. */
export const TOUR_OVERRIDE: { stops: TourStop[] | null } = { stops: null }

export const isHexColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)

/** Path of an exhibition in the museum ('/gallery' for the default one, else /gallery/<slug>). */
export const exhibitionPath = (e: Pick<ExhibitionInfo, 'slug' | 'isDefault'>) => (e.isDefault ? '/gallery' : `/gallery/${encodeURIComponent(e.slug)}`)
