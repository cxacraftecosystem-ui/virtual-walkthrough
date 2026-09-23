/**
 * Full-screen 3D inspection viewer for a hand-block exhibit — or, with
 * `inspect('object:<id>')`, for an inspectable scene object (procedural model or GLB).
 * Has its own <Canvas> (independent of the museum canvas) with a soft studio setup.
 */

import { useCallback, useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react'
import { loc, useLang, useT } from '../i18n'
import { zoneName } from '../i18n/content'
import { useFocusTrap } from '../a11y/focus'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, Lightformer, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { useMuseum } from '../state/store'
import { getExhibit, type ExhibitConfig } from '../config/exhibits'
import { getArtwork } from '../config/artworks'
import { Artifact3D } from '../exhibits/Artifact3D'
import { getSceneObject, type SceneObjectConfig } from '../config/objects'
import { ModelClock } from '../models/modelMaterials'
import { OBJECT_INSPECT_PREFIX, ObjectModel, objectBounds } from '../models/SceneObjects'
import { ARButton } from '../xr/ARView'
import './InspectModal.css'

type OrbitControlsImpl = ComponentRef<typeof OrbitControls>

const FOV = 32
const VIEW_DIR = new THREE.Vector3(0.55, 0.62, 1).normalize()

interface Fit {
  center: THREE.Vector3
  radius: number
}

/** Frames the object, keeps orbit limits in step with its bounds, and handles reset. */
function StudioRig({
  children,
  resetToken,
  onInteract,
  autoRotate,
}: {
  children: ReactNode
  resetToken: number
  onInteract: () => void
  autoRotate: boolean
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const scene = useThree((s) => s.scene)
  const controls = useRef<OrbitControlsImpl>(null)
  const content = useRef<THREE.Group>(null)
  const fit = useRef<Fit | null>(null)
  const box = useRef(new THREE.Box3())
  const sphere = useRef(new THREE.Sphere())
  const [shadowScale, setShadowScale] = useState(0.6)

  const applyPose = useCallback(
    (f: Fit) => {
      const dist = (f.radius / Math.sin(THREE.MathUtils.degToRad(FOV / 2))) * 1.08
      camera.position.copy(f.center).addScaledVector(VIEW_DIR, dist)
      camera.near = Math.max(0.001, dist / 200)
      camera.far = dist * 40
      camera.updateProjectionMatrix()
      const c = controls.current
      if (c) {
        c.target.copy(f.center)
        c.minDistance = f.radius * 1.15
        c.maxDistance = dist * 3
        c.update()
      }
    },
    [camera],
  )

  // measure bounds each frame (cheap: geometry bounding boxes); refit when they change
  useFrame(() => {
    const g = content.current
    if (!g) return
    box.current.setFromObject(g)
    if (box.current.isEmpty()) return
    box.current.getBoundingSphere(sphere.current)
    const r = Math.max(sphere.current.radius, 0.01)
    const prev = fit.current
    if (!prev || Math.abs(prev.radius - r) / prev.radius > 0.02) {
      fit.current = { center: sphere.current.center.clone(), radius: r }
      applyPose(fit.current)
      setShadowScale(r * 3.2)
    }
  })

  useEffect(() => {
    if (resetToken > 0 && fit.current) applyPose(fit.current)
  }, [resetToken, applyPose])

  useEffect(() => {
    scene.background = null
  }, [scene])

  return (
    <>
      <group ref={content}>
        {children}
      </group>
      <ContactShadows position={[0, 0, 0]} scale={shadowScale} opacity={0.5} blur={2.6} far={Math.max(0.3, shadowScale / 3)} resolution={512} color="#2b2621" />
      <OrbitControls
        ref={controls}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        enablePan={false}
        autoRotate={autoRotate}
        autoRotateSpeed={0.7}
        rotateSpeed={0.7}
        zoomSpeed={0.8}
        maxPolarAngle={Math.PI * 0.58}
        onStart={onInteract}
      />
    </>
  )
}

function StudioLights() {
  return (
    <>
      <ambientLight intensity={0.15} />
      {/* key */}
      <directionalLight
        position={[1.2, 2.0, 1.4]}
        intensity={2.1}
        color="#fff4e6"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0002}
        shadow-normalBias={0.01}
        shadow-camera-left={-0.5}
        shadow-camera-right={0.5}
        shadow-camera-top={0.5}
        shadow-camera-bottom={-0.5}
        shadow-camera-near={0.1}
        shadow-camera-far={6}
      />
      {/* fill */}
      <directionalLight position={[-1.6, 0.9, 0.8]} intensity={0.55} color="#e8eef8" />
      {/* rim */}
      <directionalLight position={[-0.4, 1.2, -1.8]} intensity={1.1} color="#ffe9d2" />
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={2.2} color="#fff6ea" position={[0, 3, 1.5]} rotation-x={-Math.PI / 2.6} scale={[4, 2, 1]} />
        <Lightformer form="rect" intensity={0.9} color="#f1ece4" position={[-3, 1, 0]} rotation-y={Math.PI / 2} scale={[3, 2, 1]} />
        <Lightformer form="rect" intensity={1.2} color="#ffe8d0" position={[3, 1.2, -1]} rotation-y={-Math.PI / 2} scale={[3, 1.5, 1]} />
        <Lightformer form="ring" intensity={0.6} color="#ffffff" position={[0, 1, -3]} scale={2} />
        <Lightformer form="rect" intensity={0.25} color="#8a7a66" position={[0, -2, 0]} rotation-x={Math.PI / 2} scale={[6, 6, 1]} />
      </Environment>
    </>
  )
}

/**
 * A scene object normalised to the studio's scale: large installations are shrunk so the
 * key light's shadow frustum (±0.5 m) still covers them; the bottom sits at y = 0.
 */
function StudioObject({ config }: { config: SceneObjectConfig }) {
  const { center, size } = objectBounds(config)
  const s = Math.min(1, 0.8 / Math.max(size[0], size[1], size[2]))
  return (
    <group scale={s}>
      <group position={[-center[0], -(center[1] - size[1] / 2), -center[2]]}>
        <ObjectModel config={config} />
      </group>
    </group>
  )
}

type Shown = { type: 'exhibit'; ex: ExhibitConfig } | { type: 'object'; obj: SceneObjectConfig }

function resolveInspect(id: string | null): Shown | null {
  if (!id) return null
  if (id.startsWith(OBJECT_INSPECT_PREFIX)) {
    const obj = getSceneObject(id.slice(OBJECT_INSPECT_PREFIX.length))
    return obj ? { type: 'object', obj } : null
  }
  const ex = getExhibit(id)
  return ex ? { type: 'exhibit', ex } : null
}

export function InspectModal() {
  const inspecting = useMuseum((s) => s.inspecting)
  const inspect = useMuseum((s) => s.inspect)
  const [shown, setShown] = useState<Shown | null>(null)
  const [closing, setClosing] = useState(false)
  const [resetToken, setResetToken] = useState(0)
  const [autoRotate, setAutoRotate] = useState(() => !useMuseum.getState().reducedMotion)
  const closeBtn = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const t = useT()
  const lang = useLang()
  useFocusTrap(dialogRef, !!inspecting, { autoFocus: false })

  // open / close with a short fade-out
  useEffect(() => {
    const next = resolveInspect(inspecting)
    if (next) {
      setShown(next)
      setClosing(false)
      setAutoRotate(!useMuseum.getState().reducedMotion)
      setResetToken(0)
      if (document.pointerLockElement) document.exitPointerLock?.()
      return
    }
    setClosing(true)
    const t = window.setTimeout(() => {
      setShown(null)
      setClosing(false)
    }, 240)
    return () => window.clearTimeout(t)
  }, [inspecting])

  const close = useCallback(() => inspect(null), [inspect])

  useEffect(() => {
    if (!inspecting) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        close()
      }
    }
    window.addEventListener('keydown', onKey, true)
    closeBtn.current?.focus({ preventScroll: true })
    return () => window.removeEventListener('keydown', onKey, true)
  }, [inspecting, close])

  if (!shown) return null
  const ex = shown.type === 'exhibit' ? shown.ex : null
  const obj = shown.type === 'object' ? shown.obj : null
  const artwork = ex ? getArtwork(ex.artworkId) : undefined
  const isPlaceholder = ex ? !!ex.placeholder || !ex.model : !!obj?.placeholder
  const eyebrow = ex ? (loc(ex, 'tradition', lang) ?? '') : obj ? zoneName(obj.zone, lang) : ''
  const title = (ex ? loc(ex, 'title', lang) : obj ? loc(obj, 'title', lang) : '') ?? ''
  const description = ex ? loc(ex, 'description', lang) : obj ? loc(obj, 'description', lang) : undefined
  const facts: [string, string | undefined][] = ex
    ? [
        [t('info.material'), loc(ex, 'material', lang)],
        [t('info.technique'), loc(ex, 'technique', lang)],
        [t('info.artisan'), loc(ex, 'artisan', lang)],
        [t('info.region'), loc(ex, 'region', lang)],
      ]
    : [
        [t('inspect.model'), obj?.model ? t('inspect.model3d') : t('inspect.procedural')],
        [t('inspect.credit'), obj?.credit ? `${obj.credit.author} · ${obj.credit.license}` : undefined],
      ]

  return (
    <div
      ref={dialogRef}
      className={`inspect-root${closing ? ' inspect-closing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="inspect-title"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="inspect-stage">
        <Canvas
          className="inspect-canvas"
          shadows
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          camera={{ fov: FOV, near: 0.005, far: 20, position: [0.25, 0.3, 0.45] }}
        >
          <StudioLights />
          <StudioRig resetToken={resetToken} autoRotate={autoRotate} onInteract={() => setAutoRotate(false)}>
            {ex ? (
              <Artifact3D exhibit={ex} />
            ) : obj ? (
              <>
                <ModelClock />
                <StudioObject config={obj} />
              </>
            ) : null}
          </StudioRig>
        </Canvas>

        <div className="inspect-toolbar">
          <button
            type="button"
            className="inspect-btn"
            onClick={() => {
              setResetToken((n) => n + 1)
              setAutoRotate(!useMuseum.getState().reducedMotion)
            }}
          >
            {t('inspect.reset')}
          </button>
          <ARButton inspectId={inspecting} title={title} />
        </div>
        <p className="inspect-hint">{t('inspect.hint')}</p>
      </div>

      <aside className="inspect-info">
        <button ref={closeBtn} type="button" className="inspect-btn inspect-close" onClick={close} aria-label={t('inspect.close')}>
          {t('inspect.closeWord')} <span aria-hidden="true">✕</span>
        </button>
        <p className="inspect-eyebrow">{eyebrow}</p>
        <h2 id="inspect-title" className="inspect-title">
          {title}
        </h2>
        {isPlaceholder && <span className="inspect-badge">{t('inspect.placeholder')}</span>}
        {facts.some(([, v]) => v) && (
          <dl className="inspect-facts">
            {facts
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="inspect-fact">
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
          </dl>
        )}
        {description && <p className="inspect-desc">{description}</p>}
        {artwork && (
          <div className="inspect-related">
            <span className="inspect-related-label">{t('inspect.related')}</span>
            <span className="inspect-related-title">{loc(artwork, 'title', lang)}</span>
          </div>
        )}
      </aside>
    </div>
  )
}
