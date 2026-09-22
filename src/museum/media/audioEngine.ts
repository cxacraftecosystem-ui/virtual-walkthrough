/**
 * AUDIO ENGINE — the museum's single shared WebAudio graph.
 *
 *   ambience ─► ambienceDuck ─┐
 *   video buses ──────────────┼─► master (THREE.AudioListener.gain, follows store.soundOn) ─► destination
 *
 * - One AudioContext, created lazily inside the first user gesture (pointerdown /
 *   keydown / touchend anywhere, including the "Enter Exhibition" click) so browsers
 *   never block it, and resumed on every later gesture if it was suspended.
 * - A THREE.AudioListener shares that context; its transform follows the camera every
 *   frame (see `updateListener`, called by <VideoScreens />).
 * - Master gain fades smoothly with `soundOn`; with sound off, videos keep playing
 *   silently rather than stopping.
 * - Ambience is ducked while any film with sound is audible at the listener.
 *
 * Every call is defensive: if WebAudio is unavailable the museum stays silent but works.
 */
import * as THREE from 'three'
import { useMuseum } from '../state/store'

type Ctor = typeof AudioContext

interface EngineState {
  ctx: AudioContext | null
  listener: THREE.AudioListener | null
  ambienceDuck: GainNode | null
  unsupported: boolean
  unlocked: boolean
}

const S: EngineState = { ctx: null, listener: null, ambienceDuck: null, unsupported: false, unlocked: false }
const unlockCallbacks = new Set<() => void>()
const gestureCallbacks = new Set<() => void>()
let userGestured = false
/** id → current audibility (0..1) of each video at the listener. */
const audibility = new Map<string, number>()

const MASTER_FADE = 0.35 // setTargetAtTime time constant (s)
const DUCK_DEPTH = 0.72 // ambience reduced by up to 72 % while a film is audible
const DUCK_TC = 0.6

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}

function audioCtor(): Ctor | undefined {
  if (typeof window === 'undefined') return undefined
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext
}

function wantedMaster() {
  const st = useMuseum.getState()
  const hidden = typeof document !== 'undefined' && document.hidden
  return st.soundOn && !hidden ? 1 : 0
}

function applyMaster(timeConstant = MASTER_FADE) {
  const { ctx, listener } = S
  if (!ctx || !listener) return
  safe(() => {
    const g = listener.gain.gain
    const now = ctx.currentTime
    g.cancelScheduledValues(now)
    g.setValueAtTime(g.value, now)
    g.setTargetAtTime(wantedMaster(), now, timeConstant)
  }, undefined)
}

/**
 * Returns the shared AudioContext, creating it if needed. Pass `create: false` to only
 * read it (e.g. from render loops — never create outside a gesture).
 */
export function getAudioContext(create = true): AudioContext | null {
  if (S.ctx || S.unsupported || !create) return S.ctx
  const C = audioCtor()
  if (!C) {
    S.unsupported = true
    return null
  }
  return safe(() => {
    const ctx = new C({ latencyHint: 'interactive' })
    THREE.AudioContext.setContext(ctx)
    const listener = new THREE.AudioListener()
    listener.gain.gain.value = 0
    const duck = ctx.createGain()
    duck.gain.value = 1
    duck.connect(listener.getInput())
    S.ctx = ctx
    S.listener = listener
    S.ambienceDuck = duck
    ctx.addEventListener?.('statechange', checkUnlocked)
    applyMaster(0.05)
    checkUnlocked()
    return ctx
  }, null) ?? ((S.unsupported = true), null)
}

export function getListener(): THREE.AudioListener | null {
  return S.listener
}

/** Destination for film audio (after the master gain). */
export function videoInput(): AudioNode | null {
  return S.listener ? S.listener.getInput() : null
}

/** Destination for ambience (passes through the duck stage). */
export function ambienceInput(): AudioNode | null {
  return S.ambienceDuck
}

/** True once the context is running (a user gesture has happened). */
export function isAudioUnlocked() {
  return S.unlocked
}

/** Register a callback for when audio becomes available (fires immediately if it already is). */
export function onAudioUnlock(cb: () => void): () => void {
  if (S.unlocked) {
    safe(cb, undefined)
    return () => {}
  }
  unlockCallbacks.add(cb)
  return () => unlockCallbacks.delete(cb)
}

/** True when this browser has no WebAudio (films then fall back to plain element audio). */
export function isAudioUnsupported() {
  return S.unsupported || !audioCtor()
}

/** Callback on the first trusted user gesture (fires immediately if it already happened). */
export function onUserGesture(cb: () => void): () => void {
  if (userGestured) {
    safe(cb, undefined)
    return () => {}
  }
  gestureCallbacks.add(cb)
  return () => gestureCallbacks.delete(cb)
}

function checkUnlocked() {
  if (S.unlocked || !S.ctx || S.ctx.state !== 'running') return
  S.unlocked = true
  for (const cb of [...unlockCallbacks]) safe(cb, undefined)
  unlockCallbacks.clear()
}

