/**
 * Lighting rig (PDF integrated lighting plan):
 *   1. Skylight daylight  — sun (SkyAndSun) + diffuse sky fill (RectAreaLight under the lantern)
 *   2. 3000K track lights — fixtures + accent spots are placed by each exhibit (TrackSpot)
 *   3. Accent spotlights  — see Artwork / Exhibit components
 *   4. Ambient cove light — RectAreaLights washing the perimeter walls + emissive LED strips
 * Plus a light-former environment for PBR reflections and soft global fill.
 */
import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { zoneAt } from '../config/layout'
import { visitor } from '../state/visitor'
import * as THREE from 'three'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'
import { kelvinToHex, LIGHTING } from '../config/lighting'
import { KEY, MUSEUM } from '../config/museum'
import { QUALITY_PRESETS, withDevOverrides } from '../config/quality'
import { useMuseum } from '../state/store'
import { ShadowUpdater, SkyAndSun } from './SkyAndSun'
import { SpotPool } from './SpotPool'
import { GalleryEnvironment } from './GalleryEnvironment'
import { ambience } from './timeOfDayState'
import { TimeOfDayController } from './NightLights'
import { probeState, ZoneProbes } from './ZoneProbes'
import { isWebGPU } from '../utils/renderer'

/** Experimental per-zone probes are opt-in (`?probes`) until verified on target hardware. */
const probesRequested = () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('probes')

RectAreaLightUniformsLib.init()

const H = MUSEUM.gallery.ceilingHeight
const sk = MUSEUM.skylight

/** Quaternion so a RectAreaLight (emits along local -z) faces `dir`, with its height axis along `lengthAxis`. */
function rectOrientation(dir: THREE.Vector3, lengthAxis: THREE.Vector3) {
  const z = dir.clone().normalize().negate()
  const y = lengthAxis.clone().sub(z.clone().multiplyScalar(lengthAxis.dot(z))).normalize()
  const x = new THREE.Vector3().crossVectors(y, z).normalize()
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z))
}

interface AreaProps {
  position: [number, number, number]
  dir: [number, number, number]
  lengthAxis: [number, number, number]
  width: number
  height: number
  intensity: number
  color: string
  /** Daylight source: dimmed with the time of day (ambience.daylight). */
  daylit?: boolean
}

function AreaLight({ position, dir, lengthAxis, width, height, intensity, color, daylit }: AreaProps) {
  const q = useMemo(() => rectOrientation(new THREE.Vector3(...dir), new THREE.Vector3(...lengthAxis)), [dir, lengthAxis])
  const ref = useRef<THREE.RectAreaLight>(null)
  useFrame(() => {
    if (daylit && ref.current) ref.current.intensity = intensity * ambience.daylight
  })
  return <rectAreaLight ref={ref} position={position} quaternion={q} width={width} height={height} intensity={intensity} color={color} />
}

const COVE = kelvinToHex(LIGHTING.cove.colorK, 0.2)
const DAY = kelvinToHex(LIGHTING.skylightFill.colorK)
const SKY_DOWN: [number, number, number] = [0, -1, 0]
const ALONG_Z: [number, number, number] = [0, 0, 1]
const ALONG_X: [number, number, number] = [1, 0, 0]

/**
 * Global fill (hemisphere + environment) is scaled per zone — e.g. the theatre is dark —
 * and eased as the visitor walks between rooms (no shader changes, just intensities).
 */
const ZONE_AMBIENT: Record<string, number> = { theatre: 0.12, courtyard: 1.25, atrium: 1.1 }
/** Fraction of the hemisphere/env fill kept at full night (the rest is daylight bounce). */
const NIGHT_FILL_FLOOR: Record<string, number> = { courtyard: 0.04, atrium: 0.22 }

