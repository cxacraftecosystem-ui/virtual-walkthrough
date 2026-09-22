/**
 * Craft Workshop Hall models: printing table, dye vat, block archive shelf, pigment
 * station, wash tank, cloth-roll rack, carving bench.
 * All are placeholder reconstructions of generic workshop furniture (no claims about a
 * specific workshop's equipment) built to the object's footprint and height.
 */
import { useMemo } from 'react'
import * as THREE from 'three'
import type { MotifId } from '../config/exhibits'
import { MOTIF_IDS } from '../exhibits/motifs'
import { arc, box, Builder, cyl, cylX, lathe, latheColored, Parts, rbox, rng, sweepX, tube, useBuilt, type V3 } from './kit'
import { liquidMaterial, tinted, useModelMaterials } from './modelMaterials'
import { BLOCK_ATLAS, blockFaceAtlas, carvingFaceTexture, designSheetTexture, printedClothTexture } from './textures'
import { fp, geoKey, num, str, type ModelProps } from './types'

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

/** Turned block handle (knob), origin at its base, height ≈ 0.072. */
const KNOB_PROFILE: [number, number][] = [
  [0.024, 0],
  [0.022, 0.006],
  [0.012, 0.018],
  [0.0095, 0.034],
  [0.012, 0.048],
  [0.02, 0.057],
  [0.022, 0.064],
  [0.016, 0.07],
  [0.006, 0.0725],
  [0, 0.073],
]

/** A hand block lying carved-face down: body + turned knob (teak) + inked relief sliver (ink). */
function addBlock(b: Builder, p: V3, w: number, d: number, rotY: number, woodKey: string, inkKey: string) {
  const t = 0.05
  const c = Math.cos(rotY)
  const s = Math.sin(rotY)
  const at = (dx: number, dy: number, dz: number): V3 => [p[0] + dx * c + dz * s, p[1] + dy, p[2] - dx * s + dz * c]
  b.add(inkKey, box(w - 0.006, 0.006, d - 0.006), { p: at(0, 0.003, 0), r: [0, rotY, 0] })
  b.add(woodKey, rbox(w, t, d, 0.005), { p: at(0, 0.006 + t / 2, 0), r: [0, rotY, 0] })
  b.add(woodKey, lathe(KNOB_PROFILE, 18), { p: at(0, 0.006 + t, 0), r: [0, rotY, 0] })
}

/* ------------------------------------------------------------------ */
/* Printing table                                                      */
/* ------------------------------------------------------------------ */

