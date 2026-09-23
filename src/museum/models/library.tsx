/**
 * Reading Room & Library furniture (zone 'library'):
 *
 *   'bookcase'        walnut bookcase; the books are ONE instanced mesh (varied sizes,
 *                     muted cloth colours, tooled bands — no lettering)
 *   'reading-table'   long oak reading table, chairs both sides, brass reading lamps
 *   'lounge-set'      two upholstered lounge chairs and a side table with a lamp
 *   'pattern-lectern' lectern with an open sample book of printed swatches
 *   'drawing-wall'    framed design drawings for printing blocks (placeholder art)
 *   'resource-board'  framed wall board listing the visitor resources (click → links)
 *
 * Every model: origin at floor centre (wall models: on the wall face), front faces +z.
 */
import { useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { MotifId } from '../config/exhibits'
import { useAsyncTexture } from '../utils/useAsyncTexture'
import { resourceBoardTexture, sampleBookSpread, spineTexture } from './amenityTextures'
import { useLocalSpots } from './amenityLights'
import { box, Builder, cyl, Parts, rbox, rng, useBuilt } from './kit'
import { tinted, useModelMaterials } from './modelMaterials'
import { InMuseumScene } from './sceneContext'
import { designSheetTexture } from './textures'
import { fp, geoKey, num, type ModelProps } from './types'

const BOOK_COLOURS = ['#6d2a22', '#8a3b2b', '#2c3f6b', '#243049', '#3b5a3a', '#5b6b45', '#b7862f', '#9a7b4f', '#e4d9c3', '#d8cbb0', '#3a3431', '#5e4432', '#7a4b5a', '#48606a']

const lampShadeMat = new THREE.MeshStandardMaterial({ color: '#3f5b45', roughness: 0.35, metalness: 0.2, emissive: new THREE.Color('#1c2a1f'), emissiveIntensity: 0.4 })
const lampGlowMat = new THREE.MeshStandardMaterial({ color: '#fff4dc', emissive: new THREE.Color('#ffd6a0'), emissiveIntensity: 2.4, toneMapped: true })
const linenShadeMat = new THREE.MeshStandardMaterial({ color: '#efe3cc', roughness: 0.95, emissive: new THREE.Color('#ffcf94'), emissiveIntensity: 0.55, side: THREE.DoubleSide })

/* ------------------------------------------------------------------ */
/* Bookcase                                                            */
/* ------------------------------------------------------------------ */

interface BookSet {
  matrices: THREE.Matrix4[]
  colors: THREE.Color[]
}

function layBooks(W: number, D: number, shelves: number[], bays: number, t: number, seed: number): BookSet {
  const r = rng(seed * 997)
  const matrices: THREE.Matrix4[] = []
  const colors: THREE.Color[] = []
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const bw = (W - t) / bays
  const push = (x: number, y: number, z: number, w: number, h: number, d: number, rz = 0) => {
    q.setFromEuler(e.set(0, 0, rz))
    matrices.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(w, h, d)))
    const c = new THREE.Color(BOOK_COLOURS[Math.floor(r() * BOOK_COLOURS.length)])
    c.offsetHSL(0, (r() - 0.5) * 0.08, (r() - 0.5) * 0.08)
    colors.push(c)
  }
  for (let s = 0; s < shelves.length - 1; s++) {
    const y0 = shelves[s] + 0.025
    const gap = shelves[s + 1] - y0 - 0.03
    for (let bay = 0; bay < bays; bay++) {
      const x0 = -W / 2 + t + bay * bw + 0.012
      const x1 = x0 + bw - t - 0.024
      let x = x0
      // leave some bays part-empty (a vessel or a lying stack), as real shelves are
      const fill = 0.62 + r() * 0.36
      const stop = x0 + (x1 - x0) * fill
      while (x < stop) {
        const w = 0.018 + r() * 0.035
        const h = Math.min(gap - 0.01, 0.18 + r() * 0.16)
        const d = Math.min(D - 0.06, 0.15 + r() * 0.1)
        if (x + w > x1) break
        push(x + w / 2, y0 + h / 2, -D / 2 + 0.03 + d / 2 + (D - 0.06 - d) * 0.9, w, h, d)
        x += w + (r() < 0.08 ? 0.01 : 0.0015)
      }
      // one book leaning against the run, and sometimes a lying stack at the end
      if (x1 - x > 0.12 && r() < 0.6) {
        const h = Math.min(gap - 0.02, 0.22 + r() * 0.08)
        const lean = 0.22
        push(x + Math.sin(lean) * h * 0.5 + 0.02, y0 + (Math.cos(lean) * h) / 2, -D / 2 + 0.03 + 0.1 + (D - 0.26) * 0.9, 0.03, h, 0.2, -lean)
        x += 0.1
      }
      if (x1 - x > 0.26) {
        let yy = y0
        const n = 2 + Math.floor(r() * 3)
        for (let k = 0; k < n; k++) {
          const hh = 0.025 + r() * 0.02
          push(x1 - 0.13 + (r() - 0.5) * 0.02, yy + hh / 2, 0.02, 0.22 + r() * 0.04, hh, 0.16 + r() * 0.04)
          yy += hh
        }
      }
    }
  }
  return { matrices, colors }
}

