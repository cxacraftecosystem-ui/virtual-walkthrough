/**
 * WALL GRAPHICS — canvas-rendered typography & illustration textures.
 *
 * Everything is laid out in physical METRES and rasterised at a fixed pixel
 * density (≥ ~500 px/m; small, text-dense items get more), capped at 4096 px.
 * Transparent textures contain ink only and are meant to be overlaid on a
 * plaster wall (like cut vinyl lettering); opaque ones are printed panels/cards.
 *
 * Fonts are provided by the app via CSS: "Cormorant Garamond" (300–600) and
 * "Inter" (400–600). Each factory awaits `document.fonts.load` first.
 */

import * as THREE from 'three'
import { EXHIBITION_TITLE, RECEPTION_WELCOME, type InfographicConfig } from '../config/infographics'
import { WALLS, ZONES } from '../config/layout'
import { MUSEUM } from '../config/museum'
import { mulberry32 } from './noise'

const SERIF = '"Cormorant Garamond", "Cormorant", "Iowan Old Style", Georgia, serif'
const SANS = 'Inter, "Helvetica Neue", Helvetica, Arial, sans-serif'

const INK = '#2e2a26'
const INK_SOFT = 'rgba(46, 42, 38, 0.78)'
const ACCENT = '#8a4a33'
const PAPER = '#f5f1e8'
const CARD = '#f7f4ee'
const MAX_PX = 4096

/* ------------------------------------------------------------------ */
/* Infrastructure                                                      */
/* ------------------------------------------------------------------ */

let fontsReady: Promise<void> | null = null

/** Resolve once the display/UI fonts are loaded (or after a timeout — never rejects). */
export function ensureWallFonts(): Promise<void> {
  if (fontsReady) return fontsReady
  fontsReady = (async () => {
    if (typeof document === 'undefined' || !document.fonts) return
    const specs = [
      `300 64px "Cormorant Garamond"`,
      `400 64px "Cormorant Garamond"`,
      `500 64px "Cormorant Garamond"`,
      `600 64px "Cormorant Garamond"`,
      `400 32px Inter`,
      `500 32px Inter`,
      `600 32px Inter`,
    ]
    const load = Promise.all(specs.map((s) => document.fonts.load(s).catch(() => []))).then(() => undefined)
    const timeout = new Promise<void>((r) => setTimeout(r, 4000))
    await Promise.race([load, timeout])
  })()
  return fontsReady
}

interface Surface {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  /** px per metre */
  s: number
  W: number
  H: number
  /** metres → px */
  m: (v: number) => number
}

function surface(widthM: number, heightM: number, pxPerM: number): Surface {
  const s = Math.min(pxPerM, MAX_PX / Math.max(widthM, heightM))
  const W = Math.max(2, Math.round(widthM * s))
  const H = Math.max(2, Math.round(heightM * s))
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  ctx.textBaseline = 'alphabetic'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  return { canvas, ctx, s, W, H, m: (v) => v * s }
}

function toTexture(canvas: HTMLCanvasElement, name: string): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas)
  t.name = name
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  t.generateMipmaps = true
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.magFilter = THREE.LinearFilter
  t.needsUpdate = true
  return t
}

function setFont(ctx: CanvasRenderingContext2D, weight: number, px: number, family: string, spacingEm = 0) {
  ctx.font = `${weight} ${px.toFixed(2)}px ${family}`
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string }
  if ('letterSpacing' in c) c.letterSpacing = `${(spacingEm * px).toFixed(2)}px`
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean)
    let line = ''
    for (const w of words) {
      const test = line ? `${line} ${w}` : w
      if (ctx.measureText(test).width <= maxW || !line) line = test
      else {
        out.push(line)
        line = w
      }
    }
    if (line) out.push(line)
  }
  return out
}

/** Width that holds ~`chars` characters of running text in the current font. */
function measureWidthForChars(ctx: CanvasRenderingContext2D, chars: number): number {
  const sample = 'the craft of carving a block and pressing colour onto cloth by hand '
  return (ctx.measureText(sample).width / sample.length) * chars
}

/* ------------------------------------------------------------------ */
/* 1. Reveal-wall title lettering (transparent)                         */
/* ------------------------------------------------------------------ */

export interface TitleWallOptions {
  /** World height (m) of the texture's bottom edge. Default 0 (texture starts at the floor). */
  bottomY?: number
}

