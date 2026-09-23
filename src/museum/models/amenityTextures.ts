/**
 * Canvas textures for the shop / library / credits models (generated once, cached).
 *
 *  - printAtlas()        8 printed-cloth swatches (placeholder motifs) for folded stacks,
 *                        cushions and stoles; `cellUV` remaps a part's UVs into one cell.
 *  - spineTexture()      neutral book-spine banding (tinted per instance) — no lettering.
 *  - sampleBookSpread()  the open pattern book: two pages of printed swatches.
 *  - resourceBoardTexture(), creditsTexture()  typography (async: waits for the web fonts).
 */
import * as THREE from 'three'
import type { MotifId } from '../config/exhibits'
import { drawMotif, hashString, mulberry32, paintCottonGround } from '../exhibits/motifs'
import { ensureWallFonts } from '../materials/wallGraphics'

const cache = new Map<string, THREE.Texture>()

function canvas(w: number, h: number) {
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  return { cv, ctx: cv.getContext('2d')! }
}

function finish(cv: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(cv)
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

function cached<T extends THREE.Texture>(key: string, make: () => T): T {
  const hit = cache.get(key)
  if (hit) return hit as T
  const t = make()
  cache.set(key, t)
  return t
}

/* ------------------------------------------------------------------ */
/* Printed cloth atlas                                                 */
/* ------------------------------------------------------------------ */

/** [motif, ink, ground] per atlas cell — placeholder colourways only. */
export const PRINT_CELLS: [MotifId, string, string][] = [
  ['rosette', '#8a3b2b', '#efe6d3'],
  ['teardrop', '#2c3f6b', '#ece4d2'],
  ['star-lattice', '#b7862f', '#f1ead9'],
  ['leaf-trail', '#3b5a3a', '#eee6d5'],
  ['diamond', '#2a2522', '#e9dfca'],
  ['rosette', '#f0e6d2', '#2f3d63'], // discharge-style: pale print on indigo ground
  ['teardrop', '#7c2419', '#e7c9a0'],
  ['star-lattice', '#efe4cf', '#8a3b2b'],
]
export const ATLAS_COLS = 4
export const ATLAS_ROWS = 2

export function printAtlas(): THREE.CanvasTexture {
  return cached('amenity-print-atlas', () => {
    const C = 256
    const { cv, ctx } = canvas(C * ATLAS_COLS, C * ATLAS_ROWS)
    PRINT_CELLS.forEach(([motif, ink, ground], i) => {
      const cx = (i % ATLAS_COLS) * C
      const cy = Math.floor(i / ATLAS_COLS) * C
      const r = mulberry32(hashString(`atlas-${i}`))
      ctx.save()
      ctx.beginPath()
      ctx.rect(cx, cy, C, C)
      ctx.clip()
      ctx.translate(cx, cy)
      paintCottonGround(ctx, C, C, ground, r, { threadPx: 1.2, unevenness: 0.5, noise: 4 })
      const cell = C / 4
      for (let yy = -1; yy < 4; yy++)
        for (let xx = 0; xx < 4; xx++) {
          const drop = xx % 2 ? cell / 2 : 0
          drawMotif(ctx, motif, xx * cell + cell / 2, yy * cell + cell / 2 + drop, cell * 0.8, ink, {
            composite: 'source-over',
            rng: r,
            alpha: 0.85,
            voids: 0.25,
            mottle: 0.3,
          })
        }
      // border stripes along two edges (the selvedge of a folded length)
      ctx.fillStyle = ink
      ctx.globalAlpha = 0.85
      ctx.fillRect(0, C - 14, C, 6)
      ctx.fillRect(0, C - 5, C, 2)
      ctx.restore()
    })
    const t = finish(cv)
    t.generateMipmaps = true
    return t
  })
}

/** Remap a geometry's 0..1 UVs into atlas cell `i` (with a small inset). Mutates and returns `geo`. */
export function cellUV(geo: THREE.BufferGeometry, i: number, inset = 0.02): THREE.BufferGeometry {
  const cell = ((i % PRINT_CELLS.length) + PRINT_CELLS.length) % PRINT_CELLS.length
  const u0 = (cell % ATLAS_COLS) / ATLAS_COLS
  const v1 = 1 - Math.floor(cell / ATLAS_COLS) / ATLAS_ROWS
  const du = 1 / ATLAS_COLS
  const dv = 1 / ATLAS_ROWS
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined
  if (!uv) return geo
  for (let k = 0; k < uv.count; k++) {
    const u = Math.min(1, Math.max(0, uv.getX(k)))
    const v = Math.min(1, Math.max(0, uv.getY(k)))
    uv.setXY(k, u0 + (inset + u * (1 - 2 * inset)) * du, v1 - dv + (inset + v * (1 - 2 * inset)) * dv)
  }
  uv.needsUpdate = true
  return geo
}

let printMat: THREE.MeshStandardMaterial | null = null
/** Shared printed-cloth material (atlas map). */
export function printMaterial(): THREE.MeshStandardMaterial {
  if (!printMat) printMat = new THREE.MeshStandardMaterial({ name: 'amenityPrint', map: printAtlas(), roughness: 0.96, metalness: 0, envMapIntensity: 0.5 })
  return printMat
}

/* ------------------------------------------------------------------ */
/* Books                                                               */
/* ------------------------------------------------------------------ */

/** Neutral spine banding (white = instance colour): cloth grain, two tooled bands near each end. */
export function spineTexture(): THREE.CanvasTexture {
  return cached('amenity-spine', () => {
    const W = 64
    const H = 256
    const { cv, ctx } = canvas(W, H)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, W, H)
    const r = mulberry32(77)
    for (let i = 0; i < 180; i++) {
      ctx.fillStyle = `rgba(0,0,0,${r() * 0.06})`
      ctx.fillRect(r() * W, r() * H, 1 + r() * 2, 1)
    }
    ctx.fillStyle = 'rgba(40,30,20,0.35)'
    for (const y of [16, 26, H - 30, H - 20]) ctx.fillRect(0, y, W, 3)
    // a pale "label" panel with no lettering
    ctx.fillStyle = 'rgba(255,248,230,0.35)'
    ctx.fillRect(W * 0.18, H * 0.28, W * 0.64, H * 0.16)
    // subtle rounded-spine shading
    const g = ctx.createLinearGradient(0, 0, W, 0)
    g.addColorStop(0, 'rgba(0,0,0,0.25)')
    g.addColorStop(0.5, 'rgba(0,0,0,0)')
    g.addColorStop(1, 'rgba(0,0,0,0.25)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
    return finish(cv)
  })
}

/* ------------------------------------------------------------------ */
/* Pattern book spread                                                 */
/* ------------------------------------------------------------------ */

export function sampleBookSpread(seed = 1): THREE.CanvasTexture {
  return cached(`amenity-spread|${seed}`, () => {
    const W = 1024
    const H = 640
    const { cv, ctx } = canvas(W, H)
    const r = mulberry32(seed * 7919)
    ctx.fillStyle = '#efe6d2'
    ctx.fillRect(0, 0, W, H)
    // paper tone + gutter shadow
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(120,95,60,${r() * 0.04})`
      ctx.fillRect(r() * W, r() * H, 2, 2)
    }
    const gut = ctx.createLinearGradient(W / 2 - 60, 0, W / 2 + 60, 0)
    gut.addColorStop(0, 'rgba(60,40,20,0)')
    gut.addColorStop(0.5, 'rgba(60,40,20,0.28)')
    gut.addColorStop(1, 'rgba(60,40,20,0)')
    ctx.fillStyle = gut
    ctx.fillRect(W / 2 - 60, 0, 120, H)
    // swatches pinned on each page: 2 × 3 per page
    const sw = 150
    const sh = 118
    let n = seed
    for (const page of [0, 1]) {
      const px = page * (W / 2) + 58
      for (let row = 0; row < 3; row++)
        for (let col = 0; col < 2; col++) {
          const [motif, ink, ground] = PRINT_CELLS[n++ % PRINT_CELLS.length]
          const x = px + col * (sw + 48) + (r() - 0.5) * 6
          const y = 60 + row * (sh + 52) + (r() - 0.5) * 6
          ctx.save()
          ctx.translate(x + sw / 2, y + sh / 2)
          ctx.rotate((r() - 0.5) * 0.04)
          ctx.shadowColor = 'rgba(40,30,20,0.35)'
          ctx.shadowBlur = 6
          ctx.shadowOffsetY = 2
          ctx.fillStyle = ground
          ctx.fillRect(-sw / 2, -sh / 2, sw, sh)
          ctx.shadowColor = 'transparent'
          ctx.beginPath()
          ctx.rect(-sw / 2, -sh / 2, sw, sh)
          ctx.clip()
          for (let yy = -1; yy <= 1; yy++) for (let xx = -1; xx <= 1; xx++) drawMotif(ctx, motif, xx * 56, yy * 56, 48, ink, { rng: r, alpha: 0.85, voids: 0.2, mottle: 0.25 })
          ctx.restore()
          // pencil reference line under each swatch (illegible scribble, no text)
          ctx.strokeStyle = 'rgba(70,60,50,0.4)'
          ctx.lineWidth = 1.2
          ctx.beginPath()
          ctx.moveTo(x + 8, y + sh + 16)
          for (let k = 0; k < 8; k++) ctx.lineTo(x + 14 + k * 9, y + sh + 16 + (k % 2 ? -2 : 2))
          ctx.stroke()
        }
    }
    return finish(cv)
  })
}

/* ------------------------------------------------------------------ */
/* Typography                                                          */
/* ------------------------------------------------------------------ */

const SERIF = '"Cormorant Garamond", "Cormorant", Georgia, serif'
const SANS = 'Inter, "Helvetica Neue", Helvetica, Arial, sans-serif'

function spacing(ctx: CanvasRenderingContext2D, em: number, px: number) {
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string }
  if ('letterSpacing' in c) c.letterSpacing = `${(em * px).toFixed(2)}px`
}

/** Framed Resources board (0.9 × 1.25 m by default), dark-on-plaster lettering. */
export async function resourceBoardTexture(items: { label: string; note?: string }[], w = 0.9, h = 1.25): Promise<THREE.CanvasTexture> {
  await ensureWallFonts()
  const s = 900 / w
  const { cv, ctx } = canvas(Math.round(w * s), Math.round(h * s))
  const W = cv.width
  const H = cv.height
  ctx.fillStyle = '#f3eee4'
  ctx.fillRect(0, 0, W, H)
  const m = (v: number) => v * s
  const L = m(0.09)
  ctx.fillStyle = '#8a4a33'
  ctx.font = `500 ${m(0.024)}px ${SANS}`
  spacing(ctx, 0.3, m(0.024))
  ctx.fillText('READING ROOM', L, m(0.14))
  ctx.fillStyle = '#2e2a26'
  ctx.font = `400 ${m(0.1)}px ${SERIF}`
  spacing(ctx, 0, m(0.1))
  ctx.fillText('Resources', L - m(0.004), m(0.25))
  ctx.fillStyle = '#8a4a33'
  ctx.fillRect(L, m(0.29), m(0.12), Math.max(2, m(0.003)))
  let y = m(0.4)
  for (const it of items) {
    ctx.fillStyle = '#2e2a26'
    ctx.font = `500 ${m(0.036)}px ${SANS}`
    ctx.fillText(it.label, L, y)
    if (it.note) {
      ctx.fillStyle = 'rgba(46,42,38,0.7)'
      ctx.font = `400 ${m(0.024)}px ${SANS}`
      // wrap the note
      const words = it.note.split(/\s+/)
      let line = ''
      let yy = y + m(0.045)
      for (const wd of words) {
        const t = line ? `${line} ${wd}` : wd
        if (ctx.measureText(t).width > W - 2 * L && line) {
          ctx.fillText(line, L, yy)
          yy += m(0.034)
          line = wd
        } else line = t
      }
      if (line) ctx.fillText(line, L, yy)
      y = yy + m(0.095)
    } else y += m(0.1)
  }
  ctx.fillStyle = 'rgba(46,42,38,0.55)'
  ctx.font = `400 ${m(0.022)}px ${SANS}`
  ctx.fillText('Select this board to open the links', L, H - m(0.08))
  const t = finish(cv)
  return t
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

/**
 * Credits panel: brass-coloured kicker, fillet, the partner logo (PNG or SVG — SVGs are
 * rasterised at the panel's full resolution) on a pale limestone ground.
 */
export async function creditsTexture(kicker: string, logo: string, w: number, h: number): Promise<THREE.CanvasTexture> {
  await ensureWallFonts()
  const s = Math.min(1100, 4096 / Math.max(w, h))
  const { cv, ctx } = canvas(Math.round(w * s), Math.round(h * s))
  const W = cv.width
  const H = cv.height
  const m = (v: number) => v * s
  // limestone ground with a faint tonal wash
  ctx.fillStyle = '#efe9dd'
  ctx.fillRect(0, 0, W, H)
  const r = mulberry32(hashString(kicker))
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = `rgba(${120 + r() * 40},${100 + r() * 30},${70 + r() * 20},${r() * 0.05})`
    ctx.fillRect(r() * W, r() * H, 1 + r() * 3, 1 + r() * 3)
  }
  // kicker (letter-spaced small caps, bronze)
  ctx.fillStyle = '#5e4320'
  ctx.textAlign = 'center'
  ctx.font = `600 ${m(0.064)}px ${SANS}`
  spacing(ctx, 0.3, m(0.064))
  ctx.fillText(kicker.toUpperCase(), W / 2 + m(0.01), m(0.19))
  spacing(ctx, 0, m(0.064))
  ctx.fillStyle = '#9a7434'
  ctx.fillRect(W / 2 - m(0.11), m(0.245), m(0.22), Math.max(2, m(0.005)))
  // logo, fitted in the lower box
  const img = await loadImage(logo)
  if (img) {
    const bw = w * 0.74
    const bh = h - 0.46
    const iw = img.naturalWidth || img.width || 1
    const ih = img.naturalHeight || img.height || 1
    const k = Math.min(bw / iw, bh / ih)
    const dw = iw * k
    const dh = ih * k
    ctx.drawImage(img, W / 2 - m(dw) / 2, m(0.33) + (m(bh) - m(dh)) / 2, m(dw), m(dh))
  }
  const t = finish(cv)
  t.generateMipmaps = true
  t.minFilter = THREE.LinearMipmapLinearFilter
  return t
}
