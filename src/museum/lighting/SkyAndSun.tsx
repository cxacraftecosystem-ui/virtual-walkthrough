/**
 * Physically based daylight: Preetham atmospheric-scattering sky (three.js Sky,
 * with sun disc + procedural clouds) and a shadow-casting sun aligned to it.
 * The roof and lantern cast shadows, so direct sun reaches the interior ONLY
 * through the skylight glazing.
 */
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import { kelvinToHex, LIGHTING } from '../config/lighting'
import { KEY } from '../config/museum'
import { ZONES, zoneAt } from '../config/layout'
import { visitor } from '../state/visitor'
import { QUALITY_PRESETS, withDevOverrides } from '../config/quality'
import { useMuseum } from '../state/store'

const DEG = Math.PI / 180

/** Unit vector pointing TOWARD the sun. Azimuth: 0 = north(-z), 90 = east(+x). */
export function sunDirection(elevationDeg = LIGHTING.sun.elevationDeg, azimuthDeg = LIGHTING.sun.azimuthDeg) {
  const el = elevationDeg * DEG
  const az = azimuthDeg * DEG
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize()
}

const SUN_TARGET = new THREE.Vector3(0, 0, (KEY.gzNorth + 4.8) / 2)

function useSky() {
  return useMemo(() => {
    const sky = new Sky()
    sky.scale.setScalar(2000)
    const mat = sky.material as THREE.ShaderMaterial
    mat.uniforms.skyExposure = { value: LIGHTING.sky.exposure }
    mat.fragmentShader = mat.fragmentShader
      .replace('uniform float time;', 'uniform float time;\nuniform float skyExposure;')
      .replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( texColor * skyExposure, 1.0 );')
    const u = mat.uniforms
    const s = LIGHTING.sky
    u.turbidity.value = s.turbidity
    u.rayleigh.value = s.rayleigh
    u.mieCoefficient.value = s.mieCoefficient
    u.mieDirectionalG.value = s.mieDirectionalG
    u.cloudCoverage.value = s.clouds.enabled ? s.clouds.coverage : 0
    u.cloudDensity.value = s.clouds.density
    u.cloudElevation.value = s.clouds.elevation
    u.cloudScale.value = s.clouds.scale
    u.cloudSpeed.value = s.clouds.speed
    u.sunPosition.value.copy(sunDirection())
    sky.frustumCulled = false
    sky.renderOrder = -10
    return sky
  }, [])
}

export function SkyAndSun() {
  const sky = useSky()
  const tier = useMuseum((s) => s.tier)
  const preset = withDevOverrides(QUALITY_PRESETS[tier])
  const light = useRef<THREE.DirectionalLight>(null)
  const gl = useThree((s) => s.gl)
  const dir = useMemo(() => sunDirection(), [])
  const target = useMemo(() => {
    const o = new THREE.Object3D()
    o.position.copy(SUN_TARGET)
    o.updateMatrixWorld()
    return o
  }, [])

  useEffect(() => {
    const l = light.current
    if (!l) return
    l.target = target
    const cam = l.shadow.camera
    cam.left = -15
    cam.right = 15
    cam.top = 15
    cam.bottom = -15
    cam.near = 1
    cam.far = 90
    cam.updateProjectionMatrix()
    l.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize)
    l.shadow.bias = -0.0004
    l.shadow.normalBias = 0.025
    l.shadow.radius = 3
    if (l.shadow.map) {
      l.shadow.map.dispose()
      l.shadow.map = null
    }
    gl.shadowMap.needsUpdate = true
  }, [preset.shadowMapSize, target, gl])

  // The shadow frustum (30 m square) follows the wing the visitor is in, so every wing
  // gets crisp sun shadows without an enormous shadow map. Re-rendered only on change.
  const currentZone = useRef<string>('')
  useFrame((_, dt) => {
    ;(sky.material as THREE.ShaderMaterial).uniforms.time.value += dt
    const z = zoneAt(visitor.x, visitor.z)
    const id = z?.id ?? currentZone.current
    if (id && id !== currentZone.current) {
      currentZone.current = id
      const zone = ZONES.find((zz) => zz.id === id)
      const main = ['reception', 'passage', 'gallery-a', 'gallery-b', 'gallery-c', 'reveal'].includes(id)
      const c = main || !zone ? SUN_TARGET : new THREE.Vector3((zone.rect.minX + zone.rect.maxX) / 2, 0, (zone.rect.minZ + zone.rect.maxZ) / 2)
      target.position.copy(c)
      target.updateMatrixWorld()
      light.current?.position.copy(dir.clone().multiplyScalar(45).add(c))
      requestShadowRefresh()
    }
  })

  const pos = dir.clone().multiplyScalar(45).add(SUN_TARGET)
  return (
    <>
      <primitive object={sky} />
      <primitive object={target} />
      <directionalLight
        ref={light}
        position={pos.toArray()}
        intensity={LIGHTING.sun.intensity}
        color={kelvinToHex(LIGHTING.sun.colorK)}
        castShadow={preset.shadows}
      />
    </>
  )
}

/**
 * The scene is static, so shadow maps are rendered on demand: continuously while
 * assets stream in, then frozen — a large, invisible performance win.
 */
let refreshFrames = 0
/** Ask the frozen shadow map to re-render for a few frames (after moving the frustum / loading assets). */
export function requestShadowRefresh(frames = 3) {
  refreshFrames = Math.max(refreshFrames, frames)
}

export function ShadowUpdater() {
  const gl = useThree((s) => s.gl)
  const tier = useMuseum((s) => s.tier)
  const frames = useRef(0)
  useEffect(() => {
    gl.shadowMap.autoUpdate = false
    gl.shadowMap.needsUpdate = true
    frames.current = 0
  }, [gl, tier])
  // Late assets (artworks, GLBs) re-arm a short refresh window when they finish loading.
  useEffect(() => {
    const mgr = THREE.DefaultLoadingManager
    const prev = mgr.onLoad
    mgr.onLoad = () => {
      frames.current = Math.min(frames.current, 180)
      prev?.()
    }
    return () => {
      mgr.onLoad = prev
    }
  }, [])
  useFrame(() => {
    // Refresh for the first ~4 s after (re)configuration, then freeze.
    frames.current++
    if (frames.current < 240) gl.shadowMap.needsUpdate = true
    if (refreshFrames > 0) {
      refreshFrames--
      gl.shadowMap.needsUpdate = true
    }
  })
  return null
}
