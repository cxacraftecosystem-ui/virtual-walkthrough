/**
 * TrackRail + TrackSpot: visible 3000K track fixtures with a real SpotLight.
 * The fixture head is oriented at its target; the light has no shadow map
 * (cones are tight and aimed at walls, so leakage is negligible and cheap).
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Vec3 } from '../config/museum'
import { kelvinToHex, LIGHTING } from '../config/lighting'
import { useMaterials } from '../materials/materials'
import type { Rail } from './tracks'
import { RAIL_Y } from './tracks'
import { registerSpot } from './SpotPool'

const headGeo = new THREE.CylinderGeometry(0.032, 0.036, 0.13, 20, 1, false)
headGeo.rotateX(Math.PI / 2) // axis along z
const lensGeo = new THREE.CircleGeometry(0.027, 20)
const stemGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.09, 8)
const adapterGeo = new THREE.BoxGeometry(0.05, 0.03, 0.05)

export const TRACK_COLOR = kelvinToHex(LIGHTING.track.colorK, LIGHTING.track.chromaticAdaptation)

const lensMat = new THREE.MeshStandardMaterial({
  color: '#fff6e8',
  emissive: new THREE.Color(TRACK_COLOR),
  emissiveIntensity: 3.2,
  roughness: 0.4,
  toneMapped: true,
})

export function TrackRail({ rail }: { rail: Rail }) {
  const m = useMaterials()
  const { position, length, rotY } = useMemo(() => {
    const a = new THREE.Vector3(...rail.from)
    const b = new THREE.Vector3(...rail.to)
    const mid = a.clone().add(b).multiplyScalar(0.5)
    const d = b.clone().sub(a)
    return { position: mid.toArray() as Vec3, length: d.length(), rotY: Math.atan2(d.x, d.z) }
  }, [rail])
  return (
    <mesh position={position} rotation={[0, rotY, 0]} material={m.trackBlack}>
      <boxGeometry args={[0.035, 0.022, length]} />
    </mesh>
  )
}

interface TrackSpotProps {
  position: Vec3
  target: Vec3
  intensity: number
  /** Full cone half-angle (rad). */
  angle: number
  penumbra?: number
  color?: string
  /** Render the light itself (false = fixture only, e.g. on low quality). */
  lit?: boolean
}

export function TrackSpot({ position, target, intensity, angle, penumbra = LIGHTING.track.penumbra, color = TRACK_COLOR, lit = true }: TrackSpotProps) {
  const m = useMaterials()
  const head = useRef<THREE.Group>(null)
  const [px, py, pz] = position
  const [tx, ty, tz] = target

  useLayoutEffect(() => {
    head.current?.lookAt(new THREE.Vector3(tx, ty, tz))
  }, [tx, ty, tz])

  // The actual light comes from the shared SpotPool (see SpotPool.tsx).
  useEffect(() => {
    if (!lit) return
    return registerSpot({ position: [px, py, pz], target: [tx, ty, tz], intensity, angle, penumbra, color })
  }, [lit, px, py, pz, tx, ty, tz, intensity, angle, penumbra, color])

  // Gallery heads hang from the track rail; heads mounted higher (taller wings) get a short monopoint stem.
  const railTop = py < RAIL_Y - 0.02 ? RAIL_Y : py + 0.14
  const stemLen = Math.max(0.02, railTop - 0.011 - py)

  return (
    <group>
      {/* stem from rail adapter to head pivot */}
      <mesh position={[px, railTop - 0.026, pz]} geometry={adapterGeo} material={m.trackBlack} />
      <mesh position={[px, py + stemLen / 2, pz]} scale={[1, stemLen / 0.09, 1]} geometry={stemGeo} material={m.trackBlack} />
      <group ref={head} position={position}>
        <mesh geometry={headGeo} material={m.trackBlack} position={[0, 0, 0.02]} castShadow={false} />
        <mesh geometry={lensGeo} material={lensMat} position={[0, 0, 0.0855]} />
      </group>
    </group>
  )
}

/** Cone half-angle that covers a rectangle of size w×h at a given distance, with soft margin. */
export function coverAngle(w: number, h: number, distance: number, spread = 1) {
  const radius = Math.hypot(w / 2, h / 2)
  return Math.min(Math.PI / 3, Math.atan(radius / Math.max(0.3, distance)) * 1.6 * spread)
}
