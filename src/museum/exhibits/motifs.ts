/**
 * MOTIFS — shared, renderer-agnostic motif definitions.
 *
 * PLACEHOLDER: these are generic geometric / floral forms drawn for layout and
 * lighting calibration only. They are NOT reproductions of any documented
 * traditional block design and carry no cultural or historical claim. They will
 * be replaced by the workshop's authentic block designs.
 *
 * Every motif lives in a unit square [-0.5, 0.5]² (y up) and is split into two
 * "blocks", as in two-colour hand block printing:
 *   - `outline` — the fine line block (usually the darker ink)
 *   - `fill`    — the filler block (usually the lighter / secondary ink)
 *
 * Primitive rules (same for both layers, applied in order):
 *   - `stroke` set  → the primitive is a line / ring of that width (unit coords)
 *   - `hole` set    → the primitive is cut out of what was drawn before it
 *   - otherwise     → a solid filled area
 *
 * Consumers:
 *   - `drawMotif()`      — 2D canvas stamping (textiles, swatches, placeholders)
 *   - `motifToShapes()`  — THREE.Shape[] for ExtrudeGeometry (carved block relief)
 */

import * as THREE from 'three'
import type { MotifId } from '../config/exhibits'

export type Pt = [number, number]

interface PrimBase {
  hole?: boolean
  /** Line width in unit coordinates; turns the primitive into a stroke / ring. */
  stroke?: number
}
export type MotifPrimitive =
  | (PrimBase & { type: 'circle'; cx: number; cy: number; r: number })
  | (PrimBase & { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number; rot: number })
  | (PrimBase & { type: 'polygon'; points: Pt[] })

export type MotifLayer = 'fill' | 'outline' | 'all'

export interface Motif {
  id: MotifId
  /** Neutral descriptive name (placeholder). */
  name: string
  fill: MotifPrimitive[]
  outline: MotifPrimitive[]
}

/* ------------------------------------------------------------------ */
/* Small geometry helpers                                              */
/* ------------------------------------------------------------------ */

const TAU = Math.PI * 2

function rotatePt([x, y]: Pt, a: number, [ox, oy]: Pt = [0, 0]): Pt {
  const c = Math.cos(a)
  const s = Math.sin(a)
  const dx = x - ox
  const dy = y - oy
  return [ox + dx * c - dy * s, oy + dx * s + dy * c]
}

function signedArea(pts: Pt[]) {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]
    const [x1, y1] = pts[(i + 1) % pts.length]
    a += x0 * y1 - x1 * y0
  }
  return a / 2
}

export function polygonCentroid(pts: Pt[]): Pt {
  const A = signedArea(pts)
  if (Math.abs(A) < 1e-9) {
    const n = pts.length || 1
    return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n]
  }
  let cx = 0
  let cy = 0
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]
    const [x1, y1] = pts[(i + 1) % pts.length]
    const f = x0 * y1 - x1 * y0
    cx += (x0 + x1) * f
    cy += (y0 + y1) * f
  }
  return [cx / (6 * A), cy / (6 * A)]
}

function scaleAbout(pts: Pt[], k: number, [ox, oy]: Pt): Pt[] {
  return pts.map(([x, y]) => [ox + (x - ox) * k, oy + (y - oy) * k])
}

/** Offsets a closed polygon outward (d > 0) or inward (d < 0) with clamped mitres. */
export function offsetPolygon(pts: Pt[], d: number): Pt[] {
  const n = pts.length
  const orient = signedArea(pts) >= 0 ? 1 : -1
  const normals: Pt[] = []
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[i]
    const [x1, y1] = pts[(i + 1) % n]
    const len = Math.hypot(x1 - x0, y1 - y0) || 1
    normals.push([((y1 - y0) / len) * orient, (-(x1 - x0) / len) * orient])
  }
  return pts.map(([x, y], i) => {
    const a = normals[(i - 1 + n) % n]
    const b = normals[i]
    let nx = a[0] + b[0]
    let ny = a[1] + b[1]
    const l = Math.hypot(nx, ny) || 1
    nx /= l
    ny /= l
    const cos = Math.max(0.45, nx * b[0] + ny * b[1])
    const m = d / cos
    return [x + nx * m, y + ny * m]
  })
}

