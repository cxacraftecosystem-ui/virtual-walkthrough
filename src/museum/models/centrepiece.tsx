/**
 * CENTREPIECE — a large carved "master" printing block turning slowly on a tall round
 * display table (kind 'centrepiece', configured in config/objects.ts).
 *
 *   table ....... polished stone plinth, fluted drum with brushed-brass collars, dark walnut
 *                 top with a brass edge band and inlaid ring; a warm hidden LED line under
 *                 the top's overhang and a faint glow on the floor around the plinth
 *   turntable ... brass disc turning at ≈ 0.15 rad/s (props.spin)
 *   block ....... 44 × 44 × 10 cm teak block standing upright in a brass cradle: mirrored
 *                 central motif, a ring of small motifs, a double-ruled border band with
 *                 corner rosettes (all in raised relief with ink on the relief tops), a brass-
 *                 bound face edge and a turned handle with brass ferrules and escutcheon
 *   light ....... one or two dedicated accent spots (SpotPool) — on the court track rail when
 *                 the object stands in the craft court, otherwise on a ceiling pendant
 *   dome ........ optional glass vitrine (props.dome)
 *
 * PLACEHOLDER: the block is procedural and generic; it will be replaced by the workshop's
 * own carved block (set `model` to a GLB — the GLB then takes the block's place only in the
 * inspector; in the museum the procedural table is kept, see objects.ts notes).
 *
 * Keep rotationDeg = 0 (the accent light and fixtures are laid out in world axes).
 * In the 3D inspector (InMuseumScene = false) only the block + cradle is rendered, at true scale.
 */
import { useFrame } from '@react-three/fiber'
import { useContext, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type { MotifId } from '../config/exhibits'
import { ZONES } from '../config/layout'
import { LIGHTING } from '../config/lighting'
import { COURT_RAIL_Z, RAIL_Y } from '../lighting/tracks'
import { registerSpot } from '../lighting/SpotPool'
import { TRACK_COLOR, TrackSpot } from '../lighting/TrackLight'
import { inkTraceTexture, woodGrainTexture } from '../exhibits/HandBlockPlaceholder'
import { motifToShapes } from '../exhibits/motifs'
import { Builder, cyl, Parts, rbox, useBuilt } from './kit'
import { useModelMaterials } from './modelMaterials'
import { useMuseum } from '../state/store'
import { VR_MODE } from '../utils/vr'
import { InMuseumScene } from './sceneContext'
import { fp, num, str, type ModelProps } from './types'

/* ------------------------------------------------------------------ */
/* Dimensions                                                          */
/* ------------------------------------------------------------------ */

const TOP_R = 0.6
const BLOCK_W = 0.44
const BLOCK_T = 0.1
const RELIEF = 0.011
const CRADLE_H = 0.018

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                    */
/* ------------------------------------------------------------------ */

/** Open fluted drum (tapered), metre UVs. */
function flutedDrum(rBot: number, rTop: number, h: number, flutes = 28, depth = 0.011) {
  const g = new THREE.CylinderGeometry(1, 1, h, flutes * 8, 6, true)
  const pos = g.getAttribute('position')
  const uv = g.getAttribute('uv')
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const a = Math.atan2(z, x)
    const t = (y + h / 2) / h
    const flute = Math.pow(0.5 + 0.5 * Math.cos(flutes * a), 1.6)
    const r = rBot + (rTop - rBot) * t - depth * flute
    pos.setXYZ(i, Math.cos(a) * r, y, Math.sin(a) * r)
    uv.setXY(i, uv.getX(i) * Math.PI * 2 * rBot, y)
  }
  g.computeVertexNormals()
  return g
}

