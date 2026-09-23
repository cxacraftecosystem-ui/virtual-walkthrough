/**
 * "Print it yourself" installations in the Craft Workshop Hall:
 *
 *  - PrintStudioTable ('print-studio') — a short printing table whose cloth shows the
 *    visitor's current studio design live (CanvasTexture of the studio canvas; a demo
 *    cloth until the visitor prints). Selecting it opens the studio overlay (see
 *    src/museum/studio/PrintStudio.tsx). While the overlay is open the museum canvas
 *    stops rendering (frameloop 'never') — it is fully covered.
 *  - VisitorsWall ('visitors-wall') — the latest approved visitor prints (GET /api/prints)
 *    as small box-framed textiles; empty frames hold plain cloth. One atlas texture,
 *    three draw calls for the whole wall.
 */
import { useThree } from '@react-three/fiber'
import { useContext, useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { drawMotif, hashString, mulberry32, paintCottonGround } from '../exhibits/motifs'
import { DYES } from '../studio/palette'
import { DESIGN_H, DESIGN_W } from '../studio/printEngine'
import { approvedPrints, type WallPrint } from '../studio/printsApi'
import { designCanvas, useStudio } from '../studio/studioStore'
import { box, Builder, lathe, Parts, rbox, useBuilt, type V3 } from './kit'
import { tinted, useModelMaterials } from './modelMaterials'
import { InMuseumScene } from './sceneContext'
import { fp, geoKey, num, str, type ModelProps } from './types'

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

function textCanvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const g = cv.getContext('2d')!
  draw(g)
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

const KNOB: [number, number][] = [
  [0.022, 0],
  [0.02, 0.006],
  [0.011, 0.018],
  [0.009, 0.033],
  [0.012, 0.047],
  [0.019, 0.056],
  [0.02, 0.063],
  [0.014, 0.069],
  [0, 0.072],
]

/** A hand block resting face down at p (y = the surface), turned by rotY. */
function addBlock(b: Builder, p: V3, w: number, d: number, rotY: number) {
  const c = Math.cos(rotY)
  const s = Math.sin(rotY)
  const at = (dx: number, dy: number, dz: number): V3 => [p[0] + dx * c + dz * s, p[1] + dy, p[2] - dx * s + dz * c]
  b.add('ink', box(w - 0.006, 0.005, d - 0.006), { p: at(0, 0.0025, 0), r: [0, rotY, 0] })
  b.add('teak', rbox(w, 0.048, d, 0.005), { p: at(0, 0.005 + 0.024, 0), r: [0, rotY, 0] })
  b.add('teak', lathe(KNOB, 16), { p: at(0, 0.053, 0), r: [0, rotY, 0] })
}

/* ------------------------------------------------------------------ */
/* Demo cloth (before the visitor prints)                              */
/* ------------------------------------------------------------------ */

let demo: HTMLCanvasElement | null = null
function demoCloth(): HTMLCanvasElement {
  if (demo) return demo
  const cv = document.createElement('canvas')
  cv.width = DESIGN_W / 2
  cv.height = DESIGN_H / 2
  const g = cv.getContext('2d')!
  const r = mulberry32(hashString('studio-demo'))
  paintCottonGround(g, cv.width, cv.height, '#ece2cc', r, { threadPx: 1, unevenness: 0.6, noise: 4 })
  // a few trial impressions in one corner, the rest of the cloth left for the visitor
  const s = 64
  const pts: [number, number][] = [
    [70, 70],
    [138, 70],
    [206, 70],
    [104, 138],
    [172, 138],
    [70, 206],
  ]
  for (const [x, y] of pts)
    drawMotif(g, 'rosette', x, y, s, '#27406b', { composite: 'multiply', alpha: 0.82 + r() * 0.12, rng: r, voids: 0.4, mottle: 0.45, grain: 0.3, bleed: 0.4, rotation: (r() - 0.5) * 0.02 })
  g.save()
  g.fillStyle = 'rgba(80, 60, 40, 0.55)'
  g.font = "italic 500 30px 'Cormorant Garamond', Georgia, serif"
  g.textAlign = 'center'
  g.fillText('Print it yourself', cv.width * 0.62, cv.height * 0.56)
  g.font = "500 13px Inter, system-ui, sans-serif"
  g.fillStyle = 'rgba(80, 60, 40, 0.5)'
  g.fillText('C L I C K   T H E   T A B L E   T O   B E G I N', cv.width * 0.62, cv.height * 0.56 + 30)
  g.restore()
  demo = cv
  return cv
}

/** Stops the (fully covered) museum canvas while the studio overlay is open. */
function PauseWhileStudioOpen() {
  const setFrameloop = useThree((s) => s.setFrameloop)
  const open = useStudio((s) => s.open)
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => setFrameloop('never'), 320) // after the overlay has faded in
    return () => {
      clearTimeout(t)
      setFrameloop('always')
    }
  }, [open, setFrameloop])
  return null
}