function ZoneAmbience({ base }: { base: number }) {
  const ref = useRef<THREE.HemisphereLight>(null)
  const scene = useThree((s) => s.scene)
  const k = useRef(1)
  const floor = useRef(0.3)
  useFrame((_, dt) => {
    const id = zoneAt(visitor.x, visitor.z)?.id
    const target = id ? (ZONE_AMBIENT[id] ?? 1) : k.current
    k.current += (target - k.current) * (1 - Math.exp(-2.5 * dt))
    // How much fill survives at night: open-air zones go dark, interiors keep lamp bounce.
    const floorTarget = id ? (NIGHT_FILL_FLOOR[id] ?? 0.3) : floor.current
    floor.current += (floorTarget - floor.current) * (1 - Math.exp(-2.5 * dt))
    // Hemisphere = bounce fill; mostly daylight, so it fades at dusk/night (lamps keep some).
    const tod = floor.current + (1 - floor.current) * ambience.daylight
    if (ref.current) ref.current.intensity = base * k.current * tod
    // Per-zone probes (ZoneProbes) already carry each room's real brightness and time of day.
    scene.environmentIntensity = LIGHTING.ambient.environmentIntensity * (probeState.active ? probeState.zoneGain : k.current * tod)
  })
  return <hemisphereLight ref={ref} args={[LIGHTING.ambient.hemisphereSky, LIGHTING.ambient.hemisphereGround, base]} />
}

export function Lighting() {
  const tier = useMuseum((s) => s.tier)
  const preset = withDevOverrides(QUALITY_PRESETS[tier])
  const skyLen = sk.startZ - sk.endZ
  const skyMidZ = (sk.startZ + sk.endZ) / 2
  const covInset = 0.14
  const galleryMidZ = KEY.gzNorth / 2
  // Without area lights (low tier) lift the hemisphere fill to compensate.
  const hemi = LIGHTING.ambient.hemisphereIntensity * (preset.areaLights ? 1 : 2.4)

  return (
    <>
      <SkyAndSun />
      <ShadowUpdater />
      <SpotPool size={preset.spotPool} />

      <ZoneAmbience base={hemi} />

      {/* Reflection/irradiance environment built only from light-formers (no network HDRIs). */}
      <GalleryEnvironment />
      <TimeOfDayController />
      {preset.zoneProbes && probesRequested() && !isWebGPU() && <ZoneProbes />}

      {preset.areaLights && (
        <>
          {/* Diffuse daylight through the skylight */}
          <AreaLight position={[0, H - 0.02, skyMidZ]} dir={SKY_DOWN} lengthAxis={ALONG_Z} width={sk.width} height={skyLen} intensity={LIGHTING.skylightFill.intensity} color={DAY} daylit />
          {/* Perimeter cove washes */}
          <AreaLight position={[-KEY.gx + covInset, H - 0.06, galleryMidZ]} dir={[-0.8, -1, 0]} lengthAxis={ALONG_Z} width={0.16} height={-KEY.gzNorth - 0.4} intensity={LIGHTING.cove.intensity * 6} color={COVE} />
          <AreaLight position={[KEY.gx - covInset, H - 0.06, galleryMidZ]} dir={[0.8, -1, 0]} lengthAxis={ALONG_Z} width={0.16} height={-KEY.gzNorth - 0.4} intensity={LIGHTING.cove.intensity * 6} color={COVE} />
          <AreaLight position={[0, H - 0.06, KEY.gzNorth + covInset]} dir={[0, -1, -0.8]} lengthAxis={ALONG_X} width={0.16} height={KEY.gx * 2 - 0.4} intensity={LIGHTING.cove.intensity * 6} color={COVE} />
          {/* Reception: soft luminous ceiling */}
          <AreaLight position={[0, MUSEUM.reception.ceilingHeight - 0.02, KEY.rzNorth + MUSEUM.reception.length / 2]} dir={SKY_DOWN} lengthAxis={ALONG_Z} width={MUSEUM.reception.width * 0.45} height={MUSEUM.reception.length * 0.7} intensity={3.2} color={kelvinToHex(3000, 0.35)} />
        </>
      )}
    </>
  )
}
