/**
 * PLACEHOLDER impression swatch — a small piece of cotton showing the block's motif
 * stamped in a short repeat, bridging tool (block) → print (textile).
 * Lies flat on a table, facing +y, 1 mm above its origin.
 */

import { useMemo } from 'react'
import * as THREE from 'three'
import type { MotifId } from '../config/exhibits'
import { drawMotif, hashString, mulberry32, paintCottonGround } from './motifs'

export interface ImpressionSwatchProps {
  motif: MotifId
  inkColor: string
  /** [width (x), depth (z)] in metres. */
  size?: [number, number]
}

const cache = new Map<string, THREE.CanvasTexture>()

function swatchTexture(motif: MotifId, inkColor: string, aspect: number): THREE.CanvasTexture {
  const a = Math.round(aspect * 100) / 100
  const key = `${motif}|${inkColor}|${a}`
  const hit = cache.get(key)
  if (hit) return hit

  const W = 768
  const H = Math.round(W / a)
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const ctx = cv.getContext('2d')!
  const rng = mulberry32(hashString(key))
  paintCottonGround(ctx, W, H, '#efe6d3', rng, { threadPx: 1.8, unevenness: 0.8, noise: 6 })

  // a short run of impressions: a practice strip, with one faint "second pull" at the end
  const cell = Math.min(W / 3.2, H / 2.2)
  const cols = Math.max(1, Math.floor((W - cell * 0.2) / cell))
  const rows = Math.max(1, Math.floor((H - cell * 0.2) / cell))
  const ox = (W - cols * cell) / 2 + cell / 2
  const oy = (H - rows * cell) / 2 + cell / 2
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const last = r === rows - 1 && c === cols - 1 && cols * rows > 2
      drawMotif(ctx, motif, ox + c * cell + (rng() - 0.5) * 3, oy + r * cell + (rng() - 0.5) * 3, cell * 0.88, inkColor, {
        layer: 'all',
        rotation: (rng() - 0.5) * 0.02,
        alpha: last ? 0.42 : 0.82 + rng() * 0.15,
        composite: 'multiply',
        rng,
        voids: last ? 1 : 0.5,
        mottle: last ? 0.9 : 0.5,
        grain: 0.6,
        bleed: 0.8,
      })
    }
  }

  // ragged, slightly frayed edges (alpha)
  ctx.globalCompositeOperation = 'destination-out'
  ctx.fillStyle = '#000'
  const nibble = (x: number, y: number, horizontal: boolean) => {
    const depth = 1 + rng() * 5
    if (horizontal) ctx.fillRect(x, y, 1 + rng() * 5, depth * (y === 0 ? 1 : -1))
    else ctx.fillRect(x, y, depth * (x === 0 ? 1 : -1), 1 + rng() * 5)
  }
  for (let x = 0; x < W; x += 2 + rng() * 5) {
    nibble(x, 0, true)
    nibble(x, H, true)
  }
  for (let y = 0; y < H; y += 2 + rng() * 5) {
    nibble(0, y, false)
    nibble(W, y, false)
  }
  ctx.globalCompositeOperation = 'source-over'

  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  cache.set(key, tex)
  return tex
}

export function ImpressionSwatch({ motif, inkColor, size = [0.3, 0.22] }: ImpressionSwatchProps) {
  const [w, d] = size
  const map = useMemo(() => swatchTexture(motif, inkColor, w / d), [motif, inkColor, w, d])
  return (
    <mesh name="impression-swatch" rotation-x={-Math.PI / 2} position={[0, 0.001, 0]} receiveShadow>
      <planeGeometry args={[w, d]} />
      <meshStandardMaterial map={map} roughness={0.96} metalness={0} alphaTest={0.5} />
    </mesh>
  )
}
