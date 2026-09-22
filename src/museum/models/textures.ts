/**
 * Canvas textures for procedural models (generated once, cached, ≤ ~1 Mpx each).
 * Printed cloth uses the shared motif library so tables, swatches and blocks agree.
 */
import * as THREE from 'three'
import type { MotifId } from '../config/exhibits'
import { drawMotif, hashString, MOTIF_IDS, mulberry32, paintCottonGround } from '../exhibits/motifs'

const cache = new Map<string, THREE.Texture>()

function canvas(w: number, h: number) {
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  return { cv, ctx: cv.getContext('2d')! }
}

function finish(cv: HTMLCanvasElement, srgb = true, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(cv)
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping
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
/* Printing table cloth                                                */
/* ------------------------------------------------------------------ */

export interface PrintedClothOpts {
  motif: MotifId
  ink: string
  /** Cloth length along u (m). */
  length: number
  /** Arc-length segments of the sweep profile along v: [hangFront, top, hangBack] (m). */
  sections: [number, number, number]
  /** Fraction of the length already printed (0..1). */
  printed: number
  /** Repeat cell (m). */
  cell?: number
}

/**
 * A length of cotton being printed: a half-drop repeat marching along the cloth,
 * border lines along both selvedges, the working edge left ragged (some cells of the
 * last column still unprinted) and a faint chalk registration line beyond it.
 */
export function printedClothTexture(o: PrintedClothOpts): THREE.CanvasTexture {
  const key = `cloth|${o.motif}|${o.ink}|${o.length}|${o.sections.join(',')}|${o.printed}`
  return cached(key, () => {
    const total = o.sections[0] + o.sections[1] + o.sections[2]
    const W = 2048
    const H = Math.max(256, Math.min(640, Math.round((W * total) / o.length / 4) * 4))
    const pxX = W / o.length
    const pxY = H / total
    const { cv, ctx } = canvas(W, H)
    const r = mulberry32(hashString(key))
    paintCottonGround(ctx, W, H, '#efe7d6', r, { threadPx: 1.1, unevenness: 0.6, noise: 5 })

    // canvas y=0 is v=1 (flipY) → the back hang is at the top of the canvas
    const topY0 = o.sections[2] * pxY
    const topY1 = topY0 + o.sections[1] * pxY
    const cellM = o.cell ?? 0.115
    const cx = cellM * pxX
    const cy = cellM * pxY
    const x0 = 0.1 * pxX
    const xEnd = x0 + (W - x0) * o.printed
    const rows = Math.floor((topY1 - topY0 - cy * 0.8) / cy)
    const yStart = topY0 + (topY1 - topY0 - rows * cy) / 2 + cy / 2
    const cols = Math.ceil((xEnd - x0) / cx)
    const size = Math.min(cx, cy) * 0.9
    for (let c = 0; c < cols; c++) {
      const isEdge = c >= cols - 1
      const drop = c % 2 ? 0.5 : 0
      for (let rr = 0; rr < rows - (drop ? 1 : 0); rr++) {
        // the working edge: the printer is part-way down this column
        if (isEdge && rr > rows * 0.55) continue
        const x = x0 + c * cx + cx / 2 + (r() - 0.5) * 1.5
        const y = yStart + (rr + drop) * cy + (r() - 0.5) * 1.5
        drawMotif(ctx, o.motif, x, y, size, o.ink, {
          layer: 'all',
          rotation: (r() - 0.5) * 0.015,
          alpha: 0.78 + r() * 0.18,
          composite: 'multiply',
          rng: r,
          voids: 0.35,
          mottle: 0.45,
          grain: 0.35,
          bleed: 0.5,
        })
      }
    }
    // selvedge border lines in the printed zone
    ctx.save()
    ctx.globalCompositeOperation = 'multiply'
    ctx.fillStyle = o.ink
    for (const yy of [topY0 + cy * 0.18, topY1 - cy * 0.18]) {
      for (let x = x0; x < xEnd - cx * 0.5; x += 3) {
        ctx.globalAlpha = 0.65 + r() * 0.3
        ctx.fillRect(x, yy - 1.6 + (r() - 0.5) * 0.6, 3.2, 3.2)
      }
    }
    ctx.restore()
    // chalk registration line ahead of the working edge
    ctx.save()
    ctx.strokeStyle = 'rgba(120,110,95,0.35)'
    ctx.setLineDash([6, 5])
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(xEnd + cx * 0.6, topY0 + 6)
    ctx.lineTo(xEnd + cx * 0.6, topY1 - 6)
    ctx.stroke()
    ctx.restore()
    return finish(cv)
  })
}

/* ------------------------------------------------------------------ */
/* Carved block faces (atlas, for instanced blocks)                    */
/* ------------------------------------------------------------------ */

export const BLOCK_ATLAS = { cols: 4, rows: 2, plainCell: 7 }

function woodBase(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: () => number, tone: string) {
  ctx.fillStyle = tone
  ctx.fillRect(x, y, w, h)
  for (let i = 0; i < 26; i++) {
    const x0 = x + r() * w
    ctx.strokeStyle = r() < 0.6 ? `rgba(45,25,12,${0.1 + r() * 0.2})` : `rgba(200,150,100,${0.06 + r() * 0.1})`
    ctx.lineWidth = 0.6 + r() * 1.6
    ctx.beginPath()
    for (let yy = 0; yy <= h; yy += 6) {
      const xx = x0 + Math.sin((yy + i * 13) * 0.03) * 3
      if (yy === 0) ctx.moveTo(xx, y + yy)
      else ctx.lineTo(xx, y + yy)
    }
    ctx.stroke()
  }
}

/**
 * 4×2 atlas of carved block faces (256 px cells): colour map shows ink-stained relief on a
 * darker carved-away floor; `bump` is the matching height field. Cell 7 is plain wood
 * (used for the block's sides via a UV strip).
 */
export function blockFaceAtlas(): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const map = cached('blockAtlas', () => {
    const C = 256
    const { cols, rows } = BLOCK_ATLAS
    const { cv, ctx } = canvas(C * cols, C * rows)
    const { cv: bcv, ctx: bctx } = canvas(C * cols, C * rows)
    const r = mulberry32(77)
    const inks = ['#2c3f6b', '#7c2419', '#3a2a22', '#8a5a1c', '#1f2d52', '#6b2a1e', '#2d2a28']
    bctx.fillStyle = '#000'
    bctx.fillRect(0, 0, bcv.width, bcv.height)
    for (let i = 0; i < cols * rows; i++) {
      const x = (i % cols) * C
      const y = Math.floor(i / cols) * C
      woodBase(ctx, x, y, C, C, r, i === BLOCK_ATLAS.plainCell ? '#9a6a42' : '#5e3e26')
      if (i === BLOCK_ATLAS.plainCell) {
        bctx.fillStyle = '#fff'
        bctx.fillRect(x, y, C, C)
        continue
      }
      const motif = MOTIF_IDS[i % MOTIF_IDS.length]
      // relief tops: lighter wood, then ink stain
      drawMotif(ctx, motif, x + C / 2, y + C / 2, C * 0.84, '#a77a52', { layer: 'all' })
      drawMotif(ctx, motif, x + C / 2, y + C / 2, C * 0.84, inks[i % inks.length], {
        layer: 'all',
        alpha: 0.78,
        rng: r,
        mottle: 0.8,
        voids: 0.4,
        composite: 'source-over',
      })
      // bump: relief raised (white) on a low floor
      bctx.fillStyle = '#222'
      bctx.fillRect(x, y, C, C)
      drawMotif(bctx, motif, x + C / 2, y + C / 2, C * 0.84, '#ffffff', { layer: 'all' })
      // uncut rim
      bctx.strokeStyle = '#fff'
      bctx.lineWidth = 14
      bctx.strokeRect(x + 7, y + 7, C - 14, C - 14)
      ctx.strokeStyle = 'rgba(160,112,70,0.9)'
      ctx.lineWidth = 12
      ctx.strokeRect(x + 6, y + 6, C - 12, C - 12)
    }
    const t = finish(cv)
    cache.set('blockAtlasBump', finish(bcv, false))
    return t
  })
  return { map, bump: cache.get('blockAtlasBump') as THREE.CanvasTexture }
}

