/**
 * Canvas textures for wayfinding signage and trail medallions.
 *
 *  - Plaques: dark lettering on a pale lime-plaster card (room name in the visitor's
 *    language; the English name beneath when another language is chosen).
 *  - Totems: brass lettering on a deep walnut-ink face, one line per destination with an
 *    arrow drawn RELATIVE to the viewer (from the sign's facing and the world direction).
 *  - Medallions: a brass disc with the motif chased into it (map + bump).
 */
import * as THREE from 'three'
import { compassVec, type Compass, type SignLine } from '../config/amenities'
import type { MotifId } from '../config/exhibits'
import { drawMotif, hashString, mulberry32 } from '../exhibits/motifs'
import { zoneName } from '../i18n/content'
import type { Lang } from '../i18n/core'
import { ensureWallFonts } from '../materials/wallGraphics'

const SERIF = '"Cormorant Garamond", "Cormorant", Georgia, "Nirmala UI", "Noto Serif Devanagari", "Noto Serif Bengali", serif'
const SANS = 'Inter, "Helvetica Neue", Helvetica, Arial, "Nirmala UI", "Noto Sans Devanagari", "Noto Sans Bengali", sans-serif'

function canvas(w: number, h: number) {
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  return { cv, ctx: cv.getContext('2d')! }
}

function finish(cv: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  t.generateMipmaps = true
  t.minFilter = THREE.LinearMipmapLinearFilter
  return t
}

function spacing(ctx: CanvasRenderingContext2D, px: number, em: number) {
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string }
  if ('letterSpacing' in c) c.letterSpacing = `${(em * px).toFixed(2)}px`
}

/** Shrink a font size until `text` fits `maxW`. */
function fit(ctx: CanvasRenderingContext2D, text: string, weight: number, px: number, family: string, maxW: number) {
  let s = px
  for (let i = 0; i < 12; i++) {
    ctx.font = `${weight} ${s}px ${family}`
    if (ctx.measureText(text).width <= maxW) break
    s *= 0.92
  }
  return s
}

/** Relative arrow angle (radians, 0 = straight ahead / up, +π/2 = right) for a destination seen from a sign. */
export function arrowAngle(facing: Compass, dir: Compass) {
  const [nx, nz] = compassVec(facing)
  const fx = -nx
  const fz = -nz // viewer looks into the sign
  const rx = -fz
  const rz = fx // viewer's right
  const [dx, dz] = compassVec(dir)
  return Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz)
}

function arrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, angle: number, color: string) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(angle)
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = s * 0.11
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(0, s * 0.42)
  ctx.lineTo(0, -s * 0.2)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(0, -s * 0.46)
  ctx.lineTo(s * 0.26, -s * 0.12)
  ctx.lineTo(-s * 0.26, -s * 0.12)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/** Plaque (w × h m): pale card, dark name. */
export async function plaqueTexture(line: SignLine, lang: Lang, w: number, h: number): Promise<THREE.CanvasTexture> {
  await ensureWallFonts()
  const s = 1200
  const { cv, ctx } = canvas(Math.round(w * s), Math.round(h * s))
  const W = cv.width
  const H = cv.height
  ctx.fillStyle = '#f1ece2'
  ctx.fillRect(0, 0, W, H)
  const r = mulberry32(hashString(line.zone))
  for (let i = 0; i < 500; i++) {
    ctx.fillStyle = `rgba(110,95,70,${r() * 0.05})`
    ctx.fillRect(r() * W, r() * H, 2, 2)
  }
  const name = zoneName(line.zone, lang)
  const en = lang === 'en' ? '' : zoneName(line.zone, 'en')
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  const pad = W * 0.1
  // brass rule + name
  ctx.fillStyle = '#9a7434'
  ctx.fillRect(pad, H * 0.22, W * 0.12, Math.max(2, H * 0.018))
  const size = fit(ctx, name, 500, H * 0.3, SERIF, W - pad * 2)
  ctx.fillStyle = '#2e2a26'
  ctx.font = `500 ${size}px ${SERIF}`
  ctx.fillText(name, pad, en ? H * 0.58 : H * 0.66)
  if (en) {
    const es = fit(ctx, en.toUpperCase(), 500, H * 0.1, SANS, W - pad * 2)
    ctx.font = `500 ${es}px ${SANS}`
    spacing(ctx, es, 0.18)
    ctx.fillStyle = 'rgba(46,42,38,0.66)'
    ctx.fillText(en.toUpperCase(), pad, H * 0.8)
  }
  return finish(cv)
}

