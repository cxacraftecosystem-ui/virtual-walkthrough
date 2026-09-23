/**
 * Geometry builder for the wall-decor system: turns config/decor.ts treatments into one
 * merged BufferGeometry per (material, role, shadow) bucket, in world space, with metre
 * UVs that are continuous along each wall (so patterns line up across door splits).
 *
 * Everything is quads. Layers are clipped to the solid parts of the walls on their plane
 * (WALLS boxes whose face lies on it), minus reserve / exclusive rectangles.
 */
import * as THREE from 'three'
import type { DecorFace, DecorGroup, DecorRect, DecorTreatment, DecorUV, Range } from '../config/decor'
import { WALLS } from '../config/layout'
import { QUALITY_ORDER, type QualityTier } from '../config/quality'
import type { DecorMaterialKey } from '../materials/decorMaterials'

export interface DecorBucket {
  key: string
  material: DecorMaterialKey
  cast: boolean
  geometry: THREE.BufferGeometry
}

type V3 = [number, number, number]
const EPS = 1e-5
const FIELD_OFFSET = 0.0015

/* ------------------------------------------------------------------ */
/* rectangles                                                          */
/* ------------------------------------------------------------------ */

interface R {
  r0: number
  r1: number
  y0: number
  y1: number
}

const fromDecor = (d: DecorRect): R => ({ r0: Math.min(d.run[0], d.run[1]), r1: Math.max(d.run[0], d.run[1]), y0: d.y[0], y1: d.y[1] })
const valid = (a: R) => a.r1 - a.r0 > EPS && a.y1 - a.y0 > EPS

function intersect(a: R, b: R): R | null {
  const r = { r0: Math.max(a.r0, b.r0), r1: Math.min(a.r1, b.r1), y0: Math.max(a.y0, b.y0), y1: Math.min(a.y1, b.y1) }
  return valid(r) ? r : null
}

function subtract(a: R, b: R): R[] {
  const i = intersect(a, b)
  if (!i) return [a]
  const out: R[] = [
    { r0: a.r0, r1: i.r0, y0: a.y0, y1: a.y1 },
    { r0: i.r1, r1: a.r1, y0: a.y0, y1: a.y1 },
    { r0: i.r0, r1: i.r1, y0: a.y0, y1: i.y0 },
    { r0: i.r0, r1: i.r1, y0: i.y1, y1: a.y1 },
  ]
  return out.filter(valid)
}

const subtractAll = (parts: R[], cuts: R[]) => cuts.reduce((ps, c) => ps.flatMap((p) => subtract(p, c)), parts)

const faceKey = (f: DecorFace) => `${f.axis}:${f.plane.toFixed(4)}:${f.normal}`

const supportCache = new Map<string, R[]>()

/** Disjoint rectangles (run × y) of wall surface lying on this face plane. */
function supports(f: DecorFace): R[] {
  const key = faceKey(f)
  const hit = supportCache.get(key)
  if (hit) return hit
  const ai = f.axis === 'x' ? 0 : 2
  const ri = f.axis === 'x' ? 2 : 0
  const out: R[] = []
  for (const w of WALLS) {
    if (w.render === false) continue
    const c = f.normal > 0 ? w.max[ai] : w.min[ai]
    if (Math.abs(c - f.plane) > 1e-4) continue
    const r: R = { r0: w.min[ri], r1: w.max[ri], y0: w.min[1], y1: w.max[1] }
    out.push(...subtractAll([r], out))
  }
  supportCache.set(key, out)
  return out
}

/* ------------------------------------------------------------------ */
/* quad accumulation                                                   */
/* ------------------------------------------------------------------ */

class Builder {
  pos: number[] = []
  nor: number[] = []
  uv: number[] = []
  idx: number[] = []

