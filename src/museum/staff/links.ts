/**
 * Staff-mode basics shared by the always-loaded gate (StaffGate.tsx) and the lazily loaded tools
 * (StaffMode.tsx). Kept tiny, with no runtime imports: it ships in every visitor's bundle.
 */
import type { SelectionKind } from '../state/store'

/** Roles that see the staff tools (the same set that may host a live tour, src/museum/live/LivePanel.tsx). */
const STAFF_ROLES: ReadonlySet<string> = new Set(['curator', 'admin', 'master'])
export const isStaffRole = (role: string | null | undefined): boolean => !!role && STAFF_ROLES.has(role)

/** Admin content tab (src/admin/pages/ContentPage.tsx `#/content/<tab>/<id>`) for each item kind. */
export const ADMIN_TAB: Record<SelectionKind, string> = {
  artwork: 'artworks',
  exhibit: 'exhibits',
  infographic: 'infographics',
  video: 'videos',
  object: 'objects',
}

export const adminEditHref = (kind: SelectionKind, id: string) => `/admin#/content/${ADMIN_TAB[kind]}/${encodeURIComponent(id)}`

/** The admin keeps the exhibition it edits here (src/admin/exhibitionsApi.ts); '' = the default one. */
const ADMIN_EXHIBITION_KEY = 'museum.admin.exhibition'

/** Point the admin at the exhibition shown in the museum, so "Edit in admin" opens the right item. */
export function selectAdminExhibition(id: string) {
  try {
    localStorage.setItem(ADMIN_EXHIBITION_KEY, id)
  } catch {
    /* storage unavailable: the admin opens its last exhibition */
  }
}