export async function createTitleWallTexture(widthM: number, heightM: number, options: TitleWallOptions = {}): Promise<THREE.CanvasTexture> {
  await ensureWallFonts()
  const { ctx, m, s } = surface(widthM, heightM, 650)
  const bottomY = options.bottomY ?? 0
  const T = EXHIBITION_TITLE

  const left = Math.max(0.12, widthM * 0.14)
  const blockW = Math.min(widthM - left - 0.12, widthM * 0.68)

  // Size the title to the composition width (max 0.26 m cap-ish size).
  setFont(ctx, 400, 100, SERIF, -0.005)
  const titleW100 = ctx.measureText(T.title).width
  const titleSize = Math.min(0.27, (m(blockW) / titleW100) * 100 / s)

  const kickerSize = Math.max(0.028, titleSize * 0.14)
  const subSize = titleSize * 0.34
  const introSize = Math.max(0.032, titleSize * 0.16)
  const introLH = introSize * 1.62

  setFont(ctx, 400, m(introSize), SANS)
  const introMaxW = Math.min(m(blockW * 0.92), measureWidthForChars(ctx, 62))
  const introLines = wrap(ctx, T.intro, introMaxW)

  // Vertical rhythm (metres, measured downward from the kicker baseline).
  const gapKT = titleSize * 0.95
  const gapTS = subSize * 1.55
  const gapSR = subSize * 1.0
  const gapRI = introSize * 2.2
  const blockH = gapKT + gapTS + gapSR + gapRI + (introLines.length - 1) * introLH + kickerSize
  // Centre the block a little above eye level (1.6 m), keep inside the texture.
  const centreY = 1.78 - bottomY
  let topY = centreY + blockH / 2 // world height (rel. to bottom edge) of kicker baseline
  topY = Math.min(topY, heightM - kickerSize - 0.1)
  topY = Math.max(topY, blockH + 0.08)
  const Y = (h: number) => m(heightM - h) // height above bottom → canvas y

  let y = topY
  // Kicker — letter-spaced small caps in madder.
  ctx.fillStyle = ACCENT
  setFont(ctx, 500, m(kickerSize), SANS, 0.32)
  ctx.fillText(T.kicker.toUpperCase(), m(left), Y(y))

  // Title
  y -= gapKT
  ctx.fillStyle = INK
  setFont(ctx, 400, m(titleSize), SERIF, -0.005)
  ctx.fillText(T.title, m(left - titleSize * 0.04), Y(y))

  // Subtitle
  y -= gapTS
  ctx.fillStyle = INK_SOFT
  setFont(ctx, 400, m(subSize), SERIF, 0.02)
  ctx.fillText(T.subtitle, m(left), Y(y))

  // Rule
  y -= gapSR
  ctx.fillStyle = ACCENT
  ctx.fillRect(m(left), Y(y), m(Math.min(0.36, blockW * 0.16)), Math.max(1.5, m(0.0028)))

  // Intro paragraph
  y -= gapRI
  ctx.fillStyle = INK
  setFont(ctx, 400, m(introSize), SANS)
  for (const line of introLines) {
    ctx.fillText(line, m(left), Y(y))
    y -= introLH
  }

  return toTexture(ctx.canvas, 'title-wall')
}

/* ------------------------------------------------------------------ */
/* 2. Craft infographic panels (opaque print)                           */
/* ------------------------------------------------------------------ */

export async function createInfographicTexture(cfg: InfographicConfig, widthM: number, heightM: number): Promise<THREE.CanvasTexture> {
  await ensureWallFonts()
  const { ctx, m } = surface(widthM, heightM, 1000)

  // Paper
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, m(widthM), m(heightM))
  paperGrain(ctx, m(widthM), m(heightM), cfg.id.length * 17 + 3)
  // Subtle inset border
  ctx.strokeStyle = 'rgba(46, 42, 38, 0.13)'
  ctx.lineWidth = Math.max(1, m(0.0014))
  const inset = Math.min(widthM, heightM) * 0.022
  ctx.strokeRect(m(inset), m(inset), m(widthM - inset * 2), m(heightM - inset * 2))

  const u = Math.min(widthM / 1.45, heightM / 1.95) // layout unit relative to the design size
  const pad = 0.11 * u
  const innerW = widthM - pad * 2
  let y = pad + 0.02 * u

  // Header: number + series line
  ctx.fillStyle = ACCENT
  setFont(ctx, 500, m(0.085 * u), SERIF)
  const num = cfg.kicker
  y += 0.07 * u
  ctx.fillText(num, m(pad), m(y))
  const numW = ctx.measureText(num).width
  ctx.fillRect(m(pad) + numW + m(0.03 * u), m(y - 0.026 * u), m(0.1 * u), Math.max(1, m(0.0018)))
  ctx.fillStyle = 'rgba(46, 42, 38, 0.55)'
  setFont(ctx, 500, m(0.019 * u), SANS, 0.24)
  ctx.fillText('THE CRAFT', m(pad) + numW + m(0.16 * u), m(y - 0.02 * u))

  // Title
  y += 0.15 * u
  ctx.fillStyle = INK
  setFont(ctx, 500, m(0.115 * u), SERIF, -0.005)
  const titleLines = wrap(ctx, cfg.title, m(innerW))
  for (const l of titleLines) {
    ctx.fillText(l, m(pad), m(y))
    y += 0.12 * u
  }
  y -= 0.12 * u

  // Illustration band
  const illTop = y + 0.07 * u
  const illH = 0.7 * u
  ctx.save()
  drawIllustration(ctx, cfg, { x: m(pad), y: m(illTop), w: m(innerW), h: m(illH) }, m(0.0032 * u), m(u))
  ctx.restore()

  // Thin rule before body
  y = illTop + illH + 0.07 * u
  ctx.fillStyle = 'rgba(46, 42, 38, 0.18)'
  ctx.fillRect(m(pad), m(y), m(innerW), Math.max(1, m(0.0012)))

  // Body text
  y += 0.085 * u
  ctx.fillStyle = INK
  const bodySize = 0.034 * u
  setFont(ctx, 400, m(bodySize), SANS)
  const bodyLines = wrap(ctx, cfg.body, Math.min(m(innerW), measureWidthForChars(ctx, 52)))
  const bodyLH = bodySize * 1.6
  const maxY = heightM - pad - (cfg.placeholder ? 0.06 * u : 0)
  for (const l of bodyLines) {
    if (y > maxY) break
    ctx.fillText(l, m(pad), m(y))
    y += bodyLH
  }

  if (cfg.placeholder) {
    const tagSize = 0.017 * u
    setFont(ctx, 600, m(tagSize), SANS, 0.2)
    const label = 'CONTENT PENDING'
    const tw = ctx.measureText(label).width
    const px = m(0.018 * u)
    const bh = m(tagSize * 2.1)
    const bx = m(widthM - pad) - tw - px * 2
    const by = m(heightM - pad * 0.62) - bh
    ctx.strokeStyle = 'rgba(46, 42, 38, 0.35)'
    ctx.lineWidth = Math.max(1, m(0.0012))
    roundRect(ctx, bx, by, tw + px * 2, bh, bh / 2)
    ctx.stroke()
    ctx.fillStyle = 'rgba(46, 42, 38, 0.55)'
    ctx.fillText(label, bx + px, by + bh * 0.68)
  }

  return toTexture(ctx.canvas, `infographic-${cfg.id}`)
}