export function Bookcase({ config }: ModelProps) {
  const m = useModelMaterials()
  const [W, D] = fp(config, [3.4, 0.4])
  const H = config.height ?? 2.9
  const seed = num(config, 'seed', 31)
  const bays = Math.max(1, Math.round(W / 0.85))
  const t = 0.03
  const shelves = useMemo(() => {
    const out = [0.1]
    const n = 6
    const step = (H - 0.16 - 0.1) / n
    for (let i = 1; i <= n; i++) out.push(0.1 + i * step)
    return out
  }, [H])
  const parts = useBuilt(geoKey('bookcase', config), () => {
    const b = new Builder()
    b.add('shadow', box(W - 0.04, 0.1, D - 0.05), { p: [0, 0.05, 0.01] })
    b.add('back', box(W, H - 0.1, 0.014, 'y'), { p: [0, 0.1 + (H - 0.1) / 2, -D / 2 + 0.007] })
    for (let i = 0; i <= bays; i++) b.add('walnut', rbox(t, H - 0.02, D, 0.003, 2, 'y'), { p: [-W / 2 + t / 2 + (i * (W - t)) / bays, (H - 0.02) / 2, 0] })
    for (const y of shelves) b.add('walnut', rbox(W, 0.025, D - 0.02, 0.003, 2, 'x'), { p: [0, y + 0.0125, 0] })
    // crown moulding + brass picture light rail along the top
    b.add('walnut', rbox(W + 0.04, 0.07, D + 0.03, 0.006, 2, 'x'), { p: [0, H - 0.035, 0.005] })
    b.add('brass', box(W - 0.1, 0.012, 0.012), { p: [0, H - 0.09, D / 2 + 0.01] })
    return b
  })
  const books = useMemo(() => layBooks(W, D, shelves, bays, t, seed), [W, D, shelves, bays, seed])
  const geo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), [])
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ map: spineTexture(), roughness: 0.82, metalness: 0, envMapIntensity: 0.6 }), [])
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const im = ref.current
    if (!im) return
    books.matrices.forEach((mx, i) => {
      im.setMatrixAt(i, mx)
      im.setColorAt(i, books.colors[i])
    })
    im.instanceMatrix.needsUpdate = true
    if (im.instanceColor) im.instanceColor.needsUpdate = true
    im.computeBoundingSphere()
  }, [books])
  useEffect(
    () => () => {
      geo.dispose()
      mat.dispose()
    },
    [geo, mat],
  )
  return (
    <group>
      <Parts parts={parts} materials={{ walnut: m.walnut, back: m.darkTimber, shadow: m.shadowGap, brass: m.brass }} />
      <instancedMesh ref={ref} args={[geo, mat, books.matrices.length]} castShadow={false} receiveShadow raycast={() => null} />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Chairs, lamps                                                       */
/* ------------------------------------------------------------------ */

/** Simple timber side chair facing +z at (x, z), rotated by rotY. */
function chair(b: Builder, x: number, z: number, rotY: number) {
  const c = Math.cos(rotY)
  const s = Math.sin(rotY)
  const at = (dx: number, dy: number, dz: number): [number, number, number] => [x + dx * c + dz * s, dy, z - dx * s + dz * c]
  const R: [number, number, number] = [0, rotY, 0]
  const seatH = 0.45
  b.add('oak', rbox(0.44, 0.035, 0.42, 0.006, 2, 'x'), { p: at(0, seatH, 0), r: R })
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) b.add('oak', rbox(0.034, seatH, 0.034, 0.003, 2, 'y'), { p: at(sx * 0.19, seatH / 2, sz * 0.18), r: R })
  for (const sx of [-1, 1]) b.add('oak', rbox(0.034, 0.44, 0.034, 0.003, 2, 'y'), { p: at(sx * 0.19, seatH + 0.22, -0.18), r: R })
  b.add('oak', rbox(0.42, 0.1, 0.022, 0.004, 2, 'x'), { p: at(0, seatH + 0.36, -0.185), r: [-0.08, rotY, 0] })
  b.add('seat', rbox(0.4, 0.03, 0.38, 0.01, 2, 'x'), { p: at(0, seatH + 0.03, 0.01), r: R })
}