function ellipsePts(cx: number, cy: number, rx: number, ry: number, rot: number, n = 40): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU
    out.push(rotatePt([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry], rot, [cx, cy]))
  }
  return out
}

function primPoints(p: MotifPrimitive, n = 40): Pt[] {
  if (p.type === 'circle') return ellipsePts(p.cx, p.cy, p.r, p.r, 0, n)
  if (p.type === 'ellipse') return ellipsePts(p.cx, p.cy, p.rx, p.ry, p.rot, n)
  return p.points
}

function primCenter(p: MotifPrimitive): Pt {
  if (p.type === 'polygon') return polygonCentroid(p.points)
  return [p.cx, p.cy]
}

function pointInPolygon([x, y]: Pt, pts: Pt[]) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Fits a point set into a centred square box of side `box`. */
function fitPts(pts: Pt[], box: number, center: Pt = [0, 0]): Pt[] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of pts) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }
  const k = box / Math.max(maxX - minX, maxY - minY)
  const mx = (minX + maxX) / 2
  const my = (minY + maxY) / 2
  return pts.map(([x, y]) => [center[0] + (x - mx) * k, center[1] + (y - my) * k])
}

function lozenge(r: number, cx = 0, cy = 0, sy = 1): Pt[] {
  return [[cx, cy + r * sy], [cx - r, cy], [cx, cy - r * sy], [cx + r, cy]]
}

function star(points: number, rOuter: number, rInner: number, phase = Math.PI / 2): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i < points * 2; i++) {
    const a = phase + (i / (points * 2)) * TAU
    const r = i % 2 === 0 ? rOuter : rInner
    out.push([Math.cos(a) * r, Math.sin(a) * r])
  }
  return out
}

/** Pointed lens-shaped leaf from its base point along `angle`. */
function leafPts(bx: number, by: number, len: number, wid: number, angle: number, n = 14): Pt[] {
  const top: Pt[] = []
  const bot: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const w = (wid / 2) * Math.pow(Math.sin(Math.PI * t), 0.85) * (1 - 0.25 * t)
    top.push([t * len, w])
    if (i > 0 && i < n) bot.push([t * len, -w * 0.9])
  }
  const pts = [...top, ...bot.reverse()]
  return pts.map((p) => {
    const [x, y] = rotatePt(p, angle)
    return [x + bx, y + by] as Pt
  })
}

function bar(x0: number, y0: number, x1: number, y1: number, w: number): Pt[] {
  const len = Math.hypot(x1 - x0, y1 - y0) || 1
  const nx = (-(y1 - y0) / len) * (w / 2)
  const ny = ((x1 - x0) / len) * (w / 2)
  return [[x0 + nx, y0 + ny], [x0 - nx, y0 - ny], [x1 - nx, y1 - ny], [x1 + nx, y1 + ny]]
}

/* ------------------------------------------------------------------ */
/* Motif library (PLACEHOLDER designs)                                  */
/* ------------------------------------------------------------------ */

function buildRosette(): Motif {
  const fill: MotifPrimitive[] = []
  const outline: MotifPrimitive[] = []
  const petals = 8
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * TAU + Math.PI / 2
    const d = 0.245
    outline.push({ type: 'ellipse', cx: Math.cos(a) * d, cy: Math.sin(a) * d, rx: 0.15, ry: 0.066, rot: a, stroke: 0.02 })
    fill.push({ type: 'ellipse', cx: Math.cos(a) * d, cy: Math.sin(a) * d, rx: 0.108, ry: 0.036, rot: a })
    const b = a + Math.PI / petals
    fill.push({ type: 'circle', cx: Math.cos(b) * 0.405, cy: Math.sin(b) * 0.405, r: 0.03 })
    outline.push({ type: 'circle', cx: Math.cos(b) * 0.25, cy: Math.sin(b) * 0.25, r: 0.016 })
  }
  outline.push({ type: 'circle', cx: 0, cy: 0, r: 0.082, stroke: 0.02 })
  fill.push({ type: 'circle', cx: 0, cy: 0, r: 0.055 })
  fill.push({ type: 'circle', cx: 0, cy: 0, r: 0.02, hole: true })
  return { id: 'rosette', name: 'Eight-petal rosette (placeholder)', fill, outline }
}

