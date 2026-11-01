/**
 * The site (museum) every server query is scoped to. The hand block printing museum and the clay pavilion
 * share one database: per-site rows carry `site = currentSite().id`, meta keys this site owns go through
 * `metaKey`, and the default exhibition is the site's own. A build is one site (src/site.ts); `runAsSite`
 * lets a test or a script act as the other one inside a single process.
 */
import 'server-only'
import { AsyncLocalStorage } from 'node:async_hooks'
import { SITE } from '../site'

export interface SiteInfo {
  id: string
  defaultExhibitionId: string
  defaultExhibitionTitle: string
  defaultExhibitionSubtitle: string
  liveRoom: string
  metaPrefix: string
}

const store = new AsyncLocalStorage<SiteInfo>()

/** This build's site, or the one `runAsSite` set for the current async context. */
export const currentSite = (): SiteInfo => store.getStore() ?? SITE

/** Shorthand for `currentSite().id` — the value of every `site` column this app writes and filters by. */
export const siteId = (): string => currentSite().id

/** Meta keys are per site by prefix ('' for hand-block, so its keys from before sites stay valid). `version` stays shared. */
export const metaKey = (key: string): string => currentSite().metaPrefix + key

/** Run `fn` as another site (tests, scripts). Everything `fn` awaits sees that site. */
export function runAsSite<T>(site: SiteInfo, fn: () => T): T {
  return store.run(site, fn)
}
