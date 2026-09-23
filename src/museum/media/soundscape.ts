/**
 * SPATIAL SOUNDSCAPE — per-zone ambience, time-of-day outdoor layers and the visitor's
 * own footsteps.
 *
 *   indoor zone channels (bus gains, crossfaded ≈2 s) ─┐
 *   outdoor sites (courtyard / forecourt, time of day) ─┤
 *   footsteps (+ small room-reverb send) ───────────────┼─► out ─► soft limiter ─► ambienceInput()
 *                                                        (duck stage → master gain → destination)
 *
 * Everything feeds the engine's ambience input, so the global master (HUD sound toggle /
 * soundOn / hidden tab) and the film ducking apply unchanged.
 *
 * Indoor channels (built on demand, released a few seconds after they fade out):
 *   workshop   – irregular wooden block-thumps at each printing table (own rhythm each),
 *                occasional cloth rustle, low room tone + reverb
 *   galleries  – hushed brown-noise room tone + gentle reverb (galleries A–D, passage,
 *                reveal, reception and any unknown zone share it; a gallery-type zone gets
 *                its own channel only when /audio/ambience/<zoneId>.mp3 exists)
 *   atrium     – airy high tone + long reverb + a very low, indistinct distant murmur
 *   shop       – soft room tone
 *   library    – very hushed room tone + faint, occasional paper-like rustles
 *   theatre    – silent (only its film audio)
 *   courtyard  – no indoor channel: the open-air courtyard is an outdoor site
 *                (soundscape/outdoor.ts) that follows store.timeOfDay and is also heard
 *                faintly through doorways; the atrium hears the forecourt site.
 *
 * Optional recordings (fetched lazily after audio unlock, cached, 404s tolerated):
 *   /audio/ambience/<zoneId>.mp3               looped; replaces that zone's synthesis
 *   /audio/ambience/galleries.mp3              shared fallback for the gallery-type zones,
 *   /audio/ambience.mp3                        … then the legacy single ambience file
 *   /audio/ambience/<site>-<timeOfDay>.mp3     outdoor sites (courtyard / forecourt), then <site>.mp3
 *   /audio/footsteps/<material>-1..4.mp3       random pick per step; replaces synth steps
 *
 * Scheduling: one timer (≈40 ms) schedules event sounds a little ahead on the WebAudio
 * clock, only for audible channels and nearby sources. Nothing runs unless
 * soundOn && phase === 'entered' && the context is unlocked && the tab is visible. The
 * AudioContext is never created here (getAudioContext(false)); the engine creates it in
 * the first user gesture.
 */
import { ZONES, zoneAt, type ZoneId } from '../config/layout'
import { MUSEUM } from '../config/museum'
import { SCENE_OBJECTS } from '../config/objects'
import { useMuseum } from '../state/store'
import { visitor } from '../state/visitor'
import { ambienceInput, createRoomReverb, getAudioContext, isAudioUnlocked, onAudioUnlock, resumeAudio } from './audioEngine'
import { debug, type FloorMaterial, type SoundscapeDebug } from './soundscape/debug'
import { ambienceUrl, isProbed, knownFile, knownFirst, loadFile, loadFirst } from './soundscape/files'
import { normTimeOfDay, updateOutdoor } from './soundscape/outdoor'
import { Kit, burst, clamp, hdist, noise, pick, rand, randInt, releaseOnEnd, safe, tone, type Vec3 } from './soundscape/synth'

export type { FloorMaterial, SoundscapeDebug }

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

/** Synthesised indoor channels; any other channel id is a file-only zone channel. */
type SynthChannel = 'workshop' | 'galleries' | 'atrium' | 'shop' | 'library'
type ChannelId = SynthChannel | ZoneId

const OWN_CHANNEL: ReadonlySet<string> = new Set<SynthChannel>(['workshop', 'atrium', 'shop', 'library'])
/** Zones without an indoor ambience channel. */
const NO_CHANNEL: ReadonlySet<string> = new Set<ZoneId>(['theatre', 'courtyard'])