/** Split an ExtrudeGeometry (non-indexed; group 0 = caps, group 1 = sides). */
function splitExtrude(g: THREE.BufferGeometry): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const out: THREE.BufferGeometry[] = []
  for (const grp of [0, 1]) {
    const parts = g.groups.filter((x) => x.materialIndex === grp)
    const piece = new THREE.BufferGeometry()
    for (const name of ['position', 'normal', 'uv']) {
      const src = g.getAttribute(name) as THREE.BufferAttribute
      const n = src.itemSize
      const total = parts.reduce((s, p) => s + p.count, 0)
      const arr = new Float32Array(total * n)
      let o = 0
      for (const p of parts) {
        arr.set((src.array as Float32Array).subarray(p.start * n, (p.start + p.count) * n), o)
        o += p.count * n
      }
      piece.setAttribute(name, new THREE.BufferAttribute(arr, n))
    }
    out.push(piece)
  }
  return [out[0], out[1]]
}

function rectRing(w: number, h: number, band: number) {
  const s = new THREE.Shape()
  s.moveTo(-w / 2, -h / 2)
  s.lineTo(w / 2, -h / 2)
  s.lineTo(w / 2, h / 2)
  s.lineTo(-w / 2, h / 2)
  s.closePath()
  const hole = new THREE.Path()
  const iw = w / 2 - band
  const ih = h / 2 - band
  hole.moveTo(-iw, -ih)
  hole.lineTo(-iw, ih)
  hole.lineTo(iw, ih)
  hole.lineTo(iw, -ih)
  hole.closePath()
  s.holes.push(hole)
  return [s]
}

interface ReliefPart {
  shapes: THREE.Shape[]
  x: number
  y: number
  rot?: number
}

/** All relief of the carved face in block-face space (XY, relief grows +z from z = 0). */
function buildRelief(motif: MotifId) {
  const W = BLOCK_W
  const parts: ReliefPart[] = []
  // border band: two ruled frames, corner rosettes, small diamonds along each side
  parts.push({ shapes: rectRing(W - 0.022, W - 0.022, 0.006), x: 0, y: 0 })
  parts.push({ shapes: rectRing(W - 0.13, W - 0.13, 0.005), x: 0, y: 0 })
  const bandC = W / 2 - 0.011 - 0.043 / 2 - 0.006
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ])
    parts.push({ shapes: motifToShapes('rosette', 0.044, 'all', true), x: sx * bandC, y: sy * bandC })
  const nSide = 5
  for (let i = 0; i < nSide; i++) {
    const t = -bandC + ((i + 1) * (2 * bandC)) / (nSide + 1)
    const small = motifToShapes('diamond', 0.034, 'all', true)
    parts.push({ shapes: small, x: t, y: bandC }, { shapes: small, x: t, y: -bandC }, { shapes: small, x: bandC, y: t, rot: Math.PI / 2 }, { shapes: small, x: -bandC, y: t, rot: Math.PI / 2 })
  }
  // field: large mirrored central motif + a ring of eight teardrops
  parts.push({ shapes: motifToShapes(motif, 0.18, 'all', true), x: 0, y: 0 })
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8
    parts.push({ shapes: motifToShapes('teardrop', 0.046, 'all', true), x: Math.cos(a) * 0.118, y: Math.sin(a) * 0.118, rot: a - Math.PI / 2 })
  }

  const caps: THREE.BufferGeometry[] = []
  const sides: THREE.BufferGeometry[] = []
  const bevel = 0.0009
  for (const p of parts) {
    const g = new THREE.ExtrudeGeometry(p.shapes, {
      depth: RELIEF - bevel * 2,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: 0.0006,
      bevelOffset: 0,
      bevelSegments: 1,
      curveSegments: 8,
    })
    if (p.rot) g.rotateZ(p.rot)
    g.translate(p.x, p.y, bevel)
    const [c, s] = splitExtrude(g)
    g.dispose()
    caps.push(c)
    sides.push(s)
  }
  const cap = mergeGeometries(caps, false)!
  const side = mergeGeometries(sides, false)!
  caps.forEach((g) => g.dispose())
  sides.forEach((g) => g.dispose())
  cap.computeVertexNormals()
  side.computeVertexNormals()
  return { cap, side }
}

