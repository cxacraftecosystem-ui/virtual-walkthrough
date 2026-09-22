/**
 * DECOR MATERIALS — the wall-decor palette (config/decor.ts). Combines the shared museum
 * materials (materials.ts: lime finishes, stone, brick, fluted timber, brass…) with the
 * canvas-patterned decor materials (decorTextures.ts). One set per quality tier, built
 * lazily when <WallDecor/> first mounts; the previous tier's set is disposed shortly after
 * a switch.
 *
 * Finish layers sit 1.5 mm proud of the plaster (below every hung object's 2–4 mm
 * stand-off), so they use `polygonOffset` — `field` variants — to never z-fight the wall.
 */
import { useMemo } from 'react'
import * as THREE from 'three'
import { QUALITY_PRESETS, withDevOverrides, type QualityTier } from '../config/quality'
import { useMuseum } from '../state/store'
import { DECOR_BASE_PX, decorTextureKey, disposeDecorTextures, getDecorTexture, type DecorTextureKind } from './decorTextures'
import { finishTextureSize, getMaterials, type MaterialKey, type MuseumMaterials } from './materials'

export type DecorOnlyKey =
  | 'blockPrint'
  | 'indigoDamask'
  | 'friezePainted'
  | 'stoneFrieze'
  | 'incisedBand'
  | 'jaliStone'
  | 'jaliGlow'
  | 'recessDark'
  | 'linenWrap'

export type DecorMaterialKey = MaterialKey | DecorOnlyKey

export interface DecorMaterials {
  /** Decor variant of the material (polygonOffset, never shared with the walls themselves). */
  get(key: DecorMaterialKey): THREE.Material
  dispose(): void
}

function decorWidth(tier: QualityTier, kind: DecorTextureKind) {
  return finishTextureSize(tier, DECOR_BASE_PX[kind])
}

function build(tier: QualityTier): DecorMaterials {
  const preset = withDevOverrides(QUALITY_PRESETS[tier])
  const aniso = preset.textureAnisotropy
  const m: MuseumMaterials = getMaterials(tier)
  const tex = (k: DecorTextureKind) => getDecorTexture(k, decorWidth(tier, k), aniso)
  const limeNormal = (m.limePlasterWarm as THREE.MeshStandardMaterial).normalMap

  const own: Record<DecorOnlyKey, THREE.Material> = {
    blockPrint: new THREE.MeshStandardMaterial({
      name: 'blockPrint',
      map: tex('blockPrint').map,
      normalMap: limeNormal,
      normalScale: new THREE.Vector2(0.5, 0.5),
      roughness: 0.9,
      envMapIntensity: 0.5,
    }),
    indigoDamask: new THREE.MeshStandardMaterial({
      name: 'indigoDamask',
      map: tex('indigoDamask').map,
      normalMap: limeNormal,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughness: 0.86,
      envMapIntensity: 0.55,
    }),
    friezePainted: new THREE.MeshStandardMaterial({
      name: 'friezePainted',
      map: tex('friezePainted').map,
      normalMap: limeNormal,
      normalScale: new THREE.Vector2(0.4, 0.4),
      roughness: 0.84,
      envMapIntensity: 0.5,
    }),
    stoneFrieze: new THREE.MeshStandardMaterial({
      name: 'stoneFrieze',
      map: tex('stoneFrieze').map,
      normalMap: tex('stoneFrieze').normalMap ?? null,
      normalScale: new THREE.Vector2(1, 1),
      roughness: 0.85,
      envMapIntensity: 0.6,
    }),
    incisedBand: new THREE.MeshStandardMaterial({
      name: 'incisedBand',
      map: tex('incisedBand').map,
      normalMap: tex('incisedBand').normalMap ?? null,
      normalScale: new THREE.Vector2(1, 1),
      roughness: 0.9,
      envMapIntensity: 0.55,
    }),
    jaliStone: new THREE.MeshStandardMaterial({
      name: 'jaliStone',
      map: tex('jali').map,
      alphaMap: tex('jali').alphaMap ?? null,
      normalMap: tex('jali').normalMap ?? null,
      normalScale: new THREE.Vector2(1, 1),
      alphaTest: 0.5,
      roughness: 0.78,
      envMapIntensity: 0.7,
    }),
    // warm backlight behind the jali screens (bloom picks it up on High)
    jaliGlow: new THREE.MeshStandardMaterial({
      name: 'jaliGlow',
      color: new THREE.Color('#2a1c10'),
      emissive: new THREE.Color('#ffb46a'),
      emissiveIntensity: tier === 'low' ? 1.3 : 1.1,
      roughness: 1,
    }),
    recessDark: new THREE.MeshStandardMaterial({ name: 'recessDark', color: new THREE.Color('#4a3d31'), roughness: 1, envMapIntensity: 0.2 }),
    linenWrap: (() => {
      const l = (m.linen as THREE.MeshStandardMaterial).clone()
      l.name = 'linenWrap'
      l.color = new THREE.Color('#e4d9c4')
      return l
    })(),
  }

  const fieldVariants = new Map<string, THREE.Material>()
  const base = (key: DecorMaterialKey): THREE.Material => (key in own ? own[key as DecorOnlyKey] : m[key as MaterialKey])

  return {
    get(key) {
      const mat = base(key)
      let f = fieldVariants.get(key)
      if (!f) {
        f = mat.clone()
        f.name = `${mat.name}:field`
        f.polygonOffset = true
        f.polygonOffsetFactor = -1
        f.polygonOffsetUnits = -2
        fieldVariants.set(key, f)
      }
      return f
    },
    dispose() {
      for (const x of Object.values(own)) x.dispose()
      for (const x of fieldVariants.values()) x.dispose()
    },
  }
}

const cache = new Map<QualityTier, DecorMaterials>()
let current: QualityTier | null = null
let timer: ReturnType<typeof setTimeout> | null = null

export function getDecorMaterials(tier: QualityTier): DecorMaterials {
  let d = cache.get(tier)
  if (!d) {
    d = build(tier)
    cache.set(tier, d)
  }
  if (current !== null && current !== tier) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      for (const [t, set] of cache) {
        if (t === current) continue
        set.dispose()
        cache.delete(t)
      }
      if (current) {
        const tierNow = current
        disposeDecorTextures(new Set((Object.keys(DECOR_BASE_PX) as DecorTextureKind[]).map((k) => decorTextureKey(k, decorWidth(tierNow, k)))))
      }
    }, 1600)
  }
  current = tier
  return d
}

export function useDecorMaterials(): DecorMaterials {
  const tier = useMuseum((s) => s.tier)
  return useMemo(() => getDecorMaterials(tier), [tier])
}
