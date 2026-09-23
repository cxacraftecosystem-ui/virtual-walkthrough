/**
 * OUTDOOR SOUNDSCAPE — the open-air spaces follow the store's time of day.
 *
 * Two sites:
 *   courtyard – the Dye Garden (birds in the trees, insects/frogs at the plant beds and
 *               planters, trickling water at the rinsing channel)
 *   forecourt – the paving, hedges and lawns outside the atrium facade (+z)
 *
 * Each site has a bus whose level + low-pass follow where the visitor is (full inside the
 * space; faint and muffled through open doorways — the atrium hears the forecourt most),
 * and one layer per time of day, crossfaded over ≈4 s when `timeOfDay` changes:
 *   morning  lively dawn chorus + a distant cuckoo-like two-note call
 *   midday   sparse birds, light breeze and leaf rustles
 *   golden   evening birds + a few distant long calls
 *   dusk     birds thin out, the first crickets
 *   night    crickets, a frog-like chorus, an occasional owl-like hoot, soft night breeze
 * All synthesised (species-like, not species-accurate), low level.
 *
 * Recordings: /audio/ambience/<site>-<timeOfDay>.mp3, then /audio/ambience/<site>.mp3,
 * replace every synthesised part of that site for that time of day (incl. the water).
 */
import type { ZoneId } from '../../config/layout'
import { MUSEUM } from '../../config/museum'
import { SCENE_OBJECTS } from '../../config/objects'
import type { TimeOfDay } from '../../state/store'
import { debug } from './debug'
import { ambienceUrl, knownFirst, loadFirst } from './files'
import { Kit, birdPhrase, burst, hdist, pick, pulse, rand, randInt, safe, tone, type Vec3 } from './synth'

const TODS: readonly TimeOfDay[] = ['morning', 'midday', 'golden', 'dusk', 'night']
/** Unknown / missing values fall back to midday. */
export function normTimeOfDay(v: unknown): TimeOfDay {
  return (TODS as readonly unknown[]).includes(v) ? (v as TimeOfDay) : 'midday'
}

type SiteId = 'courtyard' | 'forecourt'

const TOD_FADE = 4 // s, linear crossfade between time-of-day layers
const SITE_TC = 0.55 // zone-driven site fade (matches the zone channel crossfade)
const EVENT_RADIUS = 40 // m — outdoor sources are gated by the site level anyway
const DISPOSE_AFTER = 5
const FILE_LEVEL = 0.26

interface SiteDef {
  id: SiteId
  canopy: Vec3[]
  ground: Vec3[]
  far: Vec3[]
  water?: { pos: Vec3; half: number }
}

function defs(): Record<SiteId, SiteDef> {
  const of = (kind: string) => SCENE_OBJECTS.filter((o) => o.kind === kind)
  const trees = of('tree').map((t) => [t.position[0], (t.height ?? 5) * 0.7, t.position[2]] as Vec3)
  const beds = of('plant-bed').map((o) => [o.position[0], 0.35, o.position[2]] as Vec3)
  const planters = of('planter')
    .filter((o) => o.zone === 'courtyard')
    .map((o) => [o.position[0], 0.6, o.position[2]] as Vec3)
  const wc = of('water-channel')[0]
  const cy = MUSEUM.wings.courtyard
  const z0 = MUSEUM.wings.atrium.maxZ + MUSEUM.walls.exteriorThickness
  return {
    courtyard: {
      id: 'courtyard',
      canopy: trees.length ? trees : [[(cy.minX + cy.maxX) / 2, 4, (cy.minZ + cy.maxZ) / 2]],
      ground: [...beds, ...planters],
      far: [
        [cy.minX + 2, 6, cy.minZ + 2],
        [cy.maxX - 2, 6, cy.minZ + 2],
      ],
      water: wc ? { pos: [wc.position[0], 0.3, wc.position[2]], half: wc.footprint ? Math.max(0, Math.min(4, wc.footprint[0] / 2 - 1)) : 3 } : undefined,
    },
    forecourt: {
      id: 'forecourt',
      canopy: [
        [-10, 1.2, z0 + 13.8],
        [10, 1.2, z0 + 13.8],
        [-28, 3, z0 + 8],
        [28, 3, z0 + 8],
        [0, 3.5, z0 + 30],
      ],
      ground: [
        [-24, 0.2, z0 + 6],
        [24, 0.2, z0 + 6],
        [-14, 0.2, z0 + 22],
        [14, 0.2, z0 + 22],
        [-6, 0.4, z0 + 13.8],
        [6, 0.4, z0 + 13.8],
      ],
      far: [
        [-50, 6, z0 + 45],
        [50, 6, z0 + 40],
        [0, 8, z0 + 65],
      ],
    },
  }
}