function paperGrain(ctx: CanvasRenderingContext2D, W: number, H: number, seed: number) {
  // Very faint fibre speckle so the print doesn't read as flat CG white.
  const img = ctx.getImageData(0, 0, W, H)
  const d = img.data
  const rnd = mulberry32(seed)
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 5
    d[i] += n
    d[i + 1] += n
    d[i + 2] += n
  }
  ctx.putImageData(img, 0, 0)
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** Line illustrations. `lw` = base stroke width px, `U` = px per layout-metre. */
function drawIllustration(ctx: CanvasRenderingContext2D, cfg: InfographicConfig, b: Box, lw: number, U: number) {
  ctx.strokeStyle = INK
  ctx.fillStyle = INK
  ctx.lineWidth = lw
  switch (cfg.icon) {
    case 'map':
      return drawMap(ctx, b, lw, U)
    case 'dye':
      return drawDyes(ctx, b, lw, U)
    case 'block':
      return drawBlock(ctx, b, lw, U)
    case 'process':
      return drawProcess(ctx, b, lw, U, cfg.steps ?? ['Block', 'Cloth', 'Colour', 'Print', 'Finish'])
  }
}

/** Smooth closed curve through points (Catmull-Rom → Bézier). */
function closedCurve(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  const n = pts.length
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]
    const p1 = pts[i]
    const p2 = pts[(i + 1) % n]
    const p3 = pts[(i + 2) % n]
    ctx.bezierCurveTo(
      p1[0] + (p2[0] - p0[0]) / 6,
      p1[1] + (p2[1] - p0[1]) / 6,
      p2[0] - (p3[0] - p1[0]) / 6,
      p2[1] - (p3[1] - p1[1]) / 6,
      p2[0],
      p2[1],
    )
  }
  ctx.closePath()
}

