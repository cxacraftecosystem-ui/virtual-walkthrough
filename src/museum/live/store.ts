/**
 * Live presence / tour state.
 *  • `useLive` (zustand) — everything the HTML UI renders (low-frequency).
 *  • `peers` (mutable Map) — per-frame avatar data written by the realtime session and read by
 *    the R3F PresenceLayer on rAF (never React state).
 */
import { create } from 'zustand'

export type LiveStatus = 'off' | 'connecting' | 'online' | 'reconnecting' | 'unavailable'

export interface Peer {
  id: string
  name: string
  /** Latest received position/yaw (targets) … */
  tx: number
  tz: number
  tyaw: number
  /** … and the smoothed values the avatar is drawn at. */
  x: number
  z: number
  yaw: number
  has: boolean
  lastT: number
  hand: boolean
  /** Verified docent of this tour id (set only after signature/token verification). */
  docentOf: string | null
  /** Tour the peer claims to have joined (display only). */
  joined: string | null
}

export const peers = new Map<string, Peer>()

export interface PublicTour {
  tourId: string
  name: string
  docentId: string
  /** Docent disconnected (waiting for reconnect). */
  lost: boolean
}

export interface ChatMsg {
  mid: string
  from: string
  name: string
  text: string
  t: number
  /** Verified docent message. */
  docent: boolean
}

export interface Focus {
  kind: string
  id: string
  title: string
}

export interface Toast {
  id: number
  text: string
}

interface LiveState {
  status: LiveStatus
  selfId: string
  selfName: string
  peerCount: number
  /** Verified live tours currently running in this room. */
  tours: Record<string, PublicTour>
  dismissed: string[]
  joined: string | null
  following: boolean
  /** Self is the docent of this tour. */
  hosting: string | null
  hostingStarting: boolean
  chat: ChatMsg[]
  muted: string[]
  selfMuted: boolean
  handRaised: boolean
  /** Hands raised in the tour I host. */
  hands: { id: string; name: string }[]
  followers: number
  focus: Focus | null
  chatOpen: boolean
  toast: Toast | null
  set: (p: Partial<LiveState>) => void
}

export const useLive = create<LiveState>((set) => ({
  status: 'off',
  selfId: '',
  selfName: '',
  peerCount: 0,
  tours: {},
  dismissed: [],
  joined: null,
  following: true,
  hosting: null,
  hostingStarting: false,
  chat: [],
  muted: [],
  selfMuted: false,
  handRaised: false,
  hands: [],
  followers: 0,
  focus: null,
  chatOpen: true,
  toast: null,
  set: (p) => set(p),
}))

let toastSeq = 0
export function liveToast(text: string) {
  useLive.getState().set({ toast: { id: ++toastSeq, text } })
}

/** Soft dye-inspired palette for visitor silhouettes (indigo, madder, turmeric, leaf, rust …). */
const PALETTE = ['#7d8fc4', '#c98a7d', '#d9b45a', '#8fb08a', '#b98cb4', '#78b3b5', '#d19a66', '#a3a0d6']
export function peerColor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return PALETTE[Math.abs(h) % PALETTE.length]
}
export const DOCENT_COLOR = '#f2c46d'
