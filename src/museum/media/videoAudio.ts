/**
 * FILM AUDIO ROUTING (on the shared engine context).
 *
 *  spatial   <video> ─► MediaElementSource ─► volume ─► HRTF PannerNode (screen centre) ─► master
 *
 *  surround  <video> ─► MediaElementSource ─► volume ─► ChannelSplitter(8, discrete)
 *              discrete (5.1 / 7.1):  1:1   L R C LFE Ls Rs [Lb Rb] → FL FR C LFE SL SR BL BR
 *              stereo up-mix:         L → FL SL BL · R → FR SR BR · (L+R)·0.7 → C · low-passed mono → LFE
 *            each speaker bus ─► HRTF PannerNode (speaker position) ─► master
 *                              └► reverb send ─► ConvolverNode (generated room IR) ─► master
 *
 * Channel layout is taken from `audio.channels` or detected at runtime: a stereo stream
 * split discretely into 8 outputs leaves outputs 3–8 exactly silent, so analysers on
 * those outputs reveal real multichannel content within a second of playback.
 *
 * A media element can only ever have ONE MediaElementSource, so routes are cached per
 * video id for the lifetime of the page (they survive Canvas remounts).
 */
import type { SpeakerChannel, VideoConfig } from '../config/videos'
import type { Vec3 } from '../config/museum'
import { createPanner, createRoomReverb, getAudioContext, videoInput } from './audioEngine'

export interface VideoAudioRoute {
  mode: 'spatial' | 'surround'
  /** Detected / configured source layout. */
  layout: () => 'unknown' | 'mono' | 'stereo' | '5.1' | '7.1'
  /** RMS level (0..1) of a speaker bus, for level-reactive LEDs. */
  level: (channel: SpeakerChannel) => number
  /** Move the spatial source (screen centre). */
  setPosition: (p: Vec3) => void
  /** Called ~4×/s by the screen while playing (runs layout detection). */
  tick: (playing: boolean) => void
}

const routes = new Map<string, VideoAudioRoute>()
const ORDER: SpeakerChannel[] = ['FL', 'FR', 'C', 'LFE', 'SL', 'SR', 'BL', 'BR']

export function getVideoRoute(id: string) {
  return routes.get(id) ?? null
}

/** Build (once) the audio graph for a film. Returns null if WebAudio is unavailable. */
export function routeVideoAudio(cfg: VideoConfig, el: HTMLVideoElement, center: Vec3): VideoAudioRoute | null {
  const existing = routes.get(cfg.id)
  if (existing) return existing
  if (cfg.audio.mode === 'none') return null
  const ctx = getAudioContext(false)
  const out = videoInput()
  if (!ctx || !out) return null
  try {
    const route = cfg.audio.mode === 'surround' && cfg.audio.speakers?.length ? buildSurround(ctx, out, cfg, el) : buildSpatial(ctx, out, cfg, el, center)
    routes.set(cfg.id, route)
    return route
  } catch {
    return null
  }
}

/* ------------------------------ spatial ------------------------------- */

function buildSpatial(ctx: AudioContext, out: AudioNode, cfg: VideoConfig, el: HTMLVideoElement, center: Vec3): VideoAudioRoute {
  const src = ctx.createMediaElementSource(el)
  const vol = ctx.createGain()
  vol.gain.value = cfg.audio.volume
  const panner = createPanner(ctx, center, cfg.audio)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 256
  src.connect(vol).connect(panner).connect(out)
  vol.connect(analyser)
  const buf = new Float32Array(analyser.fftSize)
  return {
    mode: 'spatial',
    layout: () => 'stereo',
    level: () => rms(analyser, buf),
    setPosition: (p) => {
      try {
        if (panner.positionX) {
          panner.positionX.value = p[0]
          panner.positionY.value = p[1]
          panner.positionZ.value = p[2]
        }
      } catch {
        /* ignore */
      }
    },
    tick: () => {},
  }
}

/* ------------------------------ surround ------------------------------ */

type Target = { ch: SpeakerChannel; gain: number }

/** Where a source channel goes when the room lacks that speaker. */
function resolveTargets(ch: SpeakerChannel, have: Set<SpeakerChannel>): Target[] {
  if (have.has(ch)) return [{ ch, gain: 1 }]
  const pick = (...alts: SpeakerChannel[][]): Target[] => {
    for (const group of alts) {
      const present = group.filter((c) => have.has(c))
      if (present.length === group.length) return present.map((c) => ({ ch: c, gain: 1 / Math.sqrt(group.length) }))
    }
    return []
  }
  switch (ch) {
    case 'C':
      return pick(['FL', 'FR'])
    case 'LFE':
      return pick(['C'], ['FL', 'FR'])
    case 'SL':
      return pick(['BL'], ['FL'])
    case 'SR':
      return pick(['BR'], ['FR'])
    case 'BL':
      return pick(['SL'], ['FL'])
    case 'BR':
      return pick(['SR'], ['FR'])
    default:
      return []
  }
}

