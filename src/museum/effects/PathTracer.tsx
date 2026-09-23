/**
 * RAY-TRACED VIEW — progressive path tracing of the still photo-mode view (three-gpu-pathtracer).
 *
 *  • Only in photo mode, only when the camera has been still for a moment. Any camera movement
 *    cancels instantly (back to the raster frame); standing still again resumes.
 *  • The raster frame is always drawn first; the path-traced image cross-fades in over it once a
 *    few samples have accumulated and keeps converging up to a target sample count.
 *  • Lazy: the library is dynamically imported on first use, and the BVH is built only from what
 *    zone culling currently shows (the visitor's room + rooms visible through doorways) — on a
 *    worker when available. It is rebuilt only when that zone set changes.
 *  • Materials: MeshStandard/Physical go straight through (PBR, emissive, transmission/opacity
 *    for glass). Basic/Lambert/Phong are mapped to equivalent standard materials (basic → emissive,
 *    so video screens and signage glow), custom shader materials are skipped. Instanced meshes are
 *    expanded when small. Lights: spot, directional and rect-area lights are supported by the
 *    library (hemisphere fill is replaced by real global illumination). The sky is captured into a
 *    cube map (sun disc removed — the sun is the directional light) and used as background +
 *    image-based environment.
 *  • EXPERIMENTAL: off by default on every tier; the photo-bar "Ray-trace" toggle opts in (remembered).
 *    Scene builds time out (worker 25 s → main-thread retry, 60 s → unsupported).
 *  • Everything is feature-detected and try/catch guarded — failure marks the tracer unsupported
 *    and the museum carries on rasterised.
 */
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import type { WebGLPathTracer } from 'three-gpu-pathtracer'
import { ZONES } from '../config/layout'
import { QUALITY_PRESETS, withDevOverrides, type QualityTier } from '../config/quality'
import { isZoneVisible } from '../navigation/zoneCulling'
import { useMuseum } from '../state/store'
import { usePhoto } from '../ui/PhotoMode'
import { useRayTrace, type RayTraceStatus } from './rayTraceStore'
import { isWebGPU } from '../utils/renderer'

/** Seconds of stillness before tracing starts. */
const STILL_S = 0.45
/** Brightness match between the path-traced image and the (fill-lit) raster frame. */
const PT_EXPOSURE = 1.0

const setStatus = (status: RayTraceStatus, samples?: number) => {
  const s = useRayTrace.getState()
  if (s.status !== status || (samples !== undefined && Math.floor(samples) !== s.samples)) {
    useRayTrace.setState({ status, ...(samples !== undefined ? { samples: Math.floor(samples) } : {}) })
  }
}

let unsupported = false

/** Float render targets are the hard requirement of the path tracer. */
function supported(gl: THREE.WebGLRenderer) {
  if (unsupported || isWebGPU()) return false
  try {
    return gl.capabilities.isWebGL2 !== false && gl.extensions.has('EXT_color_buffer_float')
  } catch {
    return false
  }
}

function markUnsupported(err: unknown) {
  console.warn('[museum] path tracing unavailable — staying rasterised', err)
  unsupported = true
  disposeEngine()
  setStatus('unsupported')
}

/* ------------------------------------------------------------------ */
/* Engine (singleton per renderer)                                     */
/* ------------------------------------------------------------------ */

interface Engine {
  gl: THREE.WebGLRenderer
  pt: WebGLPathTracer
  worker: { dispose(): void } | null
  key: string
  skyRT: THREE.WebGLCubeRenderTarget
  skyCam: THREE.CubeCamera
  extra: THREE.Group
  proxies: Map<string, THREE.Material>
}

let engine: Engine | null = null
let enginePromise: Promise<Engine> | null = null

function disposeEngine() {
  const e = engine
  engine = null
  enginePromise = null
  if (!e) return
  try {
    e.pt.dispose()
    e.worker?.dispose()
    e.skyRT.dispose()
    e.proxies.forEach((m) => m.dispose())
  } catch {
    /* ignore */
  }
}

