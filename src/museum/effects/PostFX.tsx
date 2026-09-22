/**
 * Tasteful post-processing: N8AO ambient occlusion, restrained bloom that only
 * catches emissive fixtures (threshold above white), SMAA, and Khronos PBR
 * Neutral tone mapping (colour-faithful — the standard for product/art imagery).
 */
import { Bloom, EffectComposer, N8AO, SMAA, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { QUALITY_PRESETS, withDevOverrides } from '../config/quality'
import { useMuseum } from '../state/store'

export function PostFX() {
  const tier = useMuseum((s) => s.tier)
  const p = withDevOverrides(QUALITY_PRESETS[tier])
  if (!p.postprocessing) return null
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      {p.ambientOcclusion && <N8AO aoRadius={0.9} distanceFalloff={0.7} intensity={2.2} quality={p.aoQuality} halfRes={tier !== 'ultra'} color="#1c1510" />}
      {p.bloom && <Bloom mipmapBlur luminanceThreshold={1.15} luminanceSmoothing={0.2} intensity={0.35} radius={0.55} />}
      {p.smaa && <SMAA />}
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
    </EffectComposer>
  )
}