/** Turned handle profile [radius, distance out from the block back]. */
const HANDLE: [number, number][] = [
  [0.05, 0],
  [0.046, 0.006],
  [0.03, 0.014],
  [0.021, 0.03],
  [0.019, 0.055],
  [0.027, 0.08],
  [0.031, 0.1],
  [0.026, 0.12],
  [0.02, 0.132],
  [0.028, 0.142],
  [0.034, 0.152],
  [0.03, 0.162],
  [0, 0.166],
]

const blockCache = new Map<string, ReturnType<typeof buildBlock>>()

function buildBlock(motif: MotifId) {
  const body = new RoundedBoxGeometry(BLOCK_W, BLOCK_W, BLOCK_T, 3, 0.006)
  const relief = buildRelief(motif)
  const handle = new THREE.LatheGeometry(
    HANDLE.map(([r, y]) => new THREE.Vector2(r, y)),
    40,
  )
  handle.rotateX(-Math.PI / 2) // lathe axis y → −z (out of the block's back)
  // brass: face-edge binding, handle ferrules, escutcheon, knob cap, cradle + support
  const b = new Builder()
  const edge = BLOCK_W + 0.004
  for (const [w, h, x, y] of [
    [edge, 0.006, 0, BLOCK_W / 2 - 0.001],
    [edge, 0.006, 0, -BLOCK_W / 2 + 0.001],
    [0.006, edge, BLOCK_W / 2 - 0.001, 0],
    [0.006, edge, -BLOCK_W / 2 + 0.001, 0],
  ])
    b.add('brass', rbox(w, h, 0.012, 0.0015), { p: [x, y, BLOCK_T / 2 - 0.004] })
  b.add('brass', cyl(0.062, 0.062, 0.006, 40), { p: [0, 0, -BLOCK_T / 2 - 0.003], r: [Math.PI / 2, 0, 0] })
  for (const [d, r] of [
    [0.016, 0.03],
    [0.078, 0.027],
    [0.13, 0.021],
  ])
    b.add('brass', new THREE.TorusGeometry(r, 0.0045, 8, 40), { p: [0, 0, -BLOCK_T / 2 - d] })
  b.add('brass', new THREE.SphereGeometry(0.018, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), { p: [0, 0, -BLOCK_T / 2 - 0.163], r: [-Math.PI / 2, 0, 0] })
  const brass = b.build()
  const out = { body, cap: relief.cap, side: relief.side, handle, brass }
  return out
}

function getBlock(motif: MotifId) {
  let hit = blockCache.get(motif)
  if (!hit) {
    hit = buildBlock(motif)
    blockCache.set(motif, hit)
  }
  return hit
}

/* ------------------------------------------------------------------ */
/* The carved master block (origin = bottom centre, carved face → +z)  */
/* ------------------------------------------------------------------ */

export function MasterBlock({ motif, ink, wood }: { motif: MotifId; ink: string; wood: 'teak' | 'rosewood' }) {
  const m = useModelMaterials()
  const geo = getBlock(motif)
  const mats = useMemo(() => {
    const grain = woodGrainTexture(wood === 'rosewood' ? 'cradle' : 'teak')
    const tone = wood === 'rosewood' ? '#c9a48c' : '#f2e2d0'
    const timber = new THREE.MeshStandardMaterial({ color: tone, map: grain, roughness: 0.55, metalness: 0, envMapIntensity: 0.8 })
    const floor = new THREE.MeshStandardMaterial({ color: wood === 'rosewood' ? '#7a5646' : '#9c7a5c', map: grain, roughness: 0.9 })
    const inkMap = inkTraceTexture(ink).clone()
    inkMap.repeat.set(9, 9)
    inkMap.needsUpdate = true
    const inkMat = new THREE.MeshStandardMaterial({ map: inkMap, roughness: 0.88, metalness: 0 })
    return { timber, floor, ink: inkMat, inkMap }
  }, [ink, wood])
  useEffect(
    () => () => {
      mats.inkMap.dispose()
      mats.timber.dispose()
      mats.floor.dispose()
      mats.ink.dispose()
    },
    [mats],
  )
  const cy = CRADLE_H + BLOCK_W / 2
  return (
    <group>
      {/* brass cradle + rear support rod up to the handle */}
      <CradleParts />
      <group position={[0, cy, 0]}>
        <mesh geometry={geo.body} material={mats.timber} castShadow receiveShadow />
        <mesh position={[0, 0, BLOCK_T / 2 + 0.0004]} material={mats.floor} receiveShadow>
          <planeGeometry args={[BLOCK_W - 0.012, BLOCK_W - 0.012]} />
        </mesh>
        <group position={[0, 0, BLOCK_T / 2]}>
          <mesh geometry={geo.cap} material={mats.ink} castShadow receiveShadow />
          <mesh geometry={geo.side} material={mats.timber} castShadow receiveShadow />
        </group>
        <mesh geometry={geo.handle} material={mats.timber} position={[0, 0, -BLOCK_T / 2]} castShadow receiveShadow />
        <Parts parts={geo.brass} materials={{ brass: m.brass }} />
      </group>
    </group>
  )
}