/* ------------------------------------------------------------------ */
/* Carving bench: design traced onto a fresh block, part-carved         */
/* ------------------------------------------------------------------ */

export function carvingFaceTexture(motif: MotifId): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const key = `carve|${motif}`
  const map = cached(key, () => {
    const S = 512
    const { cv, ctx } = canvas(S, S)
    const { cv: bcv, ctx: bctx } = canvas(S, S)
    const r = mulberry32(hashString(key))
    woodBase(ctx, 0, 0, S, S, r, '#b88a5c')
    bctx.fillStyle = '#fff'
    bctx.fillRect(0, 0, S, S)
    // right half carved: floor cut away around the relief (darker, rough)
    ctx.save()
    ctx.beginPath()
    ctx.rect(S * 0.52, 0, S * 0.48, S)
    ctx.clip()
    ctx.fillStyle = 'rgba(92,60,36,0.85)'
    ctx.fillRect(0, 0, S, S)
    drawMotif(ctx, motif, S / 2, S / 2, S * 0.82, '#c09062', { layer: 'all' })
    ctx.restore()
    bctx.save()
    bctx.beginPath()
    bctx.rect(S * 0.52, 0, S * 0.48, S)
    bctx.clip()
    bctx.fillStyle = '#333'
    bctx.fillRect(0, 0, S, S)
    drawMotif(bctx, motif, S / 2, S / 2, S * 0.82, '#fff', { layer: 'all' })
    bctx.restore()
    // pencil tracing over the whole face
    drawMotif(ctx, motif, S / 2, S / 2, S * 0.82, 'rgba(40,36,34,0.85)', { layer: 'outline' })
    ctx.strokeStyle = 'rgba(40,36,34,0.5)'
    ctx.lineWidth = 1.2
    ctx.strokeRect(S * 0.06, S * 0.06, S * 0.88, S * 0.88)
    const t = finish(cv)
    cache.set(key + '|bump', finish(bcv, false))
    return t
  })
  return { map, bump: cache.get(key + '|bump') as THREE.CanvasTexture }
}

