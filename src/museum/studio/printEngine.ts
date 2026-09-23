/**
 * Print engine for the "Print it yourself" studio — pure 2D canvas, deterministic.
 *
 * A design is a ground cloth + a list of stamp operations. Every stamp carries its own
 * seed, so replaying the list (undo / redo / reload) reproduces the exact same cloth.
 *
 * Hand-print character (all driven by the op's pressure, the block's ink load and its seed):
 *   - ink density   — heavier, darker impressions right after re-inking and with a long press;
 *                     the block runs dry over successive impressions
 *   - speckle voids — pinholes where ink failed to transfer (more when light / dry)
 *   - mottle        — uneven density across the face; faint wood-grain streaks
 *   - bleed         — a soft capillary halo under firm pressure
 *   - misregistration — every impression lands slightly off (≈ ±0.6 % of the block, ±0.7°)
 */
import { drawMotif, hashString, mulberry32, paintCottonGround } from '../exhibits/motifs'
import { BORDER_MOTIF, getBlock, getDye, getGround, type BlockId, type BlockLayer } from './palette'

/** Design (cloth) size in px — also the resolution of downloads. */
export const DESIGN_W = 1200
export const DESIGN_H = 900

export interface StampOp {
  block: BlockId
  layer: BlockLayer
  dye: string
  /** Centre (design px). */
  x: number
  y: number
  /** Block length in design px. */
  size: number
  /** Intended rotation (radians); the hand adds a little jitter. */
  rot: number
  /** 0..1 — from how long the visitor held the block down. */
  pressure: number
  /** 0..1 — ink left on the block. */
  load: number
  seed: number
  /** Ops sharing a group are undone together (e.g. "border all round"). */
  group?: number
}

type Ctx = CanvasRenderingContext2D

export function makeCanvas(w: number, h: number) {
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  return cv
}

const groundCache = new Map<string, HTMLCanvasElement>()

/** The (cached) ground cloth for `groundId` at design size. */
export function groundCanvas(groundId: string): HTMLCanvasElement {
  const hit = groundCache.get(groundId)
  if (hit) return hit
  const g = getGround(groundId)
  const cv = makeCanvas(DESIGN_W, DESIGN_H)
  const ctx = cv.getContext('2d')!
  paintCottonGround(ctx, DESIGN_W, DESIGN_H, g.color, mulberry32(hashString(`studio-ground|${g.id}`)), { threadPx: 1.6, unevenness: 0.7, noise: 4 })
  groundCache.set(groundId, cv)
  return cv
}

/** Draws one impression. */
export function renderStamp(ctx: Ctx, op: StampOp) {
  const r = mulberry32(op.seed)
  const color = getDye(op.dye).color
  const p = Math.max(0, Math.min(1, op.pressure))
  const load = Math.max(0.2, Math.min(1, op.load))
  const density = Math.max(0, Math.min(1, 0.45 + 0.35 * p + 0.3 * (load - 0.6)))
  // the printer's hand: slight misregistration and twist
  const jx = (r() - 0.5) * op.size * 0.012
  const jy = (r() - 0.5) * op.size * 0.012
  const jr = (r() - 0.5) * 0.024
  const motif = op.block === 'border' ? BORDER_MOTIF : op.block
  const opts = {
    layer: op.layer,
    rotation: -(op.rot + jr), // motif space is y-up; canvas rotation is clockwise
    alpha: 0.6 + 0.36 * density,
    composite: 'multiply' as GlobalCompositeOperation,
    rng: r,
    voids: 0.18 + 0.6 * (1 - p) + 0.45 * (1 - load),
    mottle: 0.25 + 0.5 * (1 - load) + 0.15 * (1 - p),
    grain: 0.25 + 0.3 * r(),
    bleed: 0.25 + 0.95 * p * load,
  }
  drawMotif(ctx, motif, op.x + jx, op.y + jy, op.size, color, opts)
  // a freshly inked block under firm pressure leaves a second, faint "kiss" of excess ink
  if (load > 0.93 && p > 0.7) drawMotif(ctx, motif, op.x + jx + (r() - 0.5) * 1.2, op.y + jy + (r() - 0.5) * 1.2, op.size, color, { ...opts, alpha: 0.16, voids: 0.9, bleed: 1.4 })
}

/** Ground + every op, onto `ctx` (design size). */
export function renderDesign(ctx: Ctx, groundId: string, ops: readonly StampOp[]) {
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.drawImage(groundCanvas(groundId), 0, 0)
  ctx.restore()
  for (const op of ops) renderStamp(ctx, op)
}

/* ------------------------------------------------------------------ */
/* Repeat guides & snapping                                            */
/* ------------------------------------------------------------------ */

export type GuideMode = 'none' | 'grid' | 'half-drop'

/** Cell size of the repeat guides for a block (square blocks: the block plus a small gap). */
export function cellSize(size: number) {
  return Math.round(size * 1.04)
}

/** Nearest repeat-cell centre for (x, y). Half-drop shifts every other column by half a cell. */
export function snapToGuide(x: number, y: number, size: number, mode: GuideMode): [number, number] {
  if (mode === 'none') return [x, y]
  const c = cellSize(size)
  const ox = (DESIGN_W % c) / 2
  const col = Math.round((x - ox - c / 2) / c)
  const drop = mode === 'half-drop' && ((col % 2) + 2) % 2 === 1 ? c / 2 : 0
  const oy = (DESIGN_H % c) / 2 + drop
  const row = Math.round((y - oy - c / 2) / c)
  return [ox + c / 2 + col * c, oy + c / 2 + row * c]
}

