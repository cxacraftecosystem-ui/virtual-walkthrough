/**
 * MUSEUM MATERIAL LIBRARY
 *
 * One shared set of PBR materials per quality tier. Geometry UVs are in METRES
 * (see geometry.ts → createMeterBoxGeometry), so every procedural texture uses
 * `repeat = 1 / tileMetres` and reads at true physical scale.
 */

import { useMemo } from 'react'
import * as THREE from 'three'
import { QUALITY_PRESETS, withDevOverrides, type QualityTier } from '../config/quality'
import { useMuseum } from '../state/store'
import { disposeTextureSets, getTextureSet, type PBRTextureSet, type TextureKind } from './proceduralTextures'

export type MaterialKey =
  | 'plaster'
  | 'plasterCeiling'
  | 'oakFloor'
  | 'timberCeiling'
  | 'timber'
  | 'walnut'
  | 'oakFrame'
  | 'paintBlack'
  | 'paintWhite'
  | 'benchWhite'
  | 'shadowGap'
  | 'trackBlack'
  | 'steelWhite'
  | 'glass'
  | 'linen'
  | 'stone'
  | 'deskTop'
  | 'bronze'

export type MuseumMaterials = Record<MaterialKey, THREE.Material>

interface TexturedOpts {
  color: string
  normalScale: number
  /** Multiplies the roughness map (map values are absolute, so 1 = as authored). */
  roughness?: number
  envMapIntensity?: number
  name: string
}

function textured(set: PBRTextureSet, o: TexturedOpts): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    name: o.name,
    color: new THREE.Color(o.color),
    map: set.map,
    roughnessMap: set.roughnessMap,
    roughness: o.roughness ?? 1,
    normalMap: set.normalMap,
    normalScale: new THREE.Vector2(o.normalScale, o.normalScale),
    metalness: 0,
    envMapIntensity: o.envMapIntensity ?? 1,
  })
  return m
}

function solid(name: string, color: string, roughness: number, metalness = 0, envMapIntensity = 1): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ name, color: new THREE.Color(color), roughness, metalness, envMapIntensity })
}

function buildMaterials(tier: QualityTier): MuseumMaterials {
  const preset = withDevOverrides(QUALITY_PRESETS[tier])
  const size = preset.textureSize
  const aniso = preset.textureAnisotropy

  // Only the floor (large, seen at grazing angles) benefits from 2048 maps;
  // everything else is capped at 1024 to keep generation time low on 'ultra'.
  const tex = (kind: TextureKind): PBRTextureSet => {
    const set = getTextureSet(kind, kind === 'oakFloor' ? size : Math.min(size, 1024), aniso)
    const r = 1 / set.tileMetres
    for (const t of [set.map, set.roughnessMap, set.normalMap]) t.repeat.set(r, r)
    return set
  }
  // Linen is fine-scaled; smaller sets are plenty and cheaper.
  const linenSet = (() => {
    const set = getTextureSet('linen', Math.min(size, 1024), aniso)
    const r = 1 / set.tileMetres
    for (const t of [set.map, set.roughnessMap, set.normalMap]) t.repeat.set(r, r)
    return set
  })()

  const plaster = tex('plaster')
  const oak = tex('oakFloor')
  const timber = tex('timber')
  const walnut = tex('walnut')
  const stone = tex('stone')

  const glass = new THREE.MeshPhysicalMaterial({
    name: 'glass',
    color: new THREE.Color('#d9ecf0'),
    transparent: true,
    opacity: 0.16,
    roughness: 0.03,
    metalness: 0,
    ior: 1.5,
    depthWrite: false,
    envMapIntensity: 1.2,
    side: THREE.DoubleSide,
  })

  const mats: MuseumMaterials = {
    plaster: textured(plaster, { name: 'plaster', color: '#ece6dc', normalScale: 0.25, envMapIntensity: 0.6 }),
    plasterCeiling: textured(plaster, { name: 'plasterCeiling', color: '#f0eee9', normalScale: 0.2, envMapIntensity: 0.5 }),
    oakFloor: textured(oak, { name: 'oakFloor', color: '#ffffff', normalScale: 0.35, envMapIntensity: 0.8 }),
    timberCeiling: textured(timber, { name: 'timberCeiling', color: '#fff8ee', normalScale: 0.4, roughness: 1.05, envMapIntensity: 0.6 }),
    timber: textured(timber, { name: 'timber', color: '#f7ecdc', normalScale: 0.45, envMapIntensity: 0.8 }),
    walnut: textured(walnut, { name: 'walnut', color: '#ffffff', normalScale: 0.4, envMapIntensity: 0.9 }),
    oakFrame: textured(timber, { name: 'oakFrame', color: '#ecdcc4', normalScale: 0.35, roughness: 0.95, envMapIntensity: 0.9 }),
    paintBlack: solid('paintBlack', '#1d1c1b', 0.55, 0, 0.8),
    paintWhite: solid('paintWhite', '#f4f2ee', 0.7, 0, 0.7),
    benchWhite: solid('benchWhite', '#f1eee8', 0.55, 0, 0.8),
    shadowGap: solid('shadowGap', '#2d2a27', 0.9, 0, 0.3),
    trackBlack: solid('trackBlack', '#1a1a1a', 0.45, 0.6, 1),
    steelWhite: solid('steelWhite', '#f2f1ee', 0.5, 0.2, 0.9),
    glass,
    linen: textured(linenSet, { name: 'linen', color: '#e9e0d0', normalScale: 0.6, envMapIntensity: 0.5 }),
    stone: textured(stone, { name: 'stone', color: '#ffffff', normalScale: 0.5, envMapIntensity: 0.7 }),
    deskTop: solid('deskTop', '#f3f1ec', 0.32, 0, 0.9),
    bronze: solid('bronze', '#5a4a3a', 0.35, 0.8, 1),
  }
  return mats
}