function tableLamp(b: Builder, x: number, y: number, z: number) {
  b.add('brass', cyl(0.07, 0.08, 0.02, 20), { p: [x, y + 0.01, z] })
  b.add('brass', cyl(0.008, 0.008, 0.38, 8), { p: [x, y + 0.2, z] })
  b.add('brass', cyl(0.006, 0.006, 0.16, 8).rotateZ(Math.PI / 2), { p: [x + 0.08, y + 0.39, z] })
}

/* ------------------------------------------------------------------ */
/* Reading table                                                       */
/* ------------------------------------------------------------------ */

export function ReadingTable({ config }: ModelProps) {
  const m = useModelMaterials()
  const [L, Dtot] = fp(config, [2.6, 1.7])
  const H = config.height ?? 0.76
  const chairs = Math.round(num(config, 'chairs', 3))
  const lamps = Math.round(num(config, 'lamps', 2))
  const TD = 0.95
  const seat = useMemo(() => tinted(m.upholstery, '#6d3a2c', { roughness: 1 }), [m.upholstery])
  const parts = useBuilt(geoKey('reading-table', config), () => {
    const b = new Builder()
    b.add('oak', rbox(L, 0.05, TD, 0.008, 2, 'x'), { p: [0, H - 0.025, 0] })
    // trestle ends + stretcher
    for (const sx of [-1, 1]) {
      const x = sx * (L / 2 - 0.25)
      b.add('oak', rbox(0.08, H - 0.05, 0.08, 0.004, 2, 'y'), { p: [x, (H - 0.05) / 2, 0] })
      b.add('oak', rbox(0.08, 0.05, TD - 0.14, 0.004, 2, 'z'), { p: [x, 0.025, 0] })
      b.add('oak', rbox(0.08, 0.05, TD - 0.2, 0.004, 2, 'z'), { p: [x, H - 0.075, 0] })
    }
    b.add('oak', rbox(L - 0.5, 0.06, 0.05, 0.004, 2, 'x'), { p: [0, 0.3, 0] })
    // a leather writing inset down the middle
    b.add('leather', box(L - 0.3, 0.003, 0.4), { p: [0, H + 0.0015, 0] })
    // chairs pulled in on both sides
    const pitch = (L - 0.5) / Math.max(1, chairs)
    for (let i = 0; i < chairs; i++) {
      const x = -L / 2 + 0.25 + pitch * (i + 0.5)
      chair(b, x + (i % 2 ? 0.04 : -0.03), Dtot / 2 - 0.26, Math.PI)
      chair(b, x - (i % 2 ? 0.03 : -0.04), -Dtot / 2 + 0.26, 0)
    }
    // lamps + a few closed books and an open one
    for (let i = 0; i < lamps; i++) tableLamp(b, -L / 2 + (L * (i + 0.5)) / lamps, H, -0.05)
    const r = rng(9)
    for (let i = 0; i < 3; i++) b.add('book', box(0.2, 0.03, 0.27), { p: [-0.35 + i * 0.5, H + 0.018, 0.22], r: [0, (r() - 0.5) * 0.6, 0] })
    b.add('paper', box(0.42, 0.006, 0.3), { p: [0.1, H + 0.006, 0.18], r: [0, 0.1, 0] })
    return b
  })
  // lamp heads (emissive glow under a green glass shade) + pooled downlights on the table
  const lampX = useMemo(() => Array.from({ length: lamps }, (_, i) => -L / 2 + (L * (i + 0.5)) / lamps + 0.16), [L, lamps])
  useLocalSpots(
    config,
    lampX.map((x) => ({ from: [x, H + 1.9, -0.05], to: [x, H, 0.05], intensity: 7, angle: 0.8 })),
  )
  const shade = useMemo(() => new THREE.CylinderGeometry(0.035, 0.09, 0.09, 24, 1, true), [])
  const bulb = useMemo(() => new THREE.SphereGeometry(0.025, 12, 8), [])
  useEffect(
    () => () => {
      shade.dispose()
      bulb.dispose()
    },
    [shade, bulb],
  )
  return (
    <group>
      <Parts parts={parts} materials={{ oak: m.oak, seat, brass: m.brass, leather: m.upholsteryDark, book: m.upholstery, paper: m.paper }} />
      {lampX.map((x) => (
        <group key={x} position={[x, H + 0.37, -0.05]}>
          <mesh geometry={shade} material={lampShadeMat} />
          <mesh geometry={bulb} material={lampGlowMat} position={[0, -0.02, 0]} />
        </group>
      ))}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Lounge set                                                          */
/* ------------------------------------------------------------------ */

function armchair(b: Builder, x: number, rotY: number) {
  const c = Math.cos(rotY)
  const s = Math.sin(rotY)
  const at = (dx: number, dy: number, dz: number): [number, number, number] => [x + dx * c + dz * s, dy, dx * -s + dz * c]
  const R: [number, number, number] = [0, rotY, 0]
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) b.add('walnut', cyl(0.018, 0.014, 0.16, 8), { p: at(sx * 0.3, 0.08, sz * 0.3), r: R })
  b.add('fabric', rbox(0.76, 0.16, 0.74, 0.05, 3, 'x'), { p: at(0, 0.24, 0), r: R })
  b.add('fabric', rbox(0.62, 0.12, 0.6, 0.05, 3, 'x'), { p: at(0, 0.37, 0.04), r: R })
  b.add('fabric', rbox(0.76, 0.46, 0.16, 0.05, 3, 'x'), { p: at(0, 0.53, -0.29), r: [-0.12, rotY, 0] })
  for (const sx of [-1, 1]) b.add('fabric', rbox(0.12, 0.26, 0.7, 0.04, 3, 'z'), { p: at(sx * 0.33, 0.45, 0.01), r: R })
}

export function LoungeSet({ config }: ModelProps) {
  const m = useModelMaterials()
  const [W] = fp(config, [2.6, 0.9])
  const fabric = useMemo(() => tinted(m.upholstery, '#2f3d63', { roughness: 1 }), [m.upholstery])
  const parts = useBuilt(geoKey('lounge-set', config), () => {
    const b = new Builder()
    armchair(b, -W / 2 + 0.45, 0.25)
    armchair(b, W / 2 - 0.45, -0.25)
    // side table + lamp + books
    b.add('walnut', cyl(0.22, 0.22, 0.025, 28), { p: [0, 0.55, -0.1] })
    b.add('walnut', cyl(0.025, 0.03, 0.53, 10), { p: [0, 0.27, -0.1] })
    b.add('walnut', cyl(0.16, 0.18, 0.02, 24), { p: [0, 0.01, -0.1] })
    b.add('brass', cyl(0.05, 0.06, 0.02, 16), { p: [-0.06, 0.572, -0.16] })
    b.add('brass', cyl(0.007, 0.007, 0.3, 8), { p: [-0.06, 0.73, -0.16] })
    b.add('book', box(0.17, 0.028, 0.24), { p: [0.08, 0.576, -0.02], r: [0, 0.4, 0] })
    b.add('book2', box(0.16, 0.024, 0.22), { p: [0.08, 0.602, -0.02], r: [0, 0.2, 0] })
    // a woven rug under the pair
    b.add('rug', box(W - 0.1, 0.008, 1.3), { p: [0, 0.004, 0.2] })
    return b
  })
  const shade = useMemo(() => new THREE.CylinderGeometry(0.1, 0.14, 0.16, 28, 1, true), [])
  useEffect(() => () => shade.dispose(), [shade])
  useLocalSpots(config, [{ from: [-0.06, 2.9, -0.16], to: [0, 0.4, 0.3], intensity: 9, angle: 0.95 }])
  const inScene = useContext(InMuseumScene)
  return (
    <group>
      <Parts parts={parts} materials={{ walnut: m.walnut, fabric, brass: m.brass, book: m.upholstery, book2: m.upholsteryDark, rug: m.felt }} />
      <mesh geometry={shade} material={linenShadeMat} position={[-0.06, 0.93, -0.16]} castShadow={!inScene} />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Pattern-book lectern                                                */
/* ------------------------------------------------------------------ */

export function PatternLectern({ config }: ModelProps) {
  const m = useModelMaterials()
  const H = config.height ?? 1.12
  const seed = num(config, 'seed', 41)
  const tilt = 0.32
  const parts = useBuilt(geoKey('pattern-lectern', config), () => {
    const b = new Builder()
    b.add('walnut', rbox(0.5, 0.04, 0.42, 0.006, 2, 'x'), { p: [0, 0.02, 0] })
    b.add('walnut', rbox(0.1, H - 0.16, 0.1, 0.006, 2, 'y'), { p: [0, 0.04 + (H - 0.16) / 2, -0.04] })
    b.add('walnut', rbox(0.62, 0.03, 0.46, 0.006, 2, 'x'), { p: [0, H - 0.06, 0], r: [tilt, 0, 0] })
    b.add('walnut', box(0.62, 0.035, 0.02), { p: [0, H - 0.1, 0.22], r: [tilt, 0, 0] })
    // book boards under the pages
    b.add('cover', box(0.6, 0.012, 0.4), { p: [0, H - 0.038, 0.0], r: [tilt, 0, 0] })
    return b
  })
  const spread = useMemo(() => sampleBookSpread(seed), [seed])
  const pageGeo = useMemo(() => {
    // a gently curved open spread (two pages sagging to the gutter)
    const g = new THREE.PlaneGeometry(0.58, 0.38, 24, 1)
    const p = g.getAttribute('position')
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i)
      const t = Math.abs(x) / 0.29
      p.setZ(i, 0.018 * Math.sin(Math.min(1, t) * Math.PI * 0.9) - 0.004 * t)
    }
    g.computeVertexNormals()
    return g
  }, [])
  useEffect(() => () => pageGeo.dispose(), [pageGeo])
  return (
    <group>
      <Parts parts={parts} materials={{ walnut: m.walnut, cover: m.upholstery }} />
      <group position={[0, H - 0.026, 0]} rotation={[tilt - Math.PI / 2, 0, 0]}>
        <mesh geometry={pageGeo} castShadow={false} receiveShadow>
          <meshStandardMaterial map={spread} roughness={0.92} />
        </mesh>
      </group>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Wall of framed block drawings                                       */
/* ------------------------------------------------------------------ */

const DRAWING_MOTIFS: MotifId[] = ['rosette', 'star-lattice', 'teardrop', 'leaf-trail', 'diamond', 'rosette']

export function DrawingWall({ config }: ModelProps) {
  const m = useModelMaterials()
  const [W] = fp(config, [3.0, 0.06])
  const cols = Math.round(num(config, 'cols', 3))
  const rows = Math.round(num(config, 'rows', 2))
  const bottom = num(config, 'bottom', 0.95)
  const gap = 0.14
  const fw = (W - gap * (cols - 1)) / cols
  const fh = fw * 0.76
  const frames = useMemo(() => {
    const out: { x: number; y: number; motif: MotifId }[] = []
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) out.push({ x: -W / 2 + fw / 2 + c * (fw + gap), y: bottom + fh / 2 + (rows - 1 - r) * (fh + gap), motif: DRAWING_MOTIFS[(r * cols + c) % DRAWING_MOTIFS.length] })
    return out
  }, [W, cols, rows, bottom, fw, fh])
  const parts = useBuilt(geoKey('drawing-wall', config), () => {
    const b = new Builder()
    const mw = 0.03
    for (const f of frames) {
      b.add('frame', box(fw, mw, 0.03), { p: [f.x, f.y + fh / 2 - mw / 2, 0.015] })
      b.add('frame', box(fw, mw, 0.03), { p: [f.x, f.y - fh / 2 + mw / 2, 0.015] })
      b.add('frame', box(mw, fh - 2 * mw, 0.03), { p: [f.x - fw / 2 + mw / 2, f.y, 0.015] })
      b.add('frame', box(mw, fh - 2 * mw, 0.03), { p: [f.x + fw / 2 - mw / 2, f.y, 0.015] })
      b.add('mount', box(fw - 2 * mw, fh - 2 * mw, 0.006), { p: [f.x, f.y, 0.004] })
    }
    return b
  })
  const textures = useMemo(() => frames.map((f) => designSheetTexture(f.motif)), [frames])
  const sheet = useMemo(() => new THREE.PlaneGeometry(fw - 0.2, (fw - 0.2) * 0.75), [fw])
  useEffect(() => () => sheet.dispose(), [sheet])
  useLocalSpots(config, [{ from: [0, 3.6, 1.5], to: [0, bottom + (rows * (fh + gap)) / 2, 0], intensity: 16, angle: 0.62 }])
  return (
    <group>
      <Parts parts={parts} materials={{ frame: m.oak, mount: m.paintWhite }} />
      {frames.map((f, i) => (
        <mesh key={i} geometry={sheet} position={[f.x, f.y, 0.0085]}>
          <meshStandardMaterial map={textures[i]} roughness={0.95} />
        </mesh>
      ))}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Resources board                                                     */
/* ------------------------------------------------------------------ */

export function ResourceBoard({ config }: ModelProps) {
  const m = useModelMaterials()
  const w = num(config, 'width', 0.9)
  const h = w * 1.39
  const cy = 1.5
  const items = config.links ?? []
  const key = JSON.stringify(items)
  const tex = useAsyncTexture(() => resourceBoardTexture(items, w, h), [key, w, h])
  const parts = useBuilt(geoKey('resource-board', config), () => {
    const b = new Builder()
    const f = 0.035
    b.add('frame', box(w + 2 * f, f, 0.035), { p: [0, cy + h / 2 + f / 2, 0.0175] })
    b.add('frame', box(w + 2 * f, f, 0.035), { p: [0, cy - h / 2 - f / 2, 0.0175] })
    b.add('frame', box(f, h, 0.035), { p: [-w / 2 - f / 2, cy, 0.0175] })
    b.add('frame', box(f, h, 0.035), { p: [w / 2 + f / 2, cy, 0.0175] })
    b.add('back', box(w, h, 0.01), { p: [0, cy, 0.005] })
    b.add('brass', box(w * 0.3, 0.012, 0.01), { p: [0, cy - h / 2 - 0.06, 0.005] })
    return b
  })
  useLocalSpots(config, [{ from: [0, 3.6, 1.1], to: [0, cy, 0], intensity: 9, angle: 0.5 }])
  return (
    <group>
      <Parts parts={parts} materials={{ frame: m.walnut, back: m.paintWhite, brass: m.brass }} />
      {tex && (
        <mesh position={[0, cy, 0.0112]}>
          <planeGeometry args={[w, h]} />
          <meshStandardMaterial map={tex} roughness={0.9} />
        </mesh>
      )}
    </group>
  )
}