function drawMap(ctx: CanvasRenderingContext2D, b: Box, lw: number, U: number) {
  // Abstract region outline with nested contours — explicitly not a real map.
  const cx = b.x + b.w * 0.5
  const cy = b.y + b.h * 0.52
  const R = Math.min(b.w * 0.36, b.h * 0.44)
  const rnd = mulberry32(412)
  const N = 11
  const radii = Array.from({ length: N }, () => 0.78 + rnd() * 0.3)
  const ring = (scale: number, wob: number): [number, number][] =>
    radii.map((r, i) => {
      const a = (i / N) * Math.PI * 2 - Math.PI / 2
      const rr = R * scale * (1 + (r - 0.93) * wob)
      return [cx + Math.cos(a) * rr * 1.18, cy + Math.sin(a) * rr]
    })

  ctx.save()
  ctx.fillStyle = 'rgba(138, 74, 51, 0.06)'
  closedCurve(ctx, ring(1, 1))
  ctx.fill()
  ctx.lineWidth = lw * 1.1
  ctx.strokeStyle = INK
  ctx.stroke()
  ctx.lineWidth = lw * 0.55
  ctx.strokeStyle = 'rgba(46, 42, 38, 0.45)'
  for (const [sc, wob] of [
    [0.78, 1.4],
    [0.56, 1.9],
    [0.34, 2.4],
  ] as const) {
    closedCurve(ctx, ring(sc, wob))
    ctx.stroke()
  }
  // A meandering river line
  ctx.setLineDash([lw * 2.5, lw * 2.2])
  ctx.lineWidth = lw * 0.8
  ctx.strokeStyle = 'rgba(46, 42, 38, 0.6)'
  ctx.beginPath()
  ctx.moveTo(cx - R * 1.35, cy + R * 0.55)
  ctx.bezierCurveTo(cx - R * 0.6, cy + R * 0.1, cx - R * 0.2, cy + R * 0.75, cx + R * 0.3, cy + R * 0.25)
  ctx.bezierCurveTo(cx + R * 0.7, cy - R * 0.15, cx + R * 1.0, cy + R * 0.05, cx + R * 1.4, cy - R * 0.35)
  ctx.stroke()
  ctx.setLineDash([])

  // Pin
  const px = cx - R * 0.18
  const py = cy - R * 0.12
  const pr = 0.03 * U
  ctx.fillStyle = ACCENT
  ctx.beginPath()
  ctx.moveTo(px, py)
  ctx.bezierCurveTo(px - pr * 0.5, py - pr * 1.1, px - pr * 1.25, py - pr * 1.55, px - pr * 1.25, py - pr * 2.35)
  ctx.arc(px, py - pr * 2.35, pr * 1.25, Math.PI, 0)
  ctx.bezierCurveTo(px + pr * 1.25, py - pr * 1.55, px + pr * 0.5, py - pr * 1.1, px, py)
  ctx.fill()
  ctx.fillStyle = PAPER
  ctx.beginPath()
  ctx.arc(px, py - pr * 2.35, pr * 0.48, 0, Math.PI * 2)
  ctx.fill()
  // pin shadow ellipse
  ctx.fillStyle = 'rgba(46, 42, 38, 0.25)'
  ctx.beginPath()
  ctx.ellipse(px, py + pr * 0.1, pr * 0.8, pr * 0.25, 0, 0, Math.PI * 2)
  ctx.fill()

  // North arrow
  const nx = b.x + b.w - 0.05 * U
  const ny = b.y + 0.06 * U
  ctx.strokeStyle = INK
  ctx.fillStyle = INK
  ctx.lineWidth = lw * 0.8
  ctx.beginPath()
  ctx.moveTo(nx, ny + 0.07 * U)
  ctx.lineTo(nx, ny)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(nx, ny - 0.012 * U)
  ctx.lineTo(nx - 0.012 * U, ny + 0.012 * U)
  ctx.lineTo(nx + 0.012 * U, ny + 0.012 * U)
  ctx.closePath()
  ctx.fill()
  setFont(ctx, 500, 0.022 * U, SANS, 0.1)
  ctx.textAlign = 'center'
  ctx.fillText('N', nx, ny + 0.105 * U)
  ctx.textAlign = 'left'
  ctx.restore()
}

