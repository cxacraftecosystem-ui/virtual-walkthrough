/**
 * EXPERIMENTAL WebGPU renderer (`?renderer=webgpu`).
 *
 * When the flag is set and `navigator.gpu` exists, the Canvas is created with three's
 * WebGPURenderer (three/webgpu, loaded lazily so the default WebGL bundle is untouched). Any
 * failure falls back to the normal WebGLRenderer. In WebGPU mode the WebGL-only systems are
 * switched off: the postprocessing composer (WebGL-only library), zone probes, the path tracer
 * and GLSL patches (onBeforeCompile / ShaderMaterial); the sky uses the TSL SkyMesh and the
 * light-former environment uses the WebGPU PMREMGenerator. Standard/physical materials are
 * converted to node materials by three automatically.
 *
 * Status: experimental — the default path stays WebGL; see README "WebGPU".
 */
import * as THREE from 'three'

type WebGPUModule = typeof import('three/webgpu')
type SkyMeshCtor = typeof import('three/examples/jsm/objects/SkyMesh.js').SkyMesh

export const rendererState: {
  kind: 'webgl' | 'webgpu'
  /** Backend actually used by WebGPURenderer ('webgpu' or its 'webgl2' fallback). */
  backend: string
  mods: { webgpu: WebGPUModule; SkyMesh: SkyMeshCtor } | null
} = { kind: 'webgl', backend: 'webgl2', mods: null }

export const isWebGPU = () => rendererState.kind === 'webgpu'

export function webgpuRequested() {
  if (typeof window === 'undefined') return false
  try {
    return new URLSearchParams(window.location.search).get('renderer') === 'webgpu' && 'gpu' in navigator && !!navigator.gpu
  } catch {
    return false
  }
}

interface CanvasDefaults {
  canvas: HTMLCanvasElement | OffscreenCanvas
  [k: string]: unknown
}

/** R3F `gl` factory: WebGPURenderer, or a WebGLRenderer if anything goes wrong. */
export function webgpuGL(opts: { antialias: boolean; toneMappingExposure: number }) {
  return async (defaults: CanvasDefaults) => {
    const canvas = defaults.canvas as HTMLCanvasElement
    try {
      const [webgpu, sky, ltc] = await Promise.all([
        import('three/webgpu'),
        import('three/examples/jsm/objects/SkyMesh.js'),
        import('three/examples/jsm/lights/RectAreaLightTexturesLib.js'),
      ])
      const r = new webgpu.WebGPURenderer({ canvas, antialias: opts.antialias, powerPreference: 'high-performance', alpha: false })
      await r.init()
      webgpu.RectAreaLightNode.setLTC(ltc.RectAreaLightTexturesLib.init())
      r.toneMapping = THREE.NeutralToneMapping
      r.toneMappingExposure = opts.toneMappingExposure
      rendererState.kind = 'webgpu'
      rendererState.backend = (r.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2'
      rendererState.mods = { webgpu, SkyMesh: sky.SkyMesh }
      console.info(`[museum] experimental WebGPURenderer active (backend: ${rendererState.backend})`)
      return r as unknown as THREE.WebGLRenderer
    } catch (err) {
      console.warn('[museum] WebGPU renderer failed — falling back to WebGL', err)
      rendererState.kind = 'webgl'
      rendererState.mods = null
      const r = new THREE.WebGLRenderer({ canvas, antialias: opts.antialias, powerPreference: 'high-performance', stencil: false })
      r.toneMapping = THREE.NeutralToneMapping
      r.toneMappingExposure = opts.toneMappingExposure
      return r
    }
  }
}

/** A PMREMGenerator for whichever renderer is active. */
export function makePMREM(gl: THREE.WebGLRenderer): THREE.PMREMGenerator {
  const m = rendererState.mods
  if (isWebGPU() && m) return new m.webgpu.PMREMGenerator(gl as never) as unknown as THREE.PMREMGenerator
  return new THREE.PMREMGenerator(gl)
}

/**
 * WebGPU sky: TSL SkyMesh, with a `uniforms` adapter on its material so the WebGL-oriented
 * sky code (`mat.uniforms.x.value = …`) keeps working unchanged.
 */
export function makeWebGPUSky(): THREE.Mesh | null {
  const m = rendererState.mods
  if (!m) return null
  const sky = new m.SkyMesh()
  const u = sky as unknown as Record<string, { value: unknown }>
  const adapter: Record<string, { value: unknown }> = { skyExposure: { value: 1 }, time: { value: 0 } }
  for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG', 'sunPosition', 'cloudScale', 'cloudSpeed', 'cloudCoverage', 'cloudDensity', 'cloudElevation', 'showSunDisc']) {
    if (u[k]) adapter[k] = u[k]
    else adapter[k] = { value: k === 'sunPosition' ? new THREE.Vector3() : 0 }
  }
  ;(sky.material as unknown as { uniforms: typeof adapter }).uniforms = adapter
  return sky
}
