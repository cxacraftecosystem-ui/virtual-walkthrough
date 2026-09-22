/**
 * INDIA MAP WALL (kind 'map-wall') — a large linen-and-plaster map installation.
 *
 *   panel ...... paper-toned linen board in a slim walnut frame (props.width × props.height,
 *                bottom edge at props.bottom), printed with a faint graticule, indigo "water
 *                lines" following the coast, the wall text and the legend
 *   relief ..... the official-depiction outline of India (exhibits/indiaGeometry.ts, unchanged)
 *                extruded 12 mm off the panel: plaster-paper top faces with a fine madder dot
 *                print, ink-coloured sides that read as a crisp outline under the wash lights
 *   pins ....... PLACEHOLDER craft-cluster pins (props.pins = "lon,lat;lon,lat;…") — hollow
 *                numbered markers; the legend says "Cluster location — to be confirmed by the
 *                workshop". They are arbitrary layout positions and mark no real place.
 *   light ...... three wash spots from the ceiling (SpotPool)
 *
 * Local space: origin = floor point on the wall face, panel faces +z. Place it against a
 * wall with rotationDeg so +z points into the room (0 / 90 / 180 / 270).
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { ZONES } from '../config/layout'
import { LIGHTING } from '../config/lighting'
import { INDIA_BOUNDS, indiaRings } from '../exhibits/indiaGeometry'
import { registerSpot } from '../lighting/SpotPool'
import { TRACK_COLOR } from '../lighting/TrackLight'
import { ensureWallFonts } from '../materials/wallGraphics'
import { useAsyncTexture } from '../utils/useAsyncTexture'
import { Builder, Parts, rbox, useBuilt } from './kit'
import { useModelMaterials } from './modelMaterials'
import { num, str, type ModelProps } from './types'

const PAPER = '#f5f1e8'
const INK = '#2b2621'
const MADDER = '#8a5a3b'
const INDIGO = '#2c3f6b'
const SERIF = '"Cormorant Garamond", "Cormorant", Georgia, serif'
const SANS = 'Inter, "Helvetica Neue", Helvetica, Arial, sans-serif'

const RELIEF_H = 0.012
const PANEL_D = 0.05

/* ------------------------------------------------------------------ */
/* Layout (panel metres, origin = panel centre, +y up)                 */
/* ------------------------------------------------------------------ */

const MID_LAT = (INDIA_BOUNDS.minLatitude + INDIA_BOUNDS.maxLatitude) / 2
const LON_K = Math.cos((MID_LAT * Math.PI) / 180)
const SPAN_X = (INDIA_BOUNDS.maxLongitude - INDIA_BOUNDS.minLongitude) * LON_K
const SPAN_Y = INDIA_BOUNDS.maxLatitude - INDIA_BOUNDS.minLatitude

interface MapLayout {
  W: number
  H: number
  /** metres per degree of latitude */
  k: number
  /** map box (panel coords): left x, top y */
  left: number
  top: number
  mapW: number
  mapH: number
  /** text column: left x .. right x */
  textL: number
  textR: number
}

function layoutFor(W: number, H: number): MapLayout {
  const mapH = H - 0.62
  const k = mapH / SPAN_Y
  const mapW = SPAN_X * k
  const right = W / 2 - 0.42
  const left = right - mapW
  return { W, H, k, left, top: H / 2 - 0.3, mapW, mapH, textL: -W / 2 + 0.5, textR: left - 0.55 }
}

function project(L: MapLayout, lon: number, lat: number): [number, number] {
  return [L.left + (lon - INDIA_BOUNDS.minLongitude) * LON_K * L.k, L.top - (INDIA_BOUNDS.maxLatitude - lat) * L.k]
}

export function parsePins(s: string): [number, number][] {
  return s
    .split(';')
    .map((p) => p.split(',').map(Number))
    .filter((p): p is [number, number] => p.length === 2 && p.every((v) => Number.isFinite(v)))
}

/* ------------------------------------------------------------------ */
/* Printed face (canvas)                                               */
/* ------------------------------------------------------------------ */

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  const words = text.split(' ')
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w
    if (ctx.measureText(t).width > maxW && cur) {
      lines.push(cur)
      cur = w
    } else cur = t
  }
  if (cur) lines.push(cur)
  return lines
}

