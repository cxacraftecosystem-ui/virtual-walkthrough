/**
 * <Medallion/> — an SVG mandala (config/decor.ts 'medallion') hung on a wall as a crisp,
 * alpha-tested relief: the SVG is rasterised once per tier (loadMedallionTextures) into a
 * coverage-preserving alpha mask + relief normal map, and recoloured per placement
 * (brass on indigo, madder on lime…). Optional slow "breathing" backlight halo.
 *
 * The material is created up-front with 1×1 placeholder maps (fully transparent), so the
 * shader is part of the startup precompile; the real maps are swapped in when ready
 * without a program change.
 */
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { surfaceFace, type MedallionTreatment } from '../config/decor'
import { SURFACES } from '../config/layout'
import { QUALITY_PRESETS, withDevOverrides } from '../config/quality'
import { getHaloTexture, loadMedallionTextures } from '../materials/decorTextures'
import { finishTextureSize } from '../materials/materials'
import { useMuseum } from '../state/store'

const noRaycast = () => null

function placeholder(v: number): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([v, v, 255, 255]), 1, 1)
  t.needsUpdate = true
  return t
}
const EMPTY_ALPHA = placeholder(0)
const FLAT_NORMAL = placeholder(128)

export function Medallion({ m }: { m: MedallionTreatment }) {
  const tier = useMuseum((s) => s.tier)
  const halo = useRef<THREE.MeshBasicMaterial>(null)

  const place = useMemo(() => {
    const s = SURFACES[m.surface]
    const f = surfaceFace(m.surface)
    const o = m.offset ?? 0.006
    const pos: [number, number, number] = s.runAxis === 'z' ? [f.plane + f.normal * o, m.centerHeight, m.at] : [m.at, m.centerHeight, f.plane + f.normal * o]
    const haloPos: [number, number, number] = s.runAxis === 'z' ? [f.plane + f.normal * 0.003, m.centerHeight, m.at] : [m.at, m.centerHeight, f.plane + f.normal * 0.003]
    return { pos, haloPos, rotY: Math.atan2(s.normal[0], s.normal[1]) }
  }, [m.surface, m.at, m.centerHeight, m.offset])

  const paint = m.finish === 'paint'
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        name: 'medallion',
        color: new THREE.Color(m.color),
        metalness: m.metalness ?? 0,
        roughness: m.roughness ?? 0.6,
        alphaMap: EMPTY_ALPHA,
        // relief: alpha-tested (+ alpha-to-coverage under MSAA); paint: blended stencil, flat on the wall
        alphaTest: paint ? 0 : 0.5,
        alphaToCoverage: !paint,
        transparent: paint,
        depthWrite: !paint,
        polygonOffset: paint,
        polygonOffsetFactor: paint ? -2 : 0,
        polygonOffsetUnits: paint ? -2 : 0,
        normalMap: FLAT_NORMAL,
        normalScale: new THREE.Vector2(m.relief ?? 1, m.relief ?? 1),
        emissive: new THREE.Color(m.glow?.color ?? '#000000'),
        emissiveIntensity: 0,
        envMapIntensity: 1,
      }),
    [m.color, m.metalness, m.roughness, m.relief, m.glow?.color, paint],
  )
  useEffect(() => () => material.dispose(), [material])

  useEffect(() => {
    let live = true
    const preset = withDevOverrides(QUALITY_PRESETS[tier])
    loadMedallionTextures(m.svg, finishTextureSize(tier, 1024), finishTextureSize(tier, 512), m.size, preset.textureAnisotropy)
      .then((t) => {
        if (!live) return
        material.alphaMap = t.alphaMap
        material.normalMap = t.normalMap
      })
      .catch((e) => console.warn('[decor] medallion failed to load', m.svg, e))
    return () => {
      live = false
    }
  }, [m.svg, m.size, tier, material])

  const glow = m.glow
  useFrame(({ clock }) => {
    if (!glow) return
    const k = 0.5 - 0.5 * Math.cos((clock.elapsedTime * Math.PI * 2) / (glow.period ?? 8))
    material.emissiveIntensity = glow.intensity * (0.04 + 0.08 * k)
    if (halo.current) halo.current.opacity = glow.intensity * (0.35 + 0.4 * k)
  })

  return (
    <group>
      {glow && (
        <mesh position={place.haloPos} rotation={[0, place.rotY, 0]} raycast={noRaycast} renderOrder={1}>
          <planeGeometry args={[m.size * 1.45, m.size * 1.45]} />
          <meshBasicMaterial ref={halo} map={getHaloTexture()} color={glow.color} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </mesh>
      )}
      <mesh position={place.pos} rotation={[0, place.rotY, 0]} material={material} receiveShadow raycast={noRaycast}>
        <planeGeometry args={[m.size, m.size]} />
      </mesh>
    </group>
  )
}