export const ZONE_MATERIAL: Record<ZoneId, FloorMaterial> = {
  'gallery-a': 'oak',
  'gallery-b': 'oak',
  'gallery-c': 'oak',
  'gallery-d': 'oak',
  passage: 'oak',
  reveal: 'oak',
  reception: 'oak',
  shop: 'oak',
  library: 'oak',
  atrium: 'stone',
  courtyard: 'stone',
  workshop: 'concrete',
  theatre: 'carpet',
}
/** Floor material for a zone; unknown ids fall back to oak. */
export function materialFor(z: string | null | undefined): FloorMaterial {
  return (z && (ZONE_MATERIAL as Record<string, FloorMaterial | undefined>)[z]) || 'oak'
}

/** Footstep room-reverb send per zone (the atrium is the big stone hall). */
const STEP_REVERB: Partial<Record<string, number>> = { atrium: 0.32, courtyard: 0.04, workshop: 0.14, theatre: 0, 'gallery-d': 0.12, library: 0.05, shop: 0.07 }
const STEP_REVERB_DEFAULT = 0.1

const TICK_ACTIVE_MS = 40
const TICK_IDLE_MS = 200
const LOOKAHEAD = 0.28 // s, event sounds
const STEP_LOOKAHEAD = 0.12 // s, footsteps (tighter, so stopping feels immediate)
const CROSSFADE_TC = 0.55 // setTargetAtTime constant → ≈95 % after 1.65 s, settled by ≈2.5 s
const EVENT_RADIUS = 25 // m
const DISPOSE_AFTER = 4 // s silent before a channel's nodes are released
const FILE_LEVEL = 0.26
const FOOT_LEVEL = 0.75
const MIN_STEP_SPEED = 0.25 // m/s

/* ------------------------------------------------------------------ */
/* Indoor channel synthesis                                            */
/* ------------------------------------------------------------------ */

interface Part {
  kit: Kit
  schedule?: (now: number, horizon: number, lx: number, lz: number) => void
}

const objs = (kind: string) => SCENE_OBJECTS.filter((o) => o.kind === kind)

function buildWorkshop(ctx: AudioContext, dest: AudioNode): Part {
  const k = new Kit(ctx)
  const n = noise(ctx)
  const reverb = k.reverb(1.4, 3)
  reverb.connect(k.gain(0.35)).connect(dest)
  const send = k.gain(0.3)
  send.connect(reverb)

  const bedGain = k.gain(0.024)
  k.loop(n.brown).connect(k.filter('highpass', 40, 0.5)).connect(k.filter('lowpass', 260, 0.4)).connect(bedGain)
  bedGain.connect(dest)
  bedGain.connect(send)

  const tables = objs('printing-table').map((o, i) => {
    const pos: Vec3 = [o.position[0], 0.9, o.position[2]]
    const p = k.panner(pos, 1.6, 1.4, 30)
    p.connect(dest)
    p.connect(send)
    return { pos, panner: p, next: 0, left: 0, beat: 0.52 + i * 0.07 + rand(0, 0.08), pitch: rand(0.9, 1.1) }
  })

  let nextRustle = 0
  const schedule = (now: number, horizon: number, lx: number, lz: number) => {
    for (const tb of tables) {
      if (hdist(lx, lz, tb.pos) >= EVENT_RADIUS) continue
      if (tb.next < now - 1) tb.next = now + rand(0.2, 3)
      while (tb.next < horizon) {
        thump(ctx, tb.panner, Math.max(now, tb.next), tb.pitch, tb.left === 0 ? 1 : rand(0.7, 1))
        debug.events.thumps++
        if (tb.left > 0) {
          tb.left--
          tb.next += tb.beat * rand(0.85, 1.2)
        } else {
          // A new burst of a few impressions after a human-length pause.
          tb.left = randInt(2, 6)
          tb.next += Math.random() < 0.2 ? rand(7, 12) : rand(1.8, 6)
        }
      }
    }
    if (!tables.length) return
    if (nextRustle < now - 1) nextRustle = now + rand(3, 10)
    while (nextRustle < horizon) {
      const tb = pick(tables)
      if (hdist(lx, lz, tb.pos) < EVENT_RADIUS) {
        const d = rand(0.45, 0.9)
        burst(ctx, tb.panner, Math.max(now, nextRustle), { type: 'bandpass', f: rand(650, 900), f1: rand(1900, 2800), q: 0.9, peak: rand(0.012, 0.022), attack: d * 0.3, decay: d * 0.7 })
        debug.events.rustles++
      }
      nextRustle += rand(6, 15)
    }
  }
  return { kit: k, schedule }
}

