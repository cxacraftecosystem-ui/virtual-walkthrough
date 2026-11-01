/**
 * Which museum this build is. The hand block printing museum and the clay pavilion are two apps that share one
 * Postgres database and one S3 bucket; every per-site row carries `site = SITE.id`, so each app sees only its own
 * exhibitions, makers, media, prints, comments, analytics and errors. Users, sessions and the access list are shared,
 * so staff keep one login and one role across both. This file is the only one that differs between the two repos
 * by design — keep its shape identical in both.
 */
export const SITE = {
  /** Database discriminator. Rows written before sites existed belong to 'hand-block'. */
  id: 'hand-block',
  /** The exhibition this site creates and opens at /gallery when nothing else is default. Ids are global. */
  defaultExhibitionId: 'hand-block-printing',
  defaultExhibitionTitle: 'Hand Block Printing',
  defaultExhibitionSubtitle: 'Carved wood, natural dye and cloth',
  /** Supabase Realtime presence room; must match ^[a-z0-9][a-z0-9-]{0,63}$ and differ between the two sites. */
  liveRoom: 'hand-block-printing',
  /** Prefix for meta keys this site owns ('' keeps the keys written before sites existed). */
  metaPrefix: '',
  name: 'Hand Block Printing — Virtual Museum',
  shortName: 'Hand Block Museum',
  /** File-name stem for downloads (photos, exports). */
  fileStem: 'hand-block-printing',
} as const

export type SiteId = 'hand-block' | 'clay'
