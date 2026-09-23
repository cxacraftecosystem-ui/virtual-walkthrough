/**
 * CINEMATIC ARRIVAL — after "Enter Exhibition", a ~11 s drone-style flight: high over the
 * forecourt and lawns with the cuboid roof and its roof lights below, a swoop down to the
 * glazed atrium facade, then a glide through the entrance into the visitor's start pose.
 *
 *  • Only on the first entry of a browser session (sessionStorage), never with ?autostart,
 *    never with prefers-reduced-motion, and not when the guided tour is starting.
 *  • Skippable: any key, click/tap, wheel, or the "Skip" button (ArrivalOverlay).
 *  • Camera only: the visitor is frozen at the start pose during the flight (zone culling,
 *    accent spots and shadows are already set up for the atrium), so the hand-over is seamless.
 *
 * Mount right AFTER <VisitorController> so this frame callback overrides its camera pose.
 */
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { create } from 'zustand'
import { MUSEUM } from '../config/museum'
import { useMuseum } from '../state/store'
import { visitor } from '../state/visitor'
import { useTour } from '../tour/engine'
import { setCullingOverride } from './zoneCulling'

export const ARRIVAL_SECONDS = 11
const SESSION_KEY = 'museum.arrival'

export interface ArrivalState {
  /** Flight running. */
  active: boolean
  /** 0..1 progress (UI: letterbox + title timing). */
  t: number
  /** Skip requested — the overlay dips to black, then the flight ends. */
  skipping: boolean
}

export const useArrival = create<ArrivalState>(() => ({ active: false, t: 0, skipping: false }))

const SKIP_DIP_MS = 320

export function skipArrival() {
  const s = useArrival.getState()
  if (!s.active || s.skipping) return
  useArrival.setState({ skipping: true })
  window.setTimeout(() => endArrival(), SKIP_DIP_MS)
}

function endArrival() {
  setCullingOverride(false)
  if (!useArrival.getState().active) return
  visitor.frozen = false
  useArrival.setState({ active: false, skipping: false, t: 1 })
}

let suppressed = false
/** Skip the arrival flight for the next entry (e.g. the visitor chose the guided tour). */
export function suppressArrival() {
  suppressed = true
}

function shouldFly() {
  if (typeof window === 'undefined') return false
  if (suppressed) {
    suppressed = false
    return false
  }
  const q = new URLSearchParams(window.location.search)
  if (q.has('autostart') || q.has('tour') || q.has('noarrival')) return false
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false
  const st = useMuseum.getState()
  if (st.reducedMotion) return false
  // Low tier / touch devices: drawing every room at once risks stalls and context loss.
  if (st.tier === 'low' || window.matchMedia?.('(pointer: coarse)').matches) return false
  try {
    if (sessionStorage.getItem(SESSION_KEY)) return false
    sessionStorage.setItem(SESSION_KEY, '1')
  } catch {
    /* storage blocked: fly once per page load */
  }
  return true
}

const V = MUSEUM.visitor
const EYE = V.eyeHeight
const S = V.start
const DEG = Math.PI / 180

export function ArrivalFlight() {
  const camera = useThree((s) => s.camera)

  const path = useMemo(() => {
    // Final look target lies along the visitor's start view direction (yaw 0 = north, pitch up).
    const fx = -Math.sin(-S.yawDeg * DEG)
    const fz = -Math.cos(-S.yawDeg * DEG)
    const end = new THREE.Vector3(S.x, EYE, S.z)
    const endLook = end.clone().add(new THREE.Vector3(fx * 10, Math.tan(S.pitchDeg * DEG) * 10, fz * 10))
    const facadeZ = MUSEUM.wings.atrium.maxZ
    const pos = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(-58, 46, facadeZ + 58), // high over the lawns, south-west
        new THREE.Vector3(-24, 37, facadeZ + 32),
        new THREE.Vector3(14, 25, facadeZ + 26), // banking east, the roof lights below
        new THREE.Vector3(9, 9.5, facadeZ + 15), // swoop down toward the facade
        new THREE.Vector3(1.5, 3.1, facadeZ + 6.5),
        new THREE.Vector3(0, EYE + 0.35, facadeZ + 1.8), // gliding through the entrance
        end,
      ],
      false,
      'centripetal',
    )
    const look = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(0, 4, -8),
        new THREE.Vector3(0, 4, -8),
        new THREE.Vector3(0, 5, 2),
        new THREE.Vector3(0, 4, facadeZ - 4),
        new THREE.Vector3(0, 2.6, facadeZ - 6),
        new THREE.Vector3(0, EYE + 0.2, facadeZ - 8),
        endLook,
      ],
      false,
      'centripetal',
    )
    return { pos, look }
  }, [])

  // Start on entry.
  useEffect(() => {
    const start = () => {
      if (!shouldFly()) return
      visitor.frozen = true
      useArrival.setState({ active: true, t: 0, skipping: false })
    }
    if (useMuseum.getState().phase === 'entered') return
    return useMuseum.subscribe((s, p) => {
      if (s.phase === 'entered' && p.phase !== 'entered') start()
    })
  }, [])

  // Skip on any input; the tour or a tier change (canvas remount) also ends it.
  useEffect(
    () =>
      useArrival.subscribe((s, p) => {
        if (!s.active || p.active) return
        const onInput = (e: Event) => {
          if (e instanceof KeyboardEvent && (e.ctrlKey || e.metaKey || e.altKey)) return
          // the skipping key must not also trigger its normal shortcut (photo mode, panels, …)
          if (e instanceof KeyboardEvent) {
            e.preventDefault()
            e.stopPropagation()
          }
          skipArrival()
        }
        const opts = { capture: true } as const
        window.addEventListener('keydown', onInput, opts)
        window.addEventListener('pointerdown', onInput, opts)
        window.addEventListener('wheel', onInput, opts)
        const unsub = useArrival.subscribe((a) => {
          if (a.active) return
          window.removeEventListener('keydown', onInput, opts)
          window.removeEventListener('pointerdown', onInput, opts)
          window.removeEventListener('wheel', onInput, opts)
          unsub()
        })
      }),
    [],
  )
  useEffect(() => () => endArrival(), [])

  const tmpP = useMemo(() => new THREE.Vector3(), [])
  const tmpL = useMemo(() => new THREE.Vector3(), [])
  const clock = useMemo(() => ({ t: 0 }), [])

  useFrame((_, rawDt) => {
    const a = useArrival.getState()
    if (!a.active) {
      clock.t = 0
      return
    }
    if (useTour.getState().active) {
      endArrival()
      return
    }
    visitor.frozen = true
    clock.t += Math.min(rawDt, 0.05)
    const t = Math.min(1, clock.t / ARRIVAL_SECONDS)
    // Ease in/out (smootherstep) along the key frames.
    const u = t * t * t * (t * (t * 6 - 15) + 10)
    path.pos.getPoint(u, tmpP)
    path.look.getPoint(u, tmpL)
    camera.position.copy(tmpP)
    camera.lookAt(tmpL)
    // Above the roofs every room (the open courtyard especially) can be seen; once down at the
    // facade, normal zone culling resumes.
    setCullingOverride(u < 0.6)
    if (Math.abs(t - a.t) > 0.01 || t >= 1) useArrival.setState({ t })
    if (t >= 1) {
      // Hand over exactly at the start pose (VisitorController takes the camera next frame).
      endArrival()
    }
  })

  return null
}