  /** Quad from 4 corners (any order around the loop); winding is fixed to face `n`. */
  quad(p: [V3, V3, V3, V3], n: V3, t: [number, number][]) {
    const base = this.pos.length / 3
    const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]]
    const e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]]
    const cx = e1[1] * e2[2] - e1[2] * e2[1]
    const cy = e1[2] * e2[0] - e1[0] * e2[2]
    const cz = e1[0] * e2[1] - e1[1] * e2[0]
    const flip = cx * n[0] + cy * n[1] + cz * n[2] < 0
    for (let i = 0; i < 4; i++) {
      this.pos.push(...p[i])
      this.nor.push(...n)
      this.uv.push(...t[i])
    }
    if (flip) this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2)
    else this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2))
    g.setIndex(this.idx)
    g.computeBoundingSphere()
    g.computeBoundingBox()
    return g
  }
}

/* ------------------------------------------------------------------ */
/* face frames                                                         */
/* ------------------------------------------------------------------ */

class FaceFrame {
  readonly n: V3
  readonly right: V3
  readonly sgn: number
  constructor(readonly f: DecorFace) {
    this.sgn = f.axis === 'x' ? -f.normal : f.normal
    this.n = f.axis === 'x' ? [f.normal, 0, 0] : [0, 0, f.normal]
    this.right = f.axis === 'x' ? [0, 0, this.sgn] : [this.sgn, 0, 0]
  }
  /** World point at run coordinate r, height y, `o` metres off the face. */
  p(r: number, y: number, o: number): V3 {
    const f = this.f
    return f.axis === 'x' ? [f.plane + f.normal * o, y, r] : [r, y, f.plane + f.normal * o]
  }
}

interface UVMap {
  u: (r: number) => number
  v: (y: number) => number
}

function uvMap(ff: FaceFrame, rect: R, spec?: DecorUV): UVMap {
  const s = spec?.band ? spec.band / (rect.y1 - rect.y0) : 1
  const rOrigin = spec?.center ? (rect.r0 + rect.r1) / 2 : 0
  const yOrigin = spec?.band ? rect.y0 : spec?.center ? (rect.y0 + rect.y1) / 2 : 0
  return { u: (r) => (r - rOrigin) * ff.sgn * s, v: (y) => (y - yOrigin) * s }
}

/** Front-facing quad over `r` at offset `o`. */
function faceQuad(b: Builder, ff: FaceFrame, r: R, o: number, m: UVMap) {
  const p = (rr: number, y: number) => ff.p(rr, y, o)
  b.quad(
    [p(r.r0, r.y0), p(r.r1, r.y0), p(r.r1, r.y1), p(r.r0, r.y1)],
    ff.n,
    [
      [m.u(r.r0), m.v(r.y0)],
      [m.u(r.r1), m.v(r.y0)],
      [m.u(r.r1), m.v(r.y1)],
      [m.u(r.r0), m.v(r.y1)],
    ],
  )
}

/** Slab edges (top, bottom, both ends) between offsets o0..o1. */
function slabEdges(b: Builder, ff: FaceFrame, r: R, o0: number, o1: number) {
  const P = (rr: number, y: number, o: number) => ff.p(rr, y, o)
  // top / bottom (u along the wall, v across the depth)
  for (const [y, ny] of [
    [r.y1, 1],
    [r.y0, -1],
  ] as const) {
    if (ny < 0 && y <= 0.001) continue // sits on the floor
    b.quad(
      [P(r.r0, y, o0), P(r.r1, y, o0), P(r.r1, y, o1), P(r.r0, y, o1)],
      [0, ny, 0],
      [
        [r.r0 * ff.sgn, o0],
        [r.r1 * ff.sgn, o0],
        [r.r1 * ff.sgn, o1],
        [r.r0 * ff.sgn, o1],
      ],
    )
  }
  // ends (normal = ∓ run direction)
  for (const [rr, s] of [
    [r.r0, -1],
    [r.r1, 1],
  ] as const) {
    const dir = (ff.f.axis === 'x' ? [0, 0, s] : [s, 0, 0]) as V3
    b.quad(
      [P(rr, r.y0, o0), P(rr, r.y0, o1), P(rr, r.y1, o1), P(rr, r.y1, o0)],
      dir,
      [
        [o0, r.y0],
        [o1, r.y0],
        [o1, r.y1],
        [o0, r.y1],
      ],
    )
  }
}

