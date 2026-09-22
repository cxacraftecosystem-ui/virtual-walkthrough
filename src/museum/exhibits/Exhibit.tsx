/**
 * Hand-block display table placed beside its artwork:
 *   carved block (tool)  →  impression swatch (process)  →  artwork on the wall (finished textile)
 * Clicking the block opens the 3D inspection viewer; clicking the table opens its information.
 */
import type { ThreeEvent } from '@react-three/fiber'
import { Suspense, useEffect, useMemo } from 'react'
import { DISPLAY_TABLE, type ExhibitConfig } from '../config/exhibits'
import { LIGHTING } from '../config/lighting'
import type { Vec3 } from '../config/museum'
import { QUALITY_PRESETS, withDevOverrides } from '../config/quality'
import { registerItem } from '../interaction/registry'
import { TrackSpot } from '../lighting/TrackLight'
import { mountFor } from '../lighting/tracks'
import { createMeterBoxGeometry } from '../materials/geometry'
import { useMaterials } from '../materials/materials'
import { createLabelTexture } from '../materials/wallGraphics'
import { focusOn } from '../navigation/focus'
import { useMuseum } from '../state/store'
import { ErrorBoundary } from '../utils/ErrorBoundary'
import { useAsyncTexture } from '../utils/useAsyncTexture'
import { Artifact3D } from './Artifact3D'
import { ImpressionSwatch } from './ImpressionSwatch'
import { tablePlacement } from './placement'

const T = DISPLAY_TABLE

function DisplayTable() {
  const m = useMaterials()
  const top = useMemo(() => createMeterBoxGeometry(T.length, 0.04, T.depth), [])
  const base = useMemo(() => createMeterBoxGeometry(T.length - 0.14, T.height - 0.06, T.depth - 0.14), [])
  const gap = useMemo(() => createMeterBoxGeometry(T.length - 0.18, 0.03, T.depth - 0.18), [])
  return (
    <group>
      <mesh geometry={top} material={m.timber} position={[0, T.height - 0.02, 0]} castShadow receiveShadow />
      <mesh geometry={base} material={m.timber} position={[0, (T.height - 0.06) / 2 + 0.02, 0]} castShadow receiveShadow />
      <mesh geometry={gap} material={m.shadowGap} position={[0, 0.015, 0]} receiveShadow />
    </group>
  )
}

function TableLabel({ exhibit }: { exhibit: ExhibitConfig }) {
  const tex = useAsyncTexture(
    () =>
      createLabelTexture(
        [
          { text: exhibit.title, style: 'title' },
          { text: exhibit.placeholder ? 'Placeholder block · click to inspect' : 'Click to inspect in 3D', style: 'meta' },
        ],
        0.16,
        0.07,
      ),
    [exhibit.title, exhibit.placeholder],
  )
  if (!tex) return null
  return (
    <mesh position={[0.28, T.height + 0.003, T.depth / 2 - 0.07]} rotation={[-Math.PI / 2 + 0.35, 0, 0]}>
      <boxGeometry args={[0.16, 0.07, 0.003]} />
      <meshStandardMaterial map={tex} roughness={0.85} />
    </mesh>
  )
}

export function Exhibit({ exhibit }: { exhibit: ExhibitConfig }) {
  const tier = useMuseum((s) => s.tier)
  const preset = withDevOverrides(QUALITY_PRESETS[tier])
  const inspect = useMuseum((s) => s.inspect)
  const select = useMuseum((s) => s.select)
  const place = useMemo(() => tablePlacement(exhibit), [exhibit])
  const [px, , pz] = place.position
  const nx = Math.sin(place.rotationY)
  const nz = Math.cos(place.rotationY)

  useEffect(
    () =>
      registerItem({
        id: exhibit.id,
        kind: 'exhibit',
        title: exhibit.title,
        center: [px, T.height + 0.1, pz],
        normal: [nx, 0, nz],
        size: [T.length, 0.5],
        viewDistance: 1.35,
      }),
    [exhibit.id, exhibit.title, px, pz, nx, nz],
  )

  const spot = useMemo(() => {
    const mount = mountFor(exhibit.placement.surface, exhibit.placement.at)
    const target: Vec3 = [px, T.height, pz]
    const dist = Math.hypot(mount[0] - px, mount[1] - T.height, mount[2] - pz)
    return { mount, target, intensity: LIGHTING.track.tableIntensity * (dist / 3.4) ** 2, angle: Math.atan(0.62 / dist) * 1.3 }
  }, [exhibit.placement.surface, exhibit.placement.at, px, pz])

  const onBlockClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (e.delta > 6 || useMuseum.getState().phase !== 'entered') return
    inspect(exhibit.id)
  }
  const onTableClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (e.delta > 6 || useMuseum.getState().phase !== 'entered') return
    select({ kind: 'exhibit', id: exhibit.id })
    focusOn('exhibit', exhibit.id)
  }
  const pointer = (on: boolean) => (e: ThreeEvent<PointerEvent>) => {
    if (on) e.stopPropagation()
    document.body.style.cursor = on ? 'pointer' : ''
  }

  return (
    <group>
      <group position={place.position} rotation={[0, place.rotationY, 0]}>
        <group onClick={onTableClick} onPointerOver={pointer(true)} onPointerOut={pointer(false)}>
          <DisplayTable />
          <TableLabel exhibit={exhibit} />
          <group position={[0.14, T.height, -0.02]}>
            <ImpressionSwatch motif={exhibit.placeholderMotif} inkColor={exhibit.inkColor} size={[0.3, 0.24]} />
          </group>
        </group>
        <group position={[-0.2, T.height, -0.02]} onClick={onBlockClick} onPointerOver={pointer(true)} onPointerOut={pointer(false)}>
          <ErrorBoundary fallback={null}>
            <Suspense fallback={null}>
              <Artifact3D exhibit={exhibit} />
            </Suspense>
          </ErrorBoundary>
        </group>
      </group>
      {preset.tableSpots && <TrackSpot position={spot.mount} target={spot.target} intensity={spot.intensity} angle={spot.angle} />}
    </group>
  )
}