/** A soft wooden block landing on padded cloth: low body + short click + woody ring. */
function thump(ctx: AudioContext, dest: AudioNode, t: number, pitch: number, accent: number) {
  const f = rand(150, 185) * pitch
  tone(ctx, dest, t, { type: 'triangle', f0: f, f1: f * 0.6, peak: 0.05 * accent, attack: 0.003, decay: 0.12 })
  burst(ctx, dest, t, { type: 'bandpass', f: rand(1400, 2100), q: 1.2, peak: 0.018 * accent, attack: 0.001, decay: 0.018 })
  burst(ctx, dest, t, { type: 'bandpass', f: rand(380, 460) * pitch, q: 9, peak: 0.14 * accent, attack: 0.002, decay: 0.09 })
}

/** Brown-noise room tone with a slow filter drift ("breathing" of a quiet room). */
function roomTone(k: Kit, dest: AudioNode, level: number, cutoff: number, reverb?: { seconds: number; wet: number }) {
  const lp = k.filter('lowpass', cutoff, 0.4)
  k.lfo(0.045, cutoff * 0.2, lp.frequency)
  const g = k.gain(level)
  k.loop(noise(k.ctx).brown).connect(k.filter('highpass', 38, 0.5)).connect(lp).connect(g)
  g.connect(dest)
  if (reverb) {
    const r = k.reverb(reverb.seconds, 3.2)
    r.connect(k.gain(reverb.wet)).connect(dest)
    g.connect(r)
  }
}

function buildGalleries(ctx: AudioContext, dest: AudioNode): Part {
  const k = new Kit(ctx)
  roomTone(k, dest, 0.04, 340, { seconds: 1.8, wet: 0.25 })
  return { kit: k }
}

function buildShop(ctx: AudioContext, dest: AudioNode): Part {
  const k = new Kit(ctx)
  roomTone(k, dest, 0.034, 420, { seconds: 0.9, wet: 0.15 })
  return { kit: k }
}

function buildLibrary(ctx: AudioContext, dest: AudioNode): Part {
  const k = new Kit(ctx)
  roomTone(k, dest, 0.02, 260, { seconds: 0.8, wet: 0.1 })
  // Faint paper-like rustles from a few spots in the room.
  const rect = ZONES.find((zn) => zn.id === 'library')?.rect
  const pts: Vec3[] = rect
    ? [0.25, 0.5, 0.75].map((f, i) => [rect.minX + (rect.maxX - rect.minX) * (i % 2 ? 0.7 : 0.3), 0.9, rect.minZ + (rect.maxZ - rect.minZ) * f] as Vec3)
    : []
  const ps = pts.map((pos) => {
    const p = k.panner(pos, 1.2, 1.3, 20)
    p.connect(dest)
    return { pos, p }
  })
  let next = 0
  const schedule = (now: number, horizon: number, lx: number, lz: number) => {
    if (!ps.length) return
    if (next < now - 1) next = now + rand(3, 10)
    while (next < horizon) {
      const s = pick(ps)
      if (hdist(lx, lz, s.pos) < EVENT_RADIUS) {
        const at = Math.max(now, next)
        const d = rand(0.12, 0.28)
        burst(ctx, s.p, at, { type: 'bandpass', f: rand(2600, 3800), f1: rand(1500, 2200), q: 0.8, peak: rand(0.005, 0.009), attack: d * 0.35, decay: d * 0.65 })
        if (Math.random() < 0.6) burst(ctx, s.p, at + d * 0.8, { type: 'highpass', f: 3500, q: 0.6, peak: 0.004, attack: 0.004, decay: 0.03 })
        debug.events.rustles++
      }
      next += rand(8, 20)
    }
  }
  return { kit: k, schedule }
}

