/**
 * Small procedural fallbacks for CC0 props (shown while a GLB loads or if it is missing):
 * a turned earthenware vessel, a three-legged stool and a slatted timber crate.
 * Sized from footprint/height like every other model.
 */
import { Builder, cyl, lathe, Parts, rbox, useBuilt } from './kit'
import { useModelMaterials } from './modelMaterials'
import { fp, geoKey, type ModelProps } from './types'

export function Vessel({ config }: ModelProps) {
  const m = useModelMaterials()
  const H = config.height ?? 0.4
  const [fx, fz] = fp(config, [H * 0.7, H * 0.7])
  const R = Math.min(fx, fz) / 2
  const parts = useBuilt(geoKey('vessel', config), () =>
    new Builder().add(
      'pot',
      lathe(
        [
          [0, 0],
          [R * 0.55, 0],
          [R * 0.9, H * 0.3],
          [R, H * 0.52],
          [R * 0.7, H * 0.85],
          [R * 0.55, H * 0.95],
          [R * 0.62, H],
          [R * 0.5, H * 0.98],
          [R * 0.45, H * 0.85],
        ],
        32,
      ),
    ),
  )
  return <Parts parts={parts} materials={{ pot: m.terracotta }} />
}

export function Stool({ config }: ModelProps) {
  const m = useModelMaterials()
  const H = config.height ?? 0.45
  const [fx, fz] = fp(config, [0.42, 0.42])
  const R = Math.min(fx, fz) / 2
  const parts = useBuilt(geoKey('stool', config), () => {
    const b = new Builder()
    b.add('wood', cyl(R * 0.92, R * 0.9, 0.04, 28), { p: [0, H - 0.02, 0] })
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2
      const lean = 0.12
      b.add('wood', cyl(0.018, 0.022, H - 0.03, 10), {
        p: [Math.cos(a) * R * 0.62, (H - 0.03) / 2, Math.sin(a) * R * 0.62],
        r: [Math.sin(a) * lean, 0, -Math.cos(a) * lean],
      })
    }
    return b
  })
  return <Parts parts={parts} materials={{ wood: m.teak }} />
}

export function Crate({ config }: ModelProps) {
  const m = useModelMaterials()
  const H = config.height ?? 0.35
  const [W, D] = fp(config, [0.8, 0.4])
  const parts = useBuilt(geoKey('crate', config), () => {
    const b = new Builder()
    const slats = 3
    const sh = (H - 0.02) / slats - 0.012
    for (let i = 0; i < slats; i++) {
      const y = 0.02 + sh / 2 + i * (sh + 0.012)
      for (const s of [-1, 1]) {
        b.add('wood', rbox(W, sh, 0.018, 0.003, 1, 'x'), { p: [0, y, s * (D / 2 - 0.009)] })
        b.add('wood', rbox(0.018, sh, D - 0.036, 0.003, 1, 'z'), { p: [s * (W / 2 - 0.009), y, 0] })
      }
    }
    for (const x of [-1, 1]) for (const z of [-1, 1]) b.add('wood', rbox(0.04, H, 0.04, 0.004), { p: [x * (W / 2 - 0.03), H / 2, z * (D / 2 - 0.03)] })
    b.add('wood', rbox(W - 0.02, 0.02, D - 0.02, 0.003, 1, 'x'), { p: [0, 0.01, 0] })
    return b
  })
  return <Parts parts={parts} materials={{ wood: m.oak }} />
}
