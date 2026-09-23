/**
 * MODEL MATERIALS — the shared museum PBR set (materials.ts) extended with the craft
 * materials procedural models need (teak, terracotta, steel, felt, soil…).
 *
 * Extras reuse the core tier's procedural texture maps (timber / stone / linen), so
 * nothing new is generated and everything follows the quality tier. One set per tier.
 *
 * Animated materials (cloth sway, liquid ripples, foliage) share one clock uniform,
 * `MODEL_TIME`, advanced by <ModelClock/> (mounted once by <SceneObjects/>).
 */
import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import { useMaterials, type MuseumMaterials } from '../materials/materials'
import { woodTexture } from './textures'
import { useMuseum } from '../state/store'
import { VR_MODE } from '../utils/vr'

export const MODEL_TIME = { value: 0 }

/** Advances the shared animation clock. Mount once per <Canvas>. */
export function ModelClock() {
  useFrame((_, dt) => {
    // Reduced motion: banners, foliage and ripples hold still.
    if (useMuseum.getState().reducedMotion || VR_MODE) return
    MODEL_TIME.value += Math.min(dt, 0.1)
  })
  return null
}

export type ModelMaterialKey =
  | keyof MuseumMaterials
  | 'teak'
  | 'oak'
  | 'darkTimber'
  | 'bark'
  | 'terracotta'
  | 'earthenware'
  | 'steel'
  | 'blackSteel'
  | 'brass'
  | 'rope'
  | 'felt'
  | 'soil'
  | 'cloth'
  | 'clothVC'
  | 'ceramicVC'
  | 'powderVC'
  | 'upholstery'
  | 'upholsteryDark'
  | 'concrete'
  | 'stoneDark'
  | 'paper'
  | 'glazeDark'
  | 'stoneFine'
  | 'counterStone'

export type ModelMaterials = Record<ModelMaterialKey, THREE.Material>

function fromMaps(src: THREE.Material, o: Omit<THREE.MeshStandardMaterialParameters, 'normalScale'> & { normalScale?: number; name: string }) {
  const s = src as THREE.MeshStandardMaterial
  const { normalScale, ...rest } = o
  const m = new THREE.MeshStandardMaterial({
    map: s.map,
    roughnessMap: s.roughnessMap,
    normalMap: s.normalMap,
    metalness: 0,
    ...rest,
  })
  const n = normalScale ?? s.normalScale.x
  m.normalScale.set(n, n)
  return m
}

function wood(src: THREE.Material, name: string, tone: string, roughness: number) {
  const m = fromMaps(src, { name, color: '#ffffff', roughness, normalScale: 0.5, envMapIntensity: 0.75 })
  m.map = woodTexture(tone)
  return m
}

const cache = new WeakMap<MuseumMaterials, ModelMaterials>()
let lastSet: ModelMaterials | null = null

