/**
 * PROCEDURAL PBR TEXTURES — generated at runtime into typed arrays (no network,
 * no image files). Every set is seamlessly tileable and physically scaled: one
 * texture tile covers `TEXTURE_TILE_METRES[kind]` metres, so with metre UVs a
 * material uses `texture.repeat = 1 / tileMetres`.
 *
 * Maps per set:
 *   map          albedo, sRGB
 *   roughnessMap linear, value in all channels (three reads G)
 *   normalMap    linear, OpenGL convention (+Y = +V), derived from a height field
 */

import * as THREE from 'three'
import { TileNoise, clamp01, hash2, lerp, mulberry32, smoothstep } from './noise'

export type TextureKind = 'oakFloor' | 'plaster' | 'timber' | 'walnut' | 'stone' | 'linen'

/** Physical size (metres) covered by one texture tile. */
export const TEXTURE_TILE_METRES: Record<TextureKind, number> = {
  oakFloor: 3.2,
  plaster: 2.0,
  timber: 1.2,
  walnut: 1.2,
  stone: 2.4,
  linen: 0.2,
}

export interface PBRTextureSet {
  kind: TextureKind
  size: number
  tileMetres: number
  map: THREE.DataTexture
  roughnessMap: THREE.DataTexture
  normalMap: THREE.DataTexture
}

/** Raw generator output before upload. */
interface Fields {
  albedo: Uint8ClampedArray // RGBA sRGB
  rough: Float32Array // 0..1
  height: Float32Array // metres
  /** Exaggeration applied to the physical height slope when deriving normals. */
  normalStrength: number
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

type RGB = [number, number, number]
const hex = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const frac = (x: number) => x - Math.floor(x)

function allocate(size: number): Fields {
  const n = size * size
  return {
    albedo: new Uint8ClampedArray(n * 4),
    rough: new Float32Array(n),
    height: new Float32Array(n),
    normalStrength: 1,
  }
}

function putRGB(a: Uint8ClampedArray, i: number, r: number, g: number, b: number) {
  const o = i * 4
  a[o] = r
  a[o + 1] = g
  a[o + 2] = b
  a[o + 3] = 255
}

/** Height (metres) → tangent-space normal map bytes, wrapping at the edges. */
function heightToNormal(h: Float32Array, size: number, pixelMetres: number, strength: number): Uint8Array {
  const out = new Uint8Array(size * size * 4)
  const k = strength / (2 * pixelMetres)
  for (let y = 0; y < size; y++) {
    const ym = (y === 0 ? size : y) - 1
    const yp = y === size - 1 ? 0 : y + 1
    for (let x = 0; x < size; x++) {
      const xm = (x === 0 ? size : x) - 1
      const xp = x === size - 1 ? 0 : x + 1
      const dx = (h[y * size + xp] - h[y * size + xm]) * k
      const dy = (h[yp * size + x] - h[ym * size + x]) * k
      // n = normalize(-dh/du, -dh/dv, 1)
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1)
      const o = (y * size + x) * 4
      out[o] = Math.round((-dx * inv * 0.5 + 0.5) * 255)
      out[o + 1] = Math.round((-dy * inv * 0.5 + 0.5) * 255)
      out[o + 2] = Math.round((inv * 0.5 + 0.5) * 255)
      out[o + 3] = 255
    }
  }
  return out
}

function roughToBytes(r: Float32Array): Uint8Array {
  const out = new Uint8Array(r.length * 4)
  for (let i = 0; i < r.length; i++) {
    const v = Math.round(clamp01(r[i]) * 255)
    const o = i * 4
    out[o] = v
    out[o + 1] = v
    out[o + 2] = v
    out[o + 3] = 255
  }
  return out
}

function makeDataTexture(data: Uint8Array, size: number, srgb: boolean, name: string): THREE.DataTexture {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType)
  t.name = name
  t.wrapS = THREE.RepeatWrapping
  t.wrapT = THREE.RepeatWrapping
  t.magFilter = THREE.LinearFilter
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.generateMipmaps = true
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  t.needsUpdate = true
  return t
}

