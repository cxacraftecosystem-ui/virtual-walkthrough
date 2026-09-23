/**
 * GRAPHICS QUALITY PRESETS
 *
 * Progressive strategy: every tier is stable rasterised PBR. Higher tiers add
 * shadow resolution, ambient occlusion, bloom on emissive fixtures and
 * real-time planar floor reflections. "auto" starts at a device-appropriate
 * tier and steps down if the frame rate stays low.
 */

export type QualityTier = 'low' | 'medium' | 'high' | 'ultra'
export type QualitySetting = QualityTier | 'auto'

export interface QualityPreset {
  label: string
  /** Device-pixel-ratio cap. */
  dpr: [number, number]
  shadows: boolean
  shadowMapSize: number
  /** Soft (PCF-soft) vs hard shadows. */
  softShadows: boolean
  postprocessing: boolean
  ambientOcclusion: boolean
  aoQuality: 'performance' | 'low' | 'medium' | 'high' | 'ultra'
  bloom: boolean
  smaa: boolean
  /** Rendered planar reflections on the oak floor (drei MeshReflectorMaterial). */
  floorReflections: boolean
  /** Accent spotlights on hand-block tables. */
  tableSpots: boolean
  /** Number of real SpotLights shared between all track fixtures (nearest first). */
  spotPool: number
  /** Rect-area cove lights (costly per-fragment). */
  areaLights: boolean
  textureAnisotropy: number
  /** Procedural texture resolution (px). */
  textureSize: number
  antialias: boolean
  /** Per-zone irradiance/reflection probes (lighting/ZoneProbes.tsx) — experimental, also needs `?probes`. */
  zoneProbes: boolean
  /** Probe cube resolution (px per face). */
  probeSize: number
  /** Photo mode path-traces the still view by default (experimental: off everywhere; photo-bar toggle opts in). */
  pathTracing: boolean
}

export const QUALITY_PRESETS: Record<QualityTier, QualityPreset> = {
  low: {
    label: 'Low',
    dpr: [0.75, 1],
    shadows: false,
    shadowMapSize: 1024,
    softShadows: false,
    postprocessing: false,
    ambientOcclusion: false,
    aoQuality: 'performance',
    bloom: false,
    smaa: false,
    floorReflections: false,
    tableSpots: false,
    spotPool: 6,
    areaLights: false,
    textureAnisotropy: 2,
    textureSize: 512,
    antialias: false,
    zoneProbes: false,
    probeSize: 32,
    pathTracing: false,
  },
  medium: {
    label: 'Medium',
    dpr: [1, 1.25],
    shadows: true,
    shadowMapSize: 2048,
    softShadows: true,
    // No composer on Medium: native MSAA + renderer tone mapping is ~2x faster on integrated GPUs.
    postprocessing: false,
    ambientOcclusion: false,
    aoQuality: 'performance',
    bloom: false,
    smaa: true,
    floorReflections: false,
    tableSpots: true,
    spotPool: 10,
    areaLights: true,
    textureAnisotropy: 4,
    textureSize: 1024,
    antialias: true,
    zoneProbes: true,
    probeSize: 64,
    pathTracing: false,
  },
  high: {
    label: 'High',
    dpr: [1, 1.5],
    shadows: true,
    shadowMapSize: 4096,
    softShadows: true,
    postprocessing: true,
    ambientOcclusion: true,
    aoQuality: 'performance',
    bloom: true,
    smaa: true,
    floorReflections: false,
    tableSpots: true,
    spotPool: 12,
    areaLights: true,
    textureAnisotropy: 8,
    textureSize: 1024,
    antialias: false,
    zoneProbes: true,
    probeSize: 128,
    pathTracing: false,
  },
  ultra: {
    label: 'Ultra',
    dpr: [1, 2],
    shadows: true,
    shadowMapSize: 4096,
    softShadows: true,
    postprocessing: true,
    ambientOcclusion: true,
    aoQuality: 'high',
    bloom: true,
    smaa: true,
    floorReflections: true,
    tableSpots: true,
    spotPool: 14,
    areaLights: true,
    textureAnisotropy: 16,
    textureSize: 2048,
    antialias: false,
    zoneProbes: true,
    probeSize: 128,
    pathTracing: false,
  },
}