/* ------------------------------------------------------------------ */
/* Cache: one live tier; the previous one is disposed shortly after     */
/* a switch (after React has swapped every mesh to the new set).        */
/* ------------------------------------------------------------------ */

const cache = new Map<QualityTier, MuseumMaterials>()
let currentTier: QualityTier | null = null
let disposeTimer: ReturnType<typeof setTimeout> | null = null

function scheduleDisposal() {
  if (disposeTimer) clearTimeout(disposeTimer)
  disposeTimer = setTimeout(() => {
    disposeTimer = null
    if (!currentTier) return
    for (const [tier, mats] of cache) {
      if (tier === currentTier) continue
      for (const m of Object.values(mats)) m.dispose()
      cache.delete(tier)
    }
    const sz = QUALITY_PRESETS[currentTier].textureSize
    disposeTextureSets(sz, Math.min(sz, 1024))
  }, 1500)
}

/** Cached, non-hook factory. Switching tiers disposes the previous tier's set (deferred). */
export function getMaterials(tier: QualityTier): MuseumMaterials {
  let mats = cache.get(tier)
  if (!mats) {
    mats = buildMaterials(tier)
    cache.set(tier, mats)
  } else if (tier !== currentTier) {
    // Re-apply anisotropy (textures may be shared with a tier of the same size).
    const aniso = withDevOverrides(QUALITY_PRESETS[tier]).textureAnisotropy
    for (const m of Object.values(mats)) {
      if (m instanceof THREE.MeshStandardMaterial)
        for (const t of [m.map, m.roughnessMap, m.normalMap])
          if (t && t.anisotropy !== aniso) {
            t.anisotropy = aniso
            t.needsUpdate = true
          }
    }
  }
  if (currentTier !== null && currentTier !== tier) {
    currentTier = tier
    scheduleDisposal()
  }
  currentTier = tier
  return mats
}

/** React hook: materials for the current quality tier (stable identity per tier). */
export function useMaterials(): MuseumMaterials {
  const tier = useMuseum((s) => s.tier)
  return useMemo(() => getMaterials(tier), [tier])
}
