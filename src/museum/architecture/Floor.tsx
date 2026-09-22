/**
 * Soft light-oak floor (gallery + reception) with click-to-walk and a subtle
 * floor cursor. On Ultra the oak receives real-time blurred planar reflections.
 */
import { MeshReflectorMaterial } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { KEY, MUSEUM } from '../config/museum'
import { QUALITY_PRESETS, withDevOverrides } from '../config/quality'
import { createMeterBoxGeometry } from '../materials/geometry'
import { useMaterials } from '../materials/materials'
import { walkTo } from '../navigation/focus'
import { useMuseum } from '../state/store'

const T = MUSEUM.walls.exteriorThickness
const FLOOR_T = 0.1

function isFirstHit(e: ThreeEvent<PointerEvent | MouseEvent>) {
  return e.intersections.length > 0 && e.intersections[0].object === e.object
}

function FloorCursor({ cursor }: { cursor: React.RefObject<THREE.Mesh | null> }) {
  useFrame(() => {
    const c = cursor.current
    if (!c) return
    const mat = c.material as THREE.MeshBasicMaterial
    const target = c.userData.visible ? 0.55 : 0
    mat.opacity += (target - mat.opacity) * 0.2
    c.visible = mat.opacity > 0.01
  })
  return null
}

export function Floor() {
  const m = useMaterials()
  const tier = useMuseum((s) => s.tier)
  const reflect = withDevOverrides(QUALITY_PRESETS[tier]).floorReflections
  const cursor = useRef<THREE.Mesh>(null)

  const gallery = useMemo(() => {
    const w = KEY.gx * 2 + T * 2
    const l = -KEY.gzNorth + T + KEY.rzNorth
    return { geo: createMeterBoxGeometry(w, FLOOR_T, l), pos: [0, -FLOOR_T / 2, (KEY.gzNorth - T + KEY.rzNorth) / 2] as [number, number, number] }
  }, [])
  const reception = useMemo(() => {
    const w = KEY.rx * 2 + T * 2
    const l = KEY.rzSouth + T - KEY.rzNorth
    return { geo: createMeterBoxGeometry(w, FLOOR_T, l), pos: [0, -FLOOR_T / 2, (KEY.rzSouth + T + KEY.rzNorth) / 2] as [number, number, number] }
  }, [])

  const oak = m.oakFloor as THREE.MeshStandardMaterial

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const c = cursor.current
    if (!c) return
    const first = isFirstHit(e)
    c.userData.visible = first && e.pointerType === 'mouse'
    if (first) c.position.set(e.point.x, 0.004, e.point.z)
  }
  const onOut = () => {
    if (cursor.current) cursor.current.userData.visible = false
  }
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6 || !isFirstHit(e)) return
    if (useMuseum.getState().phase !== 'entered') return
    walkTo(e.point.x, e.point.z)
  }

  const handlers = { onPointerMove: onMove, onPointerOut: onOut, onClick }

  return (
    <group>
      {[gallery, reception].map((f, i) => (
        <mesh key={i} geometry={f.geo} position={f.pos} receiveShadow {...handlers} material={reflect ? undefined : oak}>
          {reflect && (
            <MeshReflectorMaterial
              map={oak.map}
              normalMap={oak.normalMap}
              normalScale={new THREE.Vector2(0.3, 0.3)}
              roughnessMap={oak.roughnessMap}
              roughness={0.55}
              color={oak.color}
              metalness={0}
              blur={[400, 120]}
              resolution={1024}
              mixBlur={1.2}
              mixStrength={0.9}
              mixContrast={1}
              depthScale={0.6}
              minDepthThreshold={0.3}
              maxDepthThreshold={1.3}
              mirror={0.35}
              envMapIntensity={0.6}
            />
          )}
        </mesh>
      ))}
      <mesh ref={cursor} rotation={[-Math.PI / 2, 0, 0]} visible={false} raycast={() => null} renderOrder={2}>
        <ringGeometry args={[0.2, 0.235, 48]} />
        <meshBasicMaterial color="#fffaf0" transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>
      <FloorCursor cursor={cursor} />
    </group>
  )
}

/** Exterior paving glimpsed through the entrance doors. */
export function ExteriorGround() {
  const m = useMaterials()
  const geo = useMemo(() => createMeterBoxGeometry(200, 0.02, 200), [])
  return <mesh geometry={geo} material={m.stone} position={[0, -0.035, 0]} receiveShadow raycast={() => null} />

}