function buildAtrium(ctx: AudioContext, dest: AudioNode): Part {
  const k = new Kit(ctx)
  const n = noise(ctx)
  const reverb = k.reverb(3.6, 2.4)
  reverb.connect(k.gain(0.5)).connect(dest)

  // Airy, wide high tone.
  const lp = k.filter('lowpass', 5200, 0.4)
  k.lfo(0.05, 900, lp.frequency)
  const airGain = k.gain(0.035)
  k.loop(n.pink).connect(k.filter('highpass', 480, 0.5)).connect(lp).connect(airGain)
  airGain.connect(dest)
  airGain.connect(k.gain(0.6)).connect(reverb)

  // Soft low body of the big hall.
  k.loop(n.brown).connect(k.filter('lowpass', 180, 0.4)).connect(k.gain(0.014)).connect(dest)

  // Distant murmur: two slowly wandering band-passes on pink noise, mostly reverberant.
  // Targets change only ≈1–2× per second and are smoothed, so nothing resembles syllables.
  const mur = k.loop(n.pink)
  const b1 = k.filter('bandpass', 520, 3)
  const b2 = k.filter('bandpass', 1450, 4)
  const am = k.gain(0.7)
  mur.connect(b1).connect(am)
  mur.connect(b2).connect(am)
  const murOut = k.gain(0.018)
  am.connect(k.filter('lowpass', 1700, 0.5)).connect(murOut)
  murOut.connect(k.gain(0.15)).connect(dest)
  murOut.connect(k.gain(0.9)).connect(reverb)

  let nextMod = 0
  const schedule = (now: number, horizon: number) => {
    if (nextMod < now - 1) nextMod = now
    while (nextMod < horizon) {
      const at = Math.max(now, nextMod)
      b1.frequency.setTargetAtTime(rand(350, 800), at, 0.3)
      b2.frequency.setTargetAtTime(rand(1100, 2000), at, 0.35)
      am.gain.setTargetAtTime(rand(0.35, 1), at, 0.45)
      debug.events.murmur++
      nextMod += rand(0.45, 1.0)
    }
  }
  return { kit: k, schedule }
}

function buildSynth(id: ChannelId, ctx: AudioContext, dest: AudioNode): Part | null {
  return safe(() => {
    switch (id) {
      case 'workshop':
        return buildWorkshop(ctx, dest)
      case 'atrium':
        return buildAtrium(ctx, dest)
      case 'shop':
        return buildShop(ctx, dest)
      case 'library':
        return buildLibrary(ctx, dest)
      case 'galleries':
        return buildGalleries(ctx, dest)
      default:
        return null // file-only gallery-zone channels
    }
  }, null)
}

function channelUrls(id: ChannelId): string[] {
  if (id === 'galleries') return [ambienceUrl('galleries'), '/audio/ambience.mp3']
  return [ambienceUrl(id)]
}

/* ------------------------------------------------------------------ */
/* Engine state                                                        */
/* ------------------------------------------------------------------ */

interface Channel {
  id: ChannelId
  bus: GainNode
  synthGain: GainNode
  fileGain: GainNode
  synth: Part | null
  fileSrc: AudioBufferSourceNode | null
  target: number
  silentSince: number
  disposed: boolean
}

interface Graph {
  ctx: AudioContext
  out: GainNode
  stepOut: GainNode
  stepSend: GainNode
}

let graph: Graph | null = null
const channels = new Map<ChannelId, Channel>()
let lastZone: ZoneId | null = null
let currentChannel: ChannelId | null | undefined
let outdoorBusy = false
let timer = 0
let installed = false

function ensureGraph(ctx: AudioContext): Graph | null {
  if (graph && graph.ctx === ctx) return graph
  const input = ambienceInput()
  if (!input) return null
  return safe(() => {
    const out = ctx.createGain()
    out.gain.value = 1
    // Gentle safety limiter (levels are low; this only catches pile-ups).
    const lim = ctx.createDynamicsCompressor()
    lim.threshold.value = -12
    lim.knee.value = 8
    lim.ratio.value = 6
    lim.attack.value = 0.004
    lim.release.value = 0.25
    out.connect(lim).connect(input)
    const stepOut = ctx.createGain()
    stepOut.connect(out)
    const stepSend = ctx.createGain()
    stepSend.gain.value = STEP_REVERB_DEFAULT
    stepOut.connect(stepSend).connect(createRoomReverb(ctx, 2.2, 3)).connect(out)
    graph = { ctx, out, stepOut, stepSend }
    return graph
  }, null)
}