/* ------------------------------------------------------------------ */
/* Studio printing table                                               */
/* ------------------------------------------------------------------ */

export function PrintStudioTable({ config }: ModelProps) {
  const m = useModelMaterials()
  const inScene = useContext(InMuseumScene)
  const [W, D] = fp(config, [2.2, 1.0])
  const H = config.height ?? 0.86
  const top = H - 0.005
  // 4:3 cloth on the left of the pad, ink tray + blocks on the right
  const clothW = Math.min(W - 0.72, (D - 0.14) * (4 / 3))
  const clothD = clothW * 0.75
  const clothX = -W / 2 + 0.07 + clothW / 2

  const version = useStudio((s) => s.version)
  const hasDesign = useStudio((s) => s.ops.length > 0)

  const tex = useMemo(() => {
    const t = new THREE.CanvasTexture(demoCloth())
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 8
    return t
  }, [])
  useEffect(() => {
    const src = hasDesign ? designCanvas() : demoCloth()
    if (tex.image !== src) {
      tex.image = src
      tex.dispose() // new size → reallocate
    }
    tex.needsUpdate = true
  }, [tex, hasDesign, version])
  useEffect(() => () => tex.dispose(), [tex])

  const clothMat = useMemo(() => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0, envMapIntensity: 0.4 }), [tex])
  useEffect(() => () => clothMat.dispose(), [clothMat])
  const inkMat = useMemo(() => tinted(m.felt, '#27406b', { roughness: 0.45 }), [m.felt])
  const dyeMats = useMemo(() => DYES.map((d) => new THREE.MeshStandardMaterial({ color: d.color, roughness: 0.35, metalness: 0 })), [])
  useEffect(() => () => dyeMats.forEach((x) => x.dispose()), [dyeMats])

  const signTex = useMemo(
    () =>
      textCanvas(512, 200, (g) => {
        g.fillStyle = '#f3ede1'
        g.fillRect(0, 0, 512, 200)
        g.strokeStyle = 'rgba(43,38,33,0.25)'
        g.lineWidth = 2
        g.strokeRect(10, 10, 492, 180)
        g.fillStyle = '#2b2621'
        g.textAlign = 'center'
        g.font = "500 54px 'Cormorant Garamond', Georgia, serif"
        g.fillText('Print it yourself', 256, 96)
        g.fillStyle = '#6f665c'
        g.font = "500 20px Inter, system-ui, sans-serif"
        g.fillText('STUDIO · CLICK THE TABLE TO BEGIN', 256, 146)
      }),
    [],
  )
  useEffect(() => () => signTex.dispose(), [signTex])

  const parts = useBuilt(geoKey('print-studio', config), () => {
    const b = new Builder()
    const legH = H - 0.085
    for (const x of [-W / 2 + 0.12, W / 2 - 0.12])
      for (const z of [-(D / 2 - 0.09), D / 2 - 0.09]) b.add('frame', rbox(0.08, legH, 0.08, 0.006, 2, 'y'), { p: [x, legH / 2, z] })
    for (const z of [-(D / 2 - 0.09), D / 2 - 0.09]) b.add('frame', rbox(W - 0.24, 0.09, 0.032, 0.004, 1, 'x'), { p: [0, legH - 0.065, z] })
    for (const x of [-W / 2 + 0.12, W / 2 - 0.12]) {
      b.add('frame', rbox(0.032, 0.09, D - 0.2, 0.004, 1, 'z'), { p: [x, legH - 0.065, 0] })
      b.add('frame', rbox(0.045, 0.05, D - 0.2, 0.004, 1, 'z'), { p: [x, 0.18, 0] })
    }
    b.add('frame', rbox(W - 0.3, 0.05, 0.045, 0.004, 1, 'x'), { p: [0, 0.18, 0] })
    b.add('frame', rbox(W, 0.05, D, 0.008, 2, 'x'), { p: [0, H - 0.06, 0] })
    b.add('felt', rbox(W - 0.03, 0.032, D - 0.03, 0.012, 2, 'x'), { p: [0, H - 0.021, 0] })
    // ink tray (a shallow teak tray with a felt ink pad) and the dye pots behind it
    const tx = W / 2 - 0.33
    b.add('teak', rbox(0.42, 0.014, 0.3, 0.003), { p: [tx, top + 0.007, 0.16] })
    for (const s of [-1, 1]) {
      b.add('teak', rbox(0.42, 0.045, 0.014, 0.003, 1, 'x'), { p: [tx, top + 0.0225, 0.16 + s * 0.143] })
      b.add('teak', rbox(0.014, 0.045, 0.272, 0.003, 1, 'z'), { p: [tx + s * 0.203, top + 0.0225, 0.16] })
    }
    b.add('ink', rbox(0.38, 0.02, 0.26, 0.006), { p: [tx, top + 0.022, 0.16] })
    addBlock(b, [tx - 0.02, top + 0.032, 0.16], 0.14, 0.14, 0.2)
    addBlock(b, [tx + 0.05, top, -0.2], 0.16, 0.16, -0.35)
    addBlock(b, [tx - 0.17, top, -0.3], 0.21, 0.07, 0.15)
    return b
  })

  return (
    <group>
      {inScene && <PauseWhileStudioOpen />}
      <Parts parts={parts} materials={{ frame: m.darkTimber, felt: m.felt, teak: m.teak, ink: inkMat }} />
      <mesh material={clothMat} position={[clothX, top + 0.0035, -0.01]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[clothW, clothD]} />
      </mesh>
      {/* dye pots along the back edge */}
      {dyeMats.map((mat, i) => {
        const x = W / 2 - 0.62 + (i % 4) * 0.12 + (i >= 4 ? 0.06 : 0)
        const z = -D / 2 + 0.1 + (i >= 4 ? 0.1 : 0)
        return (
          <group key={i} position={[x + 0.18, top, z]}>
            <mesh material={m.terracotta} castShadow geometry={potGeo()} />
            <mesh material={mat} position={[0, 0.052, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.036, 20]} />
            </mesh>
          </group>
        )
      })}
      {/* table sign, angled toward the visitor at the front edge */}
      <group position={[W / 2 - 0.32, top, D / 2 - 0.1]} rotation={[-0.9, 0, 0]}>
        <mesh position={[0, 0.06, 0]} material={m.darkTimber}>
          <boxGeometry args={[0.34, 0.14, 0.012]} />
        </mesh>
        <mesh position={[0, 0.06, 0.0065]}>
          <planeGeometry args={[0.32, 0.125]} />
          <meshStandardMaterial map={signTex} roughness={0.8} />
        </mesh>
      </group>
    </group>
  )
}