function drawDyes(ctx: CanvasRenderingContext2D, b: Box, lw: number, U: number) {
  const dyes = [
    { name: 'Indigo', color: '#2f3d66' },
    { name: 'Madder', color: '#9a3d2c' },
    { name: 'Ochre', color: '#c28f36' },
  ]
  const slot = b.w / dyes.length
  const bowlW = Math.min(slot * 0.62, 0.3 * U)
  const bowlH = bowlW * 0.5
  const baseY = b.y + b.h * 0.7
  dyes.forEach((dye, i) => {
    const cx = b.x + slot * (i + 0.5)
    const top = baseY - bowlH
    // liquid surface (ellipse) and bowl body
    ctx.save()
    ctx.lineWidth = lw
    ctx.strokeStyle = INK
    // bowl
    ctx.beginPath()
    ctx.moveTo(cx - bowlW / 2, top)
    ctx.bezierCurveTo(cx - bowlW / 2, top + bowlH * 0.9, cx - bowlW * 0.28, baseY, cx, baseY)
    ctx.bezierCurveTo(cx + bowlW * 0.28, baseY, cx + bowlW / 2, top + bowlH * 0.9, cx + bowlW / 2, top)
    ctx.stroke()
    // foot
    ctx.beginPath()
    ctx.moveTo(cx - bowlW * 0.16, baseY + lw * 0.3)
    ctx.lineTo(cx - bowlW * 0.2, baseY + bowlH * 0.16)
    ctx.lineTo(cx + bowlW * 0.2, baseY + bowlH * 0.16)
    ctx.lineTo(cx + bowlW * 0.16, baseY + lw * 0.3)
    ctx.stroke()
    // rim & dye
    ctx.fillStyle = dye.color
    ctx.beginPath()
    ctx.ellipse(cx, top + bowlH * 0.05, bowlW * 0.44, bowlH * 0.13, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.ellipse(cx, top, bowlW / 2, bowlH * 0.17, 0, 0, Math.PI * 2)
    ctx.stroke()
    // falling drop
    const dr = bowlW * 0.075
    const dy = top - bowlH * 0.75
    ctx.beginPath()
    ctx.moveTo(cx, dy - dr * 2.4)
    ctx.bezierCurveTo(cx + dr * 0.35, dy - dr * 1.4, cx + dr, dy - dr * 0.7, cx + dr, dy)
    ctx.arc(cx, dy, dr, 0, Math.PI)
    ctx.bezierCurveTo(cx - dr, dy - dr * 0.7, cx - dr * 0.35, dy - dr * 1.4, cx, dy - dr * 2.4)
    ctx.fill()
    // swatch + label
    const sw = bowlW * 0.5
    const sy = baseY + bowlH * 0.42
    ctx.fillRect(cx - sw / 2, sy, sw, sw * 0.16)
    ctx.fillStyle = INK
    setFont(ctx, 500, 0.022 * U, SANS, 0.18)
    ctx.textAlign = 'center'
    ctx.fillText(dye.name.toUpperCase(), cx, sy + sw * 0.16 + 0.042 * U)
    ctx.textAlign = 'left'
    ctx.restore()
  })
}

function drawBlock(ctx: CanvasRenderingContext2D, b: Box, lw: number, U: number) {
  // Isometric carved block (face down) with a turned handle, beside its printed repeat.
  const S = Math.min(b.w * 0.2, b.h * 0.34) // half-diagonal of the top face
  const cx = b.x + Math.max(b.w * 0.27, S * 0.9 + b.w * 0.02)
  const cy = b.y + b.h * 0.6 // half-diagonal of the top face
  const iso = (x: number, y: number, z: number): [number, number] => [cx + (x - y) * S * 0.866, cy + (x + y) * S * 0.5 - z * S]
  const thick = 0.42
  const P = {
    t0: iso(-1, -1, thick),
    t1: iso(1, -1, thick),
    t2: iso(1, 1, thick),
    t3: iso(-1, 1, thick),
    b1: iso(1, -1, 0),
    b2: iso(1, 1, 0),
    b3: iso(-1, 1, 0),
  }
  const poly = (pts: [number, number][]) => {
    ctx.beginPath()
    ctx.moveTo(pts[0][0], pts[0][1])
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
    ctx.closePath()
  }
  ctx.save()
  ctx.lineWidth = lw
  ctx.strokeStyle = INK
  // side faces with light tone
  ctx.fillStyle = 'rgba(138, 74, 51, 0.10)'
  poly([P.t1, P.t2, P.b2, P.b1])
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = 'rgba(138, 74, 51, 0.18)'
  poly([P.t2, P.t3, P.b3, P.b2])
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = 'rgba(245, 241, 232, 1)'
  poly([P.t0, P.t1, P.t2, P.t3])
  ctx.fill()
  ctx.stroke()
  // wood grain lines on the top face
  ctx.lineWidth = lw * 0.45
  ctx.strokeStyle = 'rgba(46, 42, 38, 0.35)'
  for (let k = -0.6; k <= 0.61; k += 0.3) {
    const a = iso(-0.85, k, thick)
    const c = iso(0.85, k + 0.08, thick)
    ctx.beginPath()
    ctx.moveTo(a[0], a[1])
    ctx.quadraticCurveTo((a[0] + c[0]) / 2, (a[1] + c[1]) / 2 - S * 0.03, c[0], c[1])
    ctx.stroke()
  }
  // carved relief hint along the bottom edge (teeth of the motif)
  ctx.lineWidth = lw * 0.6
  ctx.strokeStyle = INK
  for (let k = -0.8; k <= 0.81; k += 0.2) {
    const p = iso(k, 1, 0)
    ctx.beginPath()
    ctx.moveTo(p[0], p[1])
    ctx.lineTo(p[0], p[1] + S * 0.07)
    ctx.stroke()
  }
  // handle: a turned knob
  const hb = iso(0, 0, thick)
  const hr = S * 0.17
  const hh = S * 0.42
  ctx.lineWidth = lw
  ctx.fillStyle = PAPER
  ctx.beginPath()
  ctx.moveTo(hb[0] - hr * 0.55, hb[1])
  ctx.bezierCurveTo(hb[0] - hr * 0.25, hb[1] - hh * 0.35, hb[0] - hr * 1.25, hb[1] - hh * 0.65, hb[0] - hr, hb[1] - hh)
  ctx.lineTo(hb[0] + hr, hb[1] - hh)
  ctx.bezierCurveTo(hb[0] + hr * 1.25, hb[1] - hh * 0.65, hb[0] + hr * 0.25, hb[1] - hh * 0.35, hb[0] + hr * 0.55, hb[1])
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.ellipse(hb[0], hb[1] - hh, hr, hr * 0.42, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.ellipse(hb[0], hb[1], hr * 0.55, hr * 0.22, 0, 0, Math.PI)
  ctx.stroke()
  ctx.restore()

  // Printed repeat to the right: a small four-petal motif in madder.
  const gx0 = b.x + b.w * 0.66
  const gy0 = b.y + b.h * 0.2
  const cell = Math.min(b.w * 0.105, b.h * 0.2)
  ctx.save()
  ctx.fillStyle = ACCENT
  ctx.strokeStyle = ACCENT
  ctx.lineWidth = lw * 0.6
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) {
      const mx = gx0 + (c + (r % 2 ? 0.5 : 0)) * cell
      const my = gy0 + r * cell * 0.95 + cell * 0.5
      motif(ctx, mx, my, cell * 0.36)
    }
  ctx.fillStyle = 'rgba(46, 42, 38, 0.55)'
  setFont(ctx, 500, 0.019 * U, SANS, 0.2)
  ctx.fillText('IMPRESSION', gx0 - cell * 0.35, gy0 + cell * 3.45)
  ctx.restore()
  // arrow block → print
  ctx.save()
  ctx.strokeStyle = 'rgba(46, 42, 38, 0.5)'
  ctx.lineWidth = lw * 0.7
  const ax0 = b.x + b.w * 0.55
  const ax1 = b.x + b.w * 0.62
  const ay = b.y + b.h * 0.5
  ctx.beginPath()
  ctx.moveTo(ax0, ay)
  ctx.lineTo(ax1, ay)
  ctx.moveTo(ax1 - lw * 3, ay - lw * 2.4)
  ctx.lineTo(ax1, ay)
  ctx.lineTo(ax1 - lw * 3, ay + lw * 2.4)
  ctx.stroke()
  ctx.restore()
}

function motif(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2
    ctx.beginPath()
    ctx.ellipse(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.5, r * 0.24, a, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.beginPath()
  ctx.arc(x, y, r * 0.16, 0, Math.PI * 2)
  ctx.fillStyle = PAPER
  ctx.fill()
  ctx.fillStyle = ACCENT
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2
    ctx.beginPath()
    ctx.arc(x + Math.cos(a) * r * 0.95, y + Math.sin(a) * r * 0.95, r * 0.09, 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawProcess(ctx: CanvasRenderingContext2D, b: Box, lw: number, U: number, steps: string[]) {
  const n = steps.length
  const vertical = b.w / n < 0.17 * U
  const r = Math.min(0.058 * U, (vertical ? b.h / n : b.w / n) * 0.24)
  ctx.save()
  const centres: [number, number][] = steps.map((_, i) =>
    vertical ? [b.x + r * 1.4, b.y + (b.h / n) * (i + 0.5)] : [b.x + (b.w / n) * (i + 0.5), b.y + b.h * 0.42],
  )
  // connectors
  ctx.strokeStyle = 'rgba(46, 42, 38, 0.55)'
  ctx.lineWidth = lw * 0.7
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = centres[i]
    const [x1, y1] = centres[i + 1]
    const g = r * 1.35
    const sx = vertical ? x0 : x0 + g
    const sy = vertical ? y0 + g : y0
    const ex = vertical ? x1 : x1 - g
    const ey = vertical ? y1 - g : y1
    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.lineTo(ex, ey)
    ctx.stroke()
    const ah = lw * 2.4
    ctx.beginPath()
    if (vertical) {
      ctx.moveTo(ex - ah, ey - ah)
      ctx.lineTo(ex, ey)
      ctx.lineTo(ex + ah, ey - ah)
    } else {
      ctx.moveTo(ex - ah, ey - ah)
      ctx.lineTo(ex, ey)
      ctx.lineTo(ex - ah, ey + ah)
    }
    ctx.stroke()
  }
  // nodes
  steps.forEach((label, i) => {
    const [x, y] = centres[i]
    ctx.lineWidth = lw
    ctx.strokeStyle = i === n - 1 ? ACCENT : INK
    ctx.fillStyle = i === n - 1 ? ACCENT : PAPER
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = i === n - 1 ? PAPER : INK
    setFont(ctx, 500, r * 1.05, SERIF)
    ctx.textAlign = 'center'
    ctx.fillText(String(i + 1), x, y + r * 0.36)
    ctx.fillStyle = INK
    setFont(ctx, 500, 0.022 * U, SANS, 0.14)
    if (vertical) {
      ctx.textAlign = 'left'
      ctx.fillText(label.toUpperCase(), x + r * 1.8, y + 0.008 * U)
    } else {
      ctx.fillText(label.toUpperCase(), x, y + r + 0.055 * U)
    }
    ctx.textAlign = 'left'
  })
  ctx.restore()
}

/* ------------------------------------------------------------------ */
/* 3. Reception welcome + orientation plan (transparent)                */
/* ------------------------------------------------------------------ */

export async function createWelcomeTexture(widthM: number, heightM: number): Promise<THREE.CanvasTexture> {
  await ensureWallFonts()
  const { ctx, m } = surface(widthM, heightM, 900)
  const W = RECEPTION_WELCOME

  // World plan bounds (walls included).
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const w of WALLS) {
    minX = Math.min(minX, w.min[0])
    maxX = Math.max(maxX, w.max[0])
    minZ = Math.min(minZ, w.min[2])
    maxZ = Math.max(maxZ, w.max[2])
  }
  const planWm = maxX - minX
  const planHm = maxZ - minZ

  const pad = Math.min(widthM, heightM) * 0.08
  const side = widthM >= heightM * 0.95
  const textW = side ? (widthM - pad * 3) * 0.52 : widthM - pad * 2
  const k = Math.min(1.6, Math.max(0.6, Math.min(widthM, heightM * 1.2) / 1.4))

  // Text column
  const titleSize = 0.15 * k
  const bodySize = 0.034 * k
  let y = pad + titleSize * 0.8
  ctx.fillStyle = ACCENT
  setFont(ctx, 500, m(0.024 * k), SANS, 0.3)
  ctx.fillText('HAND BLOCK PRINTING', m(pad), m(y))
  y += titleSize * 1.05
  ctx.fillStyle = INK
  setFont(ctx, 400, m(titleSize), SERIF, -0.005)
  ctx.fillText(W.title, m(pad - titleSize * 0.03), m(y))
  y += bodySize * 1.4
  ctx.fillStyle = ACCENT
  ctx.fillRect(m(pad), m(y), m(0.16 * k), Math.max(1.5, m(0.0026)))
  y += bodySize * 2.3
  ctx.fillStyle = INK
  setFont(ctx, 400, m(bodySize), SANS)
  const lines = wrap(ctx, W.body, Math.min(m(textW), measureWidthForChars(ctx, 44)))
  for (const l of lines) {
    ctx.fillText(l, m(pad), m(y))
    y += bodySize * 1.62
  }
  const textBottom = y

  // Plan area
  let area: { x: number; y: number; w: number; h: number }
  if (side) area = { x: pad * 2 + textW, y: pad, w: widthM - pad * 3 - textW, h: heightM - pad * 2 }
  else area = { x: pad, y: textBottom + pad * 0.6, w: widthM - pad * 2, h: heightM - textBottom - pad * 1.6 }
  const labelSpace = 0.07 * k // room for the "N" marker above
  const sc = Math.min(area.w / planWm, (area.h - labelSpace) / planHm) // metres on panel per world metre
  const ox = area.x + (area.w - planWm * sc) / 2
  const oy = area.y + labelSpace + (area.h - labelSpace - planHm * sc) / 2
  const PX = (x: number) => m(ox + (x - minX) * sc)
  const PY = (z: number) => m(oy + (z - minZ) * sc) // north (-z) up

  // Zones — hairline tint
  for (const z of ZONES) {
    ctx.fillStyle = z.id === 'reception' ? 'rgba(138, 74, 51, 0.08)' : 'rgba(46, 42, 38, 0.035)'
    ctx.fillRect(PX(z.rect.minX), PY(z.rect.minZ), PX(z.rect.maxX) - PX(z.rect.minX), PY(z.rect.maxZ) - PY(z.rect.minZ))
  }
  // Walls (skip lintels over openings so doorways read open)
  ctx.fillStyle = '#4a4540'
  for (const w of WALLS) {
    if (w.collide === false) continue
    const x0 = PX(w.min[0])
    const y0 = PY(w.min[2])
    ctx.fillRect(x0, y0, Math.max(1, PX(w.max[0]) - x0), Math.max(1, PY(w.max[2]) - y0))
  }
  // Zone labels
  // One common label size that fits every gallery zone (≤ 80 % of its plan width).
  const lblBase = 0.026 * k
  let lblSize = lblBase
  setFont(ctx, 500, m(lblBase), SANS, 0.12)
  for (const z of ZONES) {
    if (z.id === 'reception' || z.id === 'passage') continue
    const avail = (z.rect.maxX - z.rect.minX - 0.6) * sc * 0.8
    const tw = ctx.measureText(z.short.toUpperCase()).width / m(1)
    if (tw > avail) lblSize = Math.min(lblSize, (lblBase * avail) / tw)
  }
  setFont(ctx, 500, m(lblSize), SANS, 0.12)
  ctx.textAlign = 'center'
  ctx.fillStyle = INK_SOFT
  for (const z of ZONES) {
    if (z.id === 'reception' || z.id === 'passage') continue
    const cx = (z.rect.minX + z.rect.maxX) / 2
    let cz = (z.rect.minZ + z.rect.maxZ) / 2
    if (z.id === 'reveal') cz = z.rect.minZ + (z.rect.maxZ - z.rect.minZ) * 0.2
    if (z.id === 'gallery-a') cz = z.rect.minZ + (z.rect.maxZ - z.rect.minZ) * 0.25
    ctx.fillText(z.short.toUpperCase(), PX(cx), PY(cz) + m(lblSize * 0.35))
  }
  // Passage label, rotated along the axis
  const passage = ZONES.find((z) => z.id === 'passage')
  if (passage) {
    ctx.save()
    ctx.translate(PX(0), PY((passage.rect.minZ + passage.rect.maxZ) / 2))
    ctx.rotate(-Math.PI / 2)
    setFont(ctx, 500, m(lblSize * 0.85), SANS, 0.2)
    ctx.fillText('PASSAGE', 0, m(lblSize * 0.3))
    ctx.restore()
  }
  ctx.textAlign = 'left'

  // You are here
  const start = MUSEUM.visitor.start
  const hx = PX(start.x)
  const hy = PY(start.z)
  const dr = m(Math.max(0.012 * k, 0.28 * sc))
  ctx.fillStyle = 'rgba(138, 74, 51, 0.22)'
  ctx.beginPath()
  ctx.arc(hx, hy, dr * 2.1, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = ACCENT
  ctx.beginPath()
  ctx.arc(hx, hy, dr, 0, Math.PI * 2)
  ctx.fill()
  const yahSize = Math.max(lblSize, 0.024 * k)
  setFont(ctx, 600, m(yahSize), SANS, 0.08)
  ctx.fillStyle = ACCENT
  const rec = ZONES.find((z) => z.id === 'reception')
  const rightEdge = PX((rec ? rec.rect.maxX : maxX) + MUSEUM.walls.exteriorThickness)
  const yahText = 'You are here'
  const tw = ctx.measureText(yahText).width
  const tx = rightEdge + m(0.02 * k) + tw < m(widthM - pad * 0.3) ? rightEdge + m(0.02 * k) : hx - tw / 2
  const ty = tx === hx - tw / 2 ? hy + dr * 2.2 + m(yahSize) : hy + m(yahSize * 0.35)
  if (tx !== hx - tw / 2) {
    ctx.strokeStyle = ACCENT
    ctx.lineWidth = Math.max(1, m(0.0015))
    ctx.beginPath()
    ctx.moveTo(hx + dr * 2.3, hy)
    ctx.lineTo(tx - m(0.006 * k), hy)
    ctx.stroke()
  }
  ctx.fillText(yahText, tx, ty)

  // North marker
  const nX = PX(maxX) - m(0.02 * k)
  const nY = m(oy) - m(0.02 * k)
  ctx.fillStyle = INK
  ctx.beginPath()
  ctx.moveTo(nX, nY - m(0.04 * k))
  ctx.lineTo(nX - m(0.011 * k), nY - m(0.012 * k))
  ctx.lineTo(nX + m(0.011 * k), nY - m(0.012 * k))
  ctx.closePath()
  ctx.fill()
  setFont(ctx, 600, m(0.02 * k), SANS)
  ctx.textAlign = 'center'
  ctx.fillText('N', nX, nY + m(0.012 * k))
  ctx.textAlign = 'left'

  return toTexture(ctx.canvas, 'welcome')
}

/* ------------------------------------------------------------------ */
/* 4. Artwork caption labels (opaque card)                              */
/* ------------------------------------------------------------------ */

export interface LabelLine {
  text: string
  style: 'title' | 'meta' | 'body'
}

export async function createLabelTexture(lines: LabelLine[], widthM: number, heightM: number): Promise<THREE.CanvasTexture> {
  await ensureWallFonts()
  const { ctx, m } = surface(widthM, heightM, 2400)
  ctx.fillStyle = CARD
  ctx.fillRect(0, 0, m(widthM), m(heightM))
  paperGrain(ctx, m(widthM), m(heightM), 91)

  const pad = Math.min(widthM, heightM) * 0.13
  const innerW = widthM - pad * 2
  const styleOf = (st: LabelLine['style'], k: number) =>
    st === 'title'
      ? { weight: 600, size: 0.0205 * k, family: SERIF, color: INK, lh: 1.18, spacing: 0, before: 0, upper: false }
      : st === 'meta'
        ? { weight: 500, size: 0.0085 * k, family: SANS, color: 'rgba(46, 42, 38, 0.62)', lh: 1.55, spacing: 0.12, before: 0.35, upper: true }
        : { weight: 400, size: 0.0098 * k, family: SANS, color: INK, lh: 1.55, spacing: 0, before: 0.9, upper: false }

  // Fit: shrink until it fits the card height.
  let k = Math.min(1.8, Math.max(0.7, widthM / 0.3))
  type Laid = { text: string; x: number; y: number; st: ReturnType<typeof styleOf> }
  let laid: Laid[] = []
  for (let iter = 0; iter < 12; iter++) {
    laid = []
    let y = pad
    let prev: LabelLine['style'] | null = null
    for (const line of lines) {
      const st = styleOf(line.style, k)
      setFont(ctx, st.weight, m(st.size), st.family, st.spacing)
      const text = st.upper ? line.text.toUpperCase() : line.text
      const wrapped = wrap(ctx, text, m(innerW))
      if (prev !== null) y += st.size * (prev === line.style ? 0.2 : st.before)
      for (const w of wrapped) {
        y += st.size * (laid.length === 0 ? 0.95 : st.lh)
        laid.push({ text: w, x: pad, y, st })
      }
      prev = line.style
    }
    if (y <= heightM - pad * 0.8) break
    k *= 0.92
  }
  for (const l of laid) {
    ctx.fillStyle = l.st.color
    setFont(ctx, l.st.weight, m(l.st.size), l.st.family, l.st.spacing)
    ctx.fillText(l.text, m(l.x), m(l.y))
  }
  return toTexture(ctx.canvas, 'label')
}