/* ------------------------------------------------------------------ */
/* build                                                               */
/* ------------------------------------------------------------------ */

const tierOk = (t: QualityTier, min?: QualityTier) => !min || QUALITY_ORDER.indexOf(t) >= QUALITY_ORDER.indexOf(min)

type Faced = Exclude<DecorTreatment, { type: 'wrap' } | { type: 'medallion' }>

/** The rectangle a faced treatment occupies (for `exclusive`). */
function outerRect(t: Faced): R {
  const r = fromDecor(t)
  if (t.type === 'jali') return { r0: r.r0 - t.frameWidth, r1: r.r1 + t.frameWidth, y0: r.y0 - t.frameWidth, y1: r.y1 + t.frameWidth }
  if (t.type === 'frame') return { r0: r.r0 - t.width, r1: r.r1 + t.width, y0: r.y0 - t.width, y1: r.y1 + t.width }
  return r
}

/** Pieces of `rect` on the face after support clipping and cuts. */
function pieces(f: DecorFace, rect: R, clip: boolean, cuts: R[]): R[] {
  const base = clip ? supports(f).map((s) => intersect(s, rect)).filter((x): x is R => !!x) : [rect]
  return subtractAll(base, cuts)
}

export function buildDecorGroup(group: DecorGroup, tier: QualityTier): DecorBucket[] {
  // ONE bucket (= one draw call) per material per group; it casts shadows if any part asks to
  const buckets = new Map<DecorMaterialKey, { cast: boolean; b: Builder }>()
  const B = (material: DecorMaterialKey, cast = false) => {
    let e = buckets.get(material)
    if (!e) {
      e = { cast, b: new Builder() }
      buckets.set(material, e)
    }
    e.cast ||= cast
    return e.b
  }

  const list = group.treatments.filter((t) => tierOk(tier, t.minTier))
  const exclusives = new Map<string, { t: Faced; r: R }[]>()
  for (const t of list) {
    if (t.type === 'wrap' || t.type === 'medallion' || !t.exclusive) continue
    const k = faceKey(t.face)
    if (!exclusives.has(k)) exclusives.set(k, [])
    exclusives.get(k)!.push({ t, r: outerRect(t) })
  }

  for (const t of list) {
    if (t.type === 'medallion') continue // rendered by <Medallion/> (async SVG texture)
    if (t.type === 'wrap') {
      wrap(t, B)
      continue
    }
    const ff = new FaceFrame(t.face)
    const rect = fromDecor(t)
    const clip = t.clip !== false
    const cuts = [...(t.reserve ?? []).map(fromDecor), ...(t.exclusive ? [] : (exclusives.get(faceKey(t.face)) ?? []).filter((e) => e.t !== t).map((e) => e.r))]

    if (t.type === 'field') {
      const m = uvMap(ff, rect, t.uv)
      for (const p of pieces(t.face, rect, clip, cuts)) faceQuad(B(t.material), ff, p, t.offset ?? FIELD_OFFSET, m)
    } else if (t.type === 'relief') {
      const m = uvMap(ff, rect, t.uv)
      const front = B(t.material, !!t.castShadow)
      const edge = B(t.edgeMaterial ?? t.material, !!t.castShadow)
      let ps = pieces(t.face, rect, clip, cuts)
      if (t.panels) {
        const { width, gap } = t.panels
        const panels: R[] = []
        for (let a = rect.r0; a < rect.r1 - EPS; a += width) panels.push({ r0: a + gap / 2, r1: Math.min(rect.r1, a + width) - gap / 2, y0: rect.y0, y1: rect.y1 })
        ps = ps.flatMap((p) => panels.map((q) => intersect(p, q)).filter((x): x is R => !!x))
      }
      for (const p of ps) {
        faceQuad(front, ff, p, t.depth, m)
        slabEdges(edge, ff, p, 0, t.depth)
      }
    } else if (t.type === 'frame') {
      const w = t.width
      const ring: R[] = [
        { r0: rect.r0 - w, r1: rect.r1 + w, y0: rect.y1, y1: rect.y1 + w },
        { r0: rect.r0 - w, r1: rect.r1 + w, y0: rect.y0 - w, y1: rect.y0 },
        { r0: rect.r0 - w, r1: rect.r0, y0: rect.y0, y1: rect.y1 },
        { r0: rect.r1, r1: rect.r1 + w, y0: rect.y0, y1: rect.y1 },
      ]
      const b = B(t.material)
      for (const s of ring)
        for (const p of pieces(t.face, s, clip, cuts)) {
          faceQuad(b, ff, p, t.depth, uvMap(ff, p))
          slabEdges(b, ff, p, 0, t.depth)
        }
    } else if (t.type === 'jali') {
      const w = t.frameWidth
      const frame = B(t.frame, !!t.castShadow)
      const ring: R[] = [
        { r0: rect.r0 - w, r1: rect.r1 + w, y0: rect.y1, y1: rect.y1 + w },
        { r0: rect.r0 - w, r1: rect.r1 + w, y0: rect.y0 - w, y1: rect.y0 },
        { r0: rect.r0 - w, r1: rect.r0, y0: rect.y0, y1: rect.y1 },
        { r0: rect.r1, r1: rect.r1 + w, y0: rect.y0, y1: rect.y1 },
      ]
      for (const s of ring)
        for (const p of pieces(t.face, s, clip, cuts)) {
          faceQuad(frame, ff, p, t.frameDepth, uvMap(ff, p))
          slabEdges(frame, ff, p, 0, t.frameDepth)
        }
      const m = uvMap(ff, rect, { center: true })
      for (const p of pieces(t.face, rect, clip, cuts)) {
        faceQuad(B(t.back), ff, p, 0.004, uvMap(ff, p))
        faceQuad(B(t.screen), ff, p, t.screenDepth, m)
      }
    }
  }

  const out: DecorBucket[] = []
  for (const [material, e] of buckets) if (e.b.idx.length) out.push({ key: material, material, cast: e.cast, geometry: e.b.geometry() })
  return out
}

