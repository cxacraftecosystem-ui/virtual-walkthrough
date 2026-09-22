/**
 * Ambient gallery sound.
 *
 * Prefers `/audio/ambience.mp3` (looped, low volume). If that file is missing or
 * cannot be decoded, a very soft procedural "room tone" is synthesised with
 * WebAudio: looping brown noise through a gentle low-pass with a slow drift.
 * Everything is wrapped defensively — audio must never break the museum.
 *
 * Shares the museum's single AudioContext with the film audio (media/audioEngine.ts):
 * the ambience feeds the engine's duck stage, so it dips while a film is audible, and
 * the engine's master gain follows `soundOn` for everything.
 */
import { useEffect } from 'react'
import { ambienceInput, getAudioContext } from '../media/audioEngine'
import { useMuseum } from '../state/store'

const FILE_URL = '/audio/ambience.mp3'
const FILE_VOLUME = 0.22
const SYNTH_VOLUME = 0.04
const FADE_IN = 2.5
const FADE_OUT = 1.2

type Mode = 'unknown' | 'file' | 'synth'

interface Engine {
  mode: Mode
  el: HTMLAudioElement | null
  ctx: AudioContext | null
  gain: GainNode | null
  src: AudioBufferSourceNode | null
  lfo: OscillatorNode | null
  fadeTimer: number
  wantPlaying: boolean
  probing: boolean
  /** File element routed through the shared graph (for ducking). */
  routed: boolean
}

const engine: Engine = {
  mode: 'unknown',
  el: null,
  ctx: null,
  gain: null,
  src: null,
  lfo: null,
  fadeTimer: 0,
  wantPlaying: false,
  probing: false,
  routed: false,
}

function safe(fn: () => void) {
  try {
    fn()
  } catch {
    /* audio is best-effort */
  }
}

/* ------------------------------ file mode ------------------------------ */

function fadeElement(el: HTMLAudioElement, to: number, seconds: number, onDone?: () => void) {
  window.clearInterval(engine.fadeTimer)
  const from = el.volume
  const start = performance.now()
  engine.fadeTimer = window.setInterval(() => {
    const t = Math.min(1, (performance.now() - start) / (seconds * 1000))
    safe(() => {
      el.volume = Math.max(0, Math.min(1, from + (to - from) * t))
    })
    if (t >= 1) {
      window.clearInterval(engine.fadeTimer)
      onDone?.()
    }
  }, 40)
}

function routeFile(el: HTMLAudioElement) {
  if (engine.routed) return
  safe(() => {
    const ctx = getAudioContext()
    const dest = ambienceInput()
    if (!ctx || !dest) return
    ctx.createMediaElementSource(el).connect(dest)
    engine.routed = true
    void ctx.resume().catch(() => {})
  })
}

function playFile() {
  const el = engine.el
  if (!el) return
  routeFile(el)
  safe(() => {
    el.volume = 0
    const p = el.play()
    if (p && typeof p.then === 'function') {
      p.then(
        () => fadeElement(el, FILE_VOLUME, FADE_IN),
        () => armGestureRetry(),
      )
    } else {
      fadeElement(el, FILE_VOLUME, FADE_IN)
    }
  })
}

/** Resolve whether the ambience file is usable; falls back to synthesis. */
function probe(): Promise<Mode> {
  if (engine.mode !== 'unknown') return Promise.resolve(engine.mode)
  return new Promise<Mode>((resolve) => {
    let settled = false
    const done = (m: Mode) => {
      if (settled) return
      settled = true
      engine.mode = m
      if (m !== 'file') engine.el = null
      resolve(m)
    }
    try {
      const el = new Audio()
      el.loop = true
      el.preload = 'auto'
      el.volume = 0
      el.addEventListener('canplaythrough', () => done('file'), { once: true })
      el.addEventListener('error', () => done('synth'), { once: true })
      engine.el = el
      el.src = FILE_URL
      el.load()
      // Missing/slow file → synthesise rather than wait.
      window.setTimeout(() => done('synth'), 4000)
    } catch {
      done('synth')
    }
  })
}

/* ------------------------------ synth mode ----------------------------- */