/** Guide lines (cell rectangles) for the overlay. */
export function drawGuides(ctx: Ctx, size: number, mode: GuideMode, scale: number) {
  if (mode === 'none') return
  const c = cellSize(size)
  const ox = (DESIGN_W % c) / 2
  ctx.save()
  ctx.scale(scale, scale)
  ctx.lineWidth = 1 / scale
  ctx.strokeStyle = 'rgba(138, 90, 59, 0.34)'
  ctx.setLineDash([4 / scale, 5 / scale])
  const cols = Math.ceil(DESIGN_W / c) + 1
  for (let i = -1; i < cols; i++) {
    const x = ox + i * c
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, DESIGN_H)
    ctx.stroke()
    const drop = mode === 'half-drop' && ((i % 2) + 2) % 2 === 1 ? c / 2 : 0
    const oy = (DESIGN_H % c) / 2 + drop
    for (let y = oy - c; y < DESIGN_H + c; y += c) {
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + c, y)
      ctx.stroke()
    }
  }
  // centre marks where the block will land
  ctx.setLineDash([])
  ctx.fillStyle = 'rgba(138, 90, 59, 0.45)'
  for (let i = -1; i < cols; i++) {
    const drop = mode === 'half-drop' && ((i % 2) + 2) % 2 === 1 ? c / 2 : 0
    const oy = (DESIGN_H % c) / 2 + drop
    for (let y = oy - c; y < DESIGN_H + c; y += c) {
      ctx.beginPath()
      ctx.arc(ox + i * c + c / 2, y + c / 2, 1.6 / scale, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

/* ------------------------------------------------------------------ */
/* Border block placement                                              */
/* ------------------------------------------------------------------ */

/** Border band depth for a border block of length `size`. */
const borderDepth = (size: number) => size / getBlock('border').aspect

/** Distance from the cloth edge to the border's centre line. */
export const borderInset = (size: number) => Math.round(borderDepth(size) * 0.5 + size * 0.06)

export interface BorderSlot {
  x: number
  y: number
  rot: number
  /** A corner square (printed with a small corner block). */
  corner?: boolean
}

/** Size of the corner block for a border block of length `size`. */
export const cornerSize = (size: number) => borderDepth(size) * 1.02

/**
 * Where the border blocks go: one run along each edge between the corner squares, the
 * impressions spaced evenly (a hair apart or just overlapping, as a printer matches them
 * by eye), plus a corner block in each corner.
 */
export function borderSlots(size: number): BorderSlot[] {
  const inset = borderInset(size)
  const start = inset + borderDepth(size) / 2
  const run = (len: number) => {
    const L = len - 2 * start
    const n = Math.max(1, Math.round(L / size))
    const step = L / n
    return Array.from({ length: n }, (_, i) => start + step * (i + 0.5))
  }
  const out: BorderSlot[] = []
  for (const x of run(DESIGN_W)) out.push({ x, y: inset, rot: 0 }, { x, y: DESIGN_H - inset, rot: Math.PI })
  for (const y of run(DESIGN_H)) out.push({ x: inset, y, rot: -Math.PI / 2 }, { x: DESIGN_W - inset, y, rot: Math.PI / 2 })
  for (const [x, y] of [
    [inset, inset],
    [DESIGN_W - inset, inset],
    [inset, DESIGN_H - inset],
    [DESIGN_W - inset, DESIGN_H - inset],
  ])
    out.push({ x, y, rot: 0, corner: true })
  return out
}

/**
 * Border block: snaps to the nearest cloth edge (turned to run along it). With `snap`, it
 * snaps to the nearest border slot (corner squares get the corner block).
 */
export function placeBorder(x: number, y: number, size: number, snap: boolean): BorderSlot {
  if (snap) {
    let best: BorderSlot | null = null
    let bd = Infinity
    for (const s of borderSlots(size)) {
      const d = Math.hypot(s.x - x, s.y - y)
      if (d < bd) {
        bd = d
        best = s
      }
    }
    if (best) return best
  }
  const inset = borderInset(size)
  const d = [y, DESIGN_H - y, x, DESIGN_W - x] // top, bottom, left, right
  const edge = d.indexOf(Math.min(...d))
  const along = (v: number, len: number) => Math.max(size / 2, Math.min(len - size / 2, v))
  if (edge === 0) return { x: along(x, DESIGN_W), y: inset, rot: 0 }
  if (edge === 1) return { x: along(x, DESIGN_W), y: DESIGN_H - inset, rot: Math.PI }
  if (edge === 2) return { x: inset, y: along(y, DESIGN_H), rot: -Math.PI / 2 }
  return { x: DESIGN_W - inset, y: along(y, DESIGN_H), rot: Math.PI / 2 }
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

function toBlob(cv: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => cv.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the image'))), 'image/png'))
}

/** PNG of `src` scaled to `width` px wide. */
export async function pngAt(src: HTMLCanvasElement, width: number): Promise<Blob> {
  if (width >= src.width) return toBlob(src)
  const h = Math.round((src.height * width) / src.width)
  const cv = makeCanvas(width, h)
  const ctx = cv.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, width, h)
  return toBlob(cv)
}

/** The largest PNG (≤ 1024 px wide) that fits `maxBytes`. */
export async function pngWithin(src: HTMLCanvasElement, maxBytes: number): Promise<Blob> {
  for (const w of [1024, 880, 760, 640, 520, 420]) {
    const b = await pngAt(src, w)
    if (b.size <= maxBytes) return b
  }
  throw new Error('The print could not be made small enough to send')
}