/**
 * Periodic field sampled on a coarse (resU x resV) grid and bilinearly
 * upsampled on lookup — a big speed-up for low-frequency content.
 * `fn` receives tile coordinates u, v in [0, 1); lookups wrap.
 */
function coarseField(resU: number, resV: number, fn: (u: number, v: number) => number): (u: number, v: number) => number {
  const g = new Float32Array(resU * resV)
  for (let j = 0; j < resV; j++) for (let i = 0; i < resU; i++) g[j * resU + i] = fn(i / resU, j / resV)
  return (u: number, v: number) => {
    let x = u * resU
    let y = v * resV
    x -= Math.floor(x / resU) * resU
    y -= Math.floor(y / resV) * resV
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const tx = x - x0
    const ty = y - y0
    const x1 = x0 + 1 === resU ? 0 : x0 + 1
    const y1 = y0 + 1 === resV ? 0 : y0 + 1
    const a = g[y0 * resU + x0]
    const b = g[y0 * resU + x1]
    const c = g[y1 * resU + x0]
    const d = g[y1 * resU + x1]
    const ab = a + (b - a) * tx
    const cd = c + (d - c) * tx
    return ab + (cd - ab) * ty
  }
}

/* ------------------------------------------------------------------ */
/* Oak floor                                                           */
/* ------------------------------------------------------------------ */

