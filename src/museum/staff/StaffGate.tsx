/**
 * The only staff code in the visitor bundle: three components that render nothing unless the
 * signed-in account is curator, admin or master. The tools themselves (StaffMode.tsx, its styles
 * and its geometry) are a separate chunk fetched the first time a staff account is seen.
 */
import { lazy, Suspense } from 'react'
import { CURRENT_EXHIBITION } from '../content/exhibition'
import { useMuseum, type Selection } from '../state/store'
import { adminEditHref, isStaffRole, selectAdminExhibition } from './links'
import { STAFF_TOGGLE_ID, toggleStaff, useStaff } from './staffStore'

const StaffMode = lazy(() => import('./StaffMode').then((m) => ({ default: m.StaffMode })))

const useIsStaff = () => useMuseum((s) => isStaffRole(s.user?.role))

/** Mounted once in the overlay (src/museum/ui/UIOverlay.tsx). */
export function StaffLayer() {
  const staff = useIsStaff()
  if (!staff) return null
  return (
    <Suspense fallback={null}>
      <StaffMode />
    </Suspense>
  )
}

function IconStaff() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" />
      <path d="M13.5 6.5l4 4" />
      <path d="M14 20h6" />
    </svg>
  )
}

/** HUD control (staff only): opens and closes the staff dock, like Shift+S. */
export function StaffHudButton() {
  const staff = useIsStaff()
  const open = useStaff((s) => s.open)
  if (!staff) return null
  return (
    <button
      id={STAFF_TOGGLE_ID}
      type="button"
      className="ui-icon-btn"
      aria-label={open ? 'Close staff tools' : 'Open staff tools'}
      data-tip="Staff tools (Shift+S)"
      aria-pressed={open}
      aria-keyshortcuts="Shift+S"
      onClick={toggleStaff}
    >
      <IconStaff />
    </button>
  )
}

/** "Edit in admin" at the top of the item panel (staff, while the staff tools are open — their styles load with them). */
export function StaffEditLink({ selection, tabIndex }: { selection: Selection | null; tabIndex?: number }) {
  const staff = useIsStaff()
  const open = useStaff((s) => s.open)
  if (!staff || !open || !selection) return null
  return (
    <p className="staff-edit">
      <a
        className="ui-btn ui-btn--ghost ui-btn--sm staff-btn"
        href={adminEditHref(selection.kind, selection.id)}
        target="_blank"
        rel="noopener"
        aria-label="Edit in admin (opens a new tab)"
        tabIndex={tabIndex}
        onClick={() => selectAdminExhibition(CURRENT_EXHIBITION.id)}
      >
        <IconStaff />
        Edit in admin
      </a>
      <code className="staff-code">{selection.id}</code>
    </p>
  )
}