function CradleParts() {
  const m = useModelMaterials()
  const parts = useBuilt('centrepiece-cradle', () => {
    const b = new Builder()
    b.add('brass', rbox(BLOCK_W + 0.06, CRADLE_H, BLOCK_T + 0.05, 0.004), { p: [0, CRADLE_H / 2, 0] })
    for (const s of [-1, 1]) b.add('brass', rbox(BLOCK_W + 0.06, 0.04, 0.008, 0.002), { p: [0, CRADLE_H + 0.02, s * (BLOCK_T / 2 + 0.006)] })
    // rear foot + rod to the handle's knob
    const rodZ = -BLOCK_T / 2 - 0.165
    b.add('brass', rbox(0.03, 0.012, -rodZ - BLOCK_T / 2 + 0.02, 0.003), { p: [0, 0.006, (rodZ - BLOCK_T / 2) / 2] })
    const rodH = CRADLE_H + BLOCK_W / 2 - 0.02
    b.add('brass', cyl(0.007, 0.009, rodH, 16), { p: [0, rodH / 2, rodZ] })
    return b
  })
  return <Parts parts={parts} materials={{ brass: m.brass }} />
}

/* ------------------------------------------------------------------ */
/* Table, glow and light                                               */
/* ------------------------------------------------------------------ */

