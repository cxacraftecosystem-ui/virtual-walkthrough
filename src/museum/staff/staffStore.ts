/**
 * Staff mode state: whether the staff dock is open (Shift+S or the HUD button) and whether items
 * still waiting for content are marked in the room. Small on purpose — it ships in every bundle,
 * but nothing reads it unless the signed-in account is curator, admin or master.
 */
import { create } from 'zustand'

const KEY = 'museum.staff.open'

function readOpen(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

interface StaffState {
  open: boolean
  /** Mark every placeholder item of the exhibition with a chip in the view. */
  highlight: boolean
}

export const useStaff = create<StaffState>(() => ({ open: typeof window !== 'undefined' && readOpen(), highlight: false }))

export function setStaffOpen(open: boolean) {
  useStaff.setState({ open })
  try {
    sessionStorage.setItem(KEY, open ? '1' : '0')
  } catch {
    /* storage unavailable */
  }
}

export const toggleStaff = () => setStaffOpen(!useStaff.getState().open)

/** Id of the HUD toggle, so closing the dock can return keyboard focus to it. */
export const STAFF_TOGGLE_ID = 'ui-staff-toggle'