/** Totem face (w × h m): walnut-ink ground, brass kicker + destination lines with relative arrows. */
export async function totemTexture(lines: SignLine[], facing: Compass, lang: Lang, w: number, h: number): Promise<THREE.CanvasTexture> {
  await ensureWallFonts()
  const s = 700
  const { cv, ctx } = canvas(Math.round(w * s), Math.round(h * s))
  const W = cv.width
  const H = cv.height
  ctx.fillStyle = '#2a2420'
  ctx.fillRect(0, 0, W, H)
  const r = mulberry32(7)
  for (let i = 0; i < 1500; i++) {
    ctx.fillStyle = `rgba(255,230,190,${r() * 0.025})`
    ctx.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 8)
  }
  const brass = '#d2ae6a'
  const pad = W * 0.12
  ctx.fillStyle = brass
  ctx.textBaseline = 'alphabetic'
  const kick = lang === 'hi' ? 'मार्ग' : lang === 'bn' ? 'পথনির্দেশ' : 'WAYFINDING'
  ctx.font = `500 ${W * 0.06}px ${SANS}`
  spacing(ctx, W * 0.06, lang === 'en' ? 0.3 : 0)
  ctx.fillText(kick, pad, H * 0.08)
  spacing(ctx, W * 0.06, 0)
  ctx.fillRect(pad, H * 0.1, W * 0.16, Math.max(2, W * 0.008))
  const top = H * 0.16
  const rowH = Math.min(H * 0.13, (H * 0.8) / Math.max(1, lines.length))
  lines.forEach((ln, i) => {
    const y = top + rowH * (i + 0.5)
    const aS = rowH * 0.46
    if (ln.dir) arrow(ctx, pad + aS * 0.5, y - aS * 0.05, aS, arrowAngle(facing, ln.dir), brass)
    const tx = pad + aS * 1.35
    const name = zoneName(ln.zone, lang)
    const size = fit(ctx, name, 500, rowH * 0.34, SERIF, W - tx - pad * 0.6)
    ctx.fillStyle = '#efe3c8'
    ctx.font = `500 ${size}px ${SERIF}`
    ctx.fillText(name, tx, y + size * 0.1)
    if (lang !== 'en') {
      const en = zoneName(ln.zone, 'en')
      const es = fit(ctx, en, 400, rowH * 0.15, SANS, W - tx - pad * 0.6)
      ctx.font = `400 ${es}px ${SANS}`
      ctx.fillStyle = 'rgba(239,227,200,0.62)'
      ctx.fillText(en, tx, y + size * 0.1 + es * 1.5)
    }
    // hairline between rows
    ctx.fillStyle = 'rgba(210,174,106,0.22)'
    if (i < lines.length - 1) ctx.fillRect(pad, top + rowH * (i + 1), W - pad * 2, Math.max(1, W * 0.003))
  })
  return finish(cv)
}

const medallionCache = new Map<string, { map: THREE.CanvasTexture; bump: THREE.CanvasTexture }>()

/** Brass disc face with the motif chased in (ink-dark recess) — map + bump. */
export function medallionTextures(motif: MotifId, ink: string) {
  const key = `${motif}|${ink}`
  const hit = medallionCache.get(key)
  if (hit) return hit
  const S = 256
  const a = canvas(S, S)
  const g = a.ctx.createRadialGradient(S * 0.4, S * 0.35, S * 0.05, S / 2, S / 2, S * 0.55)
  g.addColorStop(0, '#e8cc8a')
  g.addColorStop(1, '#a47a3a')
  a.ctx.fillStyle = g
  a.ctx.fillRect(0, 0, S, S)
  a.ctx.strokeStyle = 'rgba(80,55,20,0.6)'
  a.ctx.lineWidth = 6
  a.ctx.beginPath()
  a.ctx.arc(S / 2, S / 2, S * 0.44, 0, Math.PI * 2)
  a.ctx.stroke()
  drawMotif(a.ctx, motif, S / 2, S / 2, S * 0.62, ink, { alpha: 0.95 })
  const b = canvas(S, S)
  b.ctx.fillStyle = '#ffffff'
  b.ctx.fillRect(0, 0, S, S)
  b.ctx.strokeStyle = '#555'
  b.ctx.lineWidth = 6
  b.ctx.beginPath()
  b.ctx.arc(S / 2, S / 2, S * 0.44, 0, Math.PI * 2)
  b.ctx.stroke()
  drawMotif(b.ctx, motif, S / 2, S / 2, S * 0.62, '#000000')
  const map = new THREE.CanvasTexture(a.cv)
  map.colorSpace = THREE.SRGBColorSpace
  const bump = new THREE.CanvasTexture(b.cv)
  const out = { map, bump }
  medallionCache.set(key, out)
  return out
}