export const QUALITY_ORDER: QualityTier[] = ['low', 'medium', 'high', 'ultra']

/** Pick a starting tier for "auto" from coarse device signals. */
export function detectInitialTier(): QualityTier {
  if (typeof window === 'undefined') return 'high'
  const coarse = window.matchMedia?.('(pointer: coarse)').matches
  const small = Math.min(window.screen.width, window.screen.height) < 820
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  if (coarse && small) return 'low'
  if (coarse || (mem !== undefined && mem <= 4)) return 'medium'
  const cls = gpuClass()
  // Integrated / mobile GPUs: start at Medium (measured ~55-60 fps on Iris Xe vs ~20 on High).
  if (cls === 'integrated') return 'medium'
  if (cls === 'flagship') return 'ultra'
  return 'high'
}

export type GpuClass = 'integrated' | 'discrete' | 'flagship' | 'unknown'

/** Coarse GPU class from the WebGL renderer string (used for the starting tier and the auto ceiling). */
export function gpuClass(): GpuClass {
  const r = gpuRenderer()
  if (!r) return 'unknown'
  if (/rtx\s?(20[6-9]0|30\d0|40\d0|50\d0)|rx\s?(6[7-9]\d0|7[6-9]\d0|9\d{3})|radeon pro w\d|apple m\d\s?(pro|max|ultra)|arc a7/i.test(r)) return 'flagship'
  if (/nvidia|geforce|quadro|rtx|radeon rx|radeon pro|arc a|apple m\d/i.test(r)) return 'discrete'
  if (isIntegratedGPU()) return 'integrated'
  return 'unknown'
}

/**
 * Highest tier "auto" may climb to on this device class. With vsync the frame rate
 * saturates at the display refresh, so "holding 60 fps" says nothing about headroom on
 * weak GPUs — integrated GPUs therefore stay at their starting tier (measured: Iris Xe
 * holds 60 fps on Medium but ~20 fps on High), only discrete GPUs may climb.
 */
export function autoCeiling(): QualityTier {
  // Touch devices (phones/tablets; iOS reports an 'unknown' "Apple GPU") never climb: each tier
  // change rebuilds the WebGL context, and repeated rebuilds get the tab killed on iOS Safari.
  if (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches) return detectInitialTier()
  const c = gpuClass()
  if (c === 'flagship' || c === 'discrete') return 'ultra'
  if (c === 'integrated') return 'medium'
  return 'high'
}

let gpuName: string | null = null
export function gpuRenderer(): string {
  if (gpuName !== null) return gpuName
  try {
    const gl = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl')
    const ext = gl?.getExtension('WEBGL_debug_renderer_info')
    gpuName = ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : ''
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    gpuName = ''
  }
  return gpuName
}

function isIntegratedGPU() {
  const r = gpuRenderer()
  if (/nvidia|geforce|quadro|rtx|radeon rx|radeon pro|arc a/i.test(r)) return false
  return /intel|iris|uhd|mali|adreno|powervr|swiftshader|llvmpipe|microsoft basic/i.test(r)
}

/**
 * Dev-only profiling overrides, e.g. `?quality=high&fx=0&shadows=0&area=0&ao=0&dpr=1`.
 * Ignored in production builds.
 */
export function withDevOverrides(p: QualityPreset): QualityPreset {
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') return p
  const q = new URLSearchParams(window.location.search)
  const flag = (k: string) => (q.has(k) ? q.get(k) !== '0' : undefined)
  const out = { ...p }
  if (flag('fx') !== undefined) out.postprocessing = flag('fx')!
  if (flag('shadows') !== undefined) out.shadows = flag('shadows')!
  if (flag('area') !== undefined) out.areaLights = flag('area')!
  if (flag('ao') !== undefined) out.ambientOcclusion = flag('ao')!
  if (flag('bloom') !== undefined) out.bloom = flag('bloom')!
  if (q.has('dpr')) out.dpr = [Number(q.get('dpr')), Number(q.get('dpr'))]
  return out
}
