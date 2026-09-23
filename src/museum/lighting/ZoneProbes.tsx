/**
 * PER-ZONE IRRADIANCE PROBES ("baked-quality" ambient light, Medium and up).
 *
 * Why this option: lightmap baking would need a second UV set on every merged mesh, minutes of
 * GPU time and a cache that goes stale with every content edit; SH LightProbes would ADD a light
 * (→ every shader recompiles). A per-zone prefiltered environment instead reuses the scene's
 * existing env-map path (reflections + diffuse irradiance in every PBR material), so it costs no
 * shader variants and almost no frame time — each room simply gets its own bounce colour
 * (warm oak galleries, the dark theatre, indigo Gallery D, the sunlit courtyard).
 *
 * How:
 *  1. After the scene's shaders are compiled, the render-to-target shader variants the probes need
 *     are compiled asynchronously (compileAsync with the cube target bound), then
 *  2. one low-res cube face per frame is rendered at each zone's spawn point (eye height), with
 *     exactly the zones visible from there (zone culling) — ~6 cheap frames per zone.
 *  3. The zone the visitor is in is prefiltered with PMREMGenerator into a CubeUV target of the
 *     SAME size as the light-former environment (so materials keep their program), and
 *  4. `scene.environment` points at a blend target that cross-fades (≈1.2 s) from the previous
 *     room's probe to the new one whenever the visitor changes zone.
 *  5. A zone is re-captured once after the visitor has been in it for a moment (its accent spots
 *     are then assigned from the SpotPool, and the capture sees the previous bounce → a second
 *     bounce), and every zone is re-captured after a time-of-day change.
 *
 * Everything is try/catch guarded: on any failure the light-former environment simply stays.
 */
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'
import { ZONES, zoneAt, type ZoneId } from '../config/layout'
import { MUSEUM } from '../config/museum'
import { QUALITY_PRESETS, withDevOverrides } from '../config/quality'
import { withZonesVisible } from '../navigation/zoneCulling'
import { useMuseum } from '../state/store'
import { visitor } from '../state/visitor'
import { ambience, ambienceTarget } from './timeOfDayState'
import { useArrival } from '../navigation/ArrivalFlight'

/** Read by Lighting (environment intensity) and the path tracer. */
export const probeState = {
  active: false,
  /** Environment intensity multiplier while probes drive scene.environment. */
  zoneGain: 1,
  /** Zones captured so far (debug / automation). */
  baked: 0,
}

if (typeof window !== 'undefined') (window as unknown as { __probes?: typeof probeState }).__probes = probeState

/** Per-zone gain on top of the captured radiance (artistic trims, 1 = physical capture). */
const ZONE_GAIN: Partial<Record<ZoneId, number>> = { theatre: 0.6, courtyard: 1.1 }

const BLEND_S = 1.2
const REFINE_AFTER_S = 1.8
const EYE = MUSEUM.visitor.eyeHeight