/** A design sheet (tracing paper) with the motif drawn in pencil. */
export function designSheetTexture(motif: MotifId): THREE.CanvasTexture {
  return cached(`sheet|${motif}`, () => {
    const W = 512
    const H = 384
    const { cv, ctx } = canvas(W, H)
    ctx.fillStyle = '#f3ecdc'
    ctx.fillRect(0, 0, W, H)
    const r = mulberry32(5)
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = `rgba(120,100,70,${r() * 0.05})`
      ctx.fillRect(r() * W, r() * H, 2, 2)
    }
    drawMotif(ctx, motif, W * 0.3, H / 2, H * 0.7, 'rgba(50,46,44,0.8)', { layer: 'outline' })
    drawMotif(ctx, motif, W * 0.74, H / 2, H * 0.42, 'rgba(50,46,44,0.55)', { layer: 'all' })
    ctx.strokeStyle = 'rgba(60,56,52,0.35)'
    ctx.beginPath()
    ctx.moveTo(W * 0.3, 12)
    ctx.lineTo(W * 0.3, H - 12)
    ctx.moveTo(12, H / 2)
    ctx.lineTo(W * 0.56, H / 2)
    ctx.stroke()
    return finish(cv)
  })
}

/* ------------------------------------------------------------------ */
/* Foliage                                                             */
/* ------------------------------------------------------------------ */

function leaf(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, wid: number, ang: number, col: string, vein: string) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(ang)
  ctx.fillStyle = col
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.bezierCurveTo(wid, -len * 0.25, wid * 0.8, -len * 0.75, 0, -len)
  ctx.bezierCurveTo(-wid * 0.8, -len * 0.75, -wid, -len * 0.25, 0, 0)
  ctx.fill()
  ctx.strokeStyle = vein
  ctx.lineWidth = Math.max(0.8, wid * 0.08)
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(0, -len * 0.92)
  ctx.stroke()
  ctx.restore()
}

/**
 * Leaf-cluster card (alpha): a twig with a spray of leaves, drawn bottom-centre up.
 * `kind` tunes leaf size/shape: 'tree' small ovate, 'shrub' broader, 'strap' long blades.
 */