function buildTeardrop(): Motif {
  const raw: Pt[] = []
  const n = 90
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU
    const u = Math.cos(t) // 1 = tip, -1 = rounded end
    const v = Math.sin(t) * Math.pow(Math.sin(t / 2), 1.35)
    const tip = Math.max(0, u)
    let x = v * 0.62 + 0.42 * Math.pow(tip, 3)
    let y = u * 0.95 - 0.22 * Math.pow(tip, 4)
    ;[x, y] = rotatePt([x, y], -0.18)
    raw.push([x, y])
  }
  const body = fitPts(raw, 0.74, [-0.02, -0.02])
  const c = polygonCentroid(body)
  const cHole: Pt = [c[0] - 0.01, c[1] - 0.035]
  const fill: MotifPrimitive[] = [
    { type: 'polygon', points: body },
    { type: 'polygon', points: scaleAbout(body, 0.5, cHole), hole: true },
    { type: 'circle', cx: cHole[0], cy: cHole[1], r: 0.045 },
  ]
  const outline: MotifPrimitive[] = [
    { type: 'polygon', points: offsetPolygon(body, 0.04), stroke: 0.02 },
    { type: 'polygon', points: scaleAbout(body, 0.74, cHole), stroke: 0.014 },
  ]
  // small dots trailing around the rounded end
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI * 0.95 + (i / 6) * Math.PI * 0.9 - Math.PI * 0.05
    outline.push({ type: 'circle', cx: c[0] + Math.cos(a) * 0.405, cy: c[1] - 0.05 + Math.sin(a) * 0.36, r: 0.016 })
  }
  return { id: 'teardrop', name: 'Curled teardrop (placeholder)', fill, outline }
}

function buildStarLattice(): Motif {
  const s = star(8, 0.43, 0.25, Math.PI / 2)
  const fill: MotifPrimitive[] = [
    { type: 'polygon', points: star(8, 0.35, 0.2, Math.PI / 2) },
    { type: 'circle', cx: 0, cy: 0, r: 0.11, hole: true },
    { type: 'circle', cx: 0, cy: 0, r: 0.045 },
  ]
  const outline: MotifPrimitive[] = [
    { type: 'polygon', points: s, stroke: 0.02 },
    { type: 'circle', cx: 0, cy: 0, r: 0.135, stroke: 0.016 },
  ]
  // lattice nodes at the corners so the repeat links up
  for (const [x, y] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]] as Pt[]) {
    const px = x * 0.9
    const py = y * 0.9
    fill.push({ type: 'polygon', points: lozenge(0.055, px, py) })
    outline.push({ type: 'polygon', points: lozenge(0.085, px, py), stroke: 0.014 })
  }
  return { id: 'star-lattice', name: 'Eight-point star lattice (placeholder)', fill, outline }
}

