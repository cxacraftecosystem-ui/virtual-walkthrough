/**
 * "Meet the maker" — artisan profiles (bundled fallback + runtime store).
 *
 * The bundled profiles are PLACEHOLDERS ONLY: no real people are named or described here.
 * Real profiles are supplied by the workshop and entered by curators in the admin (Makers);
 * the server then replaces ARTISANS in place (see content.ts → applyContent).
 * Artworks / exhibits reference a profile with `artisanId`.
 */

export interface Artisan {
  id: string
  name: string
  /** Cluster / region, free text exactly as supplied by the workshop. */
  cluster: string
  craft: string
  bio: string
  /** Portrait image URL (media library or /public). */
  portrait: string
  contact: string
  /** "Visit the maker". */
  website: string
  /** "Buy (fair trade)". */
  shopUrl: string
  /** "Commission". */
  commissionUrl: string
  verified: boolean
  placeholder: boolean
  sort?: number
}

export const PLACEHOLDER_ARTISAN_TEXT = 'Artisan profile — to be supplied by the workshop'

const placeholder = (id: string, n: number): Artisan => ({
  id,
  name: `${PLACEHOLDER_ARTISAN_TEXT} (${n})`,
  cluster: 'To be supplied by the workshop',
  craft: 'Hand block printing',
  bio: `${PLACEHOLDER_ARTISAN_TEXT}. This stand-in card shows where the maker's own words, portrait and links will appear once the workshop has supplied and approved them. No real person is described here.`,
  portrait: '',
  contact: '',
  website: '',
  shopUrl: '',
  commissionUrl: '',
  verified: false,
  placeholder: true,
  sort: n,
})

/** Mutable runtime list (replaced in place by the content API). */
export const ARTISANS: Artisan[] = [placeholder('artisan-placeholder-01', 1), placeholder('artisan-placeholder-02', 2)]

/** Seed links: which bundled items point to which placeholder profile. */
export const SEED_ARTISAN_LINKS: Record<string, Record<string, string>> = {
  artworks: { 'hero-01': 'artisan-placeholder-01', 'hero-02': 'artisan-placeholder-01', 'hero-03': 'artisan-placeholder-02', 'hero-04': 'artisan-placeholder-02', 'hero-05': 'artisan-placeholder-02' },
  exhibits: { 'block-01': 'artisan-placeholder-01', 'block-02': 'artisan-placeholder-01', 'block-03': 'artisan-placeholder-02', 'block-04': 'artisan-placeholder-02', 'block-05': 'artisan-placeholder-02' },
}

export const findArtisan = (id: string | undefined) => (id ? ARTISANS.find((a) => a.id === id) : undefined)

/** Only http(s) links are rendered (no javascript:/data: from content). */
export const safeUrl = (u: string | undefined) => (u && /^https?:\/\//i.test(u.trim()) ? u.trim() : undefined)
