/**
 * Guided-tour engine: walks the visitor from stop to stop (collision-aware routes through
 * doorways, fade-teleport for long hops), faces the subject, lingers while the caption is
 * shown (optionally narrated with speechSynthesis) and moves on.
 *
 * Any manual movement (keys, joystick, click-to-walk, minimap travel) pauses the tour;
 * `resume()` re-plans from wherever the visitor is.
 */
import { create } from 'zustand'
import { TOUR, TOUR_STOPS, type TourStop, type TourView } from '../config/tour'
import { MUSEUM } from '../config/museum'
import { useMuseum } from '../state/store'
import { teleport, visitor, yawToRad, type WalkTarget } from '../state/visitor'
import { travel } from '../ui/Minimap'
import { track } from '../analytics/tracker'
import { pathLength, planPath, type P2 } from './pathing'
import { bcp47, getLang, useLangStore, type Lang } from '../i18n'
import { hasTourTranslation, tourField } from '../i18n/tourText'

const DEG = Math.PI / 180
/** Switch to the next waypoint this close to the current one (keeps the walk fluid). */
const HANDOFF = 0.6
/** Moving further than this from the stop while viewing counts as taking over. */
const DRIFT = 0.45

export type TourPhase = 'walking' | 'viewing' | 'done'

interface TourState {
  active: boolean
  index: number
  phase: TourPhase
  paused: boolean
  /** Why the tour paused (shown as a hint). */
  pauseReason: 'user' | 'manual' | null
  narration: boolean
  /** 0–1 progress through the current stop's dwell. */
  progress: number
}

export const useTour = create<TourState>(() => ({
  active: false,
  index: 0,
  phase: 'walking',
  paused: false,
  pauseReason: null,
  narration: false,
  progress: 0,
}))

export const narrationSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'

/* ------------------------------------------------------------------ */
/* Internal run state                                                  */
/* ------------------------------------------------------------------ */

const run = {
  raf: 0,
  path: [] as P2[],
  seg: 0,
  target: null as WalkTarget | null,
  view: null as TourView | null,
  dwellMs: 0,
  elapsed: 0,
  last: 0,
  speaking: false,
  manualAt: 0,
  travelToken: 0,
  lastProgress: -1,
}

const set = useTour.setState
const get = useTour.getState

/* ------------------------------------------------------------------ */
/* Manual-input detection                                              */
/* ------------------------------------------------------------------ */

const MOVE_KEYS = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'])
let listening = false
function listen() {
  if (listening) return
  listening = true
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    if (MOVE_KEYS.has(e.key.toLowerCase())) run.manualAt = performance.now()
  })
}

const manualInput = () => performance.now() - run.manualAt < 400 || Math.abs(visitor.joystick.x) + Math.abs(visitor.joystick.y) > 0.05

/* ------------------------------------------------------------------ */
/* Narration                                                           */
/* ------------------------------------------------------------------ */

let narrationEl: HTMLAudioElement | null = null

/** Best installed voice for a BCP-47 tag (exact region first, then language; local voices preferred). */
function pickVoice(tag: string): SpeechSynthesisVoice | null {
  try {
    const voices = window.speechSynthesis.getVoices()
    const lower = tag.toLowerCase()
    const base = lower.split('-')[0]
    const exact = voices.filter((v) => v.lang.toLowerCase().replace('_', '-') === lower)
    const lang = voices.filter((v) => v.lang.toLowerCase().startsWith(base))
    const pool = exact.length ? exact : lang
    return pool.find((v) => v.localService) ?? pool[0] ?? null
  } catch {
    return null
  }
}

function speakSynth(stop: TourStop, lang: Lang) {
  // Speak the caption in the visitor's language when a translation exists, else English.
  const useLang: Lang = hasTourTranslation(stop, lang) ? lang : 'en'
  const title = tourField(stop, 'title', useLang)
  const text = tourField(stop, 'text', useLang)
  const tag = bcp47(useLang)
  const u = new SpeechSynthesisUtterance(`${title}. ${text}`)
  u.rate = TOUR.narrationRate
  u.lang = tag
  const voice = pickVoice(tag)
  if (voice) u.voice = voice
  u.onend = u.onerror = () => {
    run.speaking = false
  }
  run.speaking = true
  window.speechSynthesis.speak(u)
}

