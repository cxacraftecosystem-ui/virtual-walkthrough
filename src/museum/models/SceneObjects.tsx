/**
 * <SceneObjects/> — renders every SCENE_OBJECTS entry (craft installations, furniture,
 * CC0 props) at its position / rotation.
 *
 *  - `model` set → GLB via <GLTFModel/> inside ErrorBoundary + Suspense; the procedural
 *    `kind` is shown while it loads and if it is missing / fails.
 *  - interactive → invisible hit box (cheap raycasts, no per-leaf picking), pointer
 *    cursor + a soft floor halo on hover, click → select + walk-to (focusOn).
 *  - inspectable → the information panel offers the 3D viewer: inspect('object:<id>').
 */
import type { ThreeEvent } from '@react-three/fiber'
import { ZoneGroup } from '../navigation/zoneCulling'
import { ZONES, type ZoneId } from '../config/layout'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { MUSEUM, type Vec3 } from '../config/museum'
import { SCENE_OBJECTS, type SceneObjectConfig } from '../config/objects'
import { registerItem } from '../interaction/registry'
import { focusOn } from '../navigation/focus'
import { useMuseum } from '../state/store'
import { ErrorBoundary } from '../utils/ErrorBoundary'
import { GLTFModel, preloadModel } from './GLTFModel'
import { PROCEDURAL_MODELS } from './index'
import { ModelClock } from './modelMaterials'
import { InMuseumScene } from './sceneContext'
import { num } from './types'

/** Prefix used with `inspect()` to open a scene object (rather than an exhibit) in the 3D viewer. */
export const OBJECT_INSPECT_PREFIX = 'object:'

// start fetching GLBs as soon as the scene module loads (browser only — safe under SSR)
if (typeof window !== 'undefined') for (const url of new Set(SCENE_OBJECTS.map((o) => (o.kind === 'splat' ? undefined : o.model)).filter((u): u is string => !!u))) preloadModel(url)

/** Default heights (m) for kinds whose config usually omits `height`. */
const DEFAULT_HEIGHT: Partial<Record<SceneObjectConfig['kind'], number>> = {
  'garden-bench': 0.45,
  'theatre-seating': 1.1,
  speaker: 0.5,
}

/** Local-space bounds of an object's visible volume: [centre, size]. */
export function objectBounds(o: SceneObjectConfig): { center: Vec3; size: Vec3 } {
  const [fx, fz] = o.footprint ?? [0.8, 0.8]
  const h = o.height ?? DEFAULT_HEIGHT[o.kind] ?? 1
  if (o.kind === 'textile-banner') {
    const w = num(o, 'width', 1.3)
    return { center: [0, -0.06 - h / 2, 0], size: [w, h, 0.12] }
  }
  return { center: [0, h / 2, 0], size: [fx, h, fz] }
}

/** The object's model (GLB with procedural fallback) in local space — also used by the 3D viewer. */
export function ObjectModel({ config }: { config: SceneObjectConfig }) {
  const Procedural = PROCEDURAL_MODELS[config.kind]
  const fallback = Procedural ? <Procedural config={config} /> : null
  // 'splat' reads its own `model` (a Gaussian splat, not a GLB)
  if (!config.model || config.kind === 'splat') return fallback
  return (
    <ErrorBoundary key={config.model} fallback={fallback}>
      <Suspense fallback={fallback}>
        <GLTFModel url={config.model} scale={config.modelScale} height={config.height} />
      </Suspense>
    </ErrorBoundary>
  )
}

/* ------------------------------------------------------------------ */
/* Interaction                                                         */
/* ------------------------------------------------------------------ */

function wingCentre(zone: SceneObjectConfig['zone']): [number, number] {
  const w = ZONES.find((z) => z.id === zone)?.rect ?? MUSEUM.wings.atrium
  return [(w.minX + w.maxX) / 2, (w.minZ + w.maxZ) / 2]
}

/**
 * Viewing normal: of the object's four sides (front +z preferred), the one that faces
 * most toward the middle of its room — i.e. toward the aisle, not the wall.
 */
function viewingNormal(o: SceneObjectConfig): Vec3 {
  const rot = THREE.MathUtils.degToRad(o.rotationDeg ?? 0)
  const [cx, cz] = wingCentre(o.zone)
  const dx = cx - o.position[0]
  const dz = cz - o.position[2]
  const len = Math.hypot(dx, dz) || 1
  let best: Vec3 = [Math.sin(rot), 0, Math.cos(rot)]
  let score = -Infinity
  const sides: [number, number, number][] = [
    [0, 1, 0.35], // local +z (front) with a preference bonus
    [0, -1, 0],
    [1, 0, 0],
    [-1, 0, 0],
  ]
  for (const [lx, lz, bonus] of sides) {
    const wx = lx * Math.cos(rot) + lz * Math.sin(rot)
    const wz = -lx * Math.sin(rot) + lz * Math.cos(rot)
    const s = (wx * dx + wz * dz) / len + bonus
    if (s > score) {
      score = s
      best = [wx, 0, wz]
    }
  }
  return best
}