function createChannel(g: Graph, id: ChannelId): Channel {
  const { ctx } = g
  const bus = ctx.createGain()
  bus.gain.value = 0
  bus.connect(g.out)
  const synthGain = ctx.createGain()
  synthGain.connect(bus)
  const fileGain = ctx.createGain()
  fileGain.gain.value = 0
  fileGain.connect(bus)
  const ch: Channel = { id, bus, synthGain, fileGain, synth: null, fileSrc: null, target: 0, silentSince: -1, disposed: false }
  channels.set(id, ch)

  const urls = channelUrls(id)
  const known = knownFirst(urls)
  if (known) startFile(ch, known, true)
  else {
    ch.synth = buildSynth(id, ctx, synthGain)
    if (known === undefined) {
      void loadFirst(ctx, urls).then((b) => {
        if (b && !ch.disposed) startFile(ch, b, false)
      })
    }
  }
  debug.sources[id] = ch.fileSrc ? 'file' : ch.synth ? 'synth' : 'silent'
  return ch
}

/** Crossfade a channel from its synthesis to a looped recording. */
function startFile(ch: Channel, buf: AudioBuffer, immediate: boolean) {
  if (ch.fileSrc || !graph) return
  const ctx = graph.ctx
  safe(() => {
    const s = ctx.createBufferSource()
    s.buffer = buf
    s.loop = true
    s.connect(ch.fileGain)
    s.start(ctx.currentTime, Math.random() * buf.duration)
    ch.fileSrc = s
    const now = ctx.currentTime
    if (immediate) ch.fileGain.gain.value = FILE_LEVEL
    else ch.fileGain.gain.setTargetAtTime(FILE_LEVEL, now, 0.5)
    if (ch.synth) {
      ch.synthGain.gain.setTargetAtTime(0, now, 0.5)
      const part = ch.synth
      ch.synth = null // stop scheduling synth events at once
      window.setTimeout(() => part.kit.dispose(), 3000)
    }
    debug.sources[ch.id] = 'file'
  }, undefined)
}

function disposeChannel(ch: Channel) {
  ch.disposed = true
  safe(() => ch.synth?.kit.dispose(), undefined)
  safe(() => ch.fileSrc?.stop(), undefined)
  for (const n of [ch.fileSrc, ch.fileGain, ch.synthGain, ch.bus]) safe(() => n?.disconnect(), undefined)
  ch.synth = null
  ch.fileSrc = null
  channels.delete(ch.id)
  delete debug.levels[ch.id]
  delete debug.sources[ch.id]
}

/** Indoor channel for a zone (null = silent indoors). Unknown zones → gallery room tone. */
function channelForZone(z: ZoneId, ctx: AudioContext): ChannelId | null {
  if (NO_CHANNEL.has(z)) return null
  if (OWN_CHANNEL.has(z)) return z
  // Gallery-type (or unknown) zone: its own recording if present, else the shared galleries channel.
  const url = ambienceUrl(z)
  if (knownFile(url)) return z
  if (!isProbed(url)) void loadFile(ctx, url)
  return 'galleries'
}

/* ------------------------------------------------------------------ */
/* Footsteps                                                           */
/* ------------------------------------------------------------------ */

const stepFiles: Record<FloorMaterial, AudioBuffer[] | null> = { oak: null, stone: null, concrete: null, carpet: null }
const stepProbe = new Set<FloorMaterial>()

function probeSteps(ctx: AudioContext, m: FloorMaterial) {
  if (stepProbe.has(m)) return
  stepProbe.add(m)
  void (async () => {
    const found: AudioBuffer[] = []
    for (let i = 1; i <= 4; i++) {
      const b = await loadFile(ctx, `/audio/footsteps/${m}-${i}.mp3`)
      if (!b) break
      found.push(b)
    }
    stepFiles[m] = found
  })()
}

let nextStep: number | null = null
let leftFoot = true

/** ≈1.8 steps/s at walkSpeed, ≈2.4 at briskSpeed. */
function cadence(speed: number) {
  return clamp(1.8 * Math.pow(speed / MUSEUM.visitor.walkSpeed, 0.55), 1.1, 2.9)
}