let pot: THREE.BufferGeometry | null = null
function potGeo() {
  pot ??= lathe(
    [
      [0, 0],
      [0.036, 0],
      [0.043, 0.012],
      [0.046, 0.03],
      [0.043, 0.046],
      [0.038, 0.052],
      [0.04, 0.056],
      [0.036, 0.056],
      [0.034, 0.05],
      [0, 0.05],
    ],
    20,
  )
  return pot
}

/* ------------------------------------------------------------------ */
/* Visitors' Wall                                                      */
/* ------------------------------------------------------------------ */

const CELL_PX = 384
const CELL_PY = 288

function emptyCell(g: CanvasRenderingContext2D, x: number, y: number, i: number) {
  const r = mulberry32(hashString(`wall-empty-${i}`))
  g.save()
  g.translate(x, y)
  paintCottonGround(g, CELL_PX, CELL_PY, '#e9dfca', r, { threadPx: 1.2, unevenness: 0.5, noise: 0 })
  g.fillStyle = 'rgba(90, 70, 50, 0.32)'
  g.textAlign = 'center'
  g.font = "italic 26px 'Cormorant Garamond', Georgia, serif"
  g.fillText('awaiting a visitor’s print', CELL_PX / 2, CELL_PY / 2 + 8)
  g.restore()
}