const blendMaterial = () =>
  new THREE.ShaderMaterial({
    uniforms: { a: { value: null }, b: { value: null }, t: { value: 0 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D a; uniform sampler2D b; uniform float t; varying vec2 vUv;
      void main() { gl_FragColor = mix( texture2D( a, vUv ), texture2D( b, vUv ), t ); }`,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    toneMapped: false,
  })

const texHeight = (t: THREE.Texture | null) => (t?.image as { height?: number } | undefined)?.height ?? 0

interface Job {
  zone: ZoneId
  face: number
}

export function ZoneProbes() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const compiled = useMuseum((s) => s.sceneCompiled)
  const tier = useMuseum((s) => s.tier)
  const probeSize = withDevOverrides(QUALITY_PRESETS[tier]).probeSize

  const res = useMemo(() => {
    const cubes = new Map<ZoneId, THREE.WebGLCubeRenderTarget>()
    for (const z of ZONES) {
      cubes.set(
        z.id,
        new THREE.WebGLCubeRenderTarget(probeSize, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }),
      )
    }
    const cubeCam = new THREE.CubeCamera(0.05, 2500, cubes.values().next().value!)
    return { cubes, cubeCam, quad: new FullScreenQuad(blendMaterial()) }
  }, [probeSize])

  const st = useRef({
    stage: 'wait' as 'wait' | 'compiling' | 'bake' | 'failed',
    waitT: 0,
    jobs: [] as Job[],
    captured: new Set<ZoneId>(),
    refined: new Set<ZoneId>(),
    pmrem: null as THREE.PMREMGenerator | null,
    uvTo: null as THREE.WebGLRenderTarget | null,
    prev: null as THREE.WebGLRenderTarget | null,
    out: null as THREE.WebGLRenderTarget | null,
    baseEnv: null as THREE.Texture | null,
    cubeSize: 256,
    zone: null as ZoneId | null,
    shown: null as ZoneId | null,
    t: 1,
    inZoneT: 0,
    todTimer: -1,
  })

  // Time of day: re-capture every zone once the lighting has eased to the new preset.
  useEffect(
    () =>
      useMuseum.subscribe((s, p) => {
        if (s.timeOfDay !== p.timeOfDay) st.current.todTimer = 0
      }),
    [],
  )

  useEffect(() => {
    const s = st.current
    const { cubes, quad } = res
    return () => {
      // Hand the light-former environment back and free the GPU targets.
      if (s.out && scene.environment === s.out.texture) scene.environment = s.baseEnv
      probeState.active = false
      probeState.baked = 0
      s.pmrem?.dispose()
      s.uvTo?.dispose()
      s.prev?.dispose()
      s.out?.dispose()
      s.pmrem = s.uvTo = s.prev = s.out = null
      s.stage = 'wait'
      s.captured.clear()
      s.refined.clear()
      s.shown = null
      cubes.forEach((c) => c.dispose())
      quad.material.dispose()
      quad.dispose()
    }
  }, [res, scene])

  useFrame((_, rawDt) => {
    const s = st.current
    const dt = Math.min(rawDt, 0.1)
    if (s.stage === 'failed' || !compiled) return
    try {
      if (s.stage === 'wait') {
        // let the first shadow maps and streamed textures settle
        s.waitT += dt
        if (s.waitT < 1.2) return
        const env = scene.environment
        const envH = texHeight(env)
        if (!env || env.mapping !== THREE.CubeUVReflectionMapping || !envH) return
        s.baseEnv = env
        s.cubeSize = Math.round(envH / 4)
        s.stage = 'compiling'
        compileVariants().then(
          () => {
            s.jobs = ZONES.flatMap((z) => [0, 1, 2, 3, 4, 5].map((face) => ({ zone: z.id, face })))
            s.stage = 'bake'
          },
          (err) => {
            console.warn('[museum] zone probes disabled (compile failed)', err)
            s.stage = 'failed'
          },
        )
        return
      }
      if (s.stage !== 'bake') return

      // 1 cube face per frame (paused during the arrival flight, which should stay silky).
      const job = useArrival.getState().active ? undefined : s.jobs.shift()
      if (job) {
        renderFace(job)
        if (job.face === 5) {
          s.captured.add(job.zone)
          probeState.baked = s.captured.size
          if (job.zone === s.shown) s.shown = null // re-show the fresher capture
        }
      }

      // Time-of-day re-capture (after the ambience ease has mostly settled).
      if (s.todTimer >= 0) {
        s.todTimer += dt
        const target = ambienceTarget(useMuseum.getState().timeOfDay)
        if (s.todTimer > 1 && (Math.abs(target.exposure - ambience.exposure) < 0.01 || s.todTimer > 4)) {
          s.todTimer = -1
          s.refined.clear()
          const here = s.zone
          const order = [...ZONES.map((z) => z.id)].sort((a, b) => Number(b === here) - Number(a === here))
          s.jobs = order.flatMap((zone) => [0, 1, 2, 3, 4, 5].map((face) => ({ zone, face })))
        }
      }

      // Which zone's probe should be shown?
      const here = zoneAt(visitor.x, visitor.z)?.id ?? s.zone
      if (here !== s.zone) {
        s.zone = here
        s.inZoneT = 0
      } else s.inZoneT += dt
      if (s.zone && s.captured.has(s.zone) && s.shown !== s.zone) startBlend(s.zone)

      // Refine the visitor's room once its spots have settled.
      if (s.zone && !s.refined.has(s.zone) && s.inZoneT > REFINE_AFTER_S && !s.jobs.some((j) => j.zone === s.zone)) {
        s.refined.add(s.zone)
        for (let face = 0; face < 6; face++) s.jobs.push({ zone: s.zone, face })
      }

      // Cross-fade.
      if (s.out && s.prev && s.uvTo && s.t < 1) {
        s.t = Math.min(1, s.t + dt / BLEND_S)
        blend(s.prev.texture, s.uvTo.texture, s.out, s.t * s.t * (3 - 2 * s.t))
      }
      const gain = (s.shown && ZONE_GAIN[s.shown]) ?? 1
      probeState.zoneGain += (gain - probeState.zoneGain) * (1 - Math.exp(-2.5 * dt))
    } catch (err) {
      console.warn('[museum] zone probes disabled', err)
      s.stage = 'failed'
      if (s.out && scene.environment === s.out.texture) scene.environment = s.baseEnv
      probeState.active = false
    }
  })

  /** Compile the render-to-target program variants (tone mapping off, linear output) off-thread. */
  function compileVariants(): Promise<unknown> {
    const { cubeCam, cubes } = res
    cubeCam.coordinateSystem = gl.coordinateSystem
    cubeCam.updateCoordinateSystem()
    const prev = gl.getRenderTarget()
    gl.setRenderTarget(cubes.values().next().value!, 0)
    let p: Promise<unknown>
    try {
      p = withZonesVisible(null, () => gl.compileAsync(scene, cubeCam.children[0] as THREE.Camera))
    } finally {
      gl.setRenderTarget(prev)
    }
    return p
  }

  function renderFace({ zone, face }: Job) {
    const z = ZONES.find((zz) => zz.id === zone)
    const rt = res.cubes.get(zone)
    if (!z || !rt) return
    const { cubeCam } = res
    cubeCam.position.set(z.spawn.x, EYE, z.spawn.z)
    cubeCam.updateMatrixWorld(true)
    const cam = cubeCam.children[face] as THREE.Camera
    const prevRT = gl.getRenderTarget()
    const prevFace = gl.getActiveCubeFace()
    const prevMip = gl.getActiveMipmapLevel()
    const shadowNeeds = gl.shadowMap.needsUpdate
    const xr = gl.xr.enabled
    gl.xr.enabled = false
    gl.shadowMap.needsUpdate = false // the frozen shadow maps are valid; don't re-render them per face
    try {
      withZonesVisible(zone, () => {
        gl.setRenderTarget(rt, face)
        gl.render(scene, cam)
      })
    } finally {
      gl.setRenderTarget(prevRT, prevFace, prevMip)
      gl.shadowMap.needsUpdate = shadowNeeds
      gl.xr.enabled = xr
    }
  }

  /** Prefilter `zone`'s cube into uvTo and start a cross-fade from whatever is shown now. */
  function startBlend(zone: ZoneId) {
    const s = st.current
    const cube = res.cubes.get(zone)
    if (!cube) return
    // Make PMREM believe the cube is `cubeSize` wide so its CubeUV layout matches the base env
    // (sampling the smaller cube is resolution-independent).
    const img = (cube.texture.image as { width: number; height: number }[])[0]
    const w = img.width
    const h = img.height
    img.width = img.height = s.cubeSize
    try {
      if (!s.pmrem) {
        s.pmrem = new THREE.PMREMGenerator(gl)
        s.uvTo = s.pmrem.fromCubemap(cube.texture)
      } else s.pmrem.fromCubemap(cube.texture, s.uvTo)
    } finally {
      img.width = w
      img.height = h
    }
    const uv = s.uvTo!
    if (!s.out || !s.prev) {
      const opts = {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        colorSpace: THREE.LinearSRGBColorSpace,
        depthBuffer: false,
        generateMipmaps: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      } as const
      s.prev = new THREE.WebGLRenderTarget(uv.width, uv.height, opts)
      s.out = new THREE.WebGLRenderTarget(uv.width, uv.height, opts)
      s.prev.texture.mapping = s.out.texture.mapping = THREE.CubeUVReflectionMapping
      if (uv.height !== texHeight(s.baseEnv)) console.warn('[museum] probe env size differs from the base env (one-off recompile)')
      // Start from the light-former environment.
      blend(s.baseEnv!, s.baseEnv!, s.out, 0)
      scene.environment = s.out.texture
      probeState.active = true
    }
    // snapshot what is on screen now → prev, then fade to the new probe
    blend(s.out.texture, s.out.texture, s.prev, 0)
    s.t = 0
    s.shown = zone
  }

  function blend(a: THREE.Texture, b: THREE.Texture, target: THREE.WebGLRenderTarget, t: number) {
    const m = res.quad.material as THREE.ShaderMaterial
    m.uniforms.a.value = a
    m.uniforms.b.value = b
    m.uniforms.t.value = t
    const prev = gl.getRenderTarget()
    gl.setRenderTarget(target)
    res.quad.render(gl)
    gl.setRenderTarget(prev)
  }

  return null
}