function buildLeafTrail(): Motif {
  const fill: MotifPrimitive[] = []
  const outline: MotifPrimitive[] = []
  const stemX = (y: number) => 0.07 * Math.sin(TAU * (y + 0.5))
  const left: Pt[] = []
  const right: Pt[] = []
  const hw = 0.013
  for (let i = 0; i <= 40; i++) {
    const y = -0.5 + i / 40
    left.push([stemX(y) - hw, y])
    right.push([stemX(y) + hw, y])
  }
  outline.push({ type: 'polygon', points: [...right, ...left.reverse()] })

  const leaves = [
    { y: -0.34, side: 1 },
    { y: -0.12, side: -1 },
    { y: 0.1, side: 1 },
    { y: 0.32, side: -1 },
  ]
  for (const { y, side } of leaves) {
    const bx = stemX(y)
    const angle = side > 0 ? 0.62 : Math.PI - 0.62
    const len = 0.28
    const wid = 0.13
    const leaf = leafPts(bx, y, len, wid, angle)
    outline.push({ type: 'polygon', points: leaf, stroke: 0.014 })
    const c = polygonCentroid(leaf)
    fill.push({ type: 'polygon', points: scaleAbout(leaf, 0.7, [c[0] - Math.cos(angle) * 0.01, c[1] - Math.sin(angle) * 0.01]) })
    const tip = rotatePt([len * 0.78, 0], angle)
    outline.push({ type: 'polygon', points: bar(bx, y, bx + tip[0], y + tip[1], 0.008) })
    // berry cluster on the opposite side
    const ob = side > 0 ? Math.PI - 0.9 : 0.9
    for (let k = 0; k < 3; k++) {
      const a = ob + (k - 1) * 0.42
      fill.push({ type: 'circle', cx: bx + Math.cos(a) * 0.1, cy: y + 0.03 + Math.sin(a) * 0.1, r: 0.019 })
    }
  }
  return { id: 'leaf-trail', name: 'Trailing leaf stem (placeholder)', fill, outline }
}

function buildDiamond(): Motif {
  const fill: MotifPrimitive[] = [
    { type: 'polygon', points: lozenge(0.43) },
    { type: 'polygon', points: lozenge(0.31), hole: true },
    { type: 'polygon', points: lozenge(0.19) },
    { type: 'circle', cx: 0, cy: 0, r: 0.05, hole: true },
  ]
  for (const [x, y] of [[0.25, 0], [-0.25, 0], [0, 0.25], [0, -0.25]] as Pt[]) {
    fill.push({ type: 'circle', cx: x, cy: y, r: 0.028 })
  }
  const outline: MotifPrimitive[] = [
    { type: 'polygon', points: lozenge(0.475), stroke: 0.014 },
    { type: 'polygon', points: lozenge(0.37), stroke: 0.014 },
    { type: 'circle', cx: 0, cy: 0, r: 0.022 },
  ]
  return { id: 'diamond', name: 'Nested lozenge (placeholder)', fill, outline }
}

export const MOTIFS: Record<MotifId, Motif> = {
  rosette: buildRosette(),
  teardrop: buildTeardrop(),
  'star-lattice': buildStarLattice(),
  'leaf-trail': buildLeafTrail(),
  diamond: buildDiamond(),
}

export const MOTIF_IDS = Object.keys(MOTIFS) as MotifId[]

export function getMotif(id: MotifId | Motif): Motif {
  return typeof id === 'string' ? MOTIFS[id] ?? MOTIFS.rosette : id
}

function layerPrims(m: Motif, layer: MotifLayer): MotifPrimitive[][] {
  if (layer === 'fill') return [m.fill]
  if (layer === 'outline') return [m.outline]
  return [m.fill, m.outline]
}

/* ------------------------------------------------------------------ */
/* Seeded randomness                                                   */
/* ------------------------------------------------------------------ */