function build(core: MuseumMaterials): ModelMaterials {
  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o)
  const extras = {
    // furniture timbers: own high-figure grain albedo + the core timber normal/roughness
    teak: wood(core.timber, 'teak', '#86654a', 0.72),
    oak: wood(core.timber, 'oak', '#c9a67c', 0.7),
    darkTimber: wood(core.timber, 'darkTimber', '#5e4432', 0.78),
    bark: fromMaps(core.timber, { name: 'bark', color: '#7a6858', roughness: 1.1, normalScale: 2.6, envMapIntensity: 0.4 }),
    // fired clay: plaster maps (fine grain, no paving joints)
    terracotta: fromMaps(core.plaster, { name: 'terracotta', color: '#b86f4b', roughness: 0.95, normalScale: 1.2, envMapIntensity: 0.5 }),
    earthenware: fromMaps(core.plaster, { name: 'earthenware', color: '#7d4c33', roughness: 0.88, normalScale: 1.4, envMapIntensity: 0.55 }),
    steel: std({ name: 'steel', color: '#b9bcbf', roughness: 0.36, metalness: 1, envMapIntensity: 1 }),
    blackSteel: std({ name: 'blackSteel', color: '#2a2a2a', roughness: 0.5, metalness: 0.7, envMapIntensity: 0.9 }),
    brass: std({ name: 'brass', color: '#b58a4a', roughness: 0.32, metalness: 1, envMapIntensity: 1 }),
    rope: fromMaps(core.linen, { name: 'rope', color: '#b7a486', roughness: 1, normalScale: 1.2, envMapIntensity: 0.4 }),
    felt: fromMaps(core.linen, { name: 'felt', color: '#6f6552', roughness: 1.05, normalScale: 0.9, envMapIntensity: 0.4 }),
    soil: fromMaps(core.plaster, { name: 'soil', color: '#4a3a2c', roughness: 1.2, normalScale: 4, envMapIntensity: 0.3 }),
    cloth: fromMaps(core.linen, { name: 'cloth', color: '#efe7d8', roughness: 1, normalScale: 0.6, envMapIntensity: 0.5 }),
    clothVC: fromMaps(core.linen, { name: 'clothVC', color: '#ffffff', vertexColors: true, roughness: 1, normalScale: 0.7, envMapIntensity: 0.5 }),
    ceramicVC: std({ name: 'ceramicVC', color: '#ffffff', vertexColors: true, roughness: 0.45, metalness: 0, envMapIntensity: 0.9 }),
    powderVC: fromMaps(core.plaster, { name: 'powderVC', color: '#ffffff', vertexColors: true, roughness: 1.2, normalScale: 2.5, envMapIntensity: 0.25 }),
    upholstery: fromMaps(core.linen, { name: 'upholstery', color: '#8c4a36', roughness: 1, normalScale: 0.9, envMapIntensity: 0.4 }),
    upholsteryDark: fromMaps(core.linen, { name: 'upholsteryDark', color: '#3a3431', roughness: 1, normalScale: 0.8, envMapIntensity: 0.4 }),
    concrete: fromMaps(core.stone, { name: 'concrete', color: '#b9b2a6', roughness: 1, normalScale: 0.6, envMapIntensity: 0.5 }),
    stoneDark: fromMaps(core.stone, { name: 'stoneDark', color: '#8a8179', roughness: 0.9, normalScale: 0.7, envMapIntensity: 0.6 }),
    paper: std({ name: 'paper', color: '#f1ead9', roughness: 0.95, envMapIntensity: 0.4 }),
    glazeDark: fromMaps(core.plaster, { name: 'glazeDark', color: '#3e4a42', roughness: 0.3, normalScale: 0.15, envMapIntensity: 1 }),
    stoneFine: fromMaps(core.plaster, { name: 'stoneFine', color: '#8d857c', roughness: 0.9, normalScale: 1.6, envMapIntensity: 0.5 }),
    counterStone: fromMaps(core.plaster, { name: 'counterStone', color: '#e6dfd2', roughness: 0.42, normalScale: 0.2, envMapIntensity: 0.9 }),
  }
  return { ...core, ...extras }
}

export function getModelMaterials(core: MuseumMaterials): ModelMaterials {
  let m = cache.get(core)
  if (!m) {
    m = build(core)
    cache.set(core, m)
    // previous tier's extras (textures are owned — and disposed — by the core set)
    if (lastSet) {
      const prev = lastSet
      setTimeout(() => {
        for (const [k, mat] of Object.entries(prev)) if (!(k in core)) mat.dispose()
      }, 2000)
    }
    lastSet = m
  }
  return m
}

export function useModelMaterials(): ModelMaterials {
  const core = useMaterials()
  return useMemo(() => getModelMaterials(core), [core])
}

/* ------------------------------------------------------------------ */
/* Per-colour cached materials                                         */
/* ------------------------------------------------------------------ */

const colorCache = new Map<string, THREE.Material>()

/** A cached variant of `base` with a different colour (e.g. dyed cloth, ink). */
export function tinted(base: THREE.Material, color: string, tweak?: Partial<THREE.MeshStandardMaterialParameters>): THREE.Material {
  const key = `${base.uuid}|${color}|${tweak ? JSON.stringify(tweak) : ''}`
  let m = colorCache.get(key)
  if (!m) {
    const c = (base as THREE.MeshStandardMaterial).clone()
    c.color.set(color)
    if (tweak) c.setValues(tweak)
    colorCache.set(key, (m = c))
  }
  return m
}