/** How much of a site is heard from where the visitor stands: level and muffling cut-off. */
function audibility(site: SiteId, zone: ZoneId | null, x: number, z: number): { gain: number; lp: number } {
  const outside = z > MUSEUM.wings.shell.maxZ + 0.3 || x < MUSEUM.wings.shell.minX || x > MUSEUM.wings.shell.maxX || z < MUSEUM.wings.shell.minZ
  if (site === 'courtyard') {
    if (outside) return { gain: 0, lp: 1500 }
    switch (zone) {
      case 'courtyard':
        return { gain: 1, lp: 18000 }
      case 'workshop':
        return { gain: 0.16, lp: 2400 }
      case 'gallery-b':
      case 'gallery-c':
        return { gain: 0.1, lp: 2000 }
      case 'reveal':
        return { gain: 0.05, lp: 1500 }
      default:
        return { gain: 0, lp: 1500 }
    }
  }
  if (outside) return { gain: 1, lp: 18000 }
  switch (zone) {
    case 'atrium':
      return { gain: 0.5, lp: 4200 }
    case 'reception':
      return { gain: 0.1, lp: 1800 }
    default:
      return { gain: 0, lp: 1500 }
  }
}

/* ------------------------------------------------------------------ */
/* Layers                                                              */
/* ------------------------------------------------------------------ */

type Schedule = (now: number, horizon: number, lx: number, lz: number) => void

interface Layer {
  tod: TimeOfDay
  kind: 'synth' | 'file'
  gain: GainNode
  kit: Kit | null
  fileSrc: AudioBufferSourceNode | null
  schedule: Schedule | null
  retireAt: number // < 0 while live
}

function ramp(p: AudioParam, ctx: AudioContext, to: number, seconds: number) {
  const now = ctx.currentTime
  p.cancelScheduledValues(now)
  p.setValueAtTime(p.value, now)
  p.linearRampToValueAtTime(to, now + seconds)
}

function makePanners(k: Kit, pts: Vec3[], dest: AudioNode, hrtf: boolean, ref: number) {
  return pts.map((pos) => {
    const p = k.panner(pos, ref, 1, 80)
    if (!hrtf) safe(() => (p.panningModel = 'equalpower'), undefined)
    p.connect(dest)
    return { pos, p }
  })
}

