/**
 * <Artwork config={...} /> — the reusable, data-driven artwork primitive.
 *
 * 1. loads the image and reads its intrinsic width/height
 * 2. computes image / mat / frame sizes inside maxWidth × maxHeight (no stretching)
 * 3. builds the configured frame (or frameless panel) around it
 * 4. places it on its display surface at the configured centre height
 * 5. adds its own 3000K accent spotlight on the nearest track
 * 6. registers itself for click / proximity interaction
 */
import type { ThreeEvent } from '@react-three/fiber'
import { Suspense, use, useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import type { ArtworkConfig } from '../config/artworks'
import { resolveFrame, type FrameStyle } from '../config/frames'
import { surfacePoint } from '../config/layout'
import { LIGHTING } from '../config/lighting'
import { MUSEUM, type Vec3 } from '../config/museum'
import { QUALITY_PRESETS, withDevOverrides } from '../config/quality'
import { registerItem } from '../interaction/registry'
import { coverAngle, TrackSpot } from '../lighting/TrackLight'
import { mountFor } from '../lighting/tracks'
import { useMaterials, type MaterialKey } from '../materials/materials'
import { createLabelTexture } from '../materials/wallGraphics'
import { focusOn } from '../navigation/focus'
import { useMuseum } from '../state/store'
import { openExamine } from '../ui/deepzoom/deepZoomStore'
import { ErrorBoundary } from '../utils/ErrorBoundary'
import { useAsyncTexture } from '../utils/useAsyncTexture'
import { loadArtworkTexture, type LoadedArtworkTexture } from './artworkTexture'
import { computeArtworkLayout, type ArtworkLayout } from './frameMath'

const promises = new Map<string, Promise<LoadedArtworkTexture>>()
function artworkResource(url: string, fallbackAspect: number) {
  let p = promises.get(url)
  if (!p) {
    p = loadArtworkTexture(url, fallbackAspect, 8)
    promises.set(url, p)
  }
  return p
}

const FRAME_MATERIAL: Record<string, MaterialKey> = { oak: 'oakFrame', walnut: 'walnut' }

function frameMaterial(frame: FrameStyle, m: Record<MaterialKey, THREE.Material>) {
  if (frame.material === 'paint') {
    return new THREE.MeshStandardMaterial({ color: frame.color, roughness: frame.roughness, metalness: 0 })
  }
  if (frame.material === 'brass') {
    return new THREE.MeshStandardMaterial({ color: frame.color, roughness: frame.roughness, metalness: 0.9, envMapIntensity: 1 })
  }
  return m[FRAME_MATERIAL[frame.material] ?? 'oakFrame']
}

/** Frame moulding (4 bars), mat/backing and image plane — all derived from the layout. */
export function ArtworkFrame({ layout, frame, texture, hovered }: { layout: ArtworkLayout; frame: FrameStyle; texture: THREE.Texture; hovered: boolean }) {
  const m = useMaterials()
  const fw = frame.frameWidth
  const fd = frame.frameDepth
  const { outer, mat, image, imageZ } = layout

  const mouldMat = useMemo(() => (fw > 0 ? frameMaterial(frame, m) : null), [frame, fw, m])
  const matMat = useMemo(() => new THREE.MeshStandardMaterial({ color: frame.matColor, roughness: 0.92 }), [frame.matColor])
  const backingMat = useMemo(() => new THREE.MeshStandardMaterial({ color: frame.backingColor, roughness: 0.9 }), [frame.backingColor])
  const imageMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.86,
        metalness: 0,
        envMapIntensity: 0.35,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    [texture],
  )
  useEffect(() => {
    imageMat.emissive.set(hovered ? '#ffffff' : '#000000')
    imageMat.emissiveMap = hovered ? texture : null
    imageMat.emissiveIntensity = hovered ? 0.06 : 0
    imageMat.needsUpdate = true
  }, [hovered, imageMat, texture])

  useEffect(
    () => () => {
      matMat.dispose()
      backingMat.dispose()
      imageMat.dispose()
      if (mouldMat && (frame.material === 'paint' || frame.material === 'brass')) mouldMat.dispose()
    },
    [matMat, backingMat, imageMat, mouldMat, frame.material],
  )

  const bars = useMemo(() => {
    if (fw <= 0) return []
    const innerH = outer.h - 2 * fw
    return [
      { size: [outer.w, fw, fd] as Vec3, pos: [0, outer.h / 2 - fw / 2, fd / 2] as Vec3 },
      { size: [outer.w, fw, fd] as Vec3, pos: [0, -outer.h / 2 + fw / 2, fd / 2] as Vec3 },
      { size: [fw, innerH, fd] as Vec3, pos: [-outer.w / 2 + fw / 2, 0, fd / 2] as Vec3 },
      { size: [fw, innerH, fd] as Vec3, pos: [outer.w / 2 - fw / 2, 0, fd / 2] as Vec3 },
    ]
  }, [outer.w, outer.h, fw, fd])

  const framed = fw > 0
  const backDepth = framed ? Math.max(0.004, imageZ) : frame.backingDepth
  return (
    <group>
      {bars.map((b, i) => (
        <mesh key={i} position={b.pos} material={mouldMat!} castShadow receiveShadow>
          <boxGeometry args={b.size} />
        </mesh>
      ))}
      {/* mat (framed) or stretched-panel backing (frameless) */}
      <mesh position={[0, 0, backDepth / 2]} material={framed && frame.matWidth > 0 ? matMat : backingMat} castShadow receiveShadow>
        <boxGeometry args={[framed ? mat.w : image.w, framed ? mat.h : image.h, backDepth]} />
      </mesh>
      <mesh position={[0, 0, imageZ + 0.0008]} material={imageMat} receiveShadow>
        <planeGeometry args={[image.w, image.h]} />
      </mesh>
    </group>
  )
}