async function getEngine(gl: THREE.WebGLRenderer, tier: QualityTier, useWorker = true): Promise<Engine> {
  if (engine && engine.gl === gl) return engine
  if (enginePromise) return enginePromise
  enginePromise = (async () => {
    const lib = await import('three-gpu-pathtracer')
    const pt = new lib.WebGLPathTracer(gl)
    let worker: Engine['worker'] = null
    if (useWorker) {
      try {
        const w = await import('three-mesh-bvh/worker')
        const bvhWorker = new w.GenerateMeshBVHWorker()
        pt.setBVHWorker(bvhWorker as unknown as Parameters<WebGLPathTracer['setBVHWorker']>[0])
        worker = bvhWorker
      } catch (err) {
        console.info('[museum] BVH worker unavailable, building on the main thread', err)
      }
    }
    const ultra = tier === 'ultra'
    pt.renderDelay = 0
    pt.minSamples = 6
    pt.fadeDuration = 800
    pt.rasterizeScene = false
    pt.dynamicLowRes = false
    pt.renderScale = ultra ? 1 : 0.75
    pt.bounces = ultra ? 8 : 5
    pt.transmissiveBounces = 6
    pt.filterGlossyFactor = 0.5
    pt.multipleImportanceSampling = true
    pt.textureSize.set(ultra ? 1024 : 512, ultra ? 1024 : 512)
    // Small tiles keep each frame short, so the page stays responsive on modest GPUs.
    pt.tiles.set(ultra ? 2 : 3, ultra ? 2 : 3)
    const skyRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: false })
    const skyCam = new THREE.CubeCamera(1, 5000, skyRT)
    const e: Engine = { gl, pt, worker, key: '', skyRT, skyCam, extra: new THREE.Group(), proxies: new Map() }
    engine = e
    return e
  })()
  try {
    return await enginePromise
  } catch (err) {
    enginePromise = null
    throw err
  }
}

/* ------------------------------------------------------------------ */
/* Scene preparation                                                   */
/* ------------------------------------------------------------------ */

type AnyMat = THREE.Material & {
  color?: THREE.Color
  map?: THREE.Texture | null
  emissive?: THREE.Color
  emissiveMap?: THREE.Texture | null
  emissiveIntensity?: number
  alphaMap?: THREE.Texture | null
  normalMap?: THREE.Texture | null
}

/** Path-tracer-friendly material for `m`: itself, a standard equivalent, or null (skip). */
function convertMaterial(e: Engine, m: AnyMat): THREE.Material | null {
  if (!m.visible || m.colorWrite === false || (m.transparent && m.opacity < 0.02)) return null
  if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) return m
  if ((m as THREE.ShaderMaterial).isShaderMaterial) return null
  const basic = (m as THREE.MeshBasicMaterial).isMeshBasicMaterial
  const lit = (m as THREE.MeshLambertMaterial).isMeshLambertMaterial || (m as THREE.MeshPhongMaterial).isMeshPhongMaterial || (m as THREE.MeshToonMaterial).isMeshToonMaterial
  if (!basic && !lit) return null
  let p = e.proxies.get(m.uuid)
  if (!p) {
    const s = new THREE.MeshStandardMaterial({
      transparent: m.transparent,
      opacity: m.opacity,
      alphaTest: m.alphaTest,
      side: m.side,
      alphaMap: m.alphaMap ?? null,
      metalness: 0,
      roughness: basic ? 1 : 0.85,
    })
    if (basic) {
      // Unlit → self-luminous (screens, signage, LED strips).
      s.color.set(0x000000)
      s.emissive.copy(m.color ?? new THREE.Color(1, 1, 1))
      s.emissiveMap = m.map ?? null
      s.emissiveIntensity = 1
      if (m.map) s.map = m.map // alpha of cut-out glyphs
    } else {
      if (m.color) s.color.copy(m.color)
      s.map = m.map ?? null
      s.normalMap = m.normalMap ?? null
      if (m.emissive) s.emissive.copy(m.emissive)
      s.emissiveMap = m.emissiveMap ?? null
      s.emissiveIntensity = m.emissiveIntensity ?? 1
    }
    s.name = `pt:${m.name || m.type}`
    p = s
    e.proxies.set(m.uuid, p)
  }
  return p
}

const MAX_INSTANCED_TRIS = 250_000

/**
 * Temporarily hide/swap what the path tracer can't use (sky mesh, custom shaders, invisible
 * helpers) and expand small instanced meshes into `e.extra`. Returns the undo function; the
 * geometry merge in setScene is synchronous, so the undo runs right after it.
 */
