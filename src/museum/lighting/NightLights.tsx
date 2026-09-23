/**
 * Time-of-day controller + night lighting.
 *
 *  • <TimeOfDayController> eases `ambience` (timeOfDayState.ts) toward the selected preset and
 *    applies it: renderer exposure (the eye adapts at night), sky dusk/night uniforms, cloud cover.
 *  • <CourtyardLanterns> — bronze wall lanterns around the Dye Garden Courtyard. Their glass glows
 *    and their downlights come on at dusk/night. The downlights are SpotPool REQUESTS (the pool
 *    has a fixed number of real lights), switched off by day (intensity 0 → never ranked), so
 *    switching time of day never changes the light count or recompiles a shader.
 */
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { kelvinToHex, LIGHTING } from '../config/lighting'
import { MUSEUM } from '../config/museum'
import { ZoneGroup } from '../navigation/zoneCulling'
import { useMuseum } from '../state/store'
import { ambience, ambienceTarget, snapAmbience, type AmbienceKey } from './timeOfDayState'
import { nightSkyUniforms } from './nightSky'
import { registerSpot, type SpotRequest } from './SpotPool'

const EASE_PER_S = 1.6
const FACADE_GLOW = new THREE.Color('#ffc27a')
const glassScan = { t: 0, k: 0, mats: [] as THREE.MeshPhysicalMaterial[] }

export function TimeOfDayController() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)

  // First frame already correct (no fade from midday on load).
  useEffect(() => {
    snapAmbience(useMuseum.getState().timeOfDay)
  }, [])

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    const target = ambienceTarget(useMuseum.getState().timeOfDay)
    const k = 1 - Math.exp(-EASE_PER_S * dt)
    for (const key of Object.keys(ambience) as AmbienceKey[]) {
      const d = target[key] - ambience[key]
      ambience[key] = Math.abs(d) < 1e-4 ? target[key] : ambience[key] + d * k
    }
    gl.toneMappingExposure = LIGHTING.exposure * ambience.exposure
    for (const u of nightSkyUniforms) {
      u.nightMix.value = ambience.night * ambience.night
      u.twilightMix.value = ambience.twilight
    }
    // Thinner cloud at night so the stars read (clouds are unlit and would just be black).
    const sky = scene.children.find((o) => (o as THREE.Mesh & { isSky?: boolean }).isSky) as THREE.Mesh | undefined
    const cu = (sky?.material as THREE.ShaderMaterial | undefined)?.uniforms?.cloudCoverage
    if (cu && LIGHTING.sky.clouds.enabled) cu.value = LIGHTING.sky.clouds.coverage * (1 - 0.55 * ambience.night)

    // Glowing facade: seen from OUTSIDE at night (arrival flight, forecourt) the glazing — atrium
    // facade and roof lights — carries the warm interior glow. From inside it stays clear glass.
    glassScan.t -= dt
    if (glassScan.t <= 0) {
      glassScan.t = 3
      glassScan.mats = []
      scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshPhysicalMaterial | undefined
        if (m && !Array.isArray(m) && m.name === 'glass' && m.emissive && !glassScan.mats.includes(m)) glassScan.mats.push(m)
      })
    }
    const c = camera.position
    const S = MUSEUM.wings.shell
    const outside = c.y > S.height + 0.4 || c.x < S.minX - 0.5 || c.x > S.maxX + 0.5 || c.z > S.maxZ + 0.4 || c.z < S.minZ - 0.5
    const glow = ambience.night * (outside ? 1 : 0)
    glassScan.k += (glow - glassScan.k) * (1 - Math.exp(-4 * dt))
    for (const m of glassScan.mats) {
      m.emissive.copy(FACADE_GLOW)
      m.emissiveIntensity = glassScan.k * 2.4
    }
  })

  return <CourtyardLanterns />
}

/* ------------------------------------------------------------------ */
/* Courtyard wall lanterns                                             */
/* ------------------------------------------------------------------ */