/** Build one time-of-day layer of synthesis for a site. */
function buildLayer(ctx: AudioContext, def: SiteDef, tod: TimeOfDay, out: GainNode, noiseBufs: { pink: AudioBuffer }): { kit: Kit; schedule: Schedule } {
  const k = new Kit(ctx)
  const canopy = makePanners(k, def.canopy, out, true, 3)
  const ground = makePanners(k, def.ground, out, false, 2)
  const far = makePanners(k, def.far, out, false, 6)
  const near = (lx: number, lz: number, s: { pos: Vec3 }) => hdist(lx, lz, s.pos) < EVENT_RADIUS

  // Breeze bed (non-positional; the site bus already carries location/muffling).
  const bed = (level: number, cutoff: number, sway: number) => {
    const src = k.loop(noiseBufs.pink)
    const lp = k.filter('lowpass', cutoff, 0.5)
    k.lfo(rand(0.05, 0.09), cutoff * 0.35, lp.frequency)
    const g = k.gain(level)
    k.lfo(rand(0.06, 0.12), level * sway, g.gain)
    src.connect(k.filter('highpass', 120, 0.5)).connect(lp).connect(g).connect(out)
  }

  const parts: Schedule[] = []

  const birds = (points: typeof canopy, minGap: number, maxGap: number, species: number[], pitch: number, level: number) => {
    const st = points.map((s, i) => ({ s, next: 0, sp: species[i % species.length] }))
    parts.push((now, horizon, lx, lz) => {
      for (const b of st) {
        if (!near(lx, lz, b.s)) continue
        if (b.next < now - 1) b.next = now + rand(0.2, maxGap * 0.6)
        while (b.next < horizon) {
          birdPhrase(ctx, b.s.p, Math.max(now, b.next), Math.random() < 0.75 ? b.sp : pick(species), pitch * rand(0.95, 1.05), level)
          debug.events.birds++
          b.next += rand(minGap, maxGap)
        }
      }
    })
  }

  /** Persistent-oscillator insects: chirps are gated pulses on each voice's gain. */
  const crickets = (count: number, level: number, sparse: boolean) => {
    const voices = ground.slice(0, count).map((s) => {
      const o = k.osc('sine', rand(4200, 5000))
      const g = k.gain(0.0001)
      o.connect(g).connect(s.p)
      return { s, g, next: 0, period: rand(0.45, 0.9), pulses: randInt(3, 5), rate: rand(24, 32), restUntil: 0 }
    })
    parts.push((now, horizon, lx, lz) => {
      for (const v of voices) {
        if (!near(lx, lz, v.s)) continue
        if (v.next < now - 1) v.next = now + rand(0.1, sparse ? 6 : 1.5)
        while (v.next < horizon) {
          const at = Math.max(now, v.next)
          for (let i = 0; i < v.pulses; i++) pulse(v.g.gain, at + i / v.rate, 0.006 * level, 0.003, 0.012)
          debug.events.crickets++
          v.next += v.period * rand(0.95, 1.05)
          // Occasional rests (longer and more frequent at dusk).
          if (Math.random() < (sparse ? 0.12 : 0.03)) v.next += rand(2, sparse ? 10 : 5)
        }
      }
    })
  }

  const frogs = (count: number, level: number) => {
    const pts = def.water ? [...makePanners(k, [def.water.pos], out, false, 2), ...ground] : ground
    const voices = pts.slice(0, count).map((s) => {
      const o = k.osc('sawtooth', rand(150, 240))
      const bp = k.filter('bandpass', rand(480, 720), 2.5)
      const g = k.gain(0.0001)
      o.connect(bp).connect(g).connect(s.p)
      return { s, g, next: 0 }
    })
    parts.push((now, horizon, lx, lz) => {
      for (const v of voices) {
        if (!near(lx, lz, v.s)) continue
        if (v.next < now - 1) v.next = now + rand(0.2, 3)
        while (v.next < horizon) {
          const at = Math.max(now, v.next)
          const n = randInt(3, 7)
          const rate = rand(13, 19)
          for (let i = 0; i < n; i++) pulse(v.g.gain, at + i / rate, 0.012 * level, 0.008, 0.035)
          debug.events.frogs++
          v.next += rand(1.2, 4.5)
        }
      }
    })
  }

  const occasional = (minGap: number, maxGap: number, fn: (t: number) => void) => {
    let next = 0
    parts.push((now, horizon) => {
      if (next < now - 1) next = now + rand(minGap * 0.3, maxGap)
      while (next < horizon) {
        fn(Math.max(now, next))
        next += rand(minGap, maxGap)
      }
    })
  }

  const cuckooLike = () =>
    occasional(14, 35, (t) => {
      const dest = pick(far).p
      const reps = randInt(2, 4)
      const f = rand(640, 760)
      for (let i = 0; i < reps; i++) {
        const at = t + i * 0.75
        tone(ctx, dest, at, { f0: f, f1: f * 0.98, peak: 0.014, attack: 0.03, decay: 0.2 })
        tone(ctx, dest, at + 0.32, { f0: f * 0.8, f1: f * 0.78, peak: 0.012, attack: 0.03, decay: 0.28 })
      }
      debug.events.cuckoos++
    })

  const distantCalls = () =>
    occasional(10, 25, (t) => {
      const dest = pick(far).p
      const reps = randInt(1, 3)
      for (let i = 0; i < reps; i++) tone(ctx, dest, t + i * rand(0.8, 1.1), { f0: rand(1700, 1950), f1: rand(1150, 1300), peak: 0.012, attack: 0.06, decay: 0.55 })
      debug.events.calls++
    })

  const owlLike = () =>
    occasional(25, 60, (t) => {
      const dest = pick([...far, ...canopy]).p
      const f = rand(370, 420)
      const hoot = (at: number, d: number) => tone(ctx, dest, at, { f0: f, f1: f * 0.93, peak: 0.02, attack: 0.06, decay: d })
      hoot(t, 0.32)
      hoot(t + 0.9, 0.16)
      hoot(t + 1.18, 0.34)
      debug.events.owls++
    })

  const leaves = () => {
    let next = 0
    parts.push((now, horizon, lx, lz) => {
      if (next < now - 1) next = now + rand(1, 5)
      while (next < horizon) {
        const s = pick(canopy)
        if (near(lx, lz, s)) {
          const d = rand(0.8, 1.8)
          burst(ctx, s.p, Math.max(now, next), { type: 'highpass', f: rand(2000, 2800), q: 0.5, peak: rand(0.008, 0.014), attack: d * 0.4, decay: d * 0.6 })
          debug.events.leaves++
        }
        next += rand(3, 8)
      }
    })
  }

  switch (tod) {
    case 'morning':
      bed(0.016, 1800, 0.3)
      birds(canopy, 0.8, 3.2, [0, 1, 2, 3], 1, 1)
      birds(ground, 3, 8, [2, 0, 1], 1.05, 0.7)
      cuckooLike()
      break
    case 'midday':
      bed(0.035, 1100, 0.45)
      birds(canopy, 5, 14, [0, 2], 1, 0.8)
      leaves()
      break
    case 'golden':
      bed(0.02, 1200, 0.35)
      birds(canopy, 2.5, 8, [0, 3], 0.88, 0.9)
      distantCalls()
      break
    case 'dusk':
      bed(0.02, 900, 0.35)
      birds(canopy, 9, 22, [0, 3], 0.85, 0.55)
      crickets(Math.min(3, ground.length), 0.6, true)
      break
    case 'night':
      bed(0.025, 600, 0.4)
      crickets(ground.length, 1, false)
      frogs(3, 1)
      owlLike()
      break
  }

  const schedule: Schedule = (now, horizon, lx, lz) => {
    for (const p of parts) safe(() => p(now, horizon, lx, lz), undefined)
  }
  return { kit: k, schedule }
}