function speak(stop: TourStop) {
  stopSpeaking()
  if (!get().narration) return
  const lang = getLang()
  // Recorded audio-guide narration (per language) wins over speech synthesis.
  const url = stop.narrationAudio?.[lang]
  if (url) {
    try {
      const el = new Audio(url)
      narrationEl = el
      el.onended = () => {
        run.speaking = false
      }
      el.onerror = () => {
        if (narrationEl !== el) return
        narrationEl = null
        run.speaking = false
        if (narrationSupported()) speakSynth(stop, lang)
      }
      run.speaking = true
      void el.play().catch(() => el.onerror?.(new Event('error')))
      return
    } catch {
      /* fall through to synthesis */
    }
  }
  if (!narrationSupported()) return
  try {
    speakSynth(stop, lang)
  } catch {
    run.speaking = false
  }
}

function stopSpeaking() {
  run.speaking = false
  if (narrationEl) {
    try {
      narrationEl.onerror = null
      narrationEl.pause()
    } catch {
      /* ignore */
    }
    narrationEl = null
  }
  try {
    if (narrationSupported()) window.speechSynthesis.cancel()
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* Walking                                                             */
/* ------------------------------------------------------------------ */

function clearWalk() {
  if (run.target && visitor.walkTarget && sameTarget(visitor.walkTarget, run.target)) visitor.walkTarget = null
  run.target = null
  run.path = []
  run.seg = 0
}

const sameTarget = (a: WalkTarget, b: WalkTarget) => a === b || (a.x === b.x && a.z === b.z && a.onArrive === b.onArrive)

function aimSegment() {
  const p = run.path[run.seg]
  const view = run.view!
  const lastSeg = run.seg === run.path.length - 1
  let t: WalkTarget
  if (lastSeg) {
    t = { x: p.x, z: p.z, yaw: yawToRad(view.yawDeg), pitch: (view.pitchDeg ?? 0) * DEG, onArrive: arrive }
  } else {
    const dx = p.x - visitor.x
    const dz = p.z - visitor.z
    t = { x: p.x, z: p.z, yaw: Math.atan2(-dx, -dz), pitch: 1.5 * DEG, onArrive: advanceSegment }
  }
  run.target = t
  visitor.walkTarget = t
}

function advanceSegment() {
  if (!get().active || get().phase !== 'walking' || get().paused) return
  if (run.seg < run.path.length - 1) {
    run.seg++
    aimSegment()
  }
}

/** Fade out, place the visitor at the stop, fade in, then arrive. */
function jumpTo(view: TourView) {
  clearWalk()
  const token = ++run.travelToken
  let moved = false
  const move = () => {
    moved = true
    if (token !== run.travelToken) return
    teleport(view.x, view.z, view.yawDeg, view.pitchDeg ?? 0)
    window.setTimeout(() => {
      if (token === run.travelToken && get().active && get().phase === 'walking') arrive()
    }, 250)
  }
  travel(move)
  // travel() ignores calls while another fade runs: fall back to a direct move.
  window.setTimeout(() => {
    if (!moved && token === run.travelToken) move()
  }, 1400)
}

function goStop(i: number) {
  const stop = TOUR_STOPS[i]
  if (!stop) return
  run.travelToken++
  stopSpeaking()
  clearWalk()
  run.view = stop.view
  run.elapsed = 0
  run.lastProgress = -1
  set({ index: i, phase: 'walking', paused: false, pauseReason: null, progress: 0 })

  const from = { x: visitor.x, z: visitor.z }
  const path = planPath(from, stop.view)
  // Reduced motion: never glide the camera between stops — soft fade-cut instead.
  if (!path || pathLength(from, path) > TOUR.teleportBeyond || useMuseum.getState().reducedMotion) {
    jumpTo(stop.view)
    return
  }
  run.path = path
  run.seg = 0
  aimSegment()
}

function arrive() {
  const s = get()
  if (!s.active || s.phase !== 'walking') return
  run.travelToken++
  run.target = null
  run.path = []
  const stop = TOUR_STOPS[s.index]
  run.dwellMs = (stop.dwellSec ?? TOUR.dwellSec) * 1000
  run.elapsed = 0
  set({ phase: 'viewing', progress: 0 })
  speak(stop)
}

function finishStop() {
  const s = get()
  if (s.index >= TOUR_STOPS.length - 1) {
    set({ phase: 'done', progress: 1 })
    track('tour_complete', { meta: { stops: TOUR_STOPS.length } })
    return
  }
  goStop(s.index + 1)
}

function pauseFor(reason: 'user' | 'manual') {
  const s = get()
  if (!s.active || s.paused || s.phase === 'done') return
  run.travelToken++ // cancel pending fade-arrivals
  if (s.phase === 'walking') clearWalk()
  stopSpeaking()
  set({ paused: true, pauseReason: reason })
}

/* ------------------------------------------------------------------ */
/* Frame loop                                                          */
/* ------------------------------------------------------------------ */

function tick(now: number) {
  run.raf = requestAnimationFrame(tick)
  const dt = Math.min(100, now - (run.last || now))
  run.last = now
  const s = get()
  if (!s.active || s.paused || s.phase === 'done') return
  const st = useMuseum.getState()
  if (st.inspecting) {
    pauseFor('manual')
    return
  }

  if (s.phase === 'walking') {
    if (!run.target) return // fading
    const cur = visitor.walkTarget
    if (!cur || !sameTarget(cur, run.target)) {
      if (cur && cur.x === run.target.x && cur.z === run.target.z) {
        // Visitor looked around mid-walk (yaw override stripped): keep going.
        run.target = cur
      } else if (cur || manualInput()) {
        pauseFor('manual') // click-to-walk, keys or joystick
        return
      } else {
        // The controller gave up (blocked): never get stuck — fade to the stop instead.
        jumpTo(run.view!)
        return
      }
    }
    // Early hand-off to the next waypoint so the walk does not stop at every corner.
    if (run.seg < run.path.length - 1) {
      const p = run.path[run.seg]
      if (Math.hypot(p.x - visitor.x, p.z - visitor.z) < HANDOFF) advanceSegment()
    }
    return
  }

  // viewing
  const v = run.view!
  if (manualInput() || Math.hypot(visitor.x - v.x, visitor.z - v.z) > DRIFT + MUSEUM.visitor.collisionRadius) {
    pauseFor('manual')
    return
  }
  if (st.selection) return // reading the info panel: hold the stop
  if (run.speaking) {
    run.elapsed = Math.min(run.elapsed + dt, run.dwellMs * 0.9)
  } else {
    run.elapsed += dt
  }
  const progress = Math.min(1, run.elapsed / run.dwellMs)
  if (Math.abs(progress - run.lastProgress) > 0.01) {
    run.lastProgress = progress
    set({ progress })
  }
  if (run.elapsed >= run.dwellMs) finishStop()
}

/* ------------------------------------------------------------------ */
/* Public controls                                                     */
/* ------------------------------------------------------------------ */

export const tour = {
  start(index = 0) {
    if (typeof window === 'undefined') return
    listen()
    const m = useMuseum.getState()
    m.select(null)
    m.setHelpOpen(false)
    m.setDrawer(null)
    if (!get().active) track('tour_start', { meta: { from: TOUR_STOPS[index]?.id ?? '' } })
    set({ active: true })
    cancelAnimationFrame(run.raf)
    run.last = 0
    run.raf = requestAnimationFrame(tick)
    goStop(Math.max(0, Math.min(TOUR_STOPS.length - 1, index)))
  },
  /** Idempotent: safe to call at any point (mid-walk, mid-fade, while narrating, twice). */
  exit() {
    run.travelToken++ // cancels pending fade-arrivals and the jumpTo fallback
    cancelAnimationFrame(run.raf)
    run.raf = 0
    stopSpeaking()
    clearWalk()
    run.view = null
    run.elapsed = 0
    set({ active: false, paused: false, pauseReason: null, phase: 'walking', progress: 0 })
  },
  pause() {
    pauseFor('user')
  },
  resume() {
    const s = get()
    if (!s.active) return
    if (s.phase === 'done') return
    const v = run.view
    const away = !v || Math.hypot(visitor.x - v.x, visitor.z - v.z) > DRIFT
    if (s.phase === 'walking' || away) {
      goStop(s.index) // re-plan from here
    } else {
      set({ paused: false, pauseReason: null })
      if (run.elapsed < run.dwellMs * 0.5) speak(TOUR_STOPS[s.index])
    }
  },
  toggle() {
    if (get().paused) tour.resume()
    else tour.pause()
  },
  next() {
    const s = get()
    if (!s.active) return
    if (s.index < TOUR_STOPS.length - 1) goStop(s.index + 1)
  },
  prev() {
    const s = get()
    if (!s.active) return
    goStop(Math.max(0, s.index - 1))
  },
  restart() {
    tour.start(0)
  },
  setNarration(on: boolean) {
    set({ narration: on && narrationSupported() })
    if (!on) stopSpeaking()
    else {
      const s = get()
      if (s.active && s.phase === 'viewing' && !s.paused) speak(TOUR_STOPS[s.index])
    }
  },
}

// Automation / console handle (like window.__museum in App.tsx).
if (typeof window !== 'undefined') {
  ;(window as unknown as { __tour?: unknown }).__tour = { tour, useTour, stops: TOUR_STOPS }
}

// Changing language mid-stop re-reads the caption in the new language.
if (typeof window !== 'undefined') {
  useLangStore.subscribe((st, prev) => {
    if (st.lang === prev.lang) return
    const s = get()
    if (s.active && s.narration && s.phase === 'viewing' && !s.paused) speak(TOUR_STOPS[s.index])
  })
}