function glowTexture() {
  const S = 256
  const cv = document.createElement('canvas')
  cv.width = cv.height = S
  const ctx = cv.getContext('2d')!
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  g.addColorStop(0, 'rgba(255,255,255,0)')
  g.addColorStop(0.46, 'rgba(255,255,255,0)')
  g.addColorStop(0.52, 'rgba(255,255,255,0.9)')
  g.addColorStop(0.62, 'rgba(255,255,255,0.25)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  const t = new THREE.CanvasTexture(cv)
  return t
}

let glowTex: THREE.CanvasTexture | null = null

function DisplayTable({ H, dome }: { H: number; dome: boolean }) {
  const m = useModelMaterials()
  const parts = useBuilt(`centrepiece-table|${H}|${dome}`, () => {
    const b = new Builder()
    const drumBot = 0.1
    const drumTop = H - 0.16
    b.add('stoneDark', cyl(0.5, 0.52, 0.06, 72), { p: [0, 0.03, 0] })
    b.add('shadow', cyl(0.43, 0.43, 0.02, 64), { p: [0, 0.07, 0] })
    b.add('stone', cyl(0.4, 0.42, 0.025, 72), { p: [0, 0.0925, 0] })
    b.add('stone', flutedDrum(0.34, 0.3, drumTop - drumBot), { p: [0, (drumBot + drumTop) / 2, 0] })
    b.add('brass', cyl(0.352, 0.352, 0.026, 72), { p: [0, drumBot + 0.02, 0] })
    b.add('brass', cyl(0.318, 0.318, 0.03, 72), { p: [0, drumTop - 0.004, 0] })
    b.add('stone', cyl(0.26, 0.3, 0.05, 64), { p: [0, drumTop + 0.035, 0] })
    b.add('shadow', cyl(0.24, 0.24, 0.035, 48), { p: [0, H - 0.07, 0] })
    // walnut top with brass edge band and an inlaid ring
    b.add('walnut', cyl(TOP_R, TOP_R - 0.01, 0.055, 96), { p: [0, H - 0.0275, 0] })
    b.add('brass', cyl(TOP_R + 0.004, TOP_R + 0.004, 0.018, 96, true), { p: [0, H - 0.02, 0] })
    const ring = new THREE.RingGeometry(0.47, 0.478, 96)
    ring.rotateX(-Math.PI / 2)
    b.add('brass', ring, { p: [0, H + 0.0008, 0] })
    // turntable bearing
    b.add('blackSteel', cyl(0.2, 0.2, 0.008, 48), { p: [0, H + 0.004, 0] })
    if (dome) b.add('brass', cyl(0.43, 0.44, 0.03, 72), { p: [0, H + 0.015, 0] })
    return b
  })
  const led = useMemo(() => new THREE.MeshStandardMaterial({ color: '#ffe7c2', emissive: new THREE.Color('#ffd49a'), emissiveIntensity: 2.4, roughness: 0.5 }), [])
  const glow = useMemo(() => {
    glowTex ??= glowTexture()
    return new THREE.MeshBasicMaterial({ color: '#ffe2b8', alphaMap: glowTex, transparent: true, opacity: 0.08, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending })
  }, [])
  const glass = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#f4f8f8', transparent: true, opacity: 0.1, roughness: 0.04, metalness: 0, envMapIntensity: 1.4, depthWrite: false, side: THREE.DoubleSide }),
    [],
  )
  useEffect(
    () => () => {
      led.dispose()
      glow.dispose()
      glass.dispose()
    },
    [led, glow, glass],
  )
  return (
    <group>
      <Parts parts={parts} materials={{ stone: m.counterStone, stoneDark: m.stoneDark, shadow: m.shadowGap, brass: m.brass, walnut: m.walnut, blackSteel: m.blackSteel }} />
      {/* hidden LED line under the top's overhang */}
      <mesh position={[0, H - 0.062, 0]} rotation={[Math.PI / 2, 0, 0]} material={led}>
        <torusGeometry args={[TOP_R - 0.07, 0.005, 6, 96]} />
      </mesh>
      {/* faint floor glow */}
      <mesh position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]} material={glow} renderOrder={2} raycast={() => null}>
        <planeGeometry args={[2.4, 2.4]} />
      </mesh>
      {dome && (
        <group position={[0, H + 0.03, 0]}>
          <mesh position={[0, 0.34, 0]} material={glass} renderOrder={3} raycast={() => null}>
            <cylinderGeometry args={[0.42, 0.42, 0.68, 64, 1, true]} />
          </mesh>
          <mesh position={[0, 0.68, 0]} rotation={[-Math.PI / 2, 0, 0]} material={glass} renderOrder={3} raycast={() => null}>
            <circleGeometry args={[0.42, 64]} />
          </mesh>
          <mesh position={[0, 0.685, 0]} material={m.brass}>
            <cylinderGeometry args={[0.425, 0.425, 0.012, 64, 1, true]} />
          </mesh>
        </group>
      )}
    </group>
  )
}