/** Five quads wrapping a free-standing wall box. */
function wrap(t: Extract<DecorTreatment, { type: 'wrap' }>, B: (m: DecorMaterialKey) => Builder) {
  const w = WALLS.find((x) => x.id === t.wallId)
  if (!w) return
  const o = t.offset ?? FIELD_OFFSET
  const b = B(t.material)
  const [y0, y1]: Range = [t.y[0], Math.min(t.y[1], w.max[1])]
  const top = y1 + o
  // long faces (±x) extended over the corners, end faces (±z) between them
  for (const nx of [1, -1] as const) {
    const ff = new FaceFrame({ axis: 'x', plane: nx > 0 ? w.max[0] : w.min[0], normal: nx })
    const r: R = { r0: w.min[2] - o, r1: w.max[2] + o, y0, y1: top }
    faceQuad(b, ff, r, o, uvMap(ff, r))
  }
  for (const nz of [1, -1] as const) {
    const ff = new FaceFrame({ axis: 'z', plane: nz > 0 ? w.max[2] : w.min[2], normal: nz })
    const r: R = { r0: w.min[0], r1: w.max[0], y0, y1: top }
    faceQuad(b, ff, r, o, uvMap(ff, r))
  }
  const x0 = w.min[0] - o
  const x1 = w.max[0] + o
  const z0 = w.min[2] - o
  const z1 = w.max[2] + o
  b.quad(
    [
      [x0, top, z0],
      [x1, top, z0],
      [x1, top, z1],
      [x0, top, z1],
    ],
    [0, 1, 0],
    [
      [x0, -z0],
      [x1, -z0],
      [x1, -z1],
      [x0, -z1],
    ],
  )
}
