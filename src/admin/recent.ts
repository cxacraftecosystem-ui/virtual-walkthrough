/**
 * "Continue where you left off": the last items a curator edited, kept in this browser only
 * (localStorage `museum.admin.recent`, per exhibition, newest first, at most 12 kept, 5 shown on
 * the home page). The item editor calls `recordRecent({ tab, id, title }, exhibitionId)` after opening or
 * saving an item; the home page reads `readRecent(exhibitionId)`.
 *
 * Entries carry the exhibition's id, never the selection '' ("the default"): the default can move to another
 * exhibition with the same item ids, and the list must not follow it there. Entries written before this
 * (exhibition '') are dropped, since which exhibition they meant is no longer known.
 */

export interface RecentItem {
  /** Content tab / collection id, e.g. 'artworks'. */
  tab: string
  id: string
  title: string
  /** The exhibition's id. */
  exhibition: string
  at: string
}

const KEY = 'museum.admin.recent'
const MAX = 12
export const RECENT_CHANGED = 'museum-admin:recent'

function load(): RecentItem[] {
  try {
    const raw = window.localStorage.getItem(KEY)
    const v: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(v)
      ? v.filter(
          (x): x is RecentItem =>
            !!x && typeof x === 'object' && typeof (x as RecentItem).id === 'string' && typeof (x as RecentItem).tab === 'string' && typeof (x as RecentItem).exhibition === 'string' && !!(x as RecentItem).exhibition,
        )
      : []
  } catch {
    return []
  }
}

/** `exhibition`: the exhibition's id (null when unknown: nothing is recorded). */
export function recordRecent(item: { tab: string; id: string; title?: string }, exhibition: string | null) {
  if (typeof window === 'undefined' || !item.id || !exhibition) return
  const entry: RecentItem = { tab: item.tab, id: item.id, title: item.title?.trim() || item.id, exhibition, at: new Date().toISOString() }
  const next = [entry, ...load().filter((r) => !(r.tab === entry.tab && r.id === entry.id && r.exhibition === exhibition))].slice(0, MAX)
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* storage blocked: nothing to remember */
  }
  window.dispatchEvent(new Event(RECENT_CHANGED))
}

/** Recent items, newest first; `exhibition` (an id) filters to one exhibition, and '' or null (not known yet) gives none. */
export function readRecent(exhibition?: string | null, limit = 5): RecentItem[] {
  if (typeof window === 'undefined') return []
  const all = load()
  if (exhibition === undefined) return all.slice(0, limit)
  return exhibition ? all.filter((r) => r.exhibition === exhibition).slice(0, limit) : []
}

/** Drop an entry (e.g. the item was deleted): in exhibition `exhibition` (an id), or in every exhibition when it is not known. */
export function forgetRecent(tab: string, id: string, exhibition?: string | null) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(KEY, JSON.stringify(load().filter((r) => !(r.tab === tab && r.id === id && (!exhibition || r.exhibition === exhibition)))))
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(RECENT_CHANGED))
}