export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hashString(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/* ------------------------------------------------------------------ */
/* Canvas stamping                                                     */
/* ------------------------------------------------------------------ */

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export interface DrawMotifOptions {
  layer?: MotifLayer
  /** Rotation in radians (counter-clockwise, y up). */
  rotation?: number
  /** Overall ink opacity. */
  alpha?: number
  /** Composite used to lay the stamp onto the target (e.g. 'multiply' for ink on cloth, 'destination-out' for resist). */
  composite?: GlobalCompositeOperation
  /** Random source; required for the hand-printed effects below. */
  rng?: () => number
  /** 0..1 — tiny voids / speckle where ink failed to transfer. */
  voids?: number
  /** 0..1 — uneven ink density across the stamp. */
  mottle?: number
  /** 0..1 — faint wood-grain streaks transferred from the block. */
  grain?: number
  /** Soft edge / capillary bleed in px (uses ctx.filter where supported). */
  bleed?: number
  /** Flip horizontally (mirror). */
  mirror?: boolean
}

let scratch: HTMLCanvasElement | null = null
function getScratch(size: number) {
  if (!scratch) scratch = document.createElement('canvas')
  if (scratch.width < size || scratch.height < size) {
    scratch.width = Math.max(scratch.width, size)
    scratch.height = Math.max(scratch.height, size)
  }
  return scratch
}

function tracePrim(ctx: Ctx2D, p: MotifPrimitive) {
  ctx.beginPath()
  if (p.type === 'circle') ctx.arc(p.cx, p.cy, p.r, 0, TAU)
  else if (p.type === 'ellipse') ctx.ellipse(p.cx, p.cy, p.rx, p.ry, p.rot, 0, TAU)
  else {
    p.points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
    ctx.closePath()
  }
}

function paintPrims(ctx: Ctx2D, prims: MotifPrimitive[]) {
  for (const p of prims) {
    ctx.globalCompositeOperation = p.hole ? 'destination-out' : 'source-over'
    tracePrim(ctx, p)
    if (p.stroke) {
      ctx.lineWidth = p.stroke
      ctx.stroke()
    } else ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'
}

/**
 * Stamps a motif onto a 2D canvas, centred at (x, y) px, `size` px across the unit square.
 */
export function drawMotif(
  ctx: Ctx2D,
  motifOrId: Motif | MotifId,
  x: number,
  y: number,
  size: number,
  color: string,
  opts: DrawMotifOptions = {},
) {
  const motif = getMotif(motifOrId)
  const { layer = 'all', rotation = 0, alpha = 1, composite = 'source-over', rng, voids = 0, mottle = 0, grain = 0, bleed = 0, mirror = false } = opts
  const S = Math.ceil(size * 1.5) + 8
  const cv = getScratch(S)
  const s = cv.getContext('2d')!
  s.setTransform(1, 0, 0, 1, 0, 0)
  s.globalCompositeOperation = 'source-over'
  s.globalAlpha = 1
  s.clearRect(0, 0, S, S)

  // motif space: y up, unit square scaled to `size`
  s.setTransform(size * (mirror ? -1 : 1), 0, 0, -size, S / 2, S / 2)
  s.rotate(rotation)
  s.fillStyle = color
  s.strokeStyle = color
  s.lineJoin = 'round'
  s.lineCap = 'round'
  for (const prims of layerPrims(motif, layer)) paintPrims(s, prims)
  s.setTransform(1, 0, 0, 1, 0, 0)

  if (rng && size >= 16) {
    s.globalCompositeOperation = 'destination-out'
    // uneven ink density: a few soft lighter blotches
    if (mottle > 0) {
      const blots = 5 + Math.floor(rng() * 5)
      for (let i = 0; i < blots; i++) {
        const bx = S / 2 + (rng() - 0.5) * size
        const by = S / 2 + (rng() - 0.5) * size
        const br = size * (0.15 + rng() * 0.35)
        const g = s.createRadialGradient(bx, by, 0, bx, by, br)
        g.addColorStop(0, `rgba(0,0,0,${(mottle * (0.25 + rng() * 0.45)).toFixed(3)})`)
        g.addColorStop(1, 'rgba(0,0,0,0)')
        s.fillStyle = g
        s.fillRect(bx - br, by - br, br * 2, br * 2)
      }
    }
    // wood grain streaks transferred from the block
    if (grain > 0) {
      const ga = rng() * Math.PI
      const cnt = Math.floor(size / 5)
      s.save()
      s.translate(S / 2, S / 2)
      s.rotate(ga)
      for (let i = 0; i < cnt; i++) {
        s.globalAlpha = grain * (0.04 + rng() * 0.16)
        s.fillStyle = '#000'
        const yy = (rng() - 0.5) * S
        s.fillRect(-S / 2, yy, S, 0.4 + rng() * 1.6)
      }
      s.restore()
      s.globalAlpha = 1
    }
    // tiny voids / speckle
    if (voids > 0) {
      const count = Math.floor(((voids * size * size) / 90) * (0.6 + rng() * 0.8))
      const px = Math.max(1, size / 260)
      s.fillStyle = '#000'
      for (let i = 0; i < count; i++) {
        s.globalAlpha = 0.45 + rng() * 0.55
        s.beginPath()
        s.arc(S / 2 + (rng() - 0.5) * size * 1.05, S / 2 + (rng() - 0.5) * size * 1.05, px * (0.35 + rng() * rng() * 1.6), 0, TAU)
        s.fill()
      }
      s.globalAlpha = 1
    }
    s.globalCompositeOperation = 'source-over'
  }

  ctx.save()
  ctx.globalCompositeOperation = composite
  const canFilter = 'filter' in ctx
  if (bleed > 0 && canFilter) {
    ctx.filter = `blur(${(bleed * 2.2).toFixed(2)}px)`
    ctx.globalAlpha = alpha * 0.28
    ctx.drawImage(cv, 0, 0, S, S, x - S / 2, y - S / 2, S, S)
    ctx.filter = `blur(${(bleed * 0.5).toFixed(2)}px)`
  }
  ctx.globalAlpha = alpha
  ctx.drawImage(cv, 0, 0, S, S, x - S / 2, y - S / 2, S, S)
  if (canFilter) ctx.filter = 'none'
  ctx.restore()
}

/**
 * Paints a cotton ground: base colour, tonal unevenness, fine weave, slubs and grain noise.
 * `threadPx` ≈ spacing of visible threads in px.
 */
export function paintCottonGround(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  base: string,
  rng: () => number,
  { threadPx = 2.4, unevenness = 1, noise = 7 }: { threadPx?: number; unevenness?: number; noise?: number } = {},
) {
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.fillStyle = base
  ctx.fillRect(0, 0, w, h)

  // tonal unevenness (washing / sun / dye pot variation)
  const blots = Math.floor(24 * unevenness + (w * h) / 180000)
  for (let i = 0; i < blots; i++) {
    const bx = rng() * w
    const by = rng() * h
    const br = Math.max(w, h) * (0.06 + rng() * 0.28)
    const dark = rng() < 0.55
    const a = (0.025 + rng() * 0.05) * unevenness
    const g = ctx.createRadialGradient(bx, by, 0, bx, by, br)
    g.addColorStop(0, dark ? `rgba(110,82,40,${a})` : `rgba(255,252,240,${a * 1.2})`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(bx - br, by - br, br * 2, br * 2)
  }

  // weave: warp and weft threads with per-thread tone
  const drawThreads = (horizontal: boolean) => {
    const span = horizontal ? h : w
    const len = horizontal ? w : h
    for (let p = 0; p < span; p += threadPx * (0.8 + rng() * 0.4)) {
      const dark = rng() < 0.5
      ctx.globalAlpha = 0.012 + rng() * 0.038
      ctx.fillStyle = dark ? '#5a4630' : '#fffaf0'
      const tw = threadPx * (0.35 + rng() * 0.3)
      if (horizontal) ctx.fillRect(0, p, len, tw)
      else ctx.fillRect(p, 0, tw, len)
    }
  }
  drawThreads(true)
  drawThreads(false)

  // slubs: short thick irregular yarn sections
  const slubs = Math.floor((w * h) / 9000)
  for (let i = 0; i < slubs; i++) {
    const horizontal = rng() < 0.55
    const sl = threadPx * (6 + rng() * 26)
    const sw = threadPx * (0.5 + rng() * 0.7)
    ctx.globalAlpha = 0.04 + rng() * 0.07
    ctx.fillStyle = rng() < 0.6 ? '#fffcf4' : '#6b5638'
    const x = rng() * w
    const y = rng() * h
    if (horizontal) ctx.fillRect(x, y, sl, sw)
    else ctx.fillRect(x, y, sw, sl)
  }
  ctx.restore()

  // per-pixel fibre noise
  if (noise > 0) {
    const img = ctx.getImageData(0, 0, w, h)
    const d = img.data
    for (let i = 0; i < d.length; i += 4) {
      const n = (rng() - 0.5) * noise * 2
      d[i] += n
      d[i + 1] += n
      d[i + 2] += n * 0.9
    }
    ctx.putImageData(img, 0, 0)
  }
}

/* ------------------------------------------------------------------ */
/* THREE.Shape conversion (for extruded block relief)                  */
/* ------------------------------------------------------------------ */

function toV2(pts: Pt[], k: number, sx: number) {
  return pts.map(([x, y]) => new THREE.Vector2(x * k * sx, y * k))
}

function primPath<T extends THREE.Path>(target: T, p: MotifPrimitive, k: number, grow = 0, sx = 1): T {
  if (p.type === 'circle') target.absarc(p.cx * k * sx, p.cy * k, (p.r + grow) * k, 0, TAU, false)
  else if (p.type === 'ellipse') target.absellipse(p.cx * k * sx, p.cy * k, (p.rx + grow) * k, (p.ry + grow) * k, 0, TAU, false, p.rot * sx)
  else target.setFromPoints(toV2(grow ? offsetPolygon(p.points, grow) : p.points, k, sx))
  return target
}

/**
 * Converts a motif to THREE.Shape[] scaled so the unit square spans `size` (in scene units).
 * Stroked primitives become rings; holes are attached to the enclosing solid primitive.
 * `mirror` flips x — a carved block face is the mirror image of the print it makes.
 */
export function motifToShapes(motifOrId: Motif | MotifId, size: number, layer: MotifLayer = 'all', mirror = false): THREE.Shape[] {
  const motif = getMotif(motifOrId)
  const sx = mirror ? -1 : 1
  const shapes: THREE.Shape[] = []
  for (const prims of layerPrims(motif, layer)) {
    const solids: { prim: MotifPrimitive; shape: THREE.Shape }[] = []
    for (const p of prims) {
      if (p.hole) {
        const c = primCenter(p)
        for (let i = solids.length - 1; i >= 0; i--) {
          if (!solids[i].prim.stroke && pointInPolygon(c, primPoints(solids[i].prim))) {
            solids[i].shape.holes.push(primPath(new THREE.Path(), p, size, 0, sx))
            break
          }
        }
        continue
      }
      let shape: THREE.Shape
      if (p.stroke && p.type === 'polygon') {
        // polygon strokes: one overlapping bar per edge (robust to self-intersecting offsets)
        const pts = p.points
        const w = p.stroke
        for (let i = 0; i < pts.length; i++) {
          const [x0, y0] = pts[i]
          const [x1, y1] = pts[(i + 1) % pts.length]
          const len = Math.hypot(x1 - x0, y1 - y0)
          if (len < 1e-6) continue
          const ex = ((x1 - x0) / len) * w * 0.45
          const ey = ((y1 - y0) / len) * w * 0.45
          const q = bar(x0 - ex, y0 - ey, x1 + ex, y1 + ey, w)
          shapes.push(new THREE.Shape(toV2(q, size, sx)))
        }
        continue
      } else if (p.stroke) {
        const half = p.stroke / 2
        shape = primPath(new THREE.Shape(), p, size, half, sx)
        shape.holes.push(primPath(new THREE.Path(), p, size, -half, sx))
      } else {
        shape = primPath(new THREE.Shape(), p, size, 0, sx)
      }
      shapes.push(shape)
      solids.push({ prim: p, shape })
    }
  }
  return shapes
}