function prepareObjects(e: Engine, scene: THREE.Scene): () => void {
  const hidden: THREE.Object3D[] = []
  const swapped: [THREE.Mesh, THREE.Material | THREE.Material[]][] = []
  e.extra.clear()
  const inst = new THREE.Matrix4()
  scene.traverseVisible((o) => {
    if ((o as THREE.Object3D & { isSky?: boolean }).isSky) {
      hidden.push(o)
      return
    }
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || o.userData?.noPathTrace) return
    if (Array.isArray(mesh.material)) return
    const conv = convertMaterial(e, mesh.material as AnyMat)
    const im = mesh as THREE.InstancedMesh
    if (im.isInstancedMesh) {
      hidden.push(mesh)
      const g = mesh.geometry
      const tris = (g.index ? g.index.count : (g.attributes.position?.count ?? 0)) / 3
      if (!conv || im.count * tris > MAX_INSTANCED_TRIS) return
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, inst)
        const c = new THREE.Mesh(g, conv)
        c.matrixAutoUpdate = false
        c.matrix.multiplyMatrices(im.matrixWorld, inst)
        e.extra.add(c)
      }
      return
    }
    if (!conv) hidden.push(mesh)
    else if (conv !== mesh.material) {
      swapped.push([mesh, mesh.material])
      mesh.material = conv
    }
  })
  for (const h of hidden) h.visible = false
  e.extra.updateMatrixWorld(true)
  return () => {
    for (const h of hidden) h.visible = true
    for (const [m, mat] of swapped) m.material = mat
  }
}

/** Sky → cube map (without the sun disc: the sun/moon is the directional light). */
function captureSky(e: Engine, scene: THREE.Scene) {
  const sky = scene.children.find((o) => (o as THREE.Object3D & { isSky?: boolean }).isSky) as THREE.Mesh | undefined
  if (!sky) return false
  const mat = sky.material as THREE.ShaderMaterial
  const s = new THREE.Scene()
  const m = new THREE.Mesh(sky.geometry, mat)
  m.scale.copy(sky.scale)
  m.frustumCulled = false
  s.add(m)
  const disc = mat.uniforms.showSunDisc
  const prev = disc?.value
  if (disc) disc.value = 0
  try {
    e.skyCam.position.set(0, 2, 0)
    e.skyCam.update(e.gl, s)
  } finally {
    if (disc) disc.value = prev
  }
  return true
}

/** A stand-in for the scene: same children (+ expanded instances), own environment/background. */
function makeProxy(e: Engine, scene: THREE.Scene, hasSky: boolean) {
  const proxy = Object.create(scene) as THREE.Scene
  proxy.children = [...scene.children, e.extra]
  proxy.environment = hasSky ? e.skyRT.texture : null
  proxy.background = hasSky ? e.skyRT.texture : new THREE.Color('#0b0d12')
  proxy.environmentIntensity = 1
  proxy.backgroundIntensity = 1
  proxy.backgroundBlurriness = 0
  return proxy
}

const zoneKey = () =>
  ZONES.filter((z) => isZoneVisible(z.id))
    .map((z) => z.id)
    .sort()
    .join(',')

async function prepare(e: Engine, scene: THREE.Scene, camera: THREE.Camera, tier: QualityTier) {
  const hasSky = captureSky(e, scene)
  const proxy = makeProxy(e, scene, hasSky)
  const key = `${tier}|${zoneKey()}`
  const pt = e.pt as WebGLPathTracer & { scene: THREE.Scene; _previousEnvironment: unknown; _previousBackground: unknown }
  // The sky cube is re-rendered in place (time of day): force the tracer to re-import it.
  pt._previousEnvironment = null
  pt._previousBackground = null
  if (e.key === key) {
    pt.scene = proxy
    pt.setCamera(camera)
    pt.updateLights()
    pt.updateEnvironment()
    return
  }
  e.key = ''
  const undo = prepareObjects(e, scene)
  let job: Promise<unknown> | unknown
  try {
    job = e.worker ? pt.setSceneAsync(proxy, camera) : pt.setScene(proxy, camera)
  } finally {
    undo()
  }
  await job
  e.key = key
}

/* ------------------------------------------------------------------ */
/* Components                                                          */
/* ------------------------------------------------------------------ */

