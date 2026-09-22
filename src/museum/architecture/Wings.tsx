/**
 * v2 expansion wings (architecture only — content lives in config/objects.ts & videos.ts):
 *
 *   Grand Atrium        double-height arrival hall, coffered roof lights, glazed south facade
 *   Immersive Theatre   dark acoustic room for the feature film (screen + speakers: media/)
 *   Craft Workshop Hall top-lit working hall with exposed steel trusses and pendant lights
 *   Dye Garden Courtyard open-air paved garden enclosed by rendered garden walls
 *
 * Walls come from config/layout.ts WALLS (rendered by <Wall/>); this file builds floors,
 * roofs, roof lights, facade, interior linings and fixtures.
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { EXHIBITION_TITLE } from '../config/infographics'
import { surfacePoint } from '../config/layout'
import { kelvinToHex, LIGHTING } from '../config/lighting'
import { MUSEUM, type Vec3 } from '../config/museum'
import { withDevOverrides, QUALITY_PRESETS } from '../config/quality'
import { SCENE_OBJECTS } from '../config/objects'
import { registerSpot } from '../lighting/SpotPool'
import { createMeterBoxGeometry } from '../materials/geometry'
import { useMaterials } from '../materials/materials'
import { createTitleWallTexture } from '../materials/wallGraphics'
import { useMuseum } from '../state/store'
import { useAsyncTexture } from '../utils/useAsyncTexture'
import { StaticMerge } from '../effects/StaticMerge'
import { ZoneGroup } from '../navigation/zoneCulling'
import { Landscape } from './Landscape'

const W = MUSEUM.wings
const T = MUSEUM.walls.exteriorThickness
const ROOF_T = 0.35

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */

interface Rect {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

function Box({ min, max, material, cast = true, receive = true }: { min: Vec3; max: Vec3; material: THREE.Material; cast?: boolean; receive?: boolean }) {
  const sx = max[0] - min[0]
  const sy = max[1] - min[1]
  const sz = max[2] - min[2]
  const geo = useMemo(() => createMeterBoxGeometry(sx, sy, sz), [sx, sy, sz])
  return (
    <mesh
      geometry={geo}
      material={material}
      position={[(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]}
      castShadow={cast}
      receiveShadow={receive}
      raycast={cast ? undefined : () => null}
    />
  )
}

/** Decompose a rectangular slab with rectangular openings into boxes (grid of break lines). */
function slabCells(outer: Rect, openings: Rect[]): Rect[] {
  const xs = [...new Set([outer.minX, outer.maxX, ...openings.flatMap((o) => [o.minX, o.maxX])])].sort((a, b) => a - b)
  const zs = [...new Set([outer.minZ, outer.maxZ, ...openings.flatMap((o) => [o.minZ, o.maxZ])])].sort((a, b) => a - b)
  const cells: Rect[] = []
  for (let i = 0; i < xs.length - 1; i++) {
    // merge contiguous z-cells in this x column for fewer meshes
    let start: number | null = null
    for (let j = 0; j < zs.length - 1; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2
      const cz = (zs[j] + zs[j + 1]) / 2
      const hole = openings.some((o) => cx > o.minX && cx < o.maxX && cz > o.minZ && cz < o.maxZ)
      if (!hole && start === null) start = zs[j]
      if ((hole || j === zs.length - 2) && start !== null) {
        const end = hole ? zs[j] : zs[j + 1]
        if (end > start) cells.push({ minX: xs[i], maxX: xs[i + 1], minZ: start, maxZ: end })
        start = null
      }
    }
  }
  return cells
}

function Slab({ outer, openings = [], y, thickness, material }: { outer: Rect; openings?: Rect[]; y: number; thickness: number; material: THREE.Material }) {
  const cells = useMemo(() => slabCells(outer, openings), [outer, openings])
  return (
    <group>
      {cells.map((c, i) => (
        <Box key={i} min={[c.minX, y, c.minZ]} max={[c.maxX, y + thickness, c.maxZ]} material={material} />
      ))}
    </group>
  )
}

/** Roof light: plaster well upstand + glass lid. Direct sun enters only through these. */
function RoofLight({ r, y, well, glass, plaster }: { r: Rect; y: number; well: number; glass: THREE.Material; plaster: THREE.Material }) {
  const t = 0.1
  const top = y + well
  return (
    <group>
      <Box min={[r.minX - t, y, r.minZ - t]} max={[r.minX, top, r.maxZ + t]} material={plaster} />
      <Box min={[r.maxX, y, r.minZ - t]} max={[r.maxX + t, top, r.maxZ + t]} material={plaster} />
      <Box min={[r.minX, y, r.minZ - t]} max={[r.maxX, top, r.minZ]} material={plaster} />
      <Box min={[r.minX, y, r.maxZ]} max={[r.maxX, top, r.maxZ + t]} material={plaster} />
      {/* glass lid: a single plane resting 3 cm ABOVE the well tops (a box coplanar with them z-fought) */}
      <mesh position={[(r.minX + r.maxX) / 2, top + 0.03, (r.minZ + r.maxZ) / 2]} rotation={[-Math.PI / 2, 0, 0]} material={glass} renderOrder={5} raycast={() => null}>
        <planeGeometry args={[r.maxX - r.minX + 2 * t, r.maxZ - r.minZ + 2 * t]} />
      </mesh>
    </group>
  )
}

/** Register a pooled accent light (no fixture) — used by pendants and wall washers. */
function PooledLight({ position, target, intensity, angle, color, penumbra = 0.8 }: { position: Vec3; target: Vec3; intensity: number; angle: number; color: string; penumbra?: number }) {
  const [px, py, pz] = position
  const [tx, ty, tz] = target
  useEffect(() => registerSpot({ position: [px, py, pz], target: [tx, ty, tz], intensity, angle, penumbra, color }), [px, py, pz, tx, ty, tz, intensity, angle, penumbra, color])
  return null
}

const WARM = kelvinToHex(3000, LIGHTING.track.chromaticAdaptation)

/* ------------------------------------------------------------------ */
/* Grand Atrium                                                        */
/* ------------------------------------------------------------------ */

function AtriumTitle() {
  const w = 6.4
  const h = 3.6
  const cy = 3.4
  const tex = useAsyncTexture(() => createTitleWallTexture(w, h, { bottomY: cy - h / 2 }), [EXHIBITION_TITLE.title])
  const p = surfacePoint('atrium-north-east', 5.6, cy, 0.002)
  return (
    <group>
      {tex && (
        <mesh position={p.position} rotation={[0, p.rotationY, 0]} raycast={() => null}>
          <planeGeometry args={[w, h]} />
          <meshStandardMaterial map={tex} transparent roughness={0.7} polygonOffset polygonOffsetFactor={-2} depthWrite={false} />
        </mesh>
      )}
      {[3.6, 7.6].map((x) => (
        <PooledLight key={x} position={[x, 7.4, W.atrium.minZ + 3.2]} target={[x, 3.2, W.atrium.minZ]} intensity={170} angle={0.42} color={WARM} />
      ))}
    </group>
  )
}

function GlassFacade({ glass, frame }: { glass: THREE.Material; frame: THREE.Material }) {
  const a = W.atrium
  const z = a.maxZ + T / 2
  const pitch = 2.0
  const mullions = useMemo(() => {
    const out: number[] = []
    for (let x = a.minX; x <= a.maxX + 1e-6; x += pitch) out.push(x)
    return out
  }, [a.minX, a.maxX])
  const dh = a.entranceHeight
  return (
    <group>
      <mesh position={[0, a.height / 2, z]} material={glass} renderOrder={5} raycast={() => null}>
        <boxGeometry args={[a.maxX - a.minX, a.height, 0.02]} />
      </mesh>
      {mullions.map((x) => (
        <Box key={x} min={[x - 0.04, 0, z - 0.09]} max={[x + 0.04, a.height, z + 0.09]} material={frame} />
      ))}
      {[dh, 5.9].map((y) => (
        <Box key={y} min={[a.minX, y - 0.04, z - 0.08]} max={[a.maxX, y + 0.04, z + 0.08]} material={frame} />
      ))}
      <Box min={[a.minX - T, a.height - 0.3, z - 0.15]} max={[a.maxX + T, a.height, z + 0.15]} material={frame} />
      {/* entrance door frame + canopy */}
      <Box min={[-a.entranceWidth / 2 - 0.08, 0, z - 0.12]} max={[-a.entranceWidth / 2, dh, z + 0.12]} material={frame} />
      <Box min={[a.entranceWidth / 2, 0, z - 0.12]} max={[a.entranceWidth / 2 + 0.08, dh, z + 0.12]} material={frame} />
      <Box min={[-0.03, 0, z - 0.1]} max={[0.03, dh, z + 0.1]} material={frame} />
      <Box min={[-3.2, dh + 0.3, a.maxZ + T]} max={[3.2, dh + 0.5, a.maxZ + 3.0]} material={frame} />
    </group>
  )
}

function Atrium() {
  const m = useMaterials()
  const a = W.atrium
  const floorMat = useMemo(() => {
    const s = (m.stone as THREE.MeshStandardMaterial).clone()
    s.color = new THREE.Color('#f0ebe2')
    s.roughness = 0.55
    s.envMapIntensity = 0.9
    return s
  }, [m.stone])
  const openings = useMemo<Rect[]>(() => {
    const out: Rect[] = []
    const w = a.maxX - a.minX
    const d = a.maxZ - a.minZ
    const half = Math.min(w / 6, d / 4) * 0.62
    for (const fx of [1 / 6, 3 / 6, 5 / 6])
      for (const fz of [0.28, 0.72]) {
        const cx = a.minX + w * fx
        const cz = a.minZ + d * fz
        out.push({ minX: cx - half, maxX: cx + half, minZ: cz - half, maxZ: cz + half })
      }
    return out
  }, [a])
  const outer = useMemo<Rect>(() => ({ minX: a.minX, maxX: a.maxX, minZ: a.minZ, maxZ: a.maxZ }), [a])
  return (
    <group>
      <Box min={[a.minX, -0.1, a.minZ - 0.3]} max={[a.maxX, 0, a.maxZ]} material={floorMat} cast={false} />
      <Slab outer={outer} openings={openings} y={a.height} thickness={ROOF_T} material={m.plasterCeiling} />
      {openings.map((r, i) => (
        <RoofLight key={i} r={r} y={a.height} well={1.0} glass={m.glass} plaster={m.plasterCeiling} />
      ))}
      <GlassFacade glass={m.glass} frame={m.bronze} />
      <AtriumTitle />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Immersive Theatre                                                   */
/* ------------------------------------------------------------------ */

const fabricMat = new THREE.MeshStandardMaterial({ color: '#2d2724', roughness: 1 })
const carpetMat = new THREE.MeshStandardMaterial({ color: '#241f1d', roughness: 1 })
const screenWallMat = new THREE.MeshStandardMaterial({ color: '#0d0c0c', roughness: 1 })
const stepLightMat = new THREE.MeshStandardMaterial({ color: '#ffd9a8', emissive: new THREE.Color('#ffb870'), emissiveIntensity: 1.6 })
const starMat = new THREE.MeshStandardMaterial({ color: '#fff4e2', emissive: new THREE.Color('#fff0d6'), emissiveIntensity: 2.2 })

function Theatre() {
  const th = W.theatre
  const panelT = 0.07
  const panels = useMemo(() => {
    const out: { min: Vec3; max: Vec3 }[] = []
    // north + south walls: vertical fabric panels with shadow gaps
    for (let x = th.minX + 0.6; x < th.maxX - 0.8; x += 1.5) {
      out.push({ min: [x, 0.3, th.minZ], max: [x + 1.42, th.height - 0.5, th.minZ + panelT] })
      out.push({ min: [x, 0.3, th.maxZ - panelT], max: [x + 1.42, th.height - 0.5, th.maxZ] })
    }
    // back (east) wall, leaving the entrance opening clear
    const d = W.doors.atriumToTheatre
    for (let z = th.minZ + 0.4; z < th.maxZ - 0.4; z += 1.5) {
      if (z + 1.42 > d.z - d.width / 2 - 0.2 && z < d.z + d.width / 2 + 0.2) continue
      out.push({ min: [th.maxX - panelT, 0.3, z], max: [th.maxX, th.height - 0.5, z + 1.42] })
    }
    return out
  }, [th])
  const stars = useMemo(() => {
    const out: Vec3[] = []
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < 90; i++) out.push([th.minX + 1 + rnd() * (th.maxX - th.minX - 2), th.height - 0.01, th.minZ + 0.6 + rnd() * (th.maxZ - th.minZ - 1.2)])
    return out
  }, [th])
  const starGeo = useMemo(() => new THREE.CircleGeometry(0.018, 8), [])
  return (
    <group>
      <Box min={[th.minX, -0.1, th.minZ]} max={[th.maxX, 0, th.maxZ]} material={carpetMat} cast={false} />
      <Box min={[th.minX - T, th.height, th.minZ - T]} max={[th.maxX, th.height + ROOF_T, th.maxZ + T]} material={fabricMat} />
      <Box min={[th.minX, 0, th.minZ]} max={[th.minX + 0.05, th.height, th.maxZ]} material={screenWallMat} cast={false} />
      {panels.map((p, i) => (
        <Box key={i} min={p.min} max={p.max} material={fabricMat} cast={false} />
      ))}
      {/* aisle step lights */}
      <Box min={[th.minX + 1.5, 0.001, th.maxZ - 1.25]} max={[th.maxX - 0.3, 0.012, th.maxZ - 1.2]} material={stepLightMat} cast={false} />
      <Box min={[th.minX + 1.5, 0.001, th.minZ + 1.2]} max={[th.maxX - 0.3, 0.012, th.minZ + 1.25]} material={stepLightMat} cast={false} />
      {stars.map((p, i) => (
        <mesh key={i} geometry={starGeo} material={starMat} position={p} rotation={[Math.PI / 2, 0, 0]} raycast={() => null} />
      ))}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Craft Workshop Hall                                                 */
/* ------------------------------------------------------------------ */

const shadeMat = new THREE.MeshStandardMaterial({ color: '#2b2a28', metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide })
const bulbMat = new THREE.MeshStandardMaterial({ color: '#fff3dc', emissive: new THREE.Color('#ffd9a0'), emissiveIntensity: 3 })

function Pendant({ x, z, drop }: { x: number; z: number; drop: number }) {
  const top = W.workshop.height
  const y = top - drop
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, (top + y) / 2, 0]} material={shadeMat}>
        <cylinderGeometry args={[0.006, 0.006, top - y, 6]} />
      </mesh>
      <mesh position={[0, y - 0.12, 0]} material={shadeMat} castShadow={false}>
        <coneGeometry args={[0.26, 0.28, 24, 1, true]} />
      </mesh>
      <mesh position={[0, y - 0.2, 0]} material={bulbMat}>
        <sphereGeometry args={[0.06, 12, 8]} />
      </mesh>
      <PooledLight position={[x, y - 0.25, z]} target={[x, 0.86, z]} intensity={26} angle={0.75} color={WARM} />
    </group>
  )
}

function pendantSpots(): [number, number][] {
  const out: [number, number][] = []
  for (const o of SCENE_OBJECTS) {
    if (o.zone !== 'workshop' || !o.interactive || !o.footprint) continue
    const [x, , z] = o.position
    const long = Math.max(o.footprint[0], o.footprint[1])
    if (long > 3) {
      const r = (((o.rotationDeg ?? 0) * Math.PI) / 180) as number
      const ax = Math.cos(r)
      const az = -Math.sin(r)
      const off = long / 4
      out.push([x - ax * off, z - az * off], [x + ax * off, z + az * off])
    } else out.push([x, z])
  }
  return out.slice(0, 14)
}

function Workshop() {
  const m = useMaterials()
  const ws = W.workshop
  const concrete = useMemo(() => {
    const s = (m.stone as THREE.MeshStandardMaterial).clone()
    s.color = new THREE.Color('#c9c3b9')
    s.roughness = 0.62
    return s
  }, [m.stone])
  const lights = useMemo<Rect[]>(() => {
    const out: Rect[] = []
    const n = 4
    for (let i = 0; i < n; i++) {
      const cz = ws.minZ + ((ws.maxZ - ws.minZ) * (i + 0.5)) / n
      out.push({ minX: ws.minX + 1.6, maxX: ws.maxX - 1.6, minZ: cz - 0.9, maxZ: cz + 0.9 })
    }
    return out
  }, [ws])
  const trussZ = useMemo(() => {
    const out: number[] = []
    for (let z = ws.minZ + 1.5; z < ws.maxZ - 0.5; z += 3) out.push(z)
    return out
  }, [ws])
  const outer = useMemo<Rect>(() => ({ minX: ws.minX, maxX: ws.maxX, minZ: ws.minZ, maxZ: ws.maxZ }), [ws])
  return (
    <group>
      <Box min={[ws.minX, -0.1, ws.minZ]} max={[ws.maxX, 0, ws.maxZ]} material={concrete} cast={false} />
      <Slab outer={outer} openings={lights} y={ws.height} thickness={ROOF_T} material={m.timberCeiling} />
      {lights.map((r, i) => (
        <RoofLight key={i} r={r} y={ws.height} well={0.7} glass={m.glass} plaster={m.plasterCeiling} />
      ))}
      {/* exposed steel trusses */}
      {trussZ.map((z) => (
        <group key={z}>
          <Box min={[ws.minX, ws.height - 0.34, z - 0.06]} max={[ws.maxX, ws.height - 0.3, z + 0.06]} material={m.trackBlack} />
          <Box min={[ws.minX, ws.height - 0.06, z - 0.06]} max={[ws.maxX, ws.height, z + 0.06]} material={m.trackBlack} />
          <Box min={[ws.minX, ws.height - 0.32, z - 0.012]} max={[ws.maxX, ws.height - 0.04, z + 0.012]} material={m.trackBlack} />
        </group>
      ))}
      {/* pendants over the workshop's interactive installations (long tables get two) */}
      {pendantSpots().map(([x, z]) => (
        <Pendant key={`${x.toFixed(2)}-${z.toFixed(2)}`} x={x} z={z} drop={ws.height - 3.4} />
      ))}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Dye Garden Courtyard                                                */
/* ------------------------------------------------------------------ */

function Courtyard() {
  const m = useMaterials()
  const c = W.courtyard
  const gravel = useMemo(() => {
    const s = (m.stone as THREE.MeshStandardMaterial).clone()
    s.color = new THREE.Color('#d9d0c2')
    return s
  }, [m.stone])
  return (
    <group>
      <Box min={[c.minX, -0.1, c.minZ]} max={[c.maxX, 0, c.maxZ + 0.3]} material={gravel} cast={false} />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Gallery D — regional gallery (west, north row)                      */
/* ------------------------------------------------------------------ */

function GalleryD() {
  const m = useMaterials()
  const g = W.galleryD
  const lights = useMemo<Rect[]>(() => {
    const out: Rect[] = []
    const cx = (g.minX + g.maxX) / 2
    const n = 3
    for (let i = 0; i < n; i++) {
      const cz = g.minZ + ((g.maxZ - g.minZ) * (i + 0.5)) / n
      out.push({ minX: cx - 3.2, maxX: cx + 3.2, minZ: cz - 2.6, maxZ: cz + 2.6 })
    }
    return out
  }, [g])
  const outer = useMemo<Rect>(() => ({ minX: g.minX, maxX: g.maxX, minZ: g.minZ, maxZ: g.maxZ }), [g])
  return (
    <group>
      <Box min={[g.minX, -0.1, g.minZ]} max={[g.maxX, 0, g.maxZ]} material={m.oakFloor} cast={false} />
      <Slab outer={outer} openings={lights} y={g.height} thickness={ROOF_T} material={m.plasterCeiling} />
      {lights.map((r, i) => (
        <RoofLight key={i} r={r} y={g.height} well={1.1} glass={m.glass} plaster={m.plasterCeiling} />
      ))}
      {/* shadow-gap skirting around the room */}
      <Box min={[g.minX, 0, g.minZ]} max={[g.maxX, 0.022, g.minZ + 0.004]} material={m.shadowGap} cast={false} />
      <Box min={[g.minX, 0, g.minZ]} max={[g.minX + 0.004, 0.022, g.maxZ]} material={m.shadowGap} cast={false} />
    </group>
  )
}

/** Continuous stone coping on the 10 m perimeter: the compound reads as one pure cuboid. */
function ShellCoping() {
  const m = useMaterials()
  const s = W.shell
  const y = s.height
  const t = T + 0.06
  return (
    <group>
      <Box min={[s.minX - t, y, s.minZ - t]} max={[s.maxX + t, y + 0.12, s.minZ + 0.06]} material={m.stone} />
      <Box min={[s.minX - t, y, s.maxZ - 0.06]} max={[s.maxX + t, y + 0.12, s.maxZ + t]} material={m.stone} />
      <Box min={[s.minX - t, y, s.minZ - t]} max={[s.minX + 0.06, y + 0.12, s.maxZ + t]} material={m.stone} />
      <Box min={[s.maxX - 0.06, y, s.minZ - t]} max={[s.maxX + t, y + 0.12, s.maxZ + t]} material={m.stone} />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Forecourt & landscape (seen through the atrium facade)              */
/* ------------------------------------------------------------------ */

const lawnMat = new THREE.MeshStandardMaterial({ color: '#8a9a62', roughness: 1 })
const hedgeMat = new THREE.MeshStandardMaterial({ color: '#56683f', roughness: 1 })

function Forecourt() {
  const m = useMaterials()
  const a = W.atrium
  const paving = useMemo(() => {
    const s = (m.stone as THREE.MeshStandardMaterial).clone()
    s.color = new THREE.Color('#e4dccf')
    return s
  }, [m.stone])
  const z0 = a.maxZ + T
  return (
    <group>
      {/* paved forecourt */}
      <Box min={[-16, -0.03, z0]} max={[16, 0, z0 + 14]} material={paving} cast={false} />
      {/* lawns either side of the approach and beyond */}
      <Box min={[-70, -0.03, z0 + 14]} max={[70, -0.005, 90]} material={lawnMat} cast={false} />
      <Box min={[-70, -0.03, -60]} max={[-16, -0.005, z0 + 14]} material={lawnMat} cast={false} />
      <Box min={[16, -0.03, z0]} max={[70, -0.005, z0 + 14]} material={lawnMat} cast={false} />
      {/* clipped hedges framing the forecourt */}
      <Box min={[-16, 0, z0 + 13.4]} max={[-3.5, 1.1, z0 + 14.2]} material={hedgeMat} />
      <Box min={[3.5, 0, z0 + 13.4]} max={[16, 1.1, z0 + 14.2]} material={hedgeMat} />
      <Box min={[-16.8, 0, z0]} max={[-16, 1.1, z0 + 14.2]} material={hedgeMat} />
      <Box min={[16, 0, z0]} max={[16.8, 1.1, z0 + 14.2]} material={hedgeMat} />
    </group>
  )
}

/* ------------------------------------------------------------------ */

export function Wings() {
  const tier = useMuseum((s) => s.tier)
  const preset = withDevOverrides(QUALITY_PRESETS[tier])
  return (
    <group>
      <ZoneGroup zones={['atrium', 'reception', 'theatre', 'workshop']}>
        <StaticMerge name="atrium">
          <Atrium />
          <Forecourt />
        </StaticMerge>
      </ZoneGroup>
      <ZoneGroup zones={['theatre']}>
        <StaticMerge name="theatre">
          <Theatre />
        </StaticMerge>
      </ZoneGroup>
      <ZoneGroup zones={['workshop', 'courtyard']}>
        <StaticMerge name="workshop">
          <Workshop />
        </StaticMerge>
      </ZoneGroup>
      <ZoneGroup zones={['courtyard']}>
        <StaticMerge name="courtyard">
          <Courtyard />
        </StaticMerge>
      </ZoneGroup>
      <ZoneGroup zones={['gallery-d', 'theatre']}>
        <StaticMerge name="gallery-d">
          <GalleryD />
        </StaticMerge>
      </ZoneGroup>
      <ZoneGroup zones={['atrium', 'courtyard']}>
        <Landscape />
      </ZoneGroup>
      <StaticMerge name="coping">
        <ShellCoping />
      </StaticMerge>
      {preset.areaLights && <WingAreaLights />}
    </group>
  )
}

/** One soft daylight area light per top-lit wing (fixed count → stable shaders). */
function WingAreaLights() {
  const a = W.atrium
  const ws = W.workshop
  const day = kelvinToHex(6500)
  return (
    <>
      <rectAreaLight
        position={[0, a.height - 0.05, (a.minZ + a.maxZ) / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        width={a.maxX - a.minX - 2}
        height={a.maxZ - a.minZ - 2}
        intensity={1.6}
        color={day}
      />
      <rectAreaLight
        position={[(ws.minX + ws.maxX) / 2, ws.height - 0.4, (ws.minZ + ws.maxZ) / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        width={ws.maxX - ws.minX - 2}
        height={ws.maxZ - ws.minZ - 2}
        intensity={1.4}
        color={day}
      />
    </>
  )
}