/** Accent light(s): court rail spots in the craft court, otherwise a ceiling pendant spot. */
function AccentLights({ config, H }: { config: ModelProps['config']; H: number }) {
  const m = useModelMaterials()
  const [px, py, pz] = config.position
  const target: [number, number, number] = [px, H + 0.26, pz]
  const onRail = config.zone === 'reveal' && Math.abs(pz - COURT_RAIL_Z) < 0.05
  const k = num(config, 'light', 1)
  const ceiling = ZONES.find((z) => z.id === config.zone)?.height ?? 6
  const pendantY = Math.min(ceiling - 0.9, 5.2)
  const rail = useMemo(() => {
    if (!onRail) return []
    return [-1.35, 1.35].map((dx, i) => {
      const pos: [number, number, number] = [px + dx, RAIL_Y - 0.1, pz]
      const d = Math.hypot(dx, pos[1] - target[1])
      return { pos, angle: Math.atan(0.42 / d) * 1.35, intensity: LIGHTING.track.artworkIntensity * (i === 0 ? 1.0 : 0.6) * k * (d / 2.2) ** 2 }
    })
  }, [onRail, px, pz, target[1], k]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (onRail) return
    const pos: [number, number, number] = [px + 0.5, pendantY, pz + 0.35]
    const d = Math.hypot(0.5, pendantY - target[1], 0.35)
    return registerSpot({ position: pos, target, intensity: LIGHTING.track.artworkIntensity * 1.1 * k * (d / 2.2) ** 2, angle: Math.atan(0.5 / d) * 1.7, penumbra: 0.65, color: TRACK_COLOR })
  }, [onRail, px, pz, pendantY, k]) // eslint-disable-line react-hooks/exhaustive-deps
  if (onRail)
    return (
      // TrackSpot works in world space: cancel this object's translation (rotationDeg must be 0)
      <group position={[-px, -py, -pz]}>
        {rail.map((s, i) => (
          <TrackSpot key={i} position={s.pos} target={target} angle={s.angle} intensity={s.intensity} penumbra={0.6} />
        ))}
      </group>
    )
  // pendant: a slim black stem from the ceiling carrying a small spot head
  return (
    <group position={[0.5, pendantY, 0.35]}>
      <mesh position={[0, (ceiling - pendantY) / 2, 0]} material={m.blackSteel}>
        <cylinderGeometry args={[0.006, 0.006, ceiling - pendantY, 8]} />
      </mesh>
      <mesh material={m.blackSteel} rotation={[Math.atan2(0.35, pendantY - H), 0, -Math.atan2(0.5, pendantY - H)]}>
        <cylinderGeometry args={[0.035, 0.03, 0.13, 20]} />
      </mesh>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Scene object                                                        */
/* ------------------------------------------------------------------ */

export function Centrepiece({ config }: ModelProps) {
  const inMuseum = useContext(InMuseumScene)
  const m = useModelMaterials()
  const H = config.height ?? 1.1
  const motif = str(config, 'motif', 'rosette') as MotifId
  const ink = str(config, 'ink', '#8a3b2b')
  const wood = str(config, 'wood', 'teak') === 'rosewood' ? 'rosewood' : 'teak'
  const dome = config.props?.dome === true
  const spin = num(config, 'spin', 0.15)
  const turn = useRef<THREE.Group>(null)
  useFrame((_, dt) => {
    if (inMuseum && turn.current && !VR_MODE && !useMuseum.getState().reducedMotion) turn.current.rotation.y += spin * Math.min(dt, 0.1)
  })

  if (!inMuseum) {
    // inspector: the block alone at true scale (undo the studio's normalisation of the table)
    const [fx, fz] = fp(config, [1.4, 1.4])
    const s = Math.min(1, 0.8 / Math.max(fx, H, fz))
    return (
      <group scale={1 / s} position={[0, 0, 0]}>
        <MasterBlock motif={motif} ink={ink} wood={wood} />
      </group>
    )
  }
  return (
    <group>
      <DisplayTable H={H} dome={dome} />
      <group ref={turn} position={[0, H + 0.008, 0]}>
        <mesh material={m.brass} position={[0, 0.011, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.25, 0.26, 0.022, 64]} />
        </mesh>
        <group position={[0, 0.022, 0.077]}>
          <MasterBlock motif={motif} ink={ink} wood={wood} />
        </group>
      </group>
      <AccentLights config={config} H={H} />
    </group>
  )
}

