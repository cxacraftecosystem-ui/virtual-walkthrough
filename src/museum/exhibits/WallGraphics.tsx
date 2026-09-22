/**
 * Wall-mounted typography & information: reveal-wall exhibition title and the
 * craft infographic panels on the product wall (content from config/infographics.ts).
 */
import type { ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { EXHIBITION_TITLE, INFOGRAPHICS, type InfographicConfig } from '../config/infographics'
import { surfacePoint } from '../config/layout'
import { LIGHTING } from '../config/lighting'
import { KEY, MUSEUM, type Vec3 } from '../config/museum'
import { registerItem } from '../interaction/registry'
import { coverAngle, TrackSpot } from '../lighting/TrackLight'
import { mountFor } from '../lighting/tracks'
import { useMaterials } from '../materials/materials'
import { createInfographicTexture, createTitleWallTexture } from '../materials/wallGraphics'
import { focusOn } from '../navigation/focus'
import { useMuseum } from '../state/store'
import { useAsyncTexture } from '../utils/useAsyncTexture'

/**
 * Exhibition title vinyl on the reveal wall's arrival face — the first focal plane.
 * v3 composition: the title occupies the LEFT ~40 % of the 7.6 m face; the large framed
 * feature painting (artworks.ts 'feature-01', at x ≈ +1.4) fills the right-hand part.
 */
const REVEAL_TITLE = { left: -MUSEUM.revealWall.width / 2 + 0.1, width: 3.0 }
export function RevealWallTitle() {
  const rw = MUSEUM.revealWall
  const w = REVEAL_TITLE.width
  const cx = rw.offsetX + REVEAL_TITLE.left + w / 2
  const h = 2.3
  const cy = 1.78
  const tex = useAsyncTexture(() => createTitleWallTexture(w, h, { bottomY: cy - h / 2 }), [EXHIBITION_TITLE.title])
  const p = surfacePoint('reveal-south', cx, cy, 0.002)
  const spots = useMemo(
    () =>
      [-0.7, 0.7].map((dx) => {
        const x = cx + dx
        const mount = mountFor('reveal-south', x)
        const target: Vec3 = [x, 1.75, KEY.revealSouthZ]
        const dist = Math.hypot(mount[1] - target[1], mount[2] - target[2])
        return { mount, target, angle: coverAngle(2.3, 2.6, dist), intensity: LIGHTING.track.artworkIntensity * 0.45 * (dist / 2.2) ** 2 }
      }),
    [cx],
  )
  return (
    <group>
      {tex && (
        <mesh position={p.position} rotation={[0, p.rotationY, 0]} raycast={() => null}>
          <planeGeometry args={[w, h]} />
          <meshStandardMaterial map={tex} transparent roughness={0.7} polygonOffset polygonOffsetFactor={-2} depthWrite={false} />
        </mesh>
      )}
      {spots.map((s, i) => (
        <TrackSpot key={i} position={s.mount} target={s.target} angle={s.angle} intensity={s.intensity} />
      ))}
    </group>
  )
}

function InfographicPanel({ cfg }: { cfg: InfographicConfig }) {
  const m = useMaterials()
  const select = useMuseum((s) => s.select)
  const cy = cfg.placement.centerHeight ?? MUSEUM.display.artworkCenterHeight
  const tex = useAsyncTexture(() => createInfographicTexture(cfg, cfg.width, cfg.height), [cfg])
  const p = useMemo(() => surfacePoint(cfg.placement.surface, cfg.placement.at, cy, 0.001), [cfg.placement.surface, cfg.placement.at, cy])
  const depth = 0.012

  useEffect(
    () =>
      registerItem({
        id: cfg.id,
        kind: 'infographic',
        title: cfg.title,
        center: [p.position[0] + p.normal[0] * depth, cy, p.position[2] + p.normal[2] * depth],
        normal: p.normal,
        size: [cfg.width, cfg.height],
        viewDistance: 2.1,
      }),
    [cfg.id, cfg.title, cfg.width, cfg.height, p, cy],
  )

  const spot = useMemo(() => {
    const mount = mountFor(cfg.placement.surface, cfg.placement.at)
    const target: Vec3 = [p.position[0], cy, p.position[2]]
    const dist = Math.hypot(mount[0] - target[0], mount[1] - target[1], mount[2] - target[2])
    return { mount, target, angle: coverAngle(cfg.width, cfg.height, dist), intensity: LIGHTING.track.artworkIntensity * 0.45 * (dist / 2.2) ** 2 }
  }, [cfg.placement.surface, cfg.placement.at, cfg.width, cfg.height, p, cy])

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (e.delta > 6 || useMuseum.getState().phase !== 'entered') return
    select({ kind: 'infographic', id: cfg.id })
    focusOn('infographic', cfg.id)
  }

  return (
    <group>
      <group
        position={p.position}
        rotation={[0, p.rotationY, 0]}
        onClick={onClick}
        onPointerOver={(e) => {
          e.stopPropagation()
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={() => (document.body.style.cursor = '')}
      >
        <mesh position={[0, 0, depth / 2]} material={m.paintWhite} castShadow receiveShadow>
          <boxGeometry args={[cfg.width, cfg.height, depth]} />
        </mesh>
        {tex && (
          <mesh position={[0, 0, depth + 0.0008]} receiveShadow>
            <planeGeometry args={[cfg.width, cfg.height]} />
            <meshStandardMaterial map={tex} roughness={0.8} polygonOffset polygonOffsetFactor={-1} />
          </mesh>
        )}
      </group>
      <TrackSpot position={spot.mount} target={spot.target} angle={spot.angle} intensity={spot.intensity} />
    </group>
  )
}

export function ProductWall() {
  return (
    <group>
      {INFOGRAPHICS.map((cfg) => (
        <InfographicPanel key={cfg.id} cfg={cfg} />
      ))}
    </group>
  )
}