/* ------------------------------------------------------------------ */
/* Shader injections                                                   */
/* ------------------------------------------------------------------ */

export interface SwayParams {
  /** Local y of the pinned (top) edge. */
  top: number
  /** Hanging length (m) — sway weight goes 0 → 1 from top to top - length. */
  length: number
  /** Max displacement (m) at the free edge. */
  amplitude: number
  /** Temporal speed multiplier. */
  speed?: number
  phase?: number
}

const SWAY_HEAD = /* glsl */ `
uniform float uTime;
uniform vec4 uSway; // top, length, amplitude, speed
uniform float uPhase;
float swayW(float y) { float w = clamp((uSway.x - y) / uSway.y, 0.0, 1.0); return w * sqrt(w); }
float swayZ(vec3 p) {
  float t = uTime * uSway.w + uPhase;
  return uSway.z * (0.62 * sin(t * 1.10 + p.x * 1.6) + 0.26 * sin(t * 2.30 + p.x * 3.9 + p.y * 2.1) + 0.12 * sin(t * 4.70 + p.x * 7.3 - p.y * 5.3));
}
`

function injectSwayVertex(shader: THREE.WebGLProgramParametersWithUniforms, p: SwayParams, normals: boolean) {
  shader.uniforms.uTime = MODEL_TIME
  shader.uniforms.uSway = { value: new THREE.Vector4(p.top, p.length, p.amplitude, p.speed ?? 1) }
  shader.uniforms.uPhase = { value: p.phase ?? 0 }
  shader.vertexShader = SWAY_HEAD + shader.vertexShader
  if (normals) {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <beginnormal_vertex>',
      `#include <beginnormal_vertex>
      {
        float e = 0.02;
        float w0 = swayW(position.y);
        float dzdx = (swayZ(position + vec3(e,0.,0.)) - swayZ(position - vec3(e,0.,0.))) / (2.0*e) * w0;
        float dzdy = (swayZ(position + vec3(0.,e,0.)) * swayW(position.y + e) - swayZ(position - vec3(0.,e,0.)) * swayW(position.y - e)) / (2.0*e);
        objectNormal = normalize(objectNormal + vec3(-dzdx, -dzdy, 0.0) * sign(objectNormal.z + 1e-4));
      }`,
    )
  }
  shader.vertexShader = shader.vertexShader.replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>
    {
      float w = swayW(position.y);
      float dz = swayZ(position) * w;
      transformed.z += dz;
      transformed.y += -abs(dz) * 0.12;
      transformed.x += 0.18 * uSway.z * w * sin(uTime * uSway.w * 0.7 + position.y * 1.3 + uPhase);
    }`,
  )
}

/**
 * Makes `mat` sway like hanging cloth (plane in local XY, pinned at `top`), and returns a
 * matching depth material so shadows move with it.
 */
export function makeSwayMaterial<T extends THREE.Material>(mat: T, p: SwayParams): { material: T; depth: THREE.MeshDepthMaterial } {
  mat.onBeforeCompile = (shader) => injectSwayVertex(shader, p, true)
  mat.customProgramCacheKey = () => 'sway'
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
  const std = mat as unknown as THREE.MeshStandardMaterial
  if (std.map && std.alphaTest > 0) {
    depth.map = std.map
    depth.alphaTest = std.alphaTest
  }
  depth.onBeforeCompile = (shader) => injectSwayVertex(shader, p, false)
  depth.customProgramCacheKey = () => 'sway-depth'
  return { material: mat, depth }
}

const FOLIAGE_HEAD = /* glsl */ `
uniform float uTime;
uniform vec2 uWind; // amplitude, speed
`
function injectFoliage(shader: THREE.WebGLProgramParametersWithUniforms, amp: number, speed: number) {
  shader.uniforms.uTime = MODEL_TIME
  shader.uniforms.uWind = { value: new THREE.Vector2(amp, speed) }
  shader.vertexShader = FOLIAGE_HEAD + shader.vertexShader
  shader.vertexShader = shader.vertexShader.replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>
    {
      #ifdef USE_INSTANCING
        vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
      #else
        vec3 ip = vec3(0.0);
      #endif
      float h = max(position.y, 0.0);
      float t = uTime * uWind.y;
      float ph = ip.x * 1.37 + ip.z * 0.91 + ip.y * 2.1;
      transformed.x += uWind.x * h * (sin(t * 1.3 + ph) + 0.35 * sin(t * 3.1 + ph * 2.0));
      transformed.z += uWind.x * h * 0.7 * cos(t * 1.1 + ph * 1.3);
    }`,
  )
}