function genOakFloor(size: number): Fields {
  const f = allocate(size)
  const T = TEXTURE_TILE_METRES.oakFloor
  const ppm = size / T
  const px = T / size
  const noise = new TileNoise(7)
  const rnd = mulberry32(1931)

  const COLS = 17 // 3.2 m / 17 = 0.188 m boards (wraps exactly)
  const colW = T / COLS

  // Two boards per column (lengths 1.2–2.0, summing to the tile) with staggered joints.
  const offs = new Float32Array(COLS)
  const len1 = new Float32Array(COLS)
  for (let c = 0; c < COLS; c++) {
    let o = 0
    let l = 1.6
    for (let attempt = 0; attempt < 40; attempt++) {
      o = rnd() * T
      l = 1.2 + rnd() * 0.8
      const prev = c > 0 ? [offs[c - 1], (offs[c - 1] + len1[c - 1]) % T] : []
      const mine = [o, (o + l) % T]
      let ok = true
      for (const a of mine)
        for (const b of prev) {
          const d = Math.abs(a - b)
          if (Math.min(d, T - d) < 0.32) ok = false
        }
      // also avoid lining up with the column two to the left
      if (c > 1) {
        const pp = [offs[c - 2], (offs[c - 2] + len1[c - 2]) % T]
        for (const a of mine)
          for (const b of pp) {
            const d = Math.abs(a - b)
            if (Math.min(d, T - d) < 0.12) ok = false
          }
      }
      if (ok) break
    }
    offs[c] = o
    len1[c] = l
  }

  // Per-board character.
  interface Board {
    tone: number
    warm: number
    rough: number
    pith: number
    slope: number
    ringFreq: number
    shift: number
    seed: number
  }
  const boards: Board[] = []
  for (let c = 0; c < COLS; c++)
    for (let p = 0; p < 2; p++) {
      const s = hash2(c, p, 11)
      const r2 = mulberry32(Math.floor(s * 1e9))
      boards.push({
        tone: r2() * 2 - 1,
        warm: r2() * 2 - 1,
        rough: (r2() * 2 - 1) * 0.035,
        pith: 0.03 + r2() * 0.16,
        slope: (r2() * 2 - 1) * 0.05,
        ringFreq: 190 + r2() * 110,
        shift: (r2() * 2 - 1) * 0.08,
        seed: r2() * 200,
      })
    }

  const light = hex('#dcc19b')
  const dark = hex('#cfae84')
  const gapCol = hex('#5e4834')

  const gapHalf = 0.0006 // 1.2 mm joints
  const bevel = Math.max(0.0016, 1.6 * px)
  const streakFreq = Math.min(700, ppm * 0.33) // cycles/m across the board, kept below Nyquist
  const PER = 4096
  const warpF = coarseField(Math.min(size, 512), 128, (a, c) => noise.fbm(a * 45, c * 7, 45, 7, 3))
  const mottF = coarseField(256, 64, (a, c) => noise.fbm(a * 16, c * 4, 16, 4, 3))
  const floorF = coarseField(128, 128, (a, c) => noise.fbm(a * 3, c * 3, 3, 3, 3))

  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * px
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * px
      const i = y * size + x
      const c = Math.min(COLS - 1, Math.floor(u / colW))
      const across = u - c * colW
      let t = v - offs[c]
      t = t - Math.floor(t / T) * T
      const first = t < len1[c]
      const L = first ? len1[c] : T - len1[c]
      const along = first ? t : t - len1[c]
      const b = boards[c * 2 + (first ? 0 : 1)]

      // Distances to joints.
      const dSide = Math.min(across, colW - across)
      const dEnd = Math.min(along, L - along)
      const dEdge = Math.min(dSide, dEnd)

      // Growth rings: flat-sawn cathedral figure from a tilted cut through a cylinder.
      const d = across - colW * 0.5 + b.shift
      const hgt = b.pith + b.slope * (along - L * 0.5)
      const bs = b.seed / 200
      const warp = warpF(u / T + bs * 0.31, v / T + bs) * 1.3
      const r = Math.sqrt(d * d + hgt * hgt)
      const ph = frac(r * b.ringFreq + warp)
      const late = smoothstep(0.62, 0.9, ph) * (1 - smoothstep(0.9, 1.0, ph))

      // Fine open-pore streaks along the board.
      const streak = noise.noise(across * streakFreq + b.seed * 3, along * 6 + b.seed, PER, PER)
      // Soft mottling within a board and across the floor.
      const mott = mottF(u / T + bs * 0.53, v / T + bs * 0.77)
      const floorMott = floorF(u / T, v / T)

      let k = 0.5 + b.tone * 0.32 + mott * 0.18 + floorMott * 0.1
      k = clamp01(k)
      let rr = lerp(dark[0], light[0], k)
      let gg = lerp(dark[1], light[1], k)
      let bb = lerp(dark[2], light[2], k)
      // warmth shift per board
      rr += b.warm * 2.5
      bb -= b.warm * 3
      const shade = 1 - late * 0.06 + streak * 0.024
      rr *= shade
      gg *= shade
      bb *= shade * (1 - late * 0.02)

      // Slight darkening of eased edges, then the joint itself.
      const edgeDark = 1 - 0.05 * smoothstep(bevel, 0, dEdge)
      rr *= edgeDark
      gg *= edgeDark
      bb *= edgeDark
      const gap = clamp01((gapHalf - dEdge) * ppm + 0.5)
      rr = lerp(rr, gapCol[0], gap)
      gg = lerp(gg, gapCol[1], gap)
      bb = lerp(bb, gapCol[2], gap)
      putRGB(f.albedo, i, rr, gg, bb)

      f.rough[i] = lerp(0.44 + b.rough + late * 0.035 - streak * 0.012 + mott * 0.02, 0.78, gap)

      const e = smoothstep(bevel, 0, dEdge)
      f.height[i] = -0.0009 * e * e - late * 0.00003 + streak * 0.000015 - gap * 0.0006
    }
  }
  f.normalStrength = 1
  return f
}

/* ------------------------------------------------------------------ */
/* Plaster                                                             */
/* ------------------------------------------------------------------ */