export function leafClusterTexture(kind: 'tree' | 'shrub' | 'strap'): THREE.CanvasTexture {
  return cached(`leaf|${kind}`, () => {
    const S = 512
    const { cv, ctx } = canvas(S, S)
    const r = mulberry32(kind === 'tree' ? 3 : kind === 'shrub' ? 9 : 21)
    const greens = kind === 'strap' ? ['#4f6a34', '#5d7a3c', '#43602f', '#6b8646'] : ['#56733a', '#46632f', '#688844', '#3d5a2c', '#7a9450']
    if (kind === 'strap') {
      for (let i = 0; i < 16; i++) {
        const a = (r() - 0.5) * 1.3
        leaf(ctx, S / 2 + (r() - 0.5) * 40, S, S * (0.55 + r() * 0.4), S * 0.035 + r() * 8, a, greens[i % greens.length], 'rgba(220,235,190,0.35)')
      }
    } else {
      // twig
      ctx.strokeStyle = '#5a4634'
      ctx.lineWidth = 5
      ctx.beginPath()
      ctx.moveTo(S / 2, S)
      ctx.quadraticCurveTo(S * 0.47, S * 0.55, S * 0.52, S * 0.12)
      ctx.stroke()
      const n = kind === 'tree' ? 34 : 22
      for (let i = 0; i < n; i++) {
        const t = r()
        const px = S * 0.5 + (r() - 0.5) * S * 0.62 * (0.4 + t)
        const py = S * (0.92 - t * 0.8)
        const len = kind === 'tree' ? S * (0.13 + r() * 0.08) : S * (0.2 + r() * 0.12)
        const wid = len * (kind === 'tree' ? 0.34 : 0.45)
        const shade = greens[Math.floor(r() * greens.length)]
        leaf(ctx, px, py, len, wid, (px - S / 2) / S * 2.2 + (r() - 0.5) * 0.9, shade, 'rgba(210,225,170,0.35)')
      }
    }
    const t = finish(cv)
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
    return t
  })
}

/** Blossom card (alpha): a few small five-petal flowers, near-white so instanceColor tints them. */
export function flowerTexture(): THREE.CanvasTexture {
  return cached('flower', () => {
    const S = 256
    const { cv, ctx } = canvas(S, S)
    const r = mulberry32(12)
    const flowers = [
      [S * 0.5, S * 0.3, 44],
      [S * 0.26, S * 0.52, 34],
      [S * 0.72, S * 0.56, 36],
      [S * 0.45, S * 0.74, 28],
    ]
    for (const [x, y, rad] of flowers) {
      for (let p = 0; p < 6; p++) {
        const a = (p / 6) * Math.PI * 2 + r()
        ctx.fillStyle = p % 2 ? '#f6efe4' : '#ffffff'
        ctx.beginPath()
        ctx.ellipse(x + Math.cos(a) * rad * 0.5, y + Math.sin(a) * rad * 0.5, rad * 0.5, rad * 0.3, a, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.fillStyle = '#e0b040'
      ctx.beginPath()
      ctx.arc(x, y, rad * 0.22, 0, Math.PI * 2)
      ctx.fill()
    }
    return finish(cv)
  })
}

/* ------------------------------------------------------------------ */
/* Image atlas (drying cloths)                                         */
/* ------------------------------------------------------------------ */

const imgCache = new Map<string, Promise<HTMLImageElement | null>>()
function loadImage(url: string) {
  let p = imgCache.get(url)
  if (!p) {
    p = new Promise((res) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => res(img)
      img.onerror = () => res(null)
      img.src = url
    })
    imgCache.set(url, p)
  }
  return p
}

const atlasCache = new Map<string, Promise<THREE.CanvasTexture>>()

/**
 * Packs images side by side into one texture (cell i spans u ∈ [i/n, (i+1)/n]), each
 * centre-cropped to the cell aspect and laid on a cotton ground. Missing images become
 * plain undyed cotton. Max 2048 px wide × `maxH` tall.
 */
export function imageAtlas(urls: string[], cellAspect: number, maxH = 1024): Promise<THREE.CanvasTexture> {
  const key = `${urls.join('|')}|${cellAspect.toFixed(3)}|${maxH}`
  let p = atlasCache.get(key)
  if (!p) {
    p = Promise.all(urls.map(loadImage)).then((imgs) => {
      const n = Math.max(1, urls.length)
      const cellH = Math.min(maxH, Math.round(2048 / n / cellAspect))
      const cellW = Math.round(cellH * cellAspect)
      const { cv, ctx } = canvas(cellW * n, cellH)
      const r = mulberry32(hashString(key))
      paintCottonGround(ctx, cv.width, cv.height, '#ece3d2', r, { threadPx: 1.4 })
      imgs.forEach((img, i) => {
        if (!img) return
        const ia = img.naturalWidth / img.naturalHeight
        let sw = img.naturalWidth
        let sh = img.naturalHeight
        if (ia > cellAspect) sw = sh * cellAspect
        else sh = sw / cellAspect
        ctx.globalCompositeOperation = 'multiply'
        ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, i * cellW, 0, cellW, cellH)
        ctx.globalCompositeOperation = 'source-over'
      })
      const t = finish(cv)
      t.generateMipmaps = true
      return t
    })
    atlasCache.set(key, p)
  }
  return p
}

