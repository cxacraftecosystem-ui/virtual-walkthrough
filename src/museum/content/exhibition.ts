/**
 * Runtime info about the exhibition currently shown (multi-exhibition platform).
 * Deliberately free of config imports (site.ts has none of its own) so config files such as tour.ts
 * can read it without changing module evaluation order: content.ts fills it BEFORE the scene is imported.
 */
import type { TourStop } from '../config/tour'
import { SITE } from '../../site'

export interface ExhibitionInfo {
  id: string
  slug: string
  title: string
  subtitle: string
  status: 'draft' | 'published'
  isDefault: boolean
  theme: { accent?: string }
}

/** This site's own exhibition (src/site.ts); shown until the content API says otherwise. */
export const DEFAULT_EXHIBITION_SLUG: string = SITE.defaultExhibitionId

/** Mutated in place by applyContent(). */
export const CURRENT_EXHIBITION: ExhibitionInfo = {
  id: DEFAULT_EXHIBITION_SLUG,
  slug: DEFAULT_EXHIBITION_SLUG,
  title: SITE.defaultExhibitionTitle,
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