/** Gentle wind for instanced foliage (displacement grows with local y). */
export function makeFoliageMaterial<T extends THREE.Material>(mat: T, amp = 0.03, speed = 1): { material: T; depth: THREE.MeshDepthMaterial } {
  mat.onBeforeCompile = (s) => injectFoliage(s, amp, speed)
  mat.customProgramCacheKey = () => `foliage-${amp}-${speed}`
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
  const std = mat as unknown as THREE.MeshStandardMaterial
  if (std.map) {
    depth.map = std.map
    depth.alphaTest = std.alphaTest || 0.5
  }
  depth.onBeforeCompile = (s) => injectFoliage(s, amp, speed)
  depth.customProgramCacheKey = () => `foliage-depth-${amp}-${speed}`
  return { material: mat, depth }
}

export interface LiquidParams {
  color: string
  /** Wave-normal strength. */
  amplitude?: number
  /** World-space frequency scale. */
  scale?: number
  /** Flow direction × speed (m/s) in world xz, for channels. */
  flow?: [number, number]
  roughness?: number
  opacity?: number
  speed?: number
  envMapIntensity?: number
}

const liquidCache = new Map<string, THREE.MeshStandardMaterial>()

/** Liquid surface: dark, glossy, with slowly moving analytic ripples in the normal. */
export function liquidMaterial(p: LiquidParams): THREE.MeshStandardMaterial {
  const key = JSON.stringify(p)
  const hit = liquidCache.get(key)
  if (hit) return hit
  const m = new THREE.MeshStandardMaterial({
    name: 'liquid',
    color: new THREE.Color(p.color),
    roughness: p.roughness ?? 0.08,
    metalness: 0,
    envMapIntensity: p.envMapIntensity ?? 1.3,
    transparent: (p.opacity ?? 1) < 1,
    opacity: p.opacity ?? 1,
  })
  const amp = p.amplitude ?? 0.06
  const scale = p.scale ?? 1
  const flow = p.flow ?? [0, 0]
  const speed = p.speed ?? 1
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = MODEL_TIME
    shader.uniforms.uLiquid = { value: new THREE.Vector4(amp, scale, flow[0], flow[1]) }
    shader.uniforms.uLSpeed = { value: speed }
    shader.vertexShader = 'varying vec3 vLiqW;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vLiqW = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    shader.fragmentShader =
      'uniform float uTime; uniform vec4 uLiquid; uniform float uLSpeed; varying vec3 vLiqW;\n' +
      shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          float t = uTime * uLSpeed;
          vec2 p = vLiqW.xz * uLiquid.y * 6.0 - uLiquid.zw * t * 6.0 * uLiquid.y;
          vec2 g = vec2(0.0);
          g += vec2(cos(p.x * 1.9 + t * 1.1), cos(p.y * 2.3 - t * 0.9)) * 0.50;
          g += vec2(cos((p.x + p.y) * 3.7 + t * 1.7), cos((p.x - p.y) * 3.1 + t * 1.3)) * 0.28;
          g += vec2(cos(p.x * 7.3 - p.y * 5.1 + t * 2.3), cos(p.y * 6.7 + p.x * 4.3 + t * 2.1)) * 0.14;
          vec3 nW = normalize(vec3(-g.x * uLiquid.x, 1.0, -g.y * uLiquid.x));
          normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
        }`,
      )
  }
  m.customProgramCacheKey = () => 'liquid'
  liquidCache.set(key, m)
  return m
}