function genPlaster(size: number): Fields {
  const f = allocate(size)
  const noise = new TileNoise(23)
  const noise2 = new TileNoise(71)
  const fine = Math.max(8, Math.round(Math.min(size / 3, 360))) // speckle cells per tile

  const cr = Math.min(size, 256)
  const mottF = coarseField(cr, cr, (u, v) => noise.fbm(u * 3, v * 3, 3, 3, 4) * 0.7 + noise2.fbm(u * 8, v * 8, 8, 8, 2) * 0.3)
  const sweepF = coarseField(cr, cr, (u, v) => noise.fbm(u * 6 + 0.3, v * 4, 6, 4, 4))
  const creaseF = coarseField(cr, cr, (u, v) => noise2.ridged(u * 5, v * 7, 5, 7, 3))

  for (let y = 0; y < size; y++) {
    const v = y / size
    for (let x = 0; x < size; x++) {
      const u = x / size
      const i = y * size + x
      // Extremely subtle low-frequency mottling (±2 %).
      const m = mottF(u, v)
      const s = noise2.value(u * fine, v * fine, fine, fine)
      const base = 249 * (1 + m * 0.02 + s * 0.004)
      putRGB(f.albedo, i, base, base, base * 0.998)

      // Trowel: broad soft sweeps + creased ridges + fine sand.
      const sweep = sweepF(u, v)
      const crease = creaseF(u, v)
      const sand = noise.noise(u * fine, v * fine, fine, fine)
      f.height[i] = sweep * 0.00018 + crease * 0.00006 + sand * 0.000012
      f.rough[i] = 0.9 + sweep * 0.035 + s * 0.015 - crease * 0.02
    }
  }
  f.normalStrength = 1
  return f
}

/* ------------------------------------------------------------------ */
/* Timber (brushed oak) and walnut                                     */
/* ------------------------------------------------------------------ */

function genTimber(size: number, walnut: boolean): Fields {
  const f = allocate(size)
  const T = TEXTURE_TILE_METRES.timber
  const ppm = size / T
  const noise = new TileNoise(walnut ? 97 : 41)
  const noise2 = new TileNoise(walnut ? 131 : 53)

  const light = walnut ? hex('#6b4a33') : hex('#e0cba9')
  const dark = walnut ? hex('#3e2a1d') : hex('#cdb38e')
  const ringsPerTile = walnut ? 84 : 210
  const streakCells = Math.round(Math.min(900, ppm * 0.33) * T)
  const streakAlong = 3
  const figureAmp = walnut ? 3.2 : 7
  const streakHalf = Math.max(1, Math.round(streakCells * 0.5))
  const warpF = coarseField(256, 128, (u, v) =>
    noise.fbm(u * 3, v * (walnut ? 1 : 2), 3, walnut ? 1 : 2, 4) * figureAmp + noise2.fbm(u * 12, v * 3, 12, 3, 2) * (walnut ? 0.5 : 0.8),
  )
  const mottF = coarseField(128, 64, (u, v) => noise2.fbm(u * 4, v * 2, 4, 2, 3))

  for (let y = 0; y < size; y++) {
    const v = y / size
    for (let x = 0; x < size; x++) {
      const u = x / size
      const i = y * size + x
      // Rings run along V; warp gives a gentle flat-sawn figure.
      const warp = warpF(u, v)
      const ph = frac(u * ringsPerTile + warp)
      const late = smoothstep(0.55, 0.88, ph) * (1 - smoothstep(0.88, 1.0, ph))
      // Brushed: fine streaks along the grain.
      const streak =
        noise.noise(u * streakCells, v * streakAlong, streakCells, streakAlong) * 0.7 +
        noise2.noise(u * streakHalf, v * streakAlong * 2, streakHalf, streakAlong * 2) * 0.3
      const mott = mottF(u, v)

      const k = clamp01(0.55 + mott * 0.28 - late * (walnut ? 0.32 : 0.4))
      const sh = 1 + streak * (walnut ? 0.05 : 0.035)
      putRGB(
        f.albedo,
        i,
        lerp(dark[0], light[0], k) * sh,
        lerp(dark[1], light[1], k) * sh,
        lerp(dark[2], light[2], k) * sh,
      )
      f.rough[i] = (walnut ? 0.5 : 0.6) + streak * 0.05 + late * 0.04 + mott * 0.02
      f.height[i] = streak * 0.00002 - late * 0.00002
    }
  }
  f.normalStrength = 1
  return f
}

/* ------------------------------------------------------------------ */
/* Stone paving                                                        */
/* ------------------------------------------------------------------ */