/** Single image texture (tall banner, ~1 Mpx) with cotton fallback. */
export function imageTexture(url: string, aspect: number): Promise<THREE.CanvasTexture> {
  return imageAtlas([url], aspect, Math.round(Math.sqrt(1_048_576 / Math.max(0.05, aspect))))
}

/* ------------------------------------------------------------------ */
/* Tileable wood grain (furniture)                                     */
/* ------------------------------------------------------------------ */

export const WOOD_TILE: [number, number] = [0.3, 1.2]

/**
 * Seamlessly tiling plain-sawn wood albedo (grain along V). One tile covers
 * WOOD_TILE metres, so with metre UVs the texture carries `repeat = 1 / WOOD_TILE`.
 * `tone`: base colour; figure and pores are derived from it.
 */
export function woodTexture(tone: string, seed = 1): THREE.CanvasTexture {
  return cached(`wood|${tone}|${seed}`, () => {
    const W = 256
    const H = 1024
    const { cv, ctx } = canvas(W, H)
    const r = mulberry32(seed * 7919 + hashString(tone))
    const base = new THREE.Color(tone)
    const hsl = { h: 0, s: 0, l: 0 }
    base.getHSL(hsl)
    const col = (dl: number, ds = 0, a = 1) => {
      const c = new THREE.Color().setHSL(hsl.h + (r() - 0.5) * 0.01, Math.max(0, Math.min(1, hsl.s + ds)), Math.max(0, Math.min(1, hsl.l + dl)))
      return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`
    }
    ctx.fillStyle = col(0)
    ctx.fillRect(0, 0, W, H)
    // broad tonal bands (heartwood / sapwood variation), tile-safe in u
    for (let i = 0; i < 7; i++) {
      const x = r() * W
      const w = 20 + r() * 70
      const g = ctx.createLinearGradient(x - w, 0, x + w, 0)
      g.addColorStop(0, col(0, 0, 0))
      g.addColorStop(0.5, col((r() - 0.5) * 0.12, 0, 0.5))
      g.addColorStop(1, col(0, 0, 0))
      for (const dx of [-W, 0, W]) {
        ctx.save()
        ctx.translate(dx, 0)
        ctx.fillStyle = g
        ctx.fillRect(x - w, 0, 2 * w, H)
        ctx.restore()
      }
    }
    // growth rings: wavy lines along v with integer periods so they tile in v
    const lines = 46
    for (let i = 0; i < lines; i++) {
      const x0 = (i / lines) * W + (r() - 0.5) * 4
      const k1 = 1 + Math.floor(r() * 2)
      const k2 = 3 + Math.floor(r() * 3)
      const a1 = 3 + r() * 6
      const a2 = 0.8 + r() * 1.6
      const p1 = r() * 6.28
      const p2 = r() * 6.28
      const dark = r() < 0.7
      ctx.strokeStyle = dark ? col(-0.1 - r() * 0.08, 0.04, 0.35 + r() * 0.35) : col(0.06, -0.02, 0.25)
      ctx.lineWidth = dark ? 0.8 + r() * 2.2 : 1 + r() * 2
      for (const dx of [-W, 0, W]) {
        ctx.beginPath()
        for (let y = 0; y <= H; y += 8) {
          const t = (y / H) * Math.PI * 2
          const x = x0 + dx + Math.sin(t * k1 + p1) * a1 + Math.sin(t * k2 + p2) * a2
          if (y === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }
    }
    // pores / fine flecks
    for (let i = 0; i < 2600; i++) {
      ctx.fillStyle = col(-0.16, 0, 0.12 + r() * 0.25)
      ctx.fillRect(r() * W, r() * H, 0.7, 1.5 + r() * 4)
    }
    const t = finish(cv, true, true)
    t.repeat.set(1 / WOOD_TILE[0], 1 / WOOD_TILE[1])
    return t
  })
}