function WallLabel({ config, position }: { config: ArtworkConfig; position: Vec3 }) {
  const w = 0.2
  const h = 0.12
  const tex = useAsyncTexture(
    () =>
      createLabelTexture(
        [
          { text: config.title, style: 'title' },
          { text: config.tradition, style: 'meta' },
          { text: config.placeholder ? 'Placeholder — awaiting workshop deliverable' : (config.artisan ?? config.region ?? ''), style: 'body' },
        ],
        w,
        h,
      ),
    [config.title, config.tradition, config.placeholder],
  )
  if (!tex) return null
  return (
    <mesh position={position} castShadow={false} receiveShadow>
      <boxGeometry args={[w, h, 0.004]} />
      <meshStandardMaterial attach="material" map={tex} roughness={0.85} />
    </mesh>
  )
}

function LoadedArtwork({ config }: { config: ArtworkConfig }) {
  const res = use(artworkResource(config.image, config.maxWidth / config.maxHeight))
  return <ArtworkBody config={config} res={res} />
}

function ArtworkBody({ config, res }: { config: ArtworkConfig; res: LoadedArtworkTexture }) {
  const tier = useMuseum((s) => s.tier)
  const preset = withDevOverrides(QUALITY_PRESETS[tier])
  const select = useMuseum((s) => s.select)
  const setHovered = useMuseum((s) => s.setHovered)
  const [hovered, setHover] = useState(false)

  useEffect(() => {
    res.texture.anisotropy = preset.textureAnisotropy
    res.texture.needsUpdate = true
  }, [res.texture, preset.textureAnisotropy])

  const frame = useMemo(() => resolveFrame(config.frame), [config.frame])
  const layout = useMemo(
    () => computeArtworkLayout(res.width, res.height, frame, { maxWidth: config.maxWidth, maxHeight: config.maxHeight, physicalWidth: config.physicalWidth }),
    [res.width, res.height, frame, config.maxWidth, config.maxHeight, config.physicalWidth],
  )
  const cy = config.placement.centerHeight ?? MUSEUM.display.artworkCenterHeight
  const place = useMemo(
    () => surfacePoint(config.placement.surface, config.placement.at, cy, MUSEUM.display.wallStandOff),
    [config.placement.surface, config.placement.at, cy],
  )

  // Interaction registry (centre sits on the image plane).
  useEffect(() => {
    const [x, y, z] = place.position
    const [nx, , nz] = place.normal
    return registerItem({
      id: config.id,
      kind: 'artwork',
      title: config.title,
      center: [x + nx * layout.imageZ, y, z + nz * layout.imageZ],
      normal: place.normal,
      size: [layout.outer.w, layout.outer.h],
    })
  }, [config.id, config.title, place, layout])

  // Accent spotlight from the nearest track.
  const spot = useMemo(() => {
    if (config.spotlight?.enabled === false) return null
    const mount = mountFor(config.placement.surface, config.placement.at)
    const target: Vec3 = [place.position[0], cy - 0.04, place.position[2]]
    const dist = Math.hypot(mount[0] - target[0], mount[1] - target[1], mount[2] - target[2])
    const angle = coverAngle(layout.outer.w, layout.outer.h, dist, config.spotlight?.spread ?? 1)
    // Keep perceived brightness similar regardless of throw distance (inverse square).
    const intensity = (config.spotlight?.intensity ?? LIGHTING.track.artworkIntensity) * (dist / 2.2) ** 2
    return { mount, target, angle, intensity }
  }, [config.spotlight, config.placement.surface, config.placement.at, place, cy, layout.outer.w, layout.outer.h])

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (e.delta > 6 || useMuseum.getState().phase !== 'entered') return
    select({ kind: 'artwork', id: config.id })
    focusOn('artwork', config.id)
  }
  // Double-click: full-screen "Examine closely" deep-zoom viewer.
  const onDoubleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (e.delta > 6 || useMuseum.getState().phase !== 'entered' || useMuseum.getState().inspecting) return
    openExamine(config.id)
  }
  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    setHover(true)
    setHovered({ kind: 'artwork', id: config.id })
    document.body.style.cursor = 'pointer'
  }
  const onOut = () => {
    setHover(false)
    setHovered(null)
    document.body.style.cursor = ''
  }

  // Wall label: to the right of the work, just below centre (museum convention).
  const labelOffset = layout.outer.w / 2 + 0.22
  const labelPos: Vec3 = [labelOffset, -Math.min(0.25, layout.outer.h / 2 - 0.1), 0.002]

  return (
    <group>
      <group position={place.position} rotation={[0, place.rotationY, 0]}>
        <group onClick={onClick} onDoubleClick={onDoubleClick} onPointerOver={onOver} onPointerOut={onOut}>
          <ArtworkFrame layout={layout} frame={frame} texture={res.texture} hovered={hovered} />
        </group>
        {config.label !== false && <WallLabel config={config} position={labelPos} />}
      </group>
      {spot && <TrackSpot position={spot.mount} target={spot.target} intensity={spot.intensity} angle={spot.angle} />}
    </group>
  )
}

/**
 * Error-contained, suspense-loaded artwork. Image load failures already resolve to an
 * "image unavailable" card inside loadArtworkTexture; the boundary is a last resort.
 */
export function Artwork({ config }: { config: ArtworkConfig }) {
  return (
    <ErrorBoundary fallback={null}>
      <Suspense fallback={null}>
        <LoadedArtwork config={config} />
      </Suspense>
    </ErrorBoundary>
  )
}
