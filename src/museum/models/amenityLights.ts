/**
 * Pooled accent lights for amenity models: a model describes a light in its own local
 * space; this converts it to world space (config position / rotation) and registers it
 * with the SpotPool — only inside the museum scene, never in the 3D inspector.
 */
import { useContext, useEffect } from 'react'
import type { SceneObjectConfig } from '../config/objects'
import type { Vec3 } from '../config/museum'
import { registerSpot } from '../lighting/SpotPool'
import { InMuseumScene } from './sceneContext'

export function toWorld(c: SceneObjectConfig, [lx, ly, lz]: Vec3): Vec3 {
  const r = ((c.rotationDeg ?? 0) * Math.PI) / 180
  const [px, py, pz] = c.position
  return [px + lx * Math.cos(r) + lz * Math.sin(r), py + ly, pz - lx * Math.sin(r) + lz * Math.cos(r)]
}

export interface LocalSpot {
  from: Vec3
  to: Vec3
  intensity: number
  angle: number
  penumbra?: number
  color?: string
}

export const WARM_3000 = '#ffd9a8'

export function useLocalSpots(config: SceneObjectConfig, spots: LocalSpot[]) {
  const inScene = useContext(InMuseumScene)
  const key = JSON.stringify(spots)
  useEffect(() => {
    if (!inScene) return
    const offs = spots.map((s) =>
      registerSpot({ position: toWorld(config, s.from), target: toWorld(config, s.to), intensity: s.intensity, angle: s.angle, penumbra: s.penumbra ?? 0.85, color: s.color ?? WARM_3000 }),
    )
    return () => offs.forEach((f) => f())
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures the spot list
  }, [inScene, config, key])
}