/** Create/resume the context. Safe to call anywhere; only effective inside a user gesture. */
export function resumeAudio() {
  const ctx = getAudioContext(true)
  if (!ctx) return
  if (ctx.state !== 'running') {
    safe(() => {
      void ctx.resume().then(checkUnlocked, () => {})
    }, undefined)
  } else checkUnlocked()
}

/* --------------------------- gesture unlock --------------------------- */

let gestureInstalled = false
function installGestureUnlock() {
  if (gestureInstalled || typeof window === 'undefined') return
  gestureInstalled = true
  const onGesture = (e: Event) => {
    // Ignore synthetic events (e.g. automation) — browsers would refuse them anyway.
    if (!e.isTrusted) return
    resumeAudio()
    if (!userGestured) {
      userGestured = true
      for (const cb of [...gestureCallbacks]) safe(cb, undefined)
      gestureCallbacks.clear()
    }
  }
  for (const ev of ['pointerdown', 'keydown', 'touchend', 'click']) window.addEventListener(ev, onGesture, true)
  document.addEventListener('visibilitychange', () => applyMaster(0.15))
  useMuseum.subscribe((s, prev) => {
    if (s.soundOn !== prev.soundOn) applyMaster()
  })
}
installGestureUnlock()

/* ------------------------------ listener ------------------------------ */

const _m = new THREE.Matrix4()
/** Copy the camera's world transform into the AudioListener (call once per frame). */
export function updateListener(camera: THREE.Camera) {
  const l = S.listener
  if (!l || !S.unlocked) return
  safe(() => {
    _m.copy(camera.matrixWorld)
    _m.decompose(l.position, l.quaternion, l.scale)
    l.updateMatrixWorld(true)
  }, undefined)
}

/* ------------------------------- ducking ------------------------------ */

let duckTarget = 1
/** Report how audible a film currently is at the listener (0..1). */
export function setVideoAudibility(id: string, level: number) {
  if (level <= 0.001) audibility.delete(id)
  else audibility.set(id, Math.min(1, level))
  let max = 0
  for (const v of audibility.values()) max = Math.max(max, v)
  const target = 1 - DUCK_DEPTH * Math.min(1, max * 1.6)
  if (Math.abs(target - duckTarget) < 0.02) return
  duckTarget = target
  const { ctx, ambienceDuck } = S
  if (!ctx || !ambienceDuck) return
  safe(() => ambienceDuck.gain.setTargetAtTime(target, ctx.currentTime, DUCK_TC), undefined)
}

/* ------------------------------- helpers ------------------------------ */

/** HRTF panner at a world position. */
export function createPanner(ctx: AudioContext, position: [number, number, number], opts: { refDistance: number; rolloff: number; maxDistance: number }): PannerNode {
  const p = ctx.createPanner()
  safe(() => {
    p.panningModel = 'HRTF'
    p.distanceModel = 'inverse'
    p.refDistance = Math.max(0.1, opts.refDistance)
    p.rolloffFactor = Math.max(0, opts.rolloff)
    p.maxDistance = Math.max(p.refDistance + 0.1, opts.maxDistance)
    p.coneInnerAngle = 360
    p.coneOuterAngle = 360
    if (p.positionX) {
      p.positionX.value = position[0]
      p.positionY.value = position[1]
      p.positionZ.value = position[2]
    } else {
      ;(p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(...position)
    }
  }, undefined)
  return p
}

/** Inverse-distance gain the panner will apply (used for ducking / level estimates). */
export function inverseDistanceGain(d: number, ref: number, rolloff: number, max: number) {
  const dd = Math.min(Math.max(d, ref), max)
  return ref / (ref + rolloff * (dd - ref))
}

/**
 * Generated room impulse response (stereo decorrelated noise, exponential decay,
 * darker tail) — a subtle, believable hall without shipping an IR file.
 */
export function createRoomReverb(ctx: AudioContext, seconds = 1.6, decay = 3.2, preDelay = 0.012): ConvolverNode {
  const conv = ctx.createConvolver()
  safe(() => {
    const rate = ctx.sampleRate
    const len = Math.floor(rate * seconds)
    const buf = ctx.createBuffer(2, len, rate)
    const pre = Math.floor(rate * preDelay)
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch)
      let lp = 0
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / (len - pre)
        // Low-pass the noise progressively (air absorption): coefficient rises over time.
        const k = 0.55 + 0.4 * t
        const white = Math.random() * 2 - 1
        lp = lp * k + white * (1 - k)
        d[i] = lp * Math.pow(1 - t, decay) * (1.6 + t)
      }
      // A few sparse early reflections.
      for (let r = 0; r < 7; r++) {
        const at = pre + Math.floor(rate * (0.008 + Math.random() * 0.06))
        if (at < len) d[at] += (Math.random() * 0.5 + 0.2) * (ch === r % 2 ? 1 : 0.6)
      }
    }
    conv.normalize = true
    conv.buffer = buf
  }, undefined)
  return conv
}
