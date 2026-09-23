/**
 * Credits / partners wall panel ('credits-panel'): a pale limestone panel with brass fillets,
 * mounted on the reception panelling, carrying a generic kicker ("Presented by" /
 * "In collaboration with") and a partner logo (PNG, or SVG rasterised at panel resolution),
 * with its own soft pooled wash light. Origin on the wall face, front +z.
 */
import { useAsyncTexture } from '../utils/useAsyncTexture'
import { creditsTexture } from './amenityTextures'
import { useLocalSpots } from './amenityLights'
import { box, Builder, Parts, rbox, useBuilt } from './kit'
import { useModelMaterials } from './modelMaterials'
import { geoKey, num, str, type ModelProps } from './types'

export function CreditsPanel({ config }: ModelProps) {
  const m = useModelMaterials()
  const w = num(config, 'width', 2.3)
  const h = num(config, 'panelHeight', 1.5)
  const cy = num(config, 'center', 1.75)
  const kicker = str(config, 'kicker', 'Presented by')
  const logo = str(config, 'logo', '/brand/dc-handicrafts.png')
  const tex = useAsyncTexture(() => creditsTexture(kicker, logo, w, h), [kicker, logo, w, h])
  const parts = useBuilt(geoKey('credits-panel', config), () => {
    const b = new Builder()
    const f = 0.018
    // shadow reveal behind the slab, the slab, brass fillet frame
    b.add('shadow', box(w + 0.02, h + 0.02, 0.004), { p: [0, cy, 0.002] })
    b.add('stone', rbox(w, h, 0.03, 0.004, 2, 'x'), { p: [0, cy, 0.019] })
    b.add('brass', box(w + 2 * f, f, 0.012), { p: [0, cy + h / 2 + f / 2, 0.028] })
    b.add('brass', box(w + 2 * f, f, 0.012), { p: [0, cy - h / 2 - f / 2, 0.028] })
    b.add('brass', box(f, h, 0.012), { p: [-w / 2 - f / 2, cy, 0.028] })
    b.add('brass', box(f, h, 0.012), { p: [w / 2 + f / 2, cy, 0.028] })
    return b
  })
  useLocalSpots(config, [{ from: [0, 3.7, 1.2], to: [0, cy, 0], intensity: 14, angle: 0.55, penumbra: 0.95 }])
  return (
    <group>
      <Parts parts={parts} materials={{ stone: m.counterStone, brass: m.brass, shadow: m.shadowGap }} />
      {tex && (
        <mesh position={[0, cy, 0.0345]} raycast={() => null}>
          <planeGeometry args={[w, h]} />
          <meshStandardMaterial map={tex} roughness={0.55} envMapIntensity={0.7} polygonOffset polygonOffsetFactor={-1} />
        </mesh>
      )}
    </group>
  )
}