function playStep(g: Graph, t: number, m: FloorMaterial, left: boolean, intensity: number) {
  const { ctx } = g
  let dest: AudioNode = g.stepOut
  let pan: StereoPannerNode | null = null
  if (typeof ctx.createStereoPanner === 'function') {
    pan = ctx.createStereoPanner()
    pan.pan.value = (left ? -1 : 1) * rand(0.08, 0.16)
    pan.connect(g.stepOut)
    dest = pan
  }
  const alt = (left ? 0.97 : 1.03) * rand(0.96, 1.04)
  const v = FOOT_LEVEL * intensity * rand(0.85, 1.1)
  const files = stepFiles[m]
  if (files && files.length) {
    const s = ctx.createBufferSource()
    s.buffer = pick(files)
    s.playbackRate.value = alt
    const gg = ctx.createGain()
    gg.gain.value = 0.45 * v
    s.connect(gg).connect(dest)
    s.start(t)
    releaseOnEnd(s, pan ? [s, gg, pan] : [s, gg])
    debug.lastStepSource = 'file'
  } else {
    const toe = t + rand(0.03, 0.05)
    switch (m) {
      case 'oak': // hollow boards: low body, mid knock, board resonance, soft toe
        tone(ctx, dest, t, { f0: 125 * alt, f1: 75 * alt, peak: 0.05 * v, attack: 0.003, decay: 0.07 })
        burst(ctx, dest, t, { type: 'bandpass', f: 900 * alt, q: 1.1, peak: 0.03 * v, decay: 0.05 })
        burst(ctx, dest, t, { type: 'bandpass', f: 260 * alt, q: 6, peak: 0.07 * v, decay: 0.08 })
        burst(ctx, dest, toe, { type: 'bandpass', f: 1600 * alt, q: 1.5, peak: 0.012 * v, decay: 0.03 })
        break
      case 'stone': // hard, bright heel click, little body
        tone(ctx, dest, t, { f0: 95 * alt, f1: 60 * alt, peak: 0.03 * v, attack: 0.002, decay: 0.05 })
        burst(ctx, dest, t, { type: 'bandpass', f: 3200 * alt, q: 0.9, peak: 0.035 * v, attack: 0.001, decay: 0.03 })
        burst(ctx, dest, toe, { type: 'bandpass', f: 2500 * alt, q: 1.2, peak: 0.015 * v, attack: 0.001, decay: 0.02 })
        break
      case 'concrete': // dull mid thud with a little grit
        tone(ctx, dest, t, { f0: 85 * alt, f1: 55 * alt, peak: 0.035 * v, attack: 0.003, decay: 0.06 })
        burst(ctx, dest, t, { type: 'bandpass', f: 1300 * alt, q: 0.8, peak: 0.035 * v, decay: 0.045 })
        burst(ctx, dest, t + 0.004, { type: 'highpass', f: 4500, q: 0.6, peak: 0.008 * v, decay: 0.06 })
        burst(ctx, dest, toe, { type: 'bandpass', f: 1800 * alt, q: 1.2, peak: 0.012 * v, decay: 0.025 })
        break
      case 'carpet': // very muffled
        tone(ctx, dest, t, { f0: 70 * alt, f1: 50 * alt, peak: 0.012 * v, attack: 0.006, decay: 0.08 })
        burst(ctx, dest, t, { type: 'lowpass', f: 380 * alt, q: 0.5, peak: 0.018 * v, attack: 0.01, decay: 0.09 })
        break
    }
    if (pan) {
      const p = pan
      window.setTimeout(() => safe(() => p.disconnect(), undefined), (t - ctx.currentTime + 0.5) * 1000)
    }
    debug.lastStepSource = 'synth'
  }
  debug.steps++
  debug.stepsByMaterial[m]++
}

/* ------------------------------------------------------------------ */
/* Scheduler                                                           */
/* ------------------------------------------------------------------ */

function wanted() {
  const st = useMuseum.getState()
  const hidden = typeof document !== 'undefined' && document.hidden
  return st.soundOn && st.phase === 'entered' && isAudioUnlocked() && !hidden
}