/** Rounded-rectangle ring (floor halo) around a footprint. */
function haloGeometry(w: number, d: number) {
  const rr = (sw: number, sd: number, r: number) => {
    const s = new THREE.Shape()
    const x = -sw / 2
    const y = -sd / 2
    s.moveTo(x + r, y)
    s.lineTo(x + sw - r, y)
    s.quadraticCurveTo(x + sw, y, x + sw, y + r)
    s.lineTo(x + sw, y + sd - r)
    s.quadraticCurveTo(x + sw, y + sd, x + sw - r, y + sd)
    s.lineTo(x + r, y + sd)
    s.quadraticCurveTo(x, y + sd, x, y + sd - r)
    s.lineTo(x, y + r)
    s.quadraticCurveTo(x, y, x + r, y)
    return s
  }
  const outer = rr(w + 0.34, d + 0.34, 0.16)
  const inner = rr(w + 0.22, d + 0.22, 0.1)
  outer.holes.push(inner)
  const g = new THREE.ShapeGeometry(outer, 6)
  g.rotateX(-Math.PI / 2)
  return g
}

const hitMaterial = new THREE.MeshBasicMaterial({ visible: false })

function Halo({ w, d }: { w: number; d: number }) {
  const geo = useMemo(() => haloGeometry(w, d), [w, d])
  const mat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#f7e6c4', transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
    [],
  )
  useFrame((_, dt) => {
    mat.opacity = Math.min(0.42, mat.opacity + dt * 2.2)
  })
  useEffect(
    () => () => {
      geo.dispose()
      mat.dispose()
    },
    [geo, mat],
  )
  return <mesh geometry={geo} material={mat} position={[0, 0.006, 0]} renderOrder={2} />
}

function InteractiveShell({ config }: { config: SceneObjectConfig }) {
  const select = useMuseum((s) => s.select)
  const setHovered = useMuseum((s) => s.setHovered)
  const [hover, setHover] = useState(false)
  const bounds = useMemo(() => objectBounds(config), [config])
  const hovering = useRef(false)

  useEffect(() => {
    const rot = THREE.MathUtils.degToRad(config.rotationDeg ?? 0)
    const [lx, ly, lz] = bounds.center
    const [px, py, pz] = config.position
    const center: Vec3 = [px + lx * Math.cos(rot) + lz * Math.sin(rot), py + ly, pz - lx * Math.sin(rot) + lz * Math.cos(rot)]
    const normal = viewingNormal(config)
    // visible width seen along the normal
    const along = Math.abs(normal[0] * Math.cos(rot) - normal[2] * Math.sin(rot)) > 0.5 // normal ∥ local x
    const width = along ? bounds.size[2] : bounds.size[0]
    const depth = along ? bounds.size[0] : bounds.size[2]
    return registerItem({
      id: config.id,
      kind: 'object',
      title: config.title,
      center: [center[0], Math.min(center[1], 1.2), center[2]],
      normal,
      size: [width, Math.min(bounds.size[1], 2.2)],
      viewDistance: Math.min(3.2, Math.max(1.8, depth / 2 + 1.3, width * 0.55 + 0.9)),
    })
  }, [config, bounds])

  useEffect(
    () => () => {
      if (hovering.current) document.body.style.cursor = ''
    },
    [],
  )

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (e.delta > 6 || useMuseum.getState().phase !== 'entered') return
    select({ kind: 'object', id: config.id })
    focusOn('object', config.id)
  }
  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    hovering.current = true
    setHover(true)
    setHovered({ kind: 'object', id: config.id })
    document.body.style.cursor = 'pointer'
  }
  const onOut = () => {
    hovering.current = false
    setHover(false)
    setHovered(null)
    document.body.style.cursor = ''
  }

  const showHalo = hover && config.kind !== 'textile-banner'
  return (
    <>
      <mesh position={bounds.center} material={hitMaterial} onClick={onClick} onPointerOver={onOver} onPointerOut={onOut}>
        <boxGeometry args={bounds.size} />
      </mesh>
      {showHalo && <Halo w={bounds.size[0]} d={bounds.size[2]} />}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

export function SceneObject({ config }: { config: SceneObjectConfig }) {
  const rot = THREE.MathUtils.degToRad(config.rotationDeg ?? 0)
  return (
    <group position={config.position} rotation={[0, rot, 0]} name={`object-${config.id}`}>
      <ErrorBoundary fallback={null}>
        <ObjectModel config={config} />
      </ErrorBoundary>
      {config.interactive && <InteractiveShell config={config} />}
    </group>
  )
}

export function SceneObjects() {
  const root = useRef<THREE.Group>(null)
  // debug/automation handle (like window.__museum): toggle visibility, count meshes
  useEffect(() => {
    const g = globalThis as { __sceneObjects?: THREE.Group | null }
    g.__sceneObjects = root.current
    return () => {
      g.__sceneObjects = null
    }
  }, [])
  return (
    <InMuseumScene.Provider value={true}>
      <group name="scene-objects" ref={root}>
        <ModelClock />
        {SCENE_OBJECTS.map((o) => (
          <ZoneGroup key={o.id} zones={[o.zone as ZoneId]}>
            <SceneObject config={o} />
          </ZoneGroup>
        ))}
      </group>
    </InMuseumScene.Provider>
  )
}