/** Always mounted inside the Canvas: decides when to trace (photo mode + still + enabled). */
export function RayTraceManager() {
  const photo = usePhoto((s) => s.on)
  const tier = useMuseum((s) => s.tier)
  const preset = withDevOverrides(QUALITY_PRESETS[tier])
  const choice = useRayTrace((s) => s.enabled)
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const [tracing, setTracing] = useState(false)
  const last = useRef({ m: new THREE.Matrix4(), p: new THREE.Matrix4(), still: 0 })
  const enabled = (choice ?? preset.pathTracing) && supported(gl)

  useEffect(() => {
    useRayTrace.setState({ target: tier === 'ultra' ? 384 : tier === 'high' ? 256 : 160 })
  }, [tier])

  // New renderer (tier change) → the old engine belongs to a dead context.
  useEffect(() => () => disposeEngine(), [gl])

  useFrame((_, dt) => {
    const L = last.current
    if (!photo || !enabled) {
      if (tracing) setTracing(false)
      if (!unsupported) setStatus('off')
      L.still = 0
      return
    }
    camera.updateMatrixWorld()
    const moved = !near(camera.matrixWorld, L.m) || !near(camera.projectionMatrix, L.p)
    L.m.copy(camera.matrixWorld)
    L.p.copy(camera.projectionMatrix)
    if (moved) {
      L.still = 0
      if (tracing) setTracing(false)
      setStatus('waiting', 0)
    } else {
      L.still += dt
      if (!tracing && L.still > STILL_S) setTracing(true)
    }
  })

  return tracing ? <RayTracePass /> : null
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = window.setTimeout(() => reject(new Error(`path tracer scene build timed out after ${ms} ms`)), ms)
    p.then(
      (v) => {
        window.clearTimeout(id)
        resolve(v)
      },
      (err) => {
        window.clearTimeout(id)
        reject(err)
      },
    )
  })
}

function near(a: THREE.Matrix4, b: THREE.Matrix4) {
  const x = a.elements
  const y = b.elements
  for (let i = 0; i < 16; i++) if (Math.abs(x[i] - y[i]) > 2e-5) return false
  return true
}

/**
 * Mounted only while tracing. Its priority-2 frame callback runs after the normal render
 * (the EffectComposer's priority-1 pass on High/Ultra; on Medium/Low it draws the raster
 * frame itself, since any positive-priority callback turns off R3F's automatic render).
 */
function RayTracePass() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const tier = useMuseum((s) => s.tier)
  const composer = withDevOverrides(QUALITY_PRESETS[tier]).postprocessing
  const ready = useRef<Engine | null>(null)
  const tick = useRef(0)

  useEffect(() => {
    let cancelled = false
    ready.current = null
    setStatus('building', 0)
    ;(async () => {
      try {
        let e = await getEngine(gl, tier)
        if (cancelled) return
        try {
          // A worker that never answers (bundler/CSP) must not leave the tracer 'building' forever.
          await withTimeout(prepare(e, scene, camera, tier), e.worker ? 25000 : 60000)
        } catch (err) {
          if (!e.worker) throw err
          // Worker path failed (bundler / CSP): rebuild on the main thread.
          console.info('[museum] BVH worker failed, retrying on the main thread', err)
          disposeEngine()
          e = await getEngine(gl, tier, false)
          if (cancelled) return
          await prepare(e, scene, camera, tier)
        }
        if (cancelled) return
        e.pt.pausePathTracing = false
        e.pt.reset()
        ready.current = e
      } catch (err) {
        if (!cancelled) markUnsupported(err)
      }
    })()
    return () => {
      cancelled = true
      ready.current = null
    }
  }, [gl, scene, camera, tier])

  useFrame((_, dt) => {
    const e = ready.current
    const quad = e ? (e.pt as unknown as { _quad?: { material: { opacity: number } } })._quad : undefined
    const covered = !!quad && quad.material.opacity >= 1
    // Raster underneath (skipped once the path-traced image fully covers it).
    if (!composer && !covered) gl.render(scene, camera)
    if (!e) return
    const pt = e.pt
    const target = useRayTrace.getState().target
    if (pt.samples >= target) pt.pausePathTracing = true
    const tm = gl.toneMapping
    const ex = gl.toneMappingExposure
    // With the composer the renderer's own tone mapping is off; the path-traced quad needs it.
    if (tm === THREE.NoToneMapping) gl.toneMapping = THREE.NeutralToneMapping
    gl.toneMappingExposure = ex * PT_EXPOSURE
    try {
      pt.renderSample()
    } catch (err) {
      markUnsupported(err)
      ready.current = null
    } finally {
      gl.toneMapping = tm
      gl.toneMappingExposure = ex
    }
    tick.current += dt
    if (tick.current > 0.25) {
      tick.current = 0
      const st: RayTraceStatus = (pt as WebGLPathTracer & { isCompiling?: boolean }).isCompiling ? 'compiling' : pt.samples >= target ? 'converged' : 'tracing'
      setStatus(st, pt.samples)
    }
  }, 2)

  return null
}