function buildSynth(): boolean {
  if (engine.ctx) return true
  const ctx = getAudioContext()
  if (!ctx) return false

  // 6 s of brown noise, looped.
  const seconds = 6
  const buffer = ctx.createBuffer(2, ctx.sampleRate * seconds, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch)
    let last = 0
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1
      last = (last + 0.02 * white) / 1.02
      data[i] = last * 3.5
    }
    // Cross-fade the loop seam.
    const seam = Math.floor(ctx.sampleRate * 0.25)
    for (let i = 0; i < seam; i++) {
      const t = i / seam
      const j = data.length - seam + i
      data[j] = data[j] * (1 - t) + data[i] * t
    }
  }

  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.loop = true

  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 38

  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 340
  lp.Q.value = 0.4

  // Slow drift of the filter — the "breathing" of a large quiet room.
  const lfo = ctx.createOscillator()
  lfo.frequency.value = 0.045
  const lfoGain = ctx.createGain()
  lfoGain.gain.value = 70
  lfo.connect(lfoGain).connect(lp.frequency)

  const gain = ctx.createGain()
  gain.gain.value = 0

  src.connect(hp).connect(lp).connect(gain).connect(ambienceInput() ?? ctx.destination)
  src.start()
  lfo.start()

  engine.ctx = ctx
  engine.src = src
  engine.lfo = lfo
  engine.gain = gain
  return true
}

function rampSynth(to: number, seconds: number) {
  const { ctx, gain } = engine
  if (!ctx || !gain) return
  const now = ctx.currentTime
  gain.gain.cancelScheduledValues(now)
  gain.gain.setValueAtTime(gain.gain.value, now)
  gain.gain.linearRampToValueAtTime(to, now + seconds)
}

function playSynth() {
  safe(() => {
    if (!buildSynth()) return
    const ctx = engine.ctx!
    if (ctx.state === 'suspended') {
      ctx.resume().then(
        () => engine.wantPlaying && rampSynth(SYNTH_VOLUME, FADE_IN),
        () => armGestureRetry(),
      )
      if (ctx.state === 'suspended') armGestureRetry()
    }
    rampSynth(SYNTH_VOLUME, FADE_IN)
  })
}

/* --------------------------- autoplay policy -------------------------- */

let gestureArmed = false
function armGestureRetry() {
  if (gestureArmed) return
  gestureArmed = true
  const retry = () => {
    gestureArmed = false
    window.removeEventListener('pointerdown', retry, true)
    window.removeEventListener('keydown', retry, true)
    if (engine.wantPlaying) start()
  }
  window.addEventListener('pointerdown', retry, true)
  window.addEventListener('keydown', retry, true)
}

/* ------------------------------ public -------------------------------- */

function start() {
  engine.wantPlaying = true
  if (engine.mode === 'file') return playFile()
  if (engine.mode === 'synth') return playSynth()
  if (engine.probing) return
  engine.probing = true
  // Create/resume the AudioContext inside the user gesture so a later synth
  // fallback is allowed to sound.
  safe(() => {
    buildSynth()
    void engine.ctx?.resume()
  })
  probe().then((m) => {
    engine.probing = false
    if (!engine.wantPlaying) return
    if (m === 'file') {
      // Release the synth graph we pre-built (the context itself is shared — keep it).
      safe(() => {
        engine.src?.stop()
        engine.lfo?.stop()
        engine.gain?.disconnect()
      })
      engine.ctx = null
      engine.gain = null
      engine.src = null
      engine.lfo = null
      playFile()
    } else {
      playSynth()
    }
  }, () => {
    engine.probing = false
  })
}

function stop() {
  engine.wantPlaying = false
  safe(() => {
    if (engine.el && engine.mode === 'file') {
      const el = engine.el
      fadeElement(el, 0, FADE_OUT, () => safe(() => !engine.wantPlaying && el.pause()))
    }
    // The shared context stays running (films may still be playing); just fade out.
    if (engine.ctx) rampSynth(0, FADE_OUT)
  })
}

/** Imperatively request ambience (call inside a user gesture, e.g. "Enter"). */
export function requestAmbientStart() {
  safe(start)
}

/** Plays ambience while `soundOn && phase === 'entered'`. */
export function useAmbientAudio() {
  const soundOn = useMuseum((s) => s.soundOn)
  const entered = useMuseum((s) => s.phase === 'entered')
  const active = soundOn && entered

  useEffect(() => {
    if (active) safe(start)
    else if (engine.wantPlaying) safe(stop)
  }, [active])

  // Quiet down when the tab is hidden.
  useEffect(() => {
    const onVis = () => {
      if (!useMuseum.getState().soundOn || useMuseum.getState().phase !== 'entered') return
      if (document.hidden) safe(stop)
      else safe(start)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])
}
