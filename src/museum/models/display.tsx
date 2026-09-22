/**
 * Display furniture for loose objects: a glazed table vitrine holding a row of hand blocks,
 * and a plaster pedestal (the object on top is a separate scene object at y = pedestal height).
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { MotifId } from '../config/exhibits'
import { HandBlockPlaceholder } from '../exhibits/HandBlockPlaceholder'
import { ImpressionSwatch } from '../exhibits/ImpressionSwatch'
import { box, Builder, Parts, rbox, useBuilt } from './kit'
import { useModelMaterials } from './modelMaterials'
import { fp, geoKey, str, type ModelProps } from './types'

const MOTIFS: MotifId[] = ['rosette', 'teardrop', 'star-lattice', 'leaf-trail', 'diamond']
const INKS = ['#2c3f6b', '#9b3326', '#b7862f', '#2a2522']

function glassMaterial() {
  return new THREE.MeshStandardMaterial({ color: '#f4f8f8', transparent: true, opacity: 0.1, roughness: 0.04, metalness: 0, envMapIntensity: 1.4, depthWrite: false, side: THREE.DoubleSide })
}

/* ------------------------------------------------------------------ */
/* Table vitrine                                                       */
/* ------------------------------------------------------------------ */

export function Vitrine({ config }: ModelProps) {
  const m = useModelMaterials()
  const [W, D] = fp(config, [1.8, 0.9])
  const H = config.height ?? 0.92
  const hood = 0.34
  const motifs = str(config, 'motifs', 'rosette,diamond,leaf-trail')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is MotifId => (MOTIFS as string[]).includes(s))

  const parts = useBuilt(geoKey('vitrine', config), () => {
    const b = new Builder()
    b.add('shadow', box(W - 0.12, 0.06, D - 0.12), { p: [0, 0.03, 0] })
    b.add('walnut', rbox(W - 0.06, H - 0.1, D - 0.06, 0.006, 2, 'y'), { p: [0, 0.06 + (H - 0.1) / 2, 0] })
    b.add('walnut', rbox(W, 0.04, D, 0.006, 2, 'x'), { p: [0, H - 0.02, 0] })
    b.add('deck', box(W - 0.08, 0.006, D - 0.08), { p: [0, H + 0.003, 0] })
    // brass hood frame: 4 posts + top rails
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) b.add('brass', box(0.014, hood, 0.014), { p: [sx * (W / 2 - 0.012), H + hood / 2, sz * (D / 2 - 0.012)] })
    for (const sz of [-1, 1]) b.add('brass', box(W, 0.014, 0.014), { p: [0, H + hood, sz * (D / 2 - 0.012)] })
    for (const sx of [-1, 1]) b.add('brass', box(0.014, 0.014, D), { p: [sx * (W / 2 - 0.012), H + hood, 0] })
    return b
  })
  const glass = useMemo(glassMaterial, [])
  useEffect(() => () => glass.dispose(), [glass])
  const n = Math.max(1, motifs.length)
  const pitch = (W - 0.3) / n
  return (
    <group>
      <Parts parts={parts} materials={{ walnut: m.walnut, shadow: m.shadowGap, brass: m.brass, deck: m.linen }} />
      {motifs.map((mo, i) => {
        const x = -W / 2 + 0.15 + pitch * (i + 0.5)
        return (
          <group key={i} position={[x, H + 0.006, 0]}>
            <group position={[0, 0, -0.1]} rotation={[0, (i - 1) * 0.12, 0]}>
              <HandBlockPlaceholder motif={mo} size={[0.17, 0.17]} inkColor={INKS[i % INKS.length]} />
            </group>
            <group position={[0, 0.001, 0.2]}>
              <ImpressionSwatch motif={mo} inkColor={INKS[i % INKS.length]} size={[0.24, 0.16]} />
            </group>
          </group>
        )
      })}
      <mesh position={[0, H + hood / 2, 0]} material={glass} renderOrder={3} raycast={() => null}>
        <boxGeometry args={[W - 0.02, hood, D - 0.02]} />
      </mesh>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Plaster pedestal                                                    */
/* ------------------------------------------------------------------ */

export function Pedestal({ config }: ModelProps) {
  const m = useModelMaterials()
  const [W, D] = fp(config, [0.55, 0.55])
  const H = config.height ?? 1.0
  const parts = useBuilt(geoKey('pedestal', config), () => {
    const b = new Builder()
    b.add('shadow', box(W - 0.05, 0.03, D - 0.05), { p: [0, 0.015, 0] })
    b.add('plaster', rbox(W, H - 0.03, D, 0.004, 2, 'y'), { p: [0, 0.03 + (H - 0.03) / 2, 0] })
    b.add('top', rbox(W + 0.01, 0.02, D + 0.01, 0.003, 2, 'x'), { p: [0, H - 0.01, 0] })
    return b
  })
  const glass = useMemo(glassMaterial, [])
  useEffect(() => () => glass.dispose(), [glass])
  const cover = config.props?.cover === true
  return (
    <group>
      <Parts parts={parts} materials={{ plaster: m.paintWhite, shadow: m.shadowGap, top: m.counterStone }} />
      {cover && (
        <mesh position={[0, H + 0.26, 0]} material={glass} renderOrder={3} raycast={() => null}>
          <boxGeometry args={[W - 0.06, 0.52, D - 0.06]} />
        </mesh>
      )}
    </group>
  )
}
