/**
 * PLACEHOLDER carved wooden printing block (procedural).
 *
 * Stand-in only — to be replaced by a 3D model of the authentic block supplied by the
 * workshop (see config/exhibits.ts `model`). The motif is a generic placeholder form.
 *
 * Geometry (local space, metres), origin = centre of the bottom resting surface:
 *   y = 0 ............ timber display cradle (base plate + two rails)
 *   handle ........... turned handle hanging down between the rails
 *   block body ....... ~5 cm thick, rounded edges
 *   carved face (+y) . motif in raised relief with ink traces on the relief tops
 */

import { useEffect, useMemo } from 'react'
import { RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import type { MotifId } from '../config/exhibits'
import { hashString, motifToShapes, mulberry32 } from './motifs'

export interface HandBlockPlaceholderProps {
  motif: MotifId
  /** Carved face size [width (x), depth (z)] in metres. */
  size?: [number, number]
  /** Ink traces on the relief. */
  inkColor?: string
}

const BLOCK_T = 0.05
const RELIEF_H = 0.007
const BASE_T = 0.012
const RAIL_H = 0.062
const RAIL_W = 0.018

/* ------------------------------------------------------------------ */
/* Cached procedural textures                                          */
/* ------------------------------------------------------------------ */

const texCache = new Map<string, THREE.CanvasTexture>()

export function woodGrainTexture(kind: 'teak' | 'cradle'): THREE.CanvasTexture {
  const key = `grain:${kind}`
  const hit = texCache.get(key)
  if (hit) return hit
  const W = 256
  const H = 512
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const ctx = cv.getContext('2d')!
  const rng = mulberry32(kind === 'teak' ? 11 : 29)
  ctx.fillStyle = kind === 'teak' ? '#a07044' : '#6e4c33'
  ctx.fillRect(0, 0, W, H)
  // long wavy grain lines along v
  for (let i = 0; i < 70; i++) {
    const x0 = rng() * W
    const amp = 2 + rng() * 6
    const freq = 0.004 + rng() * 0.01
    const ph = rng() * 6.28
    ctx.strokeStyle = rng() < 0.6 ? `rgba(50,28,12,${0.12 + rng() * 0.22})` : `rgba(190,140,90,${0.08 + rng() * 0.14})`
    ctx.lineWidth = 0.6 + rng() * 2.2
    ctx.beginPath()
    for (let y = 0; y <= H; y += 8) {
      const x = x0 + Math.sin(y * freq + ph) * amp
      if (y === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  // pores
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = `rgba(35,18,8,${0.15 + rng() * 0.3})`
    ctx.fillRect(rng() * W, rng() * H, 0.8, 1.5 + rng() * 3)
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 4
  texCache.set(key, tex)
  return tex
}

/** Mottled ink-on-wood texture for the relief tops (worn, patchy ink traces). */
export function inkTraceTexture(inkColor: string): THREE.CanvasTexture {
  const key = `ink:${inkColor}`
  const hit = texCache.get(key)
  if (hit) return hit
  const S = 256
  const cv = document.createElement('canvas')
  cv.width = cv.height = S
  const ctx = cv.getContext('2d')!
  const rng = mulberry32(hashString(inkColor))
  ctx.fillStyle = '#7a4e2f'
  ctx.fillRect(0, 0, S, S)
  ctx.fillStyle = inkColor
  ctx.globalAlpha = 0.72
  ctx.fillRect(0, 0, S, S)
  // worn patches where bare wood shows
  for (let i = 0; i < 60; i++) {
    const x = rng() * S
    const y = rng() * S
    const r = 4 + rng() * 22
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, `rgba(138,90,54,${0.25 + rng() * 0.45})`)
    g.addColorStop(1, 'rgba(138,90,54,0)')
    ctx.globalAlpha = 1
    ctx.fillStyle = g
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
  // dense dried-ink specks
  for (let i = 0; i < 900; i++) {
    ctx.globalAlpha = 0.2 + rng() * 0.5
    ctx.fillStyle = rng() < 0.7 ? inkColor : '#1b140f'
    ctx.fillRect(rng() * S, rng() * S, 1 + rng() * 2, 1 + rng() * 2)
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  texCache.set(key, tex)
  return tex
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function HandBlockPlaceholder({ motif, size = [0.16, 0.16], inkColor = '#2c3f6b' }: HandBlockPlaceholderProps) {
  const [w, d] = size
  const motifSize = Math.min(w, d) * 0.84
  const blockY = BASE_T + RAIL_H // underside of the block
  const faceY = blockY + BLOCK_T // carved face

  const reliefGeo = useMemo(() => {
    const shapes = motifToShapes(motif, motifSize, 'all', true)
    const bevel = 0.0007
    const g = new THREE.ExtrudeGeometry(shapes, {
      depth: RELIEF_H - bevel * 2,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: 0.0005,
      bevelOffset: 0,
      bevelSegments: 1,
      curveSegments: 10,
    })
    // shape XY → XZ (motif "up" points to -z), extrusion → +y
    g.rotateX(-Math.PI / 2)
    g.translate(0, bevel, 0)
    g.computeVertexNormals()
    return g
  }, [motif, motifSize])

  const handleGeo = useMemo(() => {
    // profile from the knob (y = 0) up to the block (y = L); x = radius
    const L = RAIL_H - 0.002
    const prof: [number, number][] = [
      [0, 0],
      [0.012, 0.0005],
      [0.019, 0.004],
      [0.021, 0.009],
      [0.019, 0.015],
      [0.012, 0.022],
      [0.0095, 0.03],
      [0.0105, 0.042],
      [0.014, L - 0.006],
      [0.02, L - 0.002],
      [0.022, L],
      [0, L],
    ]
    return new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 28)
  }, [])

  const mats = useMemo(() => {
    const grain = woodGrainTexture('teak')
    const cradleGrain = woodGrainTexture('cradle')
    const teak = new THREE.MeshStandardMaterial({ color: '#f2e2d0', map: grain, roughness: 0.62, metalness: 0 })
    const carvedFloor = new THREE.MeshStandardMaterial({ color: '#9c7a5c', map: grain, roughness: 0.88 })
    const ink = new THREE.MeshStandardMaterial({ map: inkTraceTexture(inkColor), roughness: 0.92, metalness: 0 })
    // relief UVs are shape coordinates in metres; map ~6 cm per texture tile
    ink.map = ink.map!.clone()
    ink.map.repeat.set(16, 16)
    ink.map.needsUpdate = true
    const cradle = new THREE.MeshStandardMaterial({ color: '#d8c6b2', map: cradleGrain, roughness: 0.55 })
    return { teak, carvedFloor, ink, cradle }
  }, [inkColor])

  useEffect(
    () => () => {
      mats.ink.map?.dispose()
      Object.values(mats).forEach((m) => m.dispose())
    },
    [mats],
  )
  useEffect(() => () => reliefGeo.dispose(), [reliefGeo])
  useEffect(() => () => handleGeo.dispose(), [handleGeo])

  const reliefMaterials = useMemo(() => [mats.ink, mats.teak], [mats])
  const baseW = w + 0.03
  const baseD = d + 0.03
  const railX = w / 2 - RAIL_W / 2 - 0.006

  return (
    <group name="hand-block-placeholder">
      {/* display cradle */}
      <RoundedBox args={[baseW, BASE_T, baseD]} radius={0.003} smoothness={2} position={[0, BASE_T / 2, 0]} castShadow receiveShadow material={mats.cradle} />
      {[-1, 1].map((s) => (
        <RoundedBox
          key={s}
          args={[RAIL_W, RAIL_H, d * 0.86]}
          radius={0.002}
          smoothness={2}
          position={[s * railX, BASE_T + RAIL_H / 2, 0]}
          castShadow
          receiveShadow
          material={mats.cradle}
        />
      ))}

      {/* turned handle hanging between the rails */}
      <mesh geometry={handleGeo} material={mats.teak} position={[0, BASE_T + 0.002, 0]} castShadow receiveShadow />

      {/* block body */}
      <RoundedBox args={[w, BLOCK_T, d]} radius={0.004} smoothness={3} position={[0, blockY + BLOCK_T / 2, 0]} castShadow receiveShadow material={mats.teak} />

      {/* carved-away floor (slightly darker, rough) */}
      <mesh rotation-x={-Math.PI / 2} position={[0, faceY + 0.0002, 0]} material={mats.carvedFloor} receiveShadow>
        <planeGeometry args={[w - 0.01, d - 0.01]} />
      </mesh>

      {/* raised relief with ink traces on top */}
      <mesh geometry={reliefGeo} material={reliefMaterials} position={[0, faceY, 0]} castShadow receiveShadow />
    </group>
  )
}
