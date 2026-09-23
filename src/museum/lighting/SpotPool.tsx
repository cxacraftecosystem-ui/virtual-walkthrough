/**
 * Accent-light pool.
 *
 * Every track fixture registers a light REQUEST; a fixed pool of real SpotLights is
 * assigned each moment to the requests that matter most to the visitor (near, in
 * line of sight), with short cross-fades. A fixed light count keeps shaders small and
 * stable (no recompiles), which is what makes the museum fast to load and render on
 * integrated GPUs, while every artwork in view stays lit.
 */
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Vec3 } from '../config/museum'
import { segmentBlocked } from '../navigation/collision'
import { visitor } from '../state/visitor'

export interface SpotRequest {
  position: Vec3
  target: Vec3
  intensity: number
  angle: number
  penumbra: number
  color: string
}

export const spotRequests = new Map<string, SpotRequest>()
let nextId = 0
export function registerSpot(req: SpotRequest) {
  const id = `spot-${nextId++}`
  spotRequests.set(id, req)
  return () => {
    spotRequests.delete(id)
  }
}

interface Slot {
  light: THREE.SpotLight
  target: THREE.Object3D
  id: string | null
  weight: number
}

const FADE_PER_S = 3.5

function score(req: SpotRequest) {
  const [tx, , tz] = req.target
  const dx = tx - visitor.x
  const dz = tz - visitor.z
  const d = Math.hypot(dx, dz)
  // Probe point slightly off the lit surface, toward the fixture.
  const px = tx + (req.position[0] - tx) * 0.25
  const pz = tz + (req.position[2] - tz) * 0.25
  const blocked = segmentBlocked(visitor.x, visitor.z, px, pz, (c) => c.id.startsWith('table-') || c.id.startsWith('bench'))
  const fx = -Math.sin(visitor.yaw)
  const fz = -Math.cos(visitor.yaw)
  const behind = d > 1.5 && (dx * fx + dz * fz) / d < -0.2
  return d + (blocked ? 40 : 0) + (behind ? 6 : 0)
}

export function SpotPool({ size }: { size: number }) {
  const slots = useMemo<Slot[]>(
    () =>
      Array.from({ length: size }, () => {
        const light = new THREE.SpotLight('#ffffff', 0, 0, 0.5, 0.8, 2)
        const target = new THREE.Object3D()
        light.target = target
        light.castShadow = false
        return { light, target, id: null, weight: 0 }
      }),
    [size],
  )
  const timer = useRef(1)
  const desired = useRef<Set<string>>(new Set())

  useFrame((_, dt) => {
    timer.current += dt
    if (timer.current > 0.2) {
      timer.current = 0
      // Switched-off requests (e.g. courtyard lanterns by day) never take a slot.
      const ranked = [...spotRequests.entries()]
        .filter(([, r]) => r.intensity > 0)
        .map(([id, r]) => [id, score(r)] as const)
        .sort((a, b) => a[1] - b[1])
      desired.current = new Set(ranked.slice(0, size).map(([id]) => id))
    }
    const want = desired.current
    const assigned = new Set(slots.map((s) => s.id).filter((x): x is string => x !== null && want.has(x)))
    const pending = [...want].filter((id) => !assigned.has(id))
    for (const s of slots) {
      const req = s.id ? spotRequests.get(s.id) : undefined
      const keep = s.id !== null && want.has(s.id) && req !== undefined
      if (keep) s.weight = Math.min(1, s.weight + dt * FADE_PER_S)
      else s.weight = Math.max(0, s.weight - dt * FADE_PER_S)
      if (s.weight === 0 && !keep) {
        // Slot is free: take the next pending request (fade in from 0).
        s.id = pending.shift() ?? null
      }
      const r = s.id ? spotRequests.get(s.id) : undefined
      if (r) {
        s.light.position.set(r.position[0], r.position[1], r.position[2])
        s.target.position.set(r.target[0], r.target[1], r.target[2])
        s.target.updateMatrixWorld()
        s.light.angle = r.angle
        s.light.penumbra = r.penumbra
        s.light.color.set(r.color)
        s.light.intensity = r.intensity * s.weight
      } else {
        s.light.intensity = 0
      }
    }
  })

  return (
    <group>
      {slots.map((s, i) => (
        <group key={i}>
          <primitive object={s.light} />
          <primitive object={s.target} />
        </group>
      ))}
    </group>
  )
}