export function PrintingTable({ config }: ModelProps) {
  const m = useModelMaterials()
  const [W, D] = fp(config, [6, 1.3])
  const H = config.height ?? 0.86
  const motif = str(config, 'motif', 'rosette') as MotifId
  const ink = str(config, 'ink', '#2c3f6b')
  const printed = num(config, 'printed', 0.62)

  const padTop = H - 0.005
  const clothX0 = -W / 2 + 0.1
  const clothX1 = W / 2 - 0.85
  const clothLen = clothX1 - clothX0
  const clothCx = (clothX0 + clothX1) / 2
  const hang = 0.17

  const cloth = useMemo(() => {
    const zE = D / 2 + 0.004
    const yT = padTop + 0.0025
    const cr = 0.014
    const prof: [number, number][] = [
      [zE, padTop - hang],
      [zE, yT - cr],
      ...arc(zE - cr, yT - cr, cr, 0, Math.PI / 2, 3).slice(1),
      ...arc(-zE + cr, yT - cr, cr, Math.PI / 2, Math.PI, 3),
      [-zE, padTop - hang],
    ]
    // profile runs +z → -z (front hang first); section lengths for the texture
    const seg = (a: number, b: number) => {
      let l = 0
      for (let i = a; i < b; i++) l += Math.hypot(prof[i + 1][0] - prof[i][0], prof[i + 1][1] - prof[i][1])
      return l
    }
    const n = prof.length
    const topStart = 1
    const topEnd = n - 2
    const sections: [number, number, number] = [seg(0, topStart), seg(topStart, topEnd), seg(topEnd, n - 1)]
    const geo = sweepX(prof, clothLen, 1)
    const tex = printedClothTexture({ motif, ink, length: clothLen, sections, printed })
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.96, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.4 })
    return { geo, mat }
  }, [D, padTop, clothLen, motif, ink, printed])

  const inkMat = useMemo(() => tinted(m.felt, ink, { roughness: 0.42, normalScale: new THREE.Vector2(0.4, 0.4) }), [m.felt, ink])

  const parts = useBuilt(geoKey('printing-table', config), () => {
    const b = new Builder()
    const legH = H - 0.085
    const legs = [-W / 2 + 0.18, 0, W / 2 - 0.18]
    for (const x of legs)
      for (const z of [-(D / 2 - 0.1), D / 2 - 0.1]) b.add('frame', rbox(0.09, legH, 0.09, 0.006, 2, 'y'), { p: [x, legH / 2, z] })
    // aprons + stretchers
    for (const z of [-(D / 2 - 0.1), D / 2 - 0.1]) b.add('frame', rbox(W - 0.3, 0.1, 0.035, 0.004, 1, 'x'), { p: [0, legH - 0.07, z] })
    for (const x of legs) b.add('frame', rbox(0.035, 0.1, D - 0.24, 0.004, 1, 'z'), { p: [x, legH - 0.07, 0] })
    b.add('frame', rbox(W - 0.4, 0.06, 0.05, 0.004, 1, 'x'), { p: [0, 0.2, 0] })
    for (const x of legs) b.add('frame', rbox(0.05, 0.06, D - 0.24, 0.004, 1, 'z'), { p: [x, 0.2, 0] })
    // slab + padding
    b.add('frame', rbox(W, 0.05, D, 0.008, 2, 'x'), { p: [0, H - 0.06, 0] })
    b.add('felt', rbox(W - 0.03, 0.032, D - 0.03, 0.012, 2, 'x'), { p: [0, H - 0.021, 0] })
    // ink tray at the free end
    const tx = W / 2 - 0.45
    const tz = 0.12
    const tw = 0.46
    const td = 0.36
    b.add('teak', rbox(tw, 0.014, td, 0.003), { p: [tx, padTop + 0.007, tz] })
    for (const s of [-1, 1]) {
      b.add('teak', rbox(tw, 0.055, 0.016, 0.003, 1, 'x'), { p: [tx, padTop + 0.0275, tz + s * (td / 2 - 0.008)] })
      b.add('teak', rbox(0.016, 0.055, td - 0.032, 0.003, 1, 'z'), { p: [tx + s * (tw / 2 - 0.008), padTop + 0.0275, tz] })
    }
    b.add('ink', rbox(tw - 0.04, 0.024, td - 0.04, 0.006), { p: [tx, padTop + 0.026, tz] })
    // hand blocks resting: one on the pad, one beside the tray, one at the working edge
    addBlock(b, [tx + 0.02, padTop + 0.038, tz + 0.01], 0.17, 0.17, 0.12, 'teak', 'ink')
    addBlock(b, [tx - 0.05, padTop, -0.34], 0.22, 0.13, -0.25, 'teak', 'ink')
    const edgeX = clothX0 + 0.1 + (clothLen - 0.1) * printed + 0.16
    addBlock(b, [Math.min(edgeX, clothX1 - 0.12), padTop + 0.003, -0.12], 0.15, 0.15, 0.05, 'teak', 'ink')
    return b
  })

  return (
    <group>
      <Parts parts={parts} materials={{ frame: m.darkTimber, felt: m.felt, teak: m.teak, ink: inkMat }} />
      <mesh geometry={cloth.geo} material={cloth.mat} position={[clothCx, 0, 0]} receiveShadow castShadow />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Dye vat                                                             */
/* ------------------------------------------------------------------ */

export function DyeVat({ config }: ModelProps) {
  const m = useModelMaterials()
  const [fx, fz] = fp(config, [1.2, 1.2])
  const H = config.height ?? 0.9
  const liquid = str(config, 'liquid', '#1f2d52')
  const R = (Math.min(fx, fz) / 2) * 0.9
  const liqY = H - 0.1

  const parts = useBuilt(geoKey('dye-vat', config), () => {
    const b = new Builder()
    // hand-thrown earthenware: sooty foot, burnished belly, a dark slip band at the
    // shoulder, worn lighter rim, dark stained interior
    const prof: [number, number][] = [
      [0, 0.004],
      [R * 0.55, 0],
      [R * 0.66, 0.02],
      [R * 0.86, H * 0.2],
      [R * 0.98, H * 0.45],
      [R * 1.0, H * 0.6],
      [R * 0.965, H * 0.78],
      [R * 0.952, H * 0.8],
      [R * 0.918, H * 0.875],
      [R * 0.9, H * 0.9],
      [R * 0.9, H * 0.94],
      [R * 0.96, H - 0.022],
      [R * 0.965, H - 0.008],
      [R * 0.94, H],
      [R * 0.9, H - 0.004],
      [R * 0.86, H - 0.02],
      [R * 0.85, liqY - 0.08],
      [R * 0.5, liqY - 0.12],
      [0, liqY - 0.13],
    ]
    const cols = [
      '#3f2c21', '#45301f', '#4d3526', '#664432', '#7a543e', '#80583f', '#6f4b36',
      '#2e231c', '#2e231c', '#5a3d2c', '#5e402e', '#7b573f', '#8d6649', '#8a6348',
      '#4a3527', '#2d221b', '#1f1814', '#1c1612', '#1c1612',
    ]
    b.add('vessel', latheColored(prof, cols, 56))
    // low lime-mortar plinth
    b.add('plinth', lathe([[R * 0.5, 0], [R * 0.84, 0], [R * 0.86, 0.012], [R * 0.84, 0.045], [R * 0.78, 0.055], [R * 0.6, 0.055]], 44))
    // stirring pole across the mouth
    const len = 2 * R + 0.16
    b.add('pole', cylX(0.017, len, 10), { p: [0.03, H + 0.016, -R * 0.12], r: [0, 0.42, 0.015] })
    return b
  })

  // cloth draped over the rim at the front-right, following the vessel's curvature,
  // with soft vertical folds and an uneven hem
  const clothGeo = useMemo(() => {
    const off = 0.01
    const prof: [number, number][] = [
      [R * 0.82, liqY - 0.03],
      [R * 0.86 - off, H - 0.03],
      [R * 0.9 - off, H - 0.004 + off],
      [R * 0.94, H + off + 0.002],
      [R * 0.975 + off, H - 0.01],
      [R * 0.965 + off, H - 0.03],
      [R * 0.92 + off, H * 0.9],
      [R * 0.97 + off, H * 0.8],
      [R * 1.0 + off, H * 0.7],
      [R * 1.005 + off * 1.2, H * 0.6],
      [R * 1.0 + off * 1.5, H * 0.5],
    ]
    const g = sweepX(prof, 0.38, 16)
    const pos = g.getAttribute('position')
    const theta0 = 0.55
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const y = pos.getY(i)
      let r = pos.getZ(i)
      const hang = THREE.MathUtils.clamp((H - 0.03 - y) / (H * 0.45), 0, 1)
      // folds grow toward the hem (outside only)
      if (r > R * 0.95) r += hang * (0.009 * Math.sin(x * 52 + 1.3) + 0.005 * Math.sin(x * 97))
      const a = theta0 + x / r
      const sag = -hang * (0.035 * Math.cos((x / 0.19) * (Math.PI / 2)) + 0.012 * Math.sin(x * 31))
      pos.setXYZ(i, Math.sin(a) * r, y + sag, Math.cos(a) * r)
    }
    g.computeVertexNormals()
    return g
  }, [R, H, liqY])

  const liq = useMemo(() => {
    const c = new THREE.Color(liquid).multiplyScalar(0.55)
    return liquidMaterial({ color: '#' + c.getHexString(), amplitude: 0.035, scale: 1.1, speed: 0.4, roughness: 0.12, envMapIntensity: 0.75 })
  }, [liquid])
  const clothColor = useMemo(() => '#' + new THREE.Color(liquid).lerp(new THREE.Color('#d8cfc0'), 0.12).getHexString(), [liquid])
  const clothMat = useMemo(() => tinted(m.cloth, clothColor, { side: THREE.DoubleSide }), [m.cloth, clothColor])
  const vesselMat = useMemo(() => tinted(m.earthenware, '#ffffff', { vertexColors: true, roughness: 0.78 }), [m.earthenware])

  return (
    <group>
      <Parts parts={parts} materials={{ vessel: vesselMat, plinth: m.stoneFine, pole: m.teak }} />
      <mesh geometry={clothGeo} material={clothMat} castShadow receiveShadow />
      <mesh rotation-x={-Math.PI / 2} position={[0, liqY, 0]} material={liq} receiveShadow>
        <circleGeometry args={[R * 0.852, 48]} />
      </mesh>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Block archive shelf (instanced blocks)                              */
/* ------------------------------------------------------------------ */

/** Unit block (1×1×1, softly bevelled): +z face samples an atlas cell (per instance), other faces plain wood. */
function unitBlockGeometry() {
  const g = rbox(1, 1, 1, 0.07, 2)
  const pos = g.getAttribute('position')
  const nor = g.getAttribute('normal')
  const uv = g.getAttribute('uv')
  const face = new Float32Array(pos.count)
  const { cols, rows, plainCell } = BLOCK_ATLAS
  const pcx = plainCell % cols
  const pcy = Math.floor(plainCell / cols)
  for (let i = 0; i < pos.count; i++) {
    const front = nor.getZ(i) > 0.7
    face[i] = front ? 1 : 0
    if (front) uv.setXY(i, pos.getX(i) + 0.5, pos.getY(i) + 0.5)
    else {
      // sample a grain strip inside the plain cell (absolute atlas coords)
      const u = (pcx + 0.1 + 0.8 * (((pos.getX(i) + pos.getZ(i) + 1) / 2) % 1)) / cols
      const v = 1 - (pcy + 0.1 + 0.8 * (pos.getY(i) + 0.5)) / rows
      uv.setXY(i, u, v)
    }
  }
  g.setAttribute('aFace', new THREE.BufferAttribute(face, 1))
  return g
}

function atlasBlockMaterial() {
  const { map, bump } = blockFaceAtlas()
  const mat = new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 2.5, roughness: 0.78, metalness: 0, envMapIntensity: 0.6 })
  const { cols, rows } = BLOCK_ATLAS
  mat.onBeforeCompile = (s) => {
    s.vertexShader = 'attribute float aFace;\nattribute float aCell;\n' + s.vertexShader
    s.vertexShader = s.vertexShader.replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
      if (aFace > 0.5) {
        vec2 cell = vec2(mod(aCell, ${cols}.0), floor(aCell / ${cols}.0));
        vec2 cuv = vec2((cell.x + 0.02 + uv.x * 0.96) / ${cols}.0, 1.0 - (cell.y + 1.0 - (0.02 + uv.y * 0.96)) / ${rows}.0);
        vMapUv = cuv;
        vBumpMapUv = cuv;
      }`,
    )
  }
  mat.customProgramCacheKey = () => 'block-atlas'
  return mat
}

let _atlasMat: THREE.MeshStandardMaterial | null = null
let _unitBlock: THREE.BufferGeometry | null = null
let _knob: THREE.BufferGeometry | null = null

export function BlockShelf({ config }: ModelProps) {
  const m = useModelMaterials()
  const [W, D] = fp(config, [3.2, 0.5])
  const H = config.height ?? 2.4

  const levels = useMemo(() => {
    const n = Math.max(3, Math.round((H - 0.1) / 0.46))
    const gap = (H - 0.08) / n
    return Array.from({ length: n + 1 }, (_, i) => 0.06 + i * gap)
  }, [H])

  const parts = useBuilt(geoKey('block-shelf', config), () => {
    const b = new Builder()
    const ups = [-W / 2 + 0.025, 0, W / 2 - 0.025]
    for (const x of ups) b.add('frame', rbox(0.045, H, D, 0.005, 2, 'y'), { p: [x, H / 2, 0] })
    for (const y of levels) b.add('frame', rbox(W - 0.01, 0.03, D - 0.02, 0.004, 1, 'x'), { p: [0, y, 0] })
    for (let i = 0; i < levels.length - 1; i++) b.add('frame', rbox(W - 0.06, 0.05, 0.018, 0.003, 1, 'x'), { p: [0, levels[i] + 0.3, -D / 2 + 0.02] })
    // plinth kick
    b.add('frame', rbox(W - 0.06, 0.05, 0.02, 0.003, 1, 'x'), { p: [0, 0.025, D / 2 - 0.04] })
    return b
  })

  const inst = useMemo(() => {
    _atlasMat ??= atlasBlockMaterial()
    _unitBlock ??= unitBlockGeometry()
    _knob ??= lathe(KNOB_PROFILE, 14)
    const r = rng(config.id)
    type B = { m: THREE.Matrix4; cell: number; tone: THREE.Color }
    const blocks: B[] = []
    const knobs: THREE.Matrix4[] = []
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    const tones = ['#f0dcc6', '#e2c7a8', '#d7b893', '#f5e4d0', '#c9a684']
    const bayW = W / 2 - 0.045
    for (let li = 0; li < levels.length - 1; li++) {
      const y0 = levels[li] + 0.015
      const clear = levels[li + 1] - levels[li] - 0.04
      const topShelfFlat = li === levels.length - 2
      for (const bay of [-1, 1]) {
        let x = bay < 0 ? -W / 2 + 0.06 : 0.035
        const xMax = x + bayW - 0.03
        while (x < xMax) {
          if (topShelfFlat && r() < 0.5) {
            // a short stack of blocks lying face-down, knob up on the top one
            const w = 0.14 + r() * 0.1
            const d = 0.12 + r() * 0.1
            if (x + w > xMax) break
            const count = 1 + Math.floor(r() * 3)
            let yy = y0
            for (let k = 0; k < count; k++) {
              const t = 0.05 + r() * 0.012
              const rot = (r() - 0.5) * 0.25
              q.setFromEuler(e.set(Math.PI / 2, 0, rot, 'YXZ'))
              const mm = new THREE.Matrix4().compose(new THREE.Vector3(x + w / 2, yy + t / 2, (r() - 0.5) * 0.06), q, new THREE.Vector3(w, d, t))
              blocks.push({ m: mm, cell: Math.floor(r() * 7), tone: new THREE.Color(tones[Math.floor(r() * tones.length)]) })
              yy += t
              if (k === count - 1)
                knobs.push(new THREE.Matrix4().compose(new THREE.Vector3(x + w / 2, yy, 0), new THREE.Quaternion(), new THREE.Vector3(0.9, 0.9, 0.9)))
            }
            x += w + 0.03 + r() * 0.03
          } else {
            // standing on edge, carved face to the aisle
            const w = 0.1 + r() * 0.18
            const h = Math.min(clear - 0.02, 0.1 + r() * 0.16)
            const t = 0.05 + r() * 0.015
            if (x + w > xMax) break
            const lean = r() < 0.15 ? (r() - 0.5) * 0.12 : 0
            q.setFromEuler(e.set(-0.05 - r() * 0.05, (r() - 0.5) * 0.12, lean))
            const z = D / 2 - 0.12 - r() * 0.06
            const mm = new THREE.Matrix4().compose(new THREE.Vector3(x + w / 2, y0 + h / 2, z), q, new THREE.Vector3(w, h, t))
            blocks.push({ m: mm, cell: Math.floor(r() * 7), tone: new THREE.Color(tones[Math.floor(r() * tones.length)]) })
            x += w + 0.012 + r() * 0.02
          }
        }
      }
    }
    const geo = _unitBlock.clone()
    const cells = new Float32Array(blocks.length)
    blocks.forEach((bk, i) => (cells[i] = bk.cell))
    geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 1))
    const im = new THREE.InstancedMesh(geo, _atlasMat, blocks.length)
    blocks.forEach((bk, i) => {
      im.setMatrixAt(i, bk.m)
      im.setColorAt(i, bk.tone)
    })
    im.castShadow = im.receiveShadow = true
    im.computeBoundingSphere()
    const km = new THREE.InstancedMesh(_knob, m.teak, Math.max(1, knobs.length))
    knobs.forEach((k, i) => km.setMatrixAt(i, k))
    km.count = knobs.length
    km.castShadow = km.receiveShadow = true
    km.computeBoundingSphere()
    return { im, km }
  }, [config.id, W, D, levels, m.teak])

  return (
    <group>
      <Parts parts={parts} materials={{ frame: m.oak }} />
      <primitive object={inst.im} />
      {inst.km.count > 0 && <primitive object={inst.km} />}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Pigment station                                                     */
/* ------------------------------------------------------------------ */

/** Natural-dye pigment colours (generic; no specific recipe implied). */
const PIGMENTS = ['#2b3a67', '#9b2d22', '#d8a21c', '#a58a3a', '#2a2622', '#c2a25a', '#b0492c', '#5a6b3a']

export function PigmentStation({ config }: ModelProps) {
  const m = useModelMaterials()
  const [W, D] = fp(config, [2.2, 0.8])
  const H = config.height ?? 0.9

  const parts = useBuilt(geoKey('pigment-station', config), () => {
    const b = new Builder()
    const r = rng('pigment' + config.id)
    // table
    const legH = H - 0.05
    for (const x of [-W / 2 + 0.07, W / 2 - 0.07]) for (const z of [-D / 2 + 0.07, D / 2 - 0.07]) b.add('table', rbox(0.065, legH, 0.065, 0.005), { p: [x, legH / 2, z] })
    b.add('table', rbox(W, 0.05, D, 0.007, 2, 'x'), { p: [0, H - 0.025, 0] })
    for (const z of [-D / 2 + 0.07, D / 2 - 0.07]) b.add('table', rbox(W - 0.2, 0.08, 0.025, 0.003, 1, 'x'), { p: [0, H - 0.09, z] })
    b.add('table', rbox(W - 0.1, 0.025, D - 0.1, 0.004, 1, 'x'), { p: [0, 0.2, 0] })
    // front row: pigment bowls with powder mounds
    const bowl = lathe([[0, 0], [0.05, 0], [0.058, 0.004], [0.08, 0.035], [0.088, 0.05], [0.083, 0.052], [0.074, 0.035], [0.05, 0.012], [0, 0.01]], 28)
    const nB = Math.max(4, Math.floor((W - 0.7) / 0.21))
    for (let i = 0; i < nB; i++) {
      const x = -W / 2 + 0.2 + i * 0.21
      const z = D / 2 - 0.2 + (r() - 0.5) * 0.03
      b.add('ceramic', bowl, { p: [x, H, z], color: i % 3 === 1 ? '#e7dfcf' : '#b9744d' })
      const hh = 0.028 + r() * 0.014
      const mound = lathe([[0.074, 0.034], [0.068, 0.028], [0.045, 0.012 + hh * 0.55], [0.02, 0.01 + hh * 0.92], [0, 0.012 + hh]], 24)
      b.add('powder', mound, { p: [x, H, z], r: [0, r() * 6, 0], color: PIGMENTS[i % PIGMENTS.length] })
    }
    // back row: lidded storage jars
    const jar = lathe([[0, 0], [0.042, 0], [0.05, 0.02], [0.054, 0.08], [0.048, 0.125], [0.034, 0.14], [0.034, 0.152], [0.03, 0.152], [0.028, 0.13]], 24)
    const glazes = ['#3b3a36', '#8fa39a', '#b3874a', '#e3d9c4', '#6d4a33']
    const nJ = Math.max(3, Math.floor((W - 0.9) / 0.15))
    for (let i = 0; i < nJ; i++) {
      const x = -W / 2 + 0.18 + i * 0.15
      const z = -D / 2 + 0.16
      const s = 0.85 + r() * 0.35
      b.add('ceramic', jar, { p: [x, H, z], s, color: glazes[i % glazes.length] })
      b.add('teak', cyl(0.037 * s, 0.035 * s, 0.018 * s, 16), { p: [x, H + 0.158 * s, z] })
    }
    // mortar & pestle (stone)
    const mx = W / 2 - 0.3
    b.add('stone', lathe([[0, 0], [0.09, 0], [0.11, 0.03], [0.115, 0.08], [0.105, 0.095], [0.085, 0.09], [0.07, 0.06], [0.04, 0.035], [0, 0.03]], 30), { p: [mx, H, 0.04] })
    b.add('stone', lathe([[0, 0], [0.024, 0.004], [0.028, 0.03], [0.018, 0.12], [0.016, 0.2], [0.02, 0.215], [0, 0.222]], 16), { p: [mx + 0.03, H + 0.035, 0.03], r: [0.35, 0, -0.45] })
    // a pinch of ground pigment in the mortar
    b.add('powder', lathe([[0.07, 0.06], [0.05, 0.044], [0, 0.052]], 20), { p: [mx, H, 0.04], color: '#9b2d22' })
    // wooden measuring scoop + stirring spatula
    b.add('teak', rbox(0.3, 0.012, 0.03, 0.004, 1, 'x'), { p: [mx - 0.2, H + 0.006, 0.24], r: [0, 0.3, 0] })
    // lower shelf: earthenware storage pots
    const pot = lathe([[0, 0], [0.08, 0], [0.13, 0.08], [0.14, 0.14], [0.11, 0.22], [0.075, 0.25], [0.08, 0.27], [0.07, 0.27], [0.065, 0.25], [0.1, 0.16], [0, 0.12]], 28)
    for (let i = 0; i < 3; i++) b.add('pot', pot, { p: [-W / 2 + 0.35 + i * 0.55, 0.2125, (r() - 0.5) * 0.12], s: 0.9 + r() * 0.25, r: [0, r() * 6, 0] })
    return b
  })

  return <Parts parts={parts} materials={{ table: m.oak, ceramic: m.ceramicVC, powder: m.powderVC, teak: m.teak, stone: m.stoneFine, pot: m.terracotta }} />
}

/* ------------------------------------------------------------------ */
/* Wash tank                                                           */
/* ------------------------------------------------------------------ */

export function WashTank({ config }: ModelProps) {
  const m = useModelMaterials()
  const [W, D] = fp(config, [2.6, 1.1])
  const H = config.height ?? 0.8
  const t = 0.1
  const waterY = H - 0.14

  const parts = useBuilt(geoKey('wash-tank', config), () => {
    const b = new Builder()
    b.add('stone', rbox(W, 0.14, D, 0.012), { p: [0, 0.07, 0] })
    for (const s of [-1, 1]) {
      b.add('stone', rbox(W, H - 0.1, t, 0.018, 2, 'x'), { p: [0, 0.1 + (H - 0.1) / 2, s * (D / 2 - t / 2)] })
      b.add('stone', rbox(t, H - 0.1, D - 2 * t + 0.01, 0.018, 2, 'z'), { p: [s * (W / 2 - t / 2), 0.1 + (H - 0.1) / 2, 0] })
    }
    // recessed plinth (shadow line)
    b.add('plinthShadow', box(W - 0.06, 0.05, D - 0.06), { p: [0, 0.025, 0] })
    // brass tap over the back wall
    const tx = W / 2 - 0.45
    const tz = -D / 2 + t / 2
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(tx, H, tz),
      new THREE.Vector3(tx, H + 0.2, tz),
      new THREE.Vector3(tx, H + 0.26, tz + 0.06),
      new THREE.Vector3(tx, H + 0.22, tz + 0.17),
      new THREE.Vector3(tx, H + 0.16, tz + 0.2),
    ])
    b.add('brass', tube(curve, 0.016, 24, 10))
    b.add('brass', cyl(0.03, 0.034, 0.02, 20), { p: [tx, H + 0.01, tz] })
    b.add('brass', cylX(0.012, 0.06, 10), { p: [tx, H + 0.2, tz], r: [0, 0, 0] })
    b.add('brass', cyl(0.022, 0.022, 0.012, 14), { p: [tx + 0.03, H + 0.2, tz], r: [0, 0, Math.PI / 2] })
    // timber beating board sloping into the water at one end
    b.add('teak', rbox(0.5, 0.04, D - 2 * t - 0.04, 0.006, 2, 'x'), { p: [-W / 2 + t + 0.28, waterY + 0.05, 0], r: [0, 0, -0.32] })
    return b
  })

  const water = useMemo(() => liquidMaterial({ color: '#34504e', amplitude: 0.035, scale: 1.4, speed: 0.6, roughness: 0.04, opacity: 0.86 }), [])

  return (
    <group>
      <Parts parts={parts} materials={{ stone: m.concrete, plinthShadow: m.shadowGap, brass: m.brass, teak: m.teak }} />
      <mesh rotation-x={-Math.PI / 2} position={[0, waterY, 0]} material={water} receiveShadow>
        <planeGeometry args={[W - 2 * t, D - 2 * t]} />
      </mesh>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Cloth roll rack                                                     */
/* ------------------------------------------------------------------ */

const CLOTH_COLOURS = ['#e6dcc8', '#2e3f66', '#8e3326', '#c99a2e', '#2b2826', '#6e6b3a', '#b5645a', '#7c95a8', '#d9c7a3', '#4b2f2a']

export function FabricRolls({ config }: ModelProps) {
  const m = useModelMaterials()
  const [W, D] = fp(config, [2.0, 0.9])
  const H = config.height ?? 1.4

  const parts = useBuilt(geoKey('fabric-rolls', config), () => {
    const b = new Builder()
    const r = rng('rolls' + config.id)
    const px = W / 2 - 0.22
    const pz = D / 2 - 0.04
    const tiers = [0.3, 0.3 + (H - 0.4) / 2, H - 0.1]
    for (const x of [-px, px]) {
      for (const z of [-pz, pz]) b.add('frame', rbox(0.035, H, 0.035, 0.004), { p: [x, H / 2, z] })
      for (const y of tiers) b.add('frame', rbox(0.04, 0.03, D - 0.04, 0.004, 1, 'z'), { p: [x, y, 0] })
      b.add('frame', rbox(0.05, 0.012, D + 0.04, 0.003, 1, 'z'), { p: [x, 0.006, 0] })
    }
    b.add('frame', rbox(2 * px, 0.03, 0.03, 0.004, 1, 'x'), { p: [0, 0.12, -pz] })
    b.add('frame', rbox(2 * px, 0.03, 0.03, 0.004, 1, 'x'), { p: [0, H - 0.02, -pz] })
    // bolts on each tier
    let ci = Math.floor(r() * CLOTH_COLOURS.length)
    for (const y of tiers) {
      let z = -D / 2 + 0.05
      while (z < D / 2 - 0.1) {
        const rad = 0.06 + r() * 0.04
        if (z + 2 * rad > D / 2 - 0.02) break
        const len = W - 0.04 - r() * 0.2
        const cx = (r() - 0.5) * 0.08
        b.add('cloth', cylX(rad, len, 20), { p: [cx, y + 0.015 + rad, z + rad], color: CLOTH_COLOURS[ci % CLOTH_COLOURS.length] })
        b.add('cloth', cylX(0.022, len + 0.012, 10), { p: [cx, y + 0.015 + rad, z + rad], color: '#8f7858' })
        ci += 1 + Math.floor(r() * 3)
        z += 2 * rad + 0.012
      }
    }
    return b
  })

  return <Parts parts={parts} materials={{ frame: m.blackSteel, cloth: m.clothVC }} />
}

/* ------------------------------------------------------------------ */
/* Carving bench                                                       */
/* ------------------------------------------------------------------ */

export function CarvingBench({ config }: ModelProps) {
  const m = useModelMaterials()
  const [W, D] = fp(config, [2.0, 0.9])
  const H = config.height ?? 0.85
  const motif = (str(config, 'motif', '') || MOTIF_IDS[2]) as MotifId
  const bx = -0.12
  const bz = 0.08
  const bw = 0.28
  const bd = 0.22
  const bt = 0.065

  const parts = useBuilt(geoKey('carving-bench', config), () => {
    const b = new Builder()
    const r = rng('carve' + config.id)
    const legH = H - 0.08
    for (const x of [-W / 2 + 0.12, W / 2 - 0.12]) {
      for (const z of [-D / 2 + 0.1, D / 2 - 0.1]) b.add('legs', rbox(0.1, legH, 0.1, 0.008), { p: [x, legH / 2, z] })
      b.add('legs', rbox(0.06, 0.08, D - 0.2, 0.005, 1, 'z'), { p: [x, 0.16, 0] })
    }
    b.add('legs', rbox(W - 0.24, 0.08, 0.05, 0.005, 1, 'x'), { p: [0, 0.16, -D / 2 + 0.1] })
    // lower shelf with block blanks
    b.add('legs', rbox(W - 0.3, 0.025, D - 0.3, 0.004, 1, 'x'), { p: [0, 0.215, 0] })
    for (let i = 0; i < 6; i++) {
      const w = 0.2 + r() * 0.12
      const d = 0.16 + r() * 0.08
      b.add('teak', rbox(w, 0.06, d, 0.004), { p: [-0.55 + (i % 3) * 0.36 + (r() - 0.5) * 0.05, 0.258 + Math.floor(i / 3) * 0.061, (r() - 0.5) * 0.1], r: [0, (r() - 0.5) * 0.3, 0] })
    }
    // heavy top
    b.add('top', rbox(W, 0.08, D, 0.01, 2, 'x'), { p: [0, H - 0.04, 0] })
    // the block being carved (face texture is a separate mesh)
    b.add('teak', rbox(bw, bt, bd, 0.004), { p: [bx, H + bt / 2, bz] })
    // chisels laid out in a row (handles teak, blades steel)
    for (let i = 0; i < 7; i++) {
      const x = 0.28 + i * 0.055
      const z = 0.16 + (r() - 0.5) * 0.02
      const rot = (r() - 0.5) * 0.06
      const hl = 0.1 + r() * 0.03
      b.add('teak', cyl(0.0105, 0.012, hl, 10), { p: [x, H + 0.012, z - 0.05], r: [Math.PI / 2, 0, rot] })
      b.add('steel', cyl(0.0125, 0.0125, 0.012, 10), { p: [x, H + 0.012, z + hl / 2 - 0.05 + 0.006], r: [Math.PI / 2, 0, rot] })
      const bl = 0.07 + r() * 0.03
      const bwid = 0.004 + i * 0.0018
      b.add('steel', box(bwid, 0.003, bl), { p: [x, H + 0.008, z + hl / 2 - 0.044 + bl / 2], r: [0, rot, 0] })
    }
    // tool rail at the back with upright chisels
    b.add('teak', rbox(0.9, 0.05, 0.06, 0.005, 2, 'x'), { p: [0.35, H + 0.025, -D / 2 + 0.07] })
    for (let i = 0; i < 9; i++) {
      const x = -0.03 + i * 0.095
      b.add('teak', cyl(0.011, 0.013, 0.11, 10), { p: [x, H + 0.1, -D / 2 + 0.07] })
      b.add('steel', box(0.006, 0.05, 0.003), { p: [x, H + 0.03, -D / 2 + 0.07] })
    }
    // mallet
    b.add('teak', cylX(0.042, 0.13, 18), { p: [0.62, H + 0.042, -0.12], r: [0, 0.4, 0] })
    b.add('teak', cyl(0.013, 0.015, 0.26, 10), { p: [0.62 + 0.13 * Math.sin(0.4), H + 0.03, -0.12 + 0.13 * Math.cos(0.4)], r: [Math.PI / 2 - 0.05, 0, -0.4] })
    return b
  })

  const faceMat = useMemo(() => {
    const { map, bump } = carvingFaceTexture(motif)
    return new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 3, roughness: 0.8, metalness: 0 })
  }, [motif])
  const sheetMat = useMemo(() => new THREE.MeshStandardMaterial({ map: designSheetTexture(motif), roughness: 0.95, metalness: 0 }), [motif])

  const shavings = useMemo(() => {
    const geo = new THREE.TorusGeometry(0.009, 0.0022, 4, 10, 4.2)
    const mat = tinted(m.teak, '#e2bd8c')
    const r = rng('shave' + config.id)
    const N = 150
    const im = new THREE.InstancedMesh(geo, mat, N)
    const mm = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    for (let i = 0; i < N; i++) {
      const onTop = i < 90
      let x: number, y: number, z: number
      if (onTop) {
        const a = r() * Math.PI * 2
        const d = 0.14 + Math.pow(r(), 1.6) * 0.35
        x = bx + Math.cos(a) * d
        z = Math.max(-D / 2 + 0.14, Math.min(D / 2 - 0.03, bz + Math.sin(a) * d * 0.7))
        y = H + 0.004
      } else {
        x = (r() - 0.5) * W * 0.8
        z = D / 2 + 0.05 + r() * 0.35
        y = 0.004
      }
      q.setFromEuler(e.set(r() * 6.28, r() * 6.28, r() * 6.28))
      const s = 0.7 + r() * 0.9
      mm.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s))
      im.setMatrixAt(i, mm)
    }
    im.castShadow = false
    im.receiveShadow = true
    im.computeBoundingSphere()
    return im
  }, [m.teak, config.id, W, D, H, bx, bz])

  return (
    <group>
      <Parts parts={parts} materials={{ legs: m.darkTimber, top: m.teak, teak: m.teak, steel: m.steel }} />
      <mesh rotation-x={-Math.PI / 2} position={[bx, H + bt + 0.0006, bz]} material={faceMat} receiveShadow>
        <planeGeometry args={[bw - 0.008, bd - 0.008]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0.12]} position={[bx - 0.42, H + 0.0015, bz + 0.02]} material={sheetMat} receiveShadow>
        <planeGeometry args={[0.32, 0.24]} />
      </mesh>
      <primitive object={shavings} />
    </group>
  )
}