const CY = MUSEUM.wings.courtyard
const MOUNT_Y = 2.55

/** Wall-mounted positions: [x, z, facing yaw] — clear of doors, beds, drapes and the drying lines. */
const LANTERNS: { x: number; z: number; nx: number; nz: number }[] = [
  // west wall (Gallery B side), flanking the gallery door at z ≈ −16.2
  { x: CY.minX, z: -13.6, nx: 1, nz: 0 },
  { x: CY.minX, z: -18.8, nx: 1, nz: 0 },
  // east wall, below the hanging cloths
  { x: CY.maxX, z: -8.6, nx: -1, nz: 0 },
  { x: CY.maxX, z: -23.8, nx: -1, nz: 0 },
  // north wall, above the garden benches
  { x: 17.4, z: CY.minZ, nx: 0, nz: 1 },
  { x: 23.8, z: CY.minZ, nx: 0, nz: 1 },
  // south wall, flanking the workshop door (x ≈ 20.6)
  { x: 17.9, z: CY.maxZ, nx: 0, nz: -1 },
  { x: 23.3, z: CY.maxZ, nx: 0, nz: -1 },
]

const bronze = new THREE.MeshStandardMaterial({ color: '#3a2c20', roughness: 0.45, metalness: 0.85 })
const lanternGlass = new THREE.MeshStandardMaterial({
  color: '#e9dcc3',
  roughness: 0.55,
  emissive: new THREE.Color(kelvinToHex(LIGHTING.lanterns.colorK)),
  emissiveIntensity: 0,
})

function CourtyardLanterns() {
  const color = kelvinToHex(LIGHTING.lanterns.colorK)
  const requests = useMemo<SpotRequest[]>(
    () =>
      LANTERNS.map((l) => ({
        position: [l.x + l.nx * 0.3, MOUNT_Y - 0.05, l.z + l.nz * 0.3],
        target: [l.x + l.nx * 2.6, 0, l.z + l.nz * 2.6],
        intensity: 0,
        angle: 1.05,
        penumbra: 0.9,
        color,
      })),
    [color],
  )

  useEffect(() => {
    const offs = requests.map((r) => registerSpot(r))
    return () => offs.forEach((off) => off())
  }, [requests])

  useFrame(() => {
    const n = ambience.night
    lanternGlass.emissiveIntensity = LIGHTING.lanterns.emissive * n
    const cd = n > 0.02 ? LIGHTING.lanterns.intensity * n : 0
    for (const r of requests) r.intensity = cd
  })

  return (
    <ZoneGroup zones={['courtyard']}>
      {LANTERNS.map((l, i) => {
        const yaw = Math.atan2(l.nx, l.nz)
        return (
          <group key={i} position={[l.x, MOUNT_Y, l.z]} rotation={[0, yaw, 0]}>
            {/* back plate */}
            <mesh position={[0, 0.02, 0.02]} material={bronze}>
              <boxGeometry args={[0.13, 0.34, 0.03]} />
            </mesh>
            {/* bracket arm */}
            <mesh position={[0, 0.16, 0.15]} material={bronze}>
              <boxGeometry args={[0.025, 0.025, 0.24]} />
            </mesh>
            {/* lantern: cap, glass, base */}
            <mesh position={[0, 0.13, 0.3]} material={bronze}>
              <cylinderGeometry args={[0.02, 0.11, 0.07, 6]} />
            </mesh>
            <mesh position={[0, 0.0, 0.3]} material={lanternGlass}>
              <cylinderGeometry args={[0.075, 0.065, 0.2, 6]} />
            </mesh>
            <mesh position={[0, -0.11, 0.3]} material={bronze}>
              <cylinderGeometry args={[0.07, 0.04, 0.03, 6]} />
            </mesh>
          </group>
        )
      })}
    </ZoneGroup>
  )
}