function nameTag(g: CanvasRenderingContext2D, x: number, y: number, name: string) {
  g.save()
  g.font = "500 15px Inter, system-ui, sans-serif"
  const label = name.length > 26 ? `${name.slice(0, 25)}…` : name
  const w = Math.min(CELL_PX - 20, g.measureText(label).width + 20)
  const tx = x + CELL_PX - w - 10
  const ty = y + CELL_PY - 34
  g.fillStyle = 'rgba(248, 244, 235, 0.94)'
  g.fillRect(tx, ty, w, 24)
  g.strokeStyle = 'rgba(43, 38, 33, 0.2)'
  g.strokeRect(tx + 0.5, ty + 0.5, w - 1, 23)
  g.fillStyle = '#3a332c'
  g.textAlign = 'left'
  g.fillText(label, tx + 10, ty + 17, w - 20)
  g.restore()
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`failed to load ${url}`))
    img.src = url
  })
}

export function VisitorsWall({ config }: ModelProps) {
  const m = useModelMaterials()
  const cols = Math.max(1, Math.round(num(config, 'cols', 8)))
  const rows = Math.max(1, Math.round(num(config, 'rows', 3)))
  const width = num(config, 'width', 6.2)
  const bottom = num(config, 'bottom', 1.0)
  const title = str(config, 'title', 'The Visitors’ Wall')
  const pitchX = width / cols
  const fw = pitchX * 0.82 // frame width
  const fh = fw * 0.78
  const pitchY = fh + 0.16
  const border = 0.03
  const depth = 0.035
  const n = cols * rows
  const [prints, setPrints] = useState<WallPrint[]>([])

  useEffect(() => {
    let alive = true
    void approvedPrints().then((p) => alive && setPrints(p.slice(0, n)))
    return () => {
      alive = false
    }
  }, [n])

  const atlas = useMemo(() => {
    const cv = document.createElement('canvas')
    cv.width = CELL_PX * cols
    cv.height = CELL_PY * rows
    const g = cv.getContext('2d')!
    for (let i = 0; i < n; i++) emptyCell(g, (i % cols) * CELL_PX, Math.floor(i / cols) * CELL_PY, i)
    const t = new THREE.CanvasTexture(cv)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 8
    return t
  }, [cols, rows, n])
  useEffect(() => () => atlas.dispose(), [atlas])

  // fill the atlas as prints arrive (newest top-left)
  useEffect(() => {
    if (!prints.length) return
    let alive = true
    const cv = atlas.image as HTMLCanvasElement
    const g = cv.getContext('2d')!
    void Promise.all(
      prints.map(async (p, i) => {
        try {
          const img = await loadImage(p.url)
          if (!alive) return
          const x = (i % cols) * CELL_PX
          const y = Math.floor(i / cols) * CELL_PY
          // cover-fit the print into its 4:3 cell
          const k = Math.max(CELL_PX / img.naturalWidth, CELL_PY / img.naturalHeight)
          const w = img.naturalWidth * k
          const h = img.naturalHeight * k
          g.save()
          g.beginPath()
          g.rect(x, y, CELL_PX, CELL_PY)
          g.clip()
          g.drawImage(img, x + (CELL_PX - w) / 2, y + (CELL_PY - h) / 2, w, h)
          g.restore()
          nameTag(g, x, y, p.displayName || 'Anonymous visitor')
          atlas.needsUpdate = true
        } catch {
          /* keep the empty cloth */
        }
      }),
    )
    return () => {
      alive = false
    }
  }, [prints, atlas, cols])

  const cellCenter = (i: number): [number, number] => {
    const c = i % cols
    const r = Math.floor(i / cols)
    return [-width / 2 + pitchX * (c + 0.5), bottom + fh / 2 + (rows - 1 - r) * pitchY]
  }

  const frames = useBuilt(geoKey('visitors-wall-frames', config), () => {
    const b = new Builder()
    for (let i = 0; i < n; i++) {
      const [x, y] = cellCenter(i)
      // box frame: four mitred-look bars + a recessed backing
      b.add('frame', rbox(fw, border, depth, 0.004, 1, 'x'), { p: [x, y + fh / 2 - border / 2, depth / 2] })
      b.add('frame', rbox(fw, border, depth, 0.004, 1, 'x'), { p: [x, y - fh / 2 + border / 2, depth / 2] })
      b.add('frame', rbox(border, fh - 2 * border, depth, 0.004, 1, 'y'), { p: [x - fw / 2 + border / 2, y, depth / 2] })
      b.add('frame', rbox(border, fh - 2 * border, depth, 0.004, 1, 'y'), { p: [x + fw / 2 - border / 2, y, depth / 2] })
      b.add('back', box(fw - 0.01, fh - 0.01, 0.006), { p: [x, y, 0.003] })
    }
    // a slim picture rail above the grid
    const railY = bottom + rows * pitchY - 0.04
    b.add('frame', rbox(width + 0.3, 0.035, 0.03, 0.004, 1, 'x'), { p: [0, railY, 0.015] })
    return b
  })

  const clothGeo = useMemo(() => {
    const pos: number[] = []
    const uv: number[] = []
    const idx: number[] = []
    const iw = fw - 2 * border - 0.02
    const ih = fh - 2 * border - 0.02
    for (let i = 0; i < n; i++) {
      const [x, y] = cellCenter(i)
      const c = i % cols
      const r = Math.floor(i / cols)
      const u0 = c / cols
      const u1 = (c + 1) / cols
      const v1 = 1 - r / rows
      const v0 = 1 - (r + 1) / rows
      const k = pos.length / 3
      const z = 0.016
      pos.push(x - iw / 2, y - ih / 2, z, x + iw / 2, y - ih / 2, z, x + iw / 2, y + ih / 2, z, x - iw / 2, y + ih / 2, z)
      uv.push(u0, v0, u1, v0, u1, v1, u0, v1)
      idx.push(k, k + 1, k + 2, k, k + 2, k + 3)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setIndex(idx)
    g.computeVertexNormals()
    return g
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, cols, rows, fw, fh, width, bottom])
  useEffect(() => () => clothGeo.dispose(), [clothGeo])

  const clothMat = useMemo(() => new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.95, metalness: 0, envMapIntensity: 0.35 }), [atlas])
  useEffect(() => () => clothMat.dispose(), [clothMat])

  const plaque = useMemo(
    () =>
      textCanvas(1024, 256, (g) => {
        g.clearRect(0, 0, 1024, 256)
        g.fillStyle = '#2b2621'
        g.textAlign = 'left'
        g.font = "500 92px 'Cormorant Garamond', Georgia, serif"
        g.fillText(title, 8, 112)
        g.fillStyle = '#5d544b'
        g.font = "500 26px Inter, system-ui, sans-serif"
        g.fillText('PRINTS MADE BY VISITORS IN THE STUDIO · SHOWN AFTER REVIEW', 12, 176)
      }),
    [title],
  )
  useEffect(() => () => plaque.dispose(), [plaque])
  const plaqueW = 2.4
  const plaqueY = bottom + rows * pitchY + 0.34

  return (
    <group>
      <Parts parts={frames} materials={{ frame: m.oak, back: m.darkTimber }} />
      <mesh geometry={clothGeo} material={clothMat} receiveShadow />
      <mesh position={[-width / 2 + plaqueW / 2, plaqueY, 0.004]}>
        <planeGeometry args={[plaqueW, plaqueW / 4]} />
        <meshStandardMaterial map={plaque} transparent roughness={0.9} depthWrite={false} />
      </mesh>
    </group>
  )
}