async function faceTexture(L: MapLayout, pins: [number, number][], title: string): Promise<THREE.Texture> {
  await ensureWallFonts()
  const s = Math.min(4096 / L.W, 520) // px per metre
  const cw = Math.round(L.W * s)
  const ch = Math.round(L.H * s)
  const cv = document.createElement('canvas')
  cv.width = cw
  cv.height = ch
  const ctx = cv.getContext('2d')!
  const X = (x: number) => (x + L.W / 2) * s
  const Y = (y: number) => (L.H / 2 - y) * s

  // paper ground + soft fibre mottling
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, cw, ch)
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 500; i++) {
    const x = rnd() * cw
    const y = rnd() * ch
    const r = 20 + rnd() * 120
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, rnd() < 0.5 ? 'rgba(120,96,70,0.014)' : 'rgba(255,255,250,0.03)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
  // inset rule
  ctx.strokeStyle = 'rgba(43,38,33,0.22)'
  ctx.lineWidth = Math.max(1.5, s * 0.003)
  ctx.strokeRect(s * 0.14, s * 0.14, cw - s * 0.28, ch - s * 0.28)

  // graticule every 4° over the map box
  ctx.save()
  ctx.beginPath()
  ctx.rect(X(L.left - 0.2), Y(L.top + 0.1), (L.mapW + 0.4) * s, (L.mapH + 0.2) * s)
  ctx.clip()
  ctx.strokeStyle = 'rgba(44,63,107,0.13)'
  ctx.lineWidth = Math.max(1, s * 0.0016)
  ctx.setLineDash([s * 0.012, s * 0.012])
  for (let lon = 68; lon <= 98; lon += 4) {
    const [x] = project(L, lon, 0)
    ctx.beginPath()
    ctx.moveTo(X(x), 0)
    ctx.lineTo(X(x), ch)
    ctx.stroke()
  }
  for (let lat = 8; lat <= 36; lat += 4) {
    const [, y] = project(L, 0, lat)
    ctx.beginPath()
    ctx.moveTo(0, Y(y))
    ctx.lineTo(cw, Y(y))
    ctx.stroke()
  }
  ctx.restore()

  // outline path (all rings)
  const path = new Path2D()
  for (const poly of indiaRings())
    for (const ring of poly) {
      ring.forEach(([lon, lat], i) => {
        const [x, y] = project(L, lon, lat)
        if (i === 0) path.moveTo(X(x), Y(y))
        else path.lineTo(X(x), Y(y))
      })
      path.closePath()
    }
  // indigo water lines (engraved-map style), widest first
  ctx.lineJoin = 'round'
  for (let i = 5; i >= 1; i--) {
    ctx.strokeStyle = `rgba(44,63,107,${0.05 + (5 - i) * 0.018})`
    ctx.lineWidth = s * 0.028 * i
    ctx.stroke(path)
    ctx.strokeStyle = PAPER
    ctx.lineWidth = s * 0.028 * i - s * 0.006
    ctx.stroke(path)
  }
  // soft cast shadow under the relief (light from above)
  ctx.save()
  ctx.shadowColor = 'rgba(40,30,20,0.35)'
  ctx.shadowBlur = s * 0.03
  ctx.shadowOffsetY = s * 0.012
  ctx.fillStyle = '#e3cfb2'
  ctx.fill(path, 'evenodd')
  ctx.restore()
  ctx.strokeStyle = INK
  ctx.lineWidth = Math.max(2, s * 0.005)
  ctx.stroke(path)

  // pin halos + numbers (the 3D pin heads sit on top)
  pins.forEach(([lon, lat], i) => {
    const [x, y] = project(L, lon, lat)
    ctx.strokeStyle = MADDER
    ctx.lineWidth = s * 0.004
    ctx.setLineDash([s * 0.012, s * 0.009])
    ctx.beginPath()
    ctx.arc(X(x), Y(y), s * 0.07, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = MADDER
    ctx.font = `600 ${Math.round(s * 0.055)}px ${SANS}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(i + 1), X(x + 0.095), Y(y))
  })

  // ── wall text column ──
  const tl = X(L.textL)
  const tw = (L.textR - L.textL) * s
  let y = Y(L.H / 2 - 0.62)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = MADDER
  ctx.font = `500 ${Math.round(s * 0.05)}px ${SANS}`
  if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${Math.round(s * 0.012)}px`
  ctx.fillText('GALLERY D  ·  MAP WALL', tl, y)
  if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = '0px'
  y += s * 0.36
  ctx.fillStyle = INK
  ctx.font = `400 ${Math.round(s * 0.3)}px ${SERIF}`
  for (const line of wrap(ctx, title, tw)) {
    ctx.fillText(line, tl - s * 0.01, y)
    y += s * 0.3
  }
  y += s * 0.02
  ctx.fillStyle = 'rgba(43,38,33,0.75)'
  ctx.font = `italic 400 ${Math.round(s * 0.1)}px ${SERIF}`
  ctx.fillText('Hand block printing — places of making', tl, y)
  y += s * 0.12
  ctx.fillStyle = MADDER
  ctx.fillRect(tl, y, s * 0.4, Math.max(2, s * 0.004))
  y += s * 0.2
  ctx.fillStyle = INK
  ctx.font = `400 ${Math.round(s * 0.072)}px ${SANS}`
  const body =
    'This wall will show where the blocks, dyes and textiles in the exhibition are made. The workshop is confirming each craft cluster; until then the numbered pins are placeholders and do not mark real places.'
  for (const line of wrap(ctx, body, tw)) {
    ctx.fillText(line, tl, y)
    y += s * 0.112
  }
  // legend
  y += s * 0.2
  const lx = tl + s * 0.07
  ctx.strokeStyle = MADDER
  ctx.lineWidth = s * 0.004
  ctx.setLineDash([s * 0.012, s * 0.009])
  ctx.beginPath()
  ctx.arc(lx, y - s * 0.02, s * 0.05, 0, Math.PI * 2)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = MADDER
  ctx.beginPath()
  ctx.arc(lx, y - s * 0.02, s * 0.022, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = INK
  ctx.font = `500 ${Math.round(s * 0.064)}px ${SANS}`
  ctx.fillText('Cluster location — to be confirmed by the workshop', tl + s * 0.19, y)
  y += s * 0.08
  ctx.fillStyle = 'rgba(43,38,33,0.6)'
  ctx.font = `400 ${Math.round(s * 0.04)}px ${SANS}`
  ctx.fillText('Placeholder pins 1–5 · positions for layout only', tl + s * 0.19, y)
  // credit, bottom-left
  ctx.fillStyle = 'rgba(43,38,33,0.55)'
  ctx.font = `400 ${Math.round(s * 0.036)}px ${SANS}`
  ctx.fillText('Outline of India: official Government of India depiction (DataMeet, india-osm). Not to scale for navigation.', tl, Y(-L.H / 2 + 0.3))
  // north arrow near the map's top-right
  const [nx, ny] = [L.left + L.mapW - 0.05, L.top - 0.15]
  ctx.fillStyle = INK
  ctx.beginPath()
  ctx.moveTo(X(nx), Y(ny + 0.12))
  ctx.lineTo(X(nx + 0.045), Y(ny - 0.04))
  ctx.lineTo(X(nx), Y(ny))
  ctx.lineTo(X(nx - 0.045), Y(ny - 0.04))
  ctx.closePath()
  ctx.fill()
  ctx.font = `500 ${Math.round(s * 0.05)}px ${SANS}`
  ctx.textAlign = 'center'
  ctx.fillText('N', X(nx), Y(ny - 0.12))

  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

/** Small repeating madder dot print for the relief's top faces (UVs are metres). */
let dotTex: THREE.CanvasTexture | null = null
function dotTexture() {
  if (dotTex) return dotTex
  const S = 128
  const cv = document.createElement('canvas')
  cv.width = cv.height = S
  const ctx = cv.getContext('2d')!
  ctx.fillStyle = '#e3cfb2'
  ctx.fillRect(0, 0, S, S)
  ctx.fillStyle = 'rgba(138,90,59,0.5)'
  for (const [x, y] of [
    [S * 0.25, S * 0.25],
    [S * 0.75, S * 0.75],
  ]) {
    ctx.beginPath()
    ctx.moveTo(x, y - S * 0.07)
    ctx.lineTo(x + S * 0.07, y)
    ctx.lineTo(x, y + S * 0.07)
    ctx.lineTo(x - S * 0.07, y)
    ctx.closePath()
    ctx.fill()
  }
  dotTex = new THREE.CanvasTexture(cv)
  dotTex.colorSpace = THREE.SRGBColorSpace
  dotTex.wrapS = dotTex.wrapT = THREE.RepeatWrapping
  dotTex.repeat.set(1 / 0.07, 1 / 0.07)
  return dotTex
}

const reliefCache = new Map<string, THREE.BufferGeometry>()
function reliefGeometry(L: MapLayout) {
  const key = `${L.W}|${L.H}`
  const hit = reliefCache.get(key)
  if (hit) return hit
  const shapes: THREE.Shape[] = []
  for (const poly of indiaRings()) {
    const [outer, ...holes] = poly
    const shape = new THREE.Shape(outer.map(([lon, lat]) => new THREE.Vector2(...project(L, lon, lat))))
    for (const h of holes) shape.holes.push(new THREE.Path(h.map(([lon, lat]) => new THREE.Vector2(...project(L, lon, lat)))))
    shapes.push(shape)
  }
  const g = new THREE.ExtrudeGeometry(shapes, { depth: RELIEF_H, bevelEnabled: false, curveSegments: 1 })
  reliefCache.set(key, g)
  return g
}

/* ------------------------------------------------------------------ */
/* Model                                                               */
/* ------------------------------------------------------------------ */

export function MapWall({ config }: ModelProps) {
  const m = useModelMaterials()
  const W = num(config, 'width', 8)
  const H = num(config, 'height', 4.6)
  const bottom = num(config, 'bottom', 0.65)
  const title = str(config, 'title', 'A Map of Making')
  const pinStr = str(config, 'pins', '')
  const L = useMemo(() => layoutFor(W, H), [W, H])
  const pins = useMemo(() => parsePins(pinStr), [pinStr])
  const cy = bottom + H / 2
  const face = useAsyncTexture(() => faceTexture(L, pins, title), [L, pins, title])
  const relief = useMemo(() => reliefGeometry(L), [L])

  const frame = useBuilt(`map-frame|${W}|${H}`, () => {
    const b = new Builder()
    const fw = 0.04
    const fd = PANEL_D + 0.03
    b.add('walnut', rbox(W + 2 * fw, fw, fd, 0.004, 2, 'x'), { p: [0, H / 2 + fw / 2, fd / 2] })
    b.add('walnut', rbox(W + 2 * fw, fw, fd, 0.004, 2, 'x'), { p: [0, -H / 2 - fw / 2, fd / 2] })
    for (const sx of [-1, 1]) b.add('walnut', rbox(fw, H, fd, 0.004, 2, 'y'), { p: [sx * (W / 2 + fw / 2), 0, fd / 2] })
    b.add('board', rbox(W, H, PANEL_D, 0.002), { p: [0, 0, PANEL_D / 2] })
    return b
  })

  const mats = useMemo(() => {
    const top = new THREE.MeshStandardMaterial({ color: '#ffffff', map: dotTexture(), roughness: 0.92, metalness: 0, envMapIntensity: 0.5 })
    const side = new THREE.MeshStandardMaterial({ color: INK, roughness: 0.8 })
    const pin = new THREE.MeshStandardMaterial({ color: MADDER, roughness: 0.45, metalness: 0.1 })
    const ring = new THREE.MeshStandardMaterial({ color: INDIGO, roughness: 0.6 })
    return { top, side, pin, ring, pair: [top, side] }
  }, [])
  const faceMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#ffffff', map: face, roughness: 0.9, metalness: 0, envMapIntensity: 0.4 }), [face])
  useEffect(
    () => () => {
      mats.top.dispose()
      mats.side.dispose()
      mats.pin.dispose()
      mats.ring.dispose()
    },
    [mats],
  )
  useEffect(() => () => faceMat.dispose(), [faceMat])

  // three wash lights from the ceiling, 2.4 m out from the wall (world space)
  useEffect(() => {
    const ceiling = Math.min(ZONES.find((z) => z.id === config.zone)?.height ?? 6, 7) - 0.2
    const rot = ((config.rotationDeg ?? 0) * Math.PI) / 180
    const [px, , pz] = config.position
    const w = (lx: number, ly: number, lz: number): [number, number, number] => [px + lx * Math.cos(rot) + lz * Math.sin(rot), ly, pz - lx * Math.sin(rot) + lz * Math.cos(rot)]
    const offs = [-W * 0.33, 0, W * 0.33]
    const out = offs.map((lx) => {
      const pos = w(lx, ceiling, 2.4)
      const target = w(lx, cy, 0)
      const d = Math.hypot(2.4, ceiling - cy)
      return registerSpot({ position: pos, target, intensity: LIGHTING.track.artworkIntensity * 0.75 * (d / 2.2) ** 2, angle: Math.min(1.0, Math.atan((W * 0.22) / d) * 1.6), penumbra: 0.85, color: TRACK_COLOR })
    })
    return () => out.forEach((u) => u())
  }, [config.position, config.rotationDeg, config.zone, W, cy])

  return (
    <group position={[0, cy, 0]}>
      <Parts parts={frame} materials={{ walnut: m.walnut, board: m.linen }} />
      {face && (
        <mesh position={[0, 0, PANEL_D + 0.0006]} material={faceMat} receiveShadow>
          <planeGeometry args={[W, H]} />
        </mesh>
      )}
      <mesh geometry={relief} material={mats.pair} position={[0, 0, PANEL_D + 0.001]} castShadow receiveShadow />
      {pins.map(([lon, lat], i) => {
        const [x, y] = project(L, lon, lat)
        return (
          <group key={i} position={[x, y, PANEL_D + RELIEF_H]}>
            <mesh position={[0, 0, 0.02]} rotation={[Math.PI / 2, 0, 0]} material={m.brass}>
              <cylinderGeometry args={[0.005, 0.005, 0.04, 8]} />
            </mesh>
            <mesh position={[0, 0, 0.045]} material={mats.pin} castShadow>
              <sphereGeometry args={[0.026, 20, 14]} />
            </mesh>
            <mesh position={[0, 0, 0.002]} material={mats.ring}>
              <torusGeometry args={[0.045, 0.004, 6, 32]} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}