/** Time-independent part of a site (the courtyard's trickling water). */
function buildStatic(ctx: AudioContext, def: SiteDef, out: GainNode, white: AudioBuffer): { kit: Kit; schedule: Schedule } | null {
  if (!def.water) return null
  const k = new Kit(ctx)
  const w = def.water
  const ps = [-w.half, 0, w.half].map((dx) => {
    const p = k.panner([w.pos[0] + dx, w.pos[1], w.pos[2]], 1.6, 1.1, 40)
    p.connect(out)
    return p
  })
  const trickle = k.loop(white)
  const g = k.gain(0.035)
  k.lfo(5.3, 0.009, g.gain)
  k.lfo(7.9, 0.007, g.gain)
  trickle.connect(k.filter('bandpass', 2300, 0.6)).connect(k.filter('highpass', 800, 0.5)).connect(g)
  for (const p of ps) g.connect(p)
  let next = 0
  const schedule: Schedule = (now, horizon, lx, lz) => {
    if (hdist(lx, lz, w.pos) >= 25) return
    if (next < now - 0.5) next = now + rand(0, 0.1)
    while (next < horizon) {
      const f0 = rand(480, 1300)
      tone(ctx, pick(ps), Math.max(now, next), { f0, f1: f0 * rand(1.5, 2.4), peak: rand(0.004, 0.013), attack: 0.002, decay: rand(0.018, 0.06) })
      debug.events.bubbles++
      next += Math.random() < 0.3 ? rand(0.02, 0.06) : rand(0.05, 0.25)
    }
  }
  return { kit: k, schedule }
}

