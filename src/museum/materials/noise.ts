/**
 * Small, fast, tileable noise helpers for runtime texture generation.
 *
 * All lattice noise here is PERIODIC: `noise(x, y, px, py)` repeats every `px`
 * lattice units in x and `py` in y, so a texture that samples it over exactly
 * [0, px) x [0, py) tiles seamlessly. fBm doubles frequency *and* period per
 * octave (integer lacunarity 2), which keeps every octave periodic.
 */

/** Seeded PRNG (mulberry32) — returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Integer hash → [0, 1). Stateless; handy for per-cell / per-plank randoms. */
export function hash2(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
const smooth = (t: number) => t * t * (3 - 2 * t)

const GRAD_COUNT = 16
const GX = new Float32Array(GRAD_COUNT)
const GY = new Float32Array(GRAD_COUNT)
for (let i = 0; i < GRAD_COUNT; i++) {
  const a = (i / GRAD_COUNT) * Math.PI * 2 + 0.19
  GX[i] = Math.cos(a)
  GY[i] = Math.sin(a)
}

/** Positive modulo that is safe for negatives. */
const pmod = (a: number, n: number) => ((a % n) + n) % n

/**
 * Periodic 2D gradient (Perlin-style) and value noise sharing one seeded
 * permutation table.
 */
export class TileNoise {
  private perm: Uint16Array
  private vals: Float32Array

  constructor(seed = 1) {
    const rnd = mulberry32(seed)
    const p = new Uint16Array(512)
    const base = new Uint16Array(256)
    for (let i = 0; i < 256; i++) base[i] = i
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1))
      const t = base[i]
      base[i] = base[j]
      base[j] = t
    }
    for (let i = 0; i < 512; i++) p[i] = base[i & 255]
    this.perm = p
    this.vals = new Float32Array(256)
    for (let i = 0; i < 256; i++) this.vals[i] = rnd() * 2 - 1
  }

  private h(ix: number, iy: number): number {
    // ix, iy already wrapped to their periods; periods up to 2^16 are fine.
    const p = this.perm
    const a = p[p[ix & 255] + (iy & 255)]
    return p[(a + (ix >> 8) * 31 + (iy >> 8)) & 255]
  }

  /** Periodic gradient noise in roughly [-1, 1]. Periods are lattice units (integers ≥ 1). */
  noise(x: number, y: number, px = 256, py = 256): number {
    const fx = Math.floor(x)
    const fy = Math.floor(y)
    const tx = x - fx
    const ty = y - fy
    const x0 = pmod(fx, px)
    const y0 = pmod(fy, py)
    const x1 = x0 + 1 === px ? 0 : x0 + 1
    const y1 = y0 + 1 === py ? 0 : y0 + 1
    const g00 = this.h(x0, y0) & 15
    const g10 = this.h(x1, y0) & 15
    const g01 = this.h(x0, y1) & 15
    const g11 = this.h(x1, y1) & 15
    const n00 = GX[g00] * tx + GY[g00] * ty
    const n10 = GX[g10] * (tx - 1) + GY[g10] * ty
    const n01 = GX[g01] * tx + GY[g01] * (ty - 1)
    const n11 = GX[g11] * (tx - 1) + GY[g11] * (ty - 1)
    const u = fade(tx)
    const v = fade(ty)
    const a = n00 + (n10 - n00) * u
    const b = n01 + (n11 - n01) * u
    return (a + (b - a) * v) * 1.41
  }

  /** Periodic value noise in [-1, 1] (softer, blobbier than gradient noise). */
  value(x: number, y: number, px = 256, py = 256): number {
    const fx = Math.floor(x)
    const fy = Math.floor(y)
    const tx = smooth(x - fx)
    const ty = smooth(y - fy)
    const x0 = pmod(fx, px)
    const y0 = pmod(fy, py)
    const x1 = x0 + 1 === px ? 0 : x0 + 1
    const y1 = y0 + 1 === py ? 0 : y0 + 1
    const v = this.vals
    const a = v[this.h(x0, y0)]
    const b = v[this.h(x1, y0)]
    const c = v[this.h(x0, y1)]
    const d = v[this.h(x1, y1)]
    const ab = a + (b - a) * tx
    const cd = c + (d - c) * tx
    return ab + (cd - ab) * ty
  }

  /**
   * Periodic fBm. `x, y` are in base-octave lattice units with periods `px, py`;
   * each octave doubles frequency and period, so the sum stays tileable.
   * Normalised to roughly [-1, 1].
   */
  fbm(x: number, y: number, px: number, py: number, octaves = 4, gain = 0.5): number {
    let sum = 0
    let amp = 1
    let norm = 0
    let f = 1
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise(x * f, y * f, px * f, py * f)
      norm += amp
      amp *= gain
      f *= 2
    }
    return sum / norm
  }

  /** Ridged periodic fBm in [0, 1] (sharp creases — trowel marks, stone veins). */
  ridged(x: number, y: number, px: number, py: number, octaves = 3, gain = 0.5): number {
    let sum = 0
    let amp = 1
    let norm = 0
    let f = 1
    for (let o = 0; o < octaves; o++) {
      const n = 1 - Math.abs(this.noise(x * f, y * f, px * f, py * f))
      sum += amp * n * n
      norm += amp
      amp *= gain
      f *= 2
    }
    return sum / norm
  }
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}