function genStone(size: number): Fields {
  const f = allocate(size)
  const T = TEXTURE_TILE_METRES.stone
  const ppm = size / T
  const px = T / size
  const noise = new TileNoise(313)
  const noise2 = new TileNoise(5)
  const SLAB = 0.6
  const N = Math.round(T / SLAB)
  const base = hex('#d2cdc4')
  const joint = hex('#9d978d')
  const jointHalf = 0.003
  const arris = Math.max(0.002, 1.5 * px)
  const speck = Math.max(8, Math.round(Math.min(size / 2.2, 900)))
  const speckHalf = Math.max(4, Math.round(speck / 2))
  const mottF = coarseField(Math.min(size, 256), Math.min(size, 256), (a, c) => noise.fbm(a * 6, c * 6, 6, 6, 4))

  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) * px
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * px
      const i = y * size + x
      const sx = Math.floor(u / SLAB)
      const sy = Math.floor(v / SLAB)
      const lu = u - sx * SLAB
      const lv = v - sy * SLAB
      const dEdge = Math.min(lu, SLAB - lu, lv, SLAB - lv)
      const slabTone = hash2(sx % N, sy % N, 3) * 2 - 1
      const slabWarm = hash2(sx % N, sy % N, 9) * 2 - 1

      const uu = u / T
      const vv = v / T
      const mott = mottF(uu, vv)
      const grain = noise2.value(uu * speck, vv * speck, speck, speck)
      const fleck = smoothstep(0.55, 0.8, noise2.value(uu * speckHalf + 7, vv * speckHalf, speckHalf, speckHalf))

      const sh = 1 + slabTone * 0.035 + mott * 0.03 + grain * 0.025 - fleck * 0.07
      let r = base[0] * sh + slabWarm * 2
      let g = base[1] * sh
      let b = base[2] * sh - slabWarm * 2
      const gap = clamp01((jointHalf - dEdge) * ppm + 0.5)
      r = lerp(r, joint[0], gap)
      g = lerp(g, joint[1], gap)
      b = lerp(b, joint[2], gap)
      putRGB(f.albedo, i, r, g, b)

      f.rough[i] = lerp(0.82 + grain * 0.05 + mott * 0.03 - fleck * 0.06, 0.95, gap)
      const e = smoothstep(arris, 0, dEdge)
      f.height[i] = -0.0015 * e * e + grain * 0.00004 + mott * 0.0002 + slabTone * 0.0001 - gap * 0.001
    }
  }
  f.normalStrength = 1
  return f
}

/* ------------------------------------------------------------------ */
/* Linen / cotton plain weave                                          */
/* ------------------------------------------------------------------ */