/* ------------------------------------------------------------------ */
/* Sites                                                               */
/* ------------------------------------------------------------------ */

interface Site {
  def: SiteDef
  bus: GainNode
  lp: BiquadFilterNode
  staticGain: GainNode
  staticPart: { kit: Kit; schedule: Schedule } | null
  staticOn: boolean
  layers: Layer[]
  target: number
  lpTarget: number
  silentSince: number
}

let siteDefs: Record<SiteId, SiteDef> | null = null
const sites = new Map<SiteId, Site>()
let sitesCtx: AudioContext | null = null

function createSite(ctx: AudioContext, out: AudioNode, def: SiteDef, white: AudioBuffer): Site {
  const bus = ctx.createGain()
  bus.gain.value = 0
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 18000
  lp.Q.value = 0.5
  bus.connect(lp).connect(out)
  const staticGain = ctx.createGain()
  staticGain.gain.value = 1
  staticGain.connect(bus)
  const site: Site = { def, bus, lp, staticGain, staticPart: safe(() => buildStatic(ctx, def, staticGain, white), null), staticOn: true, layers: [], target: -1, lpTarget: -1, silentSince: -1 }
  sites.set(def.id, site)
  return site
}

function disposeLayer(l: Layer) {
  safe(() => l.kit?.dispose(), undefined)
  safe(() => l.fileSrc?.stop(), undefined)
  safe(() => l.fileSrc?.disconnect(), undefined)
  safe(() => l.gain.disconnect(), undefined)
}

function disposeSite(s: Site) {
  for (const l of s.layers) disposeLayer(l)
  s.layers.length = 0
  safe(() => s.staticPart?.kit.dispose(), undefined)
  for (const n of [s.staticGain, s.bus, s.lp]) safe(() => n.disconnect(), undefined)
  sites.delete(s.def.id)
  for (const key of Object.keys(debug.levels)) if (key.startsWith(`${s.def.id}:`) || key === `site:${s.def.id}`) delete debug.levels[key]
  delete debug.sources[`site:${s.def.id}`]
}

export interface OutdoorFrame {
  ctx: AudioContext
  out: AudioNode
  now: number
  horizon: number
  active: boolean
  zone: ZoneId | null
  x: number
  z: number
  tod: TimeOfDay
  noise: { white: AudioBuffer; pink: AudioBuffer }
}

/** Advance the outdoor sites one scheduler tick. Returns true while any site exists. */
export function updateOutdoor(f: OutdoorFrame): boolean {
  if (sitesCtx && sitesCtx !== f.ctx) {
    for (const s of [...sites.values()]) disposeSite(s)
  }
  sitesCtx = f.ctx
  siteDefs ??= defs()
  debug.timeOfDay = f.tod
  for (const id of ['courtyard', 'forecourt'] as const) {
    const aud = f.active ? audibility(id, f.zone, f.x, f.z) : { gain: 0, lp: 1500 }
    let site = sites.get(id)
    if (!site) {
      if (aud.gain <= 0) continue
      site = createSite(f.ctx, f.out, siteDefs[id], f.noise.white)
    }
    safe(() => updateSite(site, f, aud), undefined)
  }
  return sites.size > 0
}

