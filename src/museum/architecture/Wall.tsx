import { useMemo } from 'react'
import type * as THREE from 'three'
import type { WallBox } from '../config/layout'
import { MUSEUM } from '../config/museum'
import { createMeterBoxGeometry } from '../materials/geometry'
import { useMaterials } from '../materials/materials'

interface WallProps {
  wall: WallBox
  material?: THREE.Material
  /** Dark recessed shadow-gap line at the floor junction. */
  shadowGap?: boolean
}

/** A plaster wall block defined by its min/max corners (metres). */
export function Wall({ wall, material, shadowGap = true }: WallProps) {
  const m = useMaterials()
  const [sx, sy, sz] = [wall.max[0] - wall.min[0], wall.max[1] - wall.min[1], wall.max[2] - wall.min[2]]
  const center: [number, number, number] = [
    (wall.min[0] + wall.max[0]) / 2,
    (wall.min[1] + wall.max[1]) / 2,
    (wall.min[2] + wall.max[2]) / 2,
  ]
  const geo = useMemo(() => createMeterBoxGeometry(sx, sy, sz), [sx, sy, sz])
  const gapH = MUSEUM.walls.shadowGapHeight
  const gapGeo = useMemo(() => createMeterBoxGeometry(sx + 0.004, gapH, sz + 0.004), [sx, sz, gapH])
  const onFloor = wall.min[1] <= 0.001
  return (
    <group>
      <mesh geometry={geo} material={material ?? m.plaster} position={center} castShadow receiveShadow />
      {shadowGap && onFloor && (
        <mesh geometry={gapGeo} material={m.shadowGap} position={[center[0], gapH / 2, center[2]]} receiveShadow />
      )}
    </group>
  )
}