function genLinen(size: number): Fields {
  const f = allocate(size)
  const T = TEXTURE_TILE_METRES.linen
  // ~1.25 mm thread pitch, but never finer than ~3 px per thread.
  const threads = Math.max(32, Math.min(160, Math.floor(size / 3.2)))
  const noise = new TileNoise(19)
  const threadW = 1 / threads // in tile units
  const tH = (T / threads) * 0.18 // thread relief in metres

  // Per-thread thickness (slubs vary along the thread too).
  const warpThick = new Float32Array(threads)
  const weftThick = new Float32Array(threads)
  const warpTone = new Float32Array(threads)
  const weftTone = new Float32Array(threads)
  for (let t = 0; t < threads; t++) {
    warpThick[t] = 0.75 + hash2(t, 1, 5) * 0.25
    weftThick[t] = 0.75 + hash2(t, 2, 5) * 0.25
    warpTone[t] = hash2(t, 3, 5) * 2 - 1
    weftTone[t] = hash2(t, 4, 5) * 2 - 1
  }
  const slubCells = 24
  const fibreCells = Math.max(threads, Math.round(Math.min(threads * 4, size / 2.5)))

  for (let y = 0; y < size; y++) {
    const v = y / size
    const tv = v / threadW
    const j = Math.floor(tv) % threads
    const fv = tv - Math.floor(tv)
    for (let x = 0; x < size; x++) {
      const u = x / size
      const tu = u / threadW
      const iT = Math.floor(tu) % threads
      const fu = tu - Math.floor(tu)
      const idx = y * size + x
      const warpTop = ((iT + j) & 1) === 0
      // Slub variation along each thread
      const slubWarp = noise.value(iT * 3.1, v * slubCells, 4096, slubCells) * 0.25
      const slubWeft = noise.value(u * slubCells, j * 3.7 + 50, slubCells, 4096) * 0.25
      const wThick = clamp01(warpThick[iT] + slubWarp)
      const fThick = clamp01(weftThick[j] + slubWeft)

      // Profile across a thread (0 at its edges, 1 at its crown) limited by its thickness.
      const prof = (fc: number, th: number) => {
        const dd = Math.abs(fc - 0.5) * 2 // 0 centre .. 1 edge
        const w = 0.55 + th * 0.45
        return dd >= w ? 0 : Math.sqrt(1 - (dd / w) * (dd / w))
      }
      const warpP = prof(fu, wThick) * (0.55 + 0.45 * Math.sin(Math.PI * fv))
      const weftP = prof(fv, fThick) * (0.55 + 0.45 * Math.sin(Math.PI * fu))
      let h: number
      let tone: number
      if (warpTop) {
        h = warpP > 0.05 ? 0.5 + warpP * 0.5 : weftP * 0.45
        tone = warpP > 0.05 ? warpTone[iT] + slubWarp : weftTone[j] + slubWeft
      } else {
        h = weftP > 0.05 ? 0.5 + weftP * 0.5 : warpP * 0.45
        tone = weftP > 0.05 ? weftTone[j] + slubWeft : warpTone[iT] + slubWarp
      }
      const fibre = noise.noise(u * fibreCells, v * fibreCells, fibreCells, fibreCells)
      const sh = (0.8 + 0.2 * h) * (1 + tone * 0.03 + fibre * 0.02)
      const base = 238 * sh
      putRGB(f.albedo, idx, base, base * 0.995, base * 0.985)
      f.rough[idx] = 0.88 + (1 - h) * 0.08 + fibre * 0.02
      f.height[idx] = h * tH + fibre * tH * 0.04
    }
  }
  f.normalStrength = 0.7
  return f
}

/* ------------------------------------------------------------------ */
/* Cache & public API                                                  */
/* ------------------------------------------------------------------ */

const GENERATORS: Record<TextureKind, (size: number) => Fields> = {
  oakFloor: genOakFloor,
  plaster: genPlaster,
  timber: (s) => genTimber(s, false),
  walnut: (s) => genTimber(s, true),
  stone: genStone,
  linen: genLinen,
}

const cache = new Map<string, PBRTextureSet>()

/**
 * Get (generating on first use) the PBR texture set for `kind` at `size` px.
 * Cached per (kind, size). `anisotropy` is applied to all three maps each call
 * (re-upload is triggered only when it actually changes).
 */
export function getTextureSet(kind: TextureKind, size: number, anisotropy = 4): PBRTextureSet {
  const key = `${kind}:${size}`
  let set = cache.get(key)
  if (!set) {
    const fields = GENERATORS[kind](size)
    const tile = TEXTURE_TILE_METRES[kind]
    const px = tile / size
    const albedo = new Uint8Array(fields.albedo.buffer)
    set = {
      kind,
      size,
      tileMetres: tile,
      map: makeDataTexture(albedo, size, true, `${kind}-albedo`),
      roughnessMap: makeDataTexture(roughToBytes(fields.rough), size, false, `${kind}-roughness`),
      normalMap: makeDataTexture(heightToNormal(fields.height, size, px, fields.normalStrength), size, false, `${kind}-normal`),
    }
    cache.set(key, set)
  }
  for (const t of [set.map, set.roughnessMap, set.normalMap]) {
    if (t.anisotropy !== anisotropy) {
      t.anisotropy = anisotropy
      if (t.version > 0) t.needsUpdate = true
    }
  }
  return set
}

/** Dispose cached texture sets, except those whose size is in `keepSizes` (keep none if omitted). */
export function disposeTextureSets(...keepSizes: number[]): void {
  for (const [key, set] of cache) {
    if (keepSizes.includes(set.size)) continue
    set.map.dispose()
    set.roughnessMap.dispose()
    set.normalMap.dispose()
    cache.delete(key)
  }
}