function updateSite(s: Site, f: OutdoorFrame, aud: { gain: number; lp: number }) {
  const { ctx, now } = f
  if (aud.gain !== s.target) {
    s.target = aud.gain
    s.bus.gain.setTargetAtTime(aud.gain, now, SITE_TC)
  }
  if (aud.lp !== s.lpTarget) {
    s.lpTarget = aud.lp
    s.lp.frequency.setTargetAtTime(aud.lp, now, SITE_TC)
  }
  const level = s.bus.gain.value
  debug.levels[`site:${s.def.id}`] = Math.round(level * 1000) / 1000

  // Retire faded layers.
  for (const l of [...s.layers]) {
    if (l.retireAt >= 0 && now - l.retireAt > TOD_FADE + 0.5) {
      disposeLayer(l)
      s.layers.splice(s.layers.indexOf(l), 1)
      delete debug.levels[`${s.def.id}:${l.tod}:${l.kind}`]
    }
  }

  if (s.target <= 0 && level < 0.002) {
    if (s.silentSince < 0) s.silentSince = now
    else if (now - s.silentSince > DISPOSE_AFTER) disposeSite(s)
    return
  }
  s.silentSince = -1
  if (!f.active) return

  // Which layer should be playing for the current time of day?
  const urls = [ambienceUrl(`${s.def.id}-${f.tod}`), ambienceUrl(s.def.id)]
  const known = knownFirst(urls)
  if (known === undefined) void loadFirst(ctx, urls)
  const kind: Layer['kind'] = known ? 'file' : 'synth'
  let cur = s.layers.find((l) => l.retireAt < 0 && l.tod === f.tod && l.kind === kind)
  if (!cur) {
    const layer = safe(() => createLayer(s, f, kind, known ?? null), null)
    if (layer) {
      s.layers.push(layer)
      cur = layer
    }
  }
  for (const l of s.layers) {
    if (l !== cur && l.retireAt < 0) {
      l.retireAt = now
      safe(() => ramp(l.gain.gain, ctx, 0, TOD_FADE), undefined)
    }
  }
  // A recording replaces all of the site's synthesis, the water included.
  const wantStatic = kind === 'synth'
  if (wantStatic !== s.staticOn) {
    s.staticOn = wantStatic
    safe(() => ramp(s.staticGain.gain, ctx, wantStatic ? 1 : 0, TOD_FADE), undefined)
  }
  debug.sources[`site:${s.def.id}`] = kind

  const lx = f.x
  const lz = f.z
  if (s.staticOn && s.staticPart) s.staticPart.schedule(now, f.horizon, lx, lz)
  for (const l of s.layers) {
    const lv = l.gain.gain.value
    debug.levels[`${s.def.id}:${l.tod}:${l.kind}`] = Math.round(lv * 1000) / 1000
    if (l.schedule && (l.retireAt < 0 || lv > 0.02)) l.schedule(now, f.horizon, lx, lz)
  }
}

function createLayer(s: Site, f: OutdoorFrame, kind: Layer['kind'], buf: AudioBuffer | null): Layer {
  const { ctx } = f
  const gain = ctx.createGain()
  gain.gain.value = 0
  gain.connect(s.bus)
  const layer: Layer = { tod: f.tod, kind, gain, kit: null, fileSrc: null, schedule: null, retireAt: -1 }
  if (kind === 'file' && buf) {
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    src.connect(gain)
    src.start(ctx.currentTime, Math.random() * buf.duration)
    layer.fileSrc = src
    ramp(gain.gain, ctx, FILE_LEVEL, TOD_FADE)
  } else {
    const built = buildLayer(ctx, s.def, f.tod, gain, f.noise)
    layer.kit = built.kit
    layer.schedule = built.schedule
    // First layer of a new site starts at once (the site bus does the fade-in).
    if (s.layers.length === 0) gain.gain.value = 1
    else ramp(gain.gain, ctx, 1, TOD_FADE)
  }
  return layer
}
