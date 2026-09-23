/**
 * WebXR stores (@react-three/xr v6) + feature detection.
 *
 *  vrStore — the museum canvas: immersive-vr at 1:1 (local-floor). Default controller/hand models
 *            are rendered, but every pmndrs pointer is off: locomotion and selection are our own
 *            (VRRig), so XR input never reaches the desktop R3F click handlers.
 *  arStore — a small dedicated canvas (ARView) for immersive-ar placement with hit-test.
 *
 * `emulate: false` — never inject the IWER emulator on localhost (it would make navigator.xr
 * appear on every desktop); `offerSession: false` — no automatic browser session offers.
 */
import { createXRStore } from '@react-three/xr'
import { create } from 'zustand'

const noPointers = { rayPointer: false, grabPointer: false, teleportPointer: false } as const

/** Dev only: `?xremulate` injects the IWER Meta Quest 3 emulator (localhost) to test VR on a desktop. */
const emulate =
  process.env.NODE_ENV !== 'production' && typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('xremulate')
    ? ({ type: 'metaQuest3', syntheticEnvironment: false } as const)
    : false

export const vrStore = createXRStore({
  emulate,
  offerSession: false,
  enterGrantedSession: false,
  controller: { ...noPointers },
  hand: { ...noPointers, touchPointer: false },
  transientPointer: false,
  gaze: false,
  screenInput: false,
  frameRate: 'high',
  foveation: 1,
  hitTest: false,
  anchors: false,
  planeDetection: false,
  meshDetection: false,
  domOverlay: false,
  layers: false,
})

export const arStore = createXRStore({
  emulate: false,
  offerSession: false,
  enterGrantedSession: false,
  controller: false,
  hand: false,
  transientPointer: false,
  gaze: false,
  screenInput: false,
  hitTest: true,
  domOverlay: true,
  anchors: false,
  planeDetection: false,
  meshDetection: false,
  layers: false,
  handTracking: false,
})

/** Which immersive session is running (the museum pauses post-processing etc. while in one). */
export const useXRMode = create<{ mode: 'vr' | 'ar' | null; set: (m: 'vr' | 'ar' | null) => void }>((set) => ({
  mode: null,
  set: (mode) => set({ mode }),
}))

vrStore.subscribe((s, p) => {
  if (s.session !== p.session) useXRMode.getState().set(s.session ? 'vr' : null)
})
arStore.subscribe((s, p) => {
  if (s.session !== p.session) useXRMode.getState().set(s.session ? 'ar' : null)
})

const supportCache = new Map<XRSessionMode, Promise<boolean>>()

/** navigator.xr.isSessionSupported, cached; false (never throws) without WebXR / insecure origins. */
export function xrSupported(mode: XRSessionMode): Promise<boolean> {
  let p = supportCache.get(mode)
  if (!p) {
    p = (async () => {
      try {
        if (emulate) await new Promise((r) => setTimeout(r, 2500)) // emulator installs asynchronously
        if (typeof navigator === 'undefined' || !navigator.xr || !window.isSecureContext) return false
        return await navigator.xr.isSessionSupported(mode)
      } catch {
        return false
      }
    })()
    supportCache.set(mode, p)
  }
  return p
}

/** iOS / iPadOS Safari AR Quick Look (<a rel="ar">) support. */
export function quickLookSupported() {
  if (typeof document === 'undefined') return false
  try {
    return document.createElement('a').relList.supports('ar')
  } catch {
    return false
  }
}

// automation handle for the dev emulator (scripts/xr-emulator-test.mjs)
if (emulate) (window as unknown as { __xr?: unknown }).__xr = { vrStore, arStore, useXRMode }