function buildSurround(ctx: AudioContext, out: AudioNode, cfg: VideoConfig, el: HTMLVideoElement): VideoAudioRoute {
  const speakers = cfg.audio.speakers ?? []
  const have = new Set(speakers.map((s) => s.channel))

  const src = ctx.createMediaElementSource(el)
  const vol = ctx.createGain()
  vol.gain.value = cfg.audio.volume
  const splitter = ctx.createChannelSplitter(8)
  src.connect(vol).connect(splitter)

  // Reverb (shared by all speakers).
  const reverbAmount = cfg.audio.reverb ?? 0.16
  let reverbSend: GainNode | null = null
  if (reverbAmount > 0) {
    reverbSend = ctx.createGain()
    reverbSend.gain.value = reverbAmount
    const conv = createRoomReverb(ctx, 1.7, 3.4)
    const ret = ctx.createGain()
    ret.gain.value = 0.9
    reverbSend.connect(conv).connect(ret).connect(out)
  }

  // Speaker buses → panners.
  const bus = new Map<SpeakerChannel, GainNode>()
  const analysers = new Map<SpeakerChannel, { a: AnalyserNode; buf: Float32Array }>()
  for (const s of speakers) {
    const g = ctx.createGain()
    const panner = createPanner(ctx, s.position, cfg.audio)
    if (s.channel === 'LFE') {
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 110
      lp.Q.value = 0.6
      g.connect(lp).connect(panner)
    } else {
      g.connect(panner)
      if (reverbSend) g.connect(reverbSend)
    }
    panner.connect(out)
    const a = ctx.createAnalyser()
    a.fftSize = 256
    g.connect(a)
    analysers.set(s.channel, { a, buf: new Float32Array(a.fftSize) })
    bus.set(s.channel, g)
  }
  const connectTo = (node: AudioNode, targets: Target[], scale = 1) => {
    for (const t of targets) {
      const b = bus.get(t.ch)
      if (!b) continue
      if (t.gain * scale === 1) node.connect(b)
      else {
        const g = ctx.createGain()
        g.gain.value = t.gain * scale
        node.connect(g).connect(b)
      }
    }
  }

  // Discrete (1:1) matrix, behind per-output mode gates.
  const discrete: GainNode[] = []
  ORDER.forEach((ch, i) => {
    const gate = ctx.createGain()
    gate.gain.value = 0
    splitter.connect(gate, i)
    connectTo(gate, resolveTargets(ch, have))
    discrete.push(gate)
  })

  // Stereo up-mix, behind L/R gates (mono → both).
  const gateL = ctx.createGain()
  const gateR = ctx.createGain()
  const monoToR = ctx.createGain()
  gateL.gain.value = 1
  gateR.gain.value = 1
  monoToR.gain.value = 0
  splitter.connect(gateL, 0)
  splitter.connect(gateR, 1)
  splitter.connect(monoToR, 0)
  monoToR.connect(gateR)
  const fan = (gate: GainNode, front: SpeakerChannel, side: SpeakerChannel, back: SpeakerChannel) => {
    connectTo(gate, resolveTargets(front, have), 0.9)
    connectTo(gate, resolveTargets(side, have), 0.5)
    connectTo(gate, resolveTargets(back, have), 0.4)
  }
  fan(gateL, 'FL', 'SL', 'BL')
  fan(gateR, 'FR', 'SR', 'BR')
  connectTo(gateL, resolveTargets('C', have), 0.7)
  connectTo(gateR, resolveTargets('C', have), 0.7)
  const lfeSum = ctx.createGain()
  lfeSum.gain.value = 0.5
  const lfeLp = ctx.createBiquadFilter()
  lfeLp.type = 'lowpass'
  lfeLp.frequency.value = 100
  gateL.connect(lfeSum)
  gateR.connect(lfeSum)
  lfeSum.connect(lfeLp)
  connectTo(lfeLp, resolveTargets('LFE', have))

  // Layout detection.
  let layout: ReturnType<VideoAudioRoute['layout']> = 'unknown'
  const setLayout = (l: typeof layout) => {
    layout = l
    const multi = l === '5.1' || l === '7.1'
    const t = ctx.currentTime
    for (const g of discrete) g.gain.setTargetAtTime(multi ? 1 : 0, t, 0.05)
    gateL.gain.setTargetAtTime(multi ? 0 : 1, t, 0.05)
    gateR.gain.setTargetAtTime(multi ? 0 : 1, t, 0.05)
    monoToR.gain.setTargetAtTime(l === 'mono' ? 1 : 0, t, 0.05)
  }
  const override = cfg.audio.channels
  if (override === 6) setLayout('5.1')
  else if (override === 8) setLayout('7.1')
  else if (override === 2) setLayout('stereo')

  const probes = ORDER.map((_, i) => {
    const a = ctx.createAnalyser()
    a.fftSize = 512
    splitter.connect(a, i)
    return { a, buf: new Float32Array(a.fftSize), energy: 0 }
  })
  let probeTime = 0
  let lastTick = performance.now()
  const tick = (playing: boolean) => {
    const now = performance.now()
    const dt = Math.min(0.5, (now - lastTick) / 1000)
    lastTick = now
    if (override || !playing || probeTime > 15) return
    probeTime += dt
    for (const p of probes) p.energy += rms(p.a, p.buf)
    const has = (i: number) => probes[i].energy > 1e-4
    if (has(6) || has(7)) setLayout('7.1')
    else if (has(2) || has(3) || has(4) || has(5)) setLayout('5.1')
    else if (probeTime > 1.5 && has(0)) setLayout(has(1) ? 'stereo' : 'mono')
    if (layout === '5.1' || layout === '7.1') probeTime = 99 // settled
    if (probeTime > 15) for (const p of probes) splitter.disconnect(p.a)
  }

  return {
    mode: 'surround',
    layout: () => layout,
    level: (ch) => {
      const a = analysers.get(ch)
      return a ? rms(a.a, a.buf) : 0
    },
    setPosition: () => {},
    tick,
  }
}

function rms(a: AnalyserNode, buf: Float32Array) {
  try {
    a.getFloatTimeDomainData(buf as Float32Array<ArrayBuffer>)
    let s = 0
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]
    return Math.sqrt(s / buf.length)
  } catch {
    return 0
  }
}