function tick() {
  const ctx = getAudioContext(false)
  const active = !!ctx && ctx.state === 'running' && wanted()
  debug.active = active
  debug.ticks++
  if (!ctx) return
  debug.ctxState = ctx.state
  debug.ctxTime = Math.round(ctx.currentTime * 100) / 100
  const g = active ? ensureGraph(ctx) : graph
  if (!g || g.ctx !== ctx) return
  const now = ctx.currentTime
  const lx = visitor.x
  const lz = visitor.z

  // Zone tracking (keep the last zone while between rects).
  const z = zoneAt(lx, lz)?.id ?? lastZone ?? ZONES[0]?.id ?? null
  lastZone = z
  debug.zone = z
  const material = materialFor(z)
  debug.material = material

  const want: ChannelId | null = active && z ? channelForZone(z, ctx) : null
  if (want !== currentChannel) {
    currentChannel = want
    debug.channel = want
    if (z) safe(() => g.stepSend.gain.setTargetAtTime(STEP_REVERB[z] ?? STEP_REVERB_DEFAULT, now, 0.4), undefined)
  }
  if (want && !channels.has(want)) createChannel(g, want)

  for (const ch of [...channels.values()]) {
    const target = ch.id === want ? 1 : 0
    if (target !== ch.target) {
      ch.target = target
      safe(() => ch.bus.gain.setTargetAtTime(target, now, CROSSFADE_TC), undefined)
    }
    const level = ch.bus.gain.value
    debug.levels[ch.id] = Math.round(level * 1000) / 1000
    if (target === 0 && level < 0.002) {
      if (ch.silentSince < 0) ch.silentSince = now
      else if (now - ch.silentSince > DISPOSE_AFTER) disposeChannel(ch)
      continue
    }
    ch.silentSince = -1
    const part = ch.synth
    if (active && part?.schedule && (target > 0 || level > 0.01)) safe(() => part.schedule!(now, now + LOOKAHEAD, lx, lz), undefined)
  }

  // Open-air sites (time of day).
  outdoorBusy = safe(
    () =>
      updateOutdoor({
        ctx,
        out: g.out,
        now,
        horizon: now + LOOKAHEAD,
        active,
        zone: z,
        x: lx,
        z: lz,
        tod: normTimeOfDay((useMuseum.getState() as { timeOfDay?: unknown }).timeOfDay),
        noise: noise(ctx),
      }),
    false,
  )

  // Footsteps.
  const speed = Math.hypot(visitor.vx, visitor.vz)
  debug.speed = Math.round(speed * 100) / 100
  if (active && speed >= MIN_STEP_SPEED && !visitor.frozen) {
    probeSteps(ctx, material)
    const sps = cadence(speed)
    debug.stepsPerSec = Math.round(sps * 100) / 100
    if (nextStep === null || nextStep < now - 0.2) nextStep = now + 0.05
    const intensity = clamp(0.5 + (0.5 * speed) / MUSEUM.visitor.walkSpeed, 0.55, 1.2)
    while (nextStep < now + STEP_LOOKAHEAD) {
      const at = Math.max(now + 0.005, nextStep)
      safe(() => playStep(g, at, material, leftFoot, intensity), undefined)
      leftFoot = !leftFoot
      nextStep += (1 / sps) * rand(0.96, 1.04)
    }
  } else {
    nextStep = null
    debug.stepsPerSec = 0
  }
}

function loop() {
  safe(tick, undefined)
  const busy = debug.active || channels.size > 0 || outdoorBusy
  timer = window.setTimeout(loop, busy ? TICK_ACTIVE_MS : TICK_IDLE_MS)
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/** Install the soundscape scheduler (idempotent; client only). */
export function ensureSoundscape() {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.__soundscape = debug
  onAudioUnlock(() => safe(tick, undefined))
  useMuseum.subscribe((s, prev) => {
    if (s.soundOn !== prev.soundOn || s.phase !== prev.phase) safe(tick, undefined)
  })
  window.clearTimeout(timer)
  loop()
}

/** Call inside a user gesture: creates/resumes the shared AudioContext and starts the scheduler. */
export function startSoundscape() {
  safe(() => resumeAudio(), undefined)
  ensureSoundscape()
  safe(tick, undefined)
}

/** Live snapshot for tests / debugging (also available as window.__soundscape). */
export function soundscapeDebug(): SoundscapeDebug {
  return debug
}
