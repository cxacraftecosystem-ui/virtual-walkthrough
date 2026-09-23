/**
 * <Medallion/> — an SVG mandala (config/decor.ts 'medallion') hung on a wall as a crisp,
 * alpha-tested relief: the SVG is rasterised once per tier (loadMedallionTextures) into a
 * coverage-preserving alpha mask + relief normal map, and recoloured per placement
 * (brass on indigo, madder on lime…). Optional slow "breathing" backlight halo.
 *
 * `ornate` turns it into a layered roundel: painted backing disc, raised brass rings, a
 * second smaller mandala rotated into the open centre (optionally turning very slowly)
 * and a domed brass boss. Both mandala layers share one rasterised texture.
 *
 * The materials are created up-front with 1×1 placeholder maps (fully transparent), so the
 * shaders are part of the startup precompile; the real maps are swapped in when ready
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

interface LayerLook {
  color: string
  metalness?: number
  roughness?: number
  relief?: number
  paint: boolean
  emissive?: string
}

function mandalaMaterial(l: LayerLook) {
  return new THREE.MeshStandardMaterial({
    name: 'medallion',
    color: new THREE.Color(l.color),
    metalness: l.metalness ?? 0,
    roughness: l.roughness ?? 0.6,
    alphaMap: EMPTY_ALPHA,
    // relief: alpha-tested (+ alpha-to-coverage under MSAA); paint: blended stencil, flat on the wall
    alphaTest: l.paint ? 0 : 0.5,
    alphaToCoverage: !l.paint,
    transparent: l.paint,
    depthWrite: !l.paint,
    polygonOffset: l.paint,
    polygonOffsetFactor: l.paint ? -2 : 0,
    polygonOffsetUnits: l.paint ? -2 : 0,
    normalMap: FLAT_NORMAL,
    normalScale: new THREE.Vector2(l.relief ?? 1, l.relief ?? 1),
    emissive: new THREE.Color(l.emissive ?? '#000000'),
    emissiveIntensity: 0,
    envMapIntensity: 1,
  })
}

export function Medallion({ m }: { m: MedallionTreatment }) {
  const tier = useMuseum((s) => s.tier)
  const halo = useRef<THREE.MeshBasicMaterial>(null)
  const innerMesh = useRef<THREE.Mesh>(null)
  const orn = m.ornate

  const place = useMemo(() => {
    const s = SURFACES[m.surface]
    const f = surfaceFace(m.surface)
    const pos: [number, number, number] = s.runAxis === 'z' ? [f.plane, m.centerHeight, m.at] : [m.at, m.centerHeight, f.plane]
    return { pos, rotY: Math.atan2(s.normal[0], s.normal[1]) }
  }, [m.surface, m.at, m.centerHeight])

  const paint = m.finish === 'paint'
  const material = useMemo(
    () => mandalaMaterial({ color: m.color, metalness: m.metalness, roughness: m.roughness, relief: m.relief, paint, emissive: m.glow?.color }),
    [m.color, m.metalness, m.roughness, m.relief, m.glow?.color, paint],
  )
  const inner = orn?.inner
  const innerMaterial = useMemo(
    () => (inner ? mandalaMaterial({ color: inner.color, metalness: inner.metalness, roughness: inner.roughness, relief: m.relief, paint, emissive: m.glow?.color }) : null),
    [inner, m.relief, paint, m.glow?.color],
  )
  const solids = useMemo(() => {
    if (!orn) return null
    return {
      disc: orn.disc ? new THREE.MeshStandardMaterial({ name: 'medallion-disc', color: orn.disc.color, roughness: orn.disc.roughness ?? 0.8, metalness: 0 }) : null,
      ring: orn.rings ? new THREE.MeshStandardMaterial({ name: 'medallion-brass', color: orn.rings.color, metalness: 0.9, roughness: 0.32 }) : null,
      boss: orn.boss ? new THREE.MeshStandardMaterial({ name: 'medallion-brass', color: orn.boss.color, metalness: 0.9, roughness: 0.28 }) : null,
    }
  }, [orn])
  useEffect(
    () => () => {
      material.dispose()
      innerMaterial?.dispose()
      if (solids) for (const s of Object.values(solids)) s?.dispose()
    },
    [material, innerMaterial, solids],
  )

  useEffect(() => {
    let live = true
    const preset = withDevOverrides(QUALITY_PRESETS[tier])
    loadMedallionTextures(m.svg, finishTextureSize(tier, 1024), finishTextureSize(tier, 512), m.size, preset.textureAnisotropy)
      .then((t) => {
        if (!live) return
        for (const mat of [material, innerMaterial]) {
          if (!mat) continue
          mat.alphaMap = t.alphaMap
          mat.normalMap = t.normalMap
        }
      })
      .catch((e) => console.warn('[decor] medallion failed to load', m.svg, e))
    return () => {
      live = false
    }
  }, [m.svg, m.size, tier, material, innerMaterial])

  const glow = m.glow
  const spin = inner?.spinPeriod
  const reducedMotion = useMuseum((s) => s.reducedMotion)
  useFrame(({ clock }, dt) => {
    if (spin && innerMesh.current && !reducedMotion) innerMesh.current.rotation.z -= (dt * Math.PI * 2) / spin
    if (!glow) return
    const k = 0.5 - 0.5 * Math.cos((clock.elapsedTime * Math.PI * 2) / (glow.period ?? 8))
    material.emissiveIntensity = glow.intensity * (0.04 + 0.08 * k)
    if (innerMaterial) innerMaterial.emissiveIntensity = material.emissiveIntensity
    if (halo.current) halo.current.opacity = glow.intensity * (0.35 + 0.4 * k)
  })

  // Local frame: +z points out of the wall. Layers step off the face so nothing z-fights.
  const S = m.size
  const zMain = m.offset ?? (orn ? 0.014 : 0.006)
  const rings = orn?.rings
  const tube = rings ? (rings.tube ?? 0.012) : 0
  return (
    <group position={place.pos} rotation={[0, place.rotY, 0]}>
      {glow && (
        <mesh position={[0, 0, 0.003]} raycast={noRaycast} renderOrder={1}>
          <planeGeometry args={[S * 1.45, S * 1.45]} />
          <meshBasicMaterial ref={halo} map={getHaloTexture()} color={glow.color} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </mesh>
      )}
      {solids?.disc && orn?.disc && (
        <mesh position={[0, 0, 0.006]} material={solids.disc} receiveShadow raycast={noRaycast}>
          <circleGeometry args={[(S * (orn.disc.scale ?? 1.06)) / 2, 96]} />
        </mesh>
      )}
      {solids?.ring &&
        rings?.radii.map((r) => (
          <mesh key={r} position={[0, 0, 0.006 + tube * 0.4]} material={solids.ring ?? undefined} castShadow receiveShadow raycast={noRaycast}>
            <torusGeometry args={[S * r, tube, 10, 128]} />
          </mesh>
        ))}
      <mesh position={[0, 0, zMain]} material={material} receiveShadow raycast={noRaycast}>
        <planeGeometry args={[S, S]} />
      </mesh>
      {innerMaterial && inner && (
        <mesh
          ref={innerMesh}
          position={[0, 0, zMain + 0.006]}
          rotation={[0, 0, THREE.MathUtils.degToRad(inner.rotationDeg ?? 7.5)]}
          material={innerMaterial}
          receiveShadow
          raycast={noRaycast}
        >
          <planeGeometry args={[S * (inner.scale ?? 0.5), S * (inner.scale ?? 0.5)]} />
        </mesh>
      )}
      {solids?.boss && orn?.boss && (
        <mesh position={[0, 0, zMain + 0.008]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 0.45, 1]} material={solids.boss} castShadow raycast={noRaycast}>
          <sphereGeometry args={[(S * (orn.boss.scale ?? 0.075)) / 2, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        </mesh>
      )}
    </group>
  )
}
