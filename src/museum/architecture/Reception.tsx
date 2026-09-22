/**
 * Entrance & reception (10' x 15', GA-101): lower plaster ceiling with downlights,
 * a portal onto the Grand Atrium (v2), timber reception desk and the
 * orientation / welcome wall.
 */
import { useMemo } from 'react'
import * as THREE from 'three'
import { KEY, MUSEUM } from '../config/museum'
import { RECEPTION_DESK, surfacePoint } from '../config/layout'
import { createMeterBoxGeometry } from '../materials/geometry'
import { useMaterials } from '../materials/materials'
import { createWelcomeTexture } from '../materials/wallGraphics'
import { useAsyncTexture } from '../utils/useAsyncTexture'
import { kelvinToHex } from '../config/lighting'

const RH = MUSEUM.reception.ceilingHeight
const T = MUSEUM.walls.exteriorThickness

const downlightMat = new THREE.MeshStandardMaterial({
  color: '#fff8ee',
  emissive: new THREE.Color(kelvinToHex(3000, 0.35)),
  emissiveIntensity: 2.6,
})

function Box({ size, position, material, cast = true }: { size: [number, number, number]; position: [number, number, number]; material: THREE.Material; cast?: boolean }) {
  const geo = useMemo(() => createMeterBoxGeometry(...size), [size[0], size[1], size[2]]) // eslint-disable-line react-hooks/exhaustive-deps
  return <mesh geometry={geo} material={material} position={position} castShadow={cast} receiveShadow />
}

function Desk() {
  const m = useMaterials()
  const d = RECEPTION_DESK
  return (
    <group position={[d.x, 0, d.z]}>
      <Box size={[d.depth - 0.06, d.height - 0.04, d.length - 0.06]} position={[0.03, (d.height - 0.04) / 2, 0]} material={m.timber} />
      <Box size={[d.depth, 0.04, d.length]} position={[0, d.height - 0.02, 0]} material={m.deskTop} />
      {/* recessed plinth shadow */}
      <Box size={[d.depth - 0.1, 0.06, d.length - 0.1]} position={[0.05, 0.03, 0]} material={m.shadowGap} cast={false} />
    </group>
  )
}

function WelcomeWall() {
  const w = 2.3
  const h = 1.55
  const tex = useAsyncTexture(() => createWelcomeTexture(w, h), [])
  const p = surfacePoint('reception-west', KEY.rzNorth + MUSEUM.reception.length * 0.55, 1.55, 0.003)
  if (!tex) return null
  return (
    <mesh position={p.position} rotation={[0, p.rotationY, 0]} raycast={() => null}>
      <planeGeometry args={[w, h]} />
      <meshStandardMaterial map={tex} transparent roughness={0.9} polygonOffset polygonOffsetFactor={-2} depthWrite={false} />
    </mesh>
  )
}

export function Reception() {
  const m = useMaterials()
  const len = MUSEUM.reception.length
  const midZ = KEY.rzNorth + len / 2
  return (
    <group>
      {/* ceiling + roof */}
      <Box size={[KEY.rx * 2, 0.04, len]} position={[0, RH + 0.02, midZ]} material={m.plasterCeiling} />
      <Box size={[KEY.rx * 2 + T * 2, 0.3, len + T]} position={[0, RH + 0.19, midZ + T / 2]} material={m.plaster} />
      {/* recessed downlights */}
      {[0.28, 0.5, 0.72].map((f) => (
        <mesh key={f} position={[0, RH - 0.002, KEY.rzNorth + len * f]} rotation={[Math.PI / 2, 0, 0]} material={downlightMat}>
          <circleGeometry args={[0.07, 24]} />
        </mesh>
      ))}
      <Desk />
      <WelcomeWall />
    </group>
  )
}
