/**
 * "View in your space" for the object open in the 3D inspection viewer.
 *
 *  (i)   Android / Chrome — WebXR immersive-ar: a dedicated transparent canvas (mounted hidden while
 *        the viewer is open, so the session can start inside the click) with hit-test placement at
 *        real scale; tap to place / move, DOM-overlay "Done".
 *  (ii)  iOS / iPadOS — AR Quick Look: the model is rendered once off-screen, exported with three's
 *        USDZExporter and opened through <a rel="ar">.
 *  (iii) Neither — no button: the inspection viewer itself is the fallback.
 */
import { Canvas } from '@react-three/fiber'
import { ContactShadows, Environment, Lightformer } from '@react-three/drei'
import { XR, XRDomOverlay, useXR, useXRHitTest, useXRInputSourceEvent } from '@react-three/xr'
import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import * as THREE from 'three'
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js'
import { getExhibit } from '../config/exhibits'
import { getSceneObject } from '../config/objects'
import { Artifact3D } from '../exhibits/Artifact3D'
import { ModelClock } from '../models/modelMaterials'
import { OBJECT_INSPECT_PREFIX, ObjectModel, objectBounds } from '../models/SceneObjects'
import { arStore, quickLookSupported, useXRMode, xrSupported } from './xrStore'

/** The inspected item at real scale, centred on the origin, bottom at y = 0. */
export function RealScaleModel({ inspectId }: { inspectId: string }) {
  if (inspectId.startsWith(OBJECT_INSPECT_PREFIX)) {
    const obj = getSceneObject(inspectId.slice(OBJECT_INSPECT_PREFIX.length))
    if (!obj) return null
    const { center, size } = objectBounds(obj)
    return (
      <group position={[-center[0], -(center[1] - size[1] / 2), -center[2]]}>
        <ModelClock />
        <ObjectModel config={obj} />
      </group>
    )
  }
  const ex = getExhibit(inspectId)
  return ex ? <Artifact3D exhibit={ex} /> : null
}

function ARLights() {
  return (
    <>
      <hemisphereLight args={['#fff6ea', '#6b5e50', 0.9]} />
      <directionalLight position={[0.8, 2, 0.6]} intensity={1.6} color="#fff4e6" />
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={2} color="#fff6ea" position={[0, 3, 1.5]} rotation-x={-Math.PI / 2.6} scale={[4, 2, 1]} />
        <Lightformer form="rect" intensity={0.8} color="#f1ece4" position={[-3, 1, 0]} rotation-y={Math.PI / 2} scale={[3, 2, 1]} />
        <Lightformer form="rect" intensity={1} color="#ffe8d0" position={[3, 1.2, -1]} rotation-y={-Math.PI / 2} scale={[3, 1.5, 1]} />
      </Environment>
    </>
  )
}

const _m = new THREE.Matrix4()
const _p = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _s = new THREE.Vector3()

function ARPlacement({ inspectId, title }: { inspectId: string; title: string }) {
  const reticle = useRef<THREE.Mesh>(null)
  const model = useRef<THREE.Group>(null)
  const [placed, setPlaced] = useState(false)
  const found = useRef(false)
  const [hasSurface, setHasSurface] = useState(false)
  const session = useXR((s) => s.session)

  useXRHitTest((results, getWorldMatrix) => {
    const r = reticle.current
    if (!r) return
    if (results.length === 0 || !getWorldMatrix(_m, results[0])) {
      r.visible = false
      return
    }
    _m.decompose(_p, _q, _s)
    r.position.copy(_p)
    r.quaternion.copy(_q)
    r.visible = true
    if (!found.current) {
      found.current = true
      setHasSurface(true)
    }
  }, 'viewer')

  useXRInputSourceEvent(
    'all',
    'select',
    () => {
      const r = reticle.current
      const m = model.current
      if (!r || !m || !r.visible) return
      m.position.copy(r.position)
      m.visible = true
      setPlaced(true)
    },
    [],
  )

  return (
    <>
      <ARLights />
      <mesh ref={reticle} visible={false} matrixAutoUpdate>
        <ringGeometry args={[0.07, 0.09, 40]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.9} side={THREE.DoubleSide} />
      </mesh>
      <group ref={model} visible={false}>
        <Suspense fallback={null}>
          <RealScaleModel inspectId={inspectId} />
        </Suspense>
        <ContactShadows scale={1.4} opacity={0.45} blur={2.4} far={0.8} resolution={256} color="#000000" />
      </group>
      <XRDomOverlay className="xr-ar-overlay">
        <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', fontFamily: 'Inter, system-ui, sans-serif' }}>
          <div
            style={{
              position: 'absolute',
              left: '50%',
              bottom: 32,
              transform: 'translateX(-50%)',
              padding: '10px 16px',
              borderRadius: 8,
              background: 'rgba(245,241,232,.92)',
              color: '#2b2621',
              fontSize: 14,
              textAlign: 'center',
              maxWidth: '86vw',
            }}
          >
            <strong style={{ display: 'block', marginBottom: 4 }}>{title}</strong>
            {!hasSurface ? 'Move your phone slowly to find the floor or a table…' : placed ? 'Shown at real size · tap to move it' : 'Tap to place it at real size'}
          </div>
          <button
            type="button"
            onClick={() => void session?.end()}
            style={{
              position: 'absolute',
              top: 18,
              right: 18,
              pointerEvents: 'auto',
              padding: '10px 16px',
              borderRadius: 6,
              border: 0,
              background: '#8a5a3b',
              color: '#fbf7f0',
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: '.06em',
              textTransform: 'uppercase',
            }}
          >
            Done
          </button>
        </div>
      </XRDomOverlay>
    </>
  )
}

/** Hidden canvas holding the AR XR store; renders only while the AR session runs. */
function ARCanvas({ inspectId, title }: { inspectId: string; title: string }) {
  const mode = useXRMode((s) => s.mode)
  return createPortal(
    <div
      aria-hidden="true"
      style={{ position: 'fixed', left: 0, top: 0, width: 2, height: 2, opacity: 0, pointerEvents: 'none', zIndex: -1 }}
    >
      <Canvas
        frameloop={mode === 'ar' ? 'always' : 'never'}
        dpr={1}
        gl={{ alpha: true, antialias: true, preserveDrawingBuffer: false }}
        camera={{ near: 0.01, far: 40 }}
        onCreated={({ scene }) => {
          scene.background = null
        }}
      >
        <XR store={arStore}>{mode === 'ar' && <ARPlacement inspectId={inspectId} title={title} />}</XR>
      </Canvas>
    </div>,
    document.body,
  )
}

/* ------------------------------------------------------------------ iOS Quick Look */

/** Renders the model off-screen, then exports USDZ (after textures / GLBs settle). */
function USDZBaker({ inspectId, onDone }: { inspectId: string; onDone: (url: string | null) => void }) {
  return createPortal(
    <div aria-hidden="true" style={{ position: 'fixed', left: -10, top: -10, width: 4, height: 4, opacity: 0, pointerEvents: 'none' }}>
      <Canvas frameloop="always" dpr={1} gl={{ antialias: false }}>
        <Suspense fallback={null}>
          <Baker onDone={onDone}>
            <RealScaleModel inspectId={inspectId} />
          </Baker>
        </Suspense>
      </Canvas>
    </div>,
    document.body,
  )
}

function toStandard(root: THREE.Object3D) {
  const clone = root.clone(true)
  clone.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const conv = (m: THREE.Material) => {
      if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) return m
      const src = m as THREE.MeshBasicMaterial & { emissive?: THREE.Color }
      return new THREE.MeshStandardMaterial({
        color: src.color ?? new THREE.Color('#bba88f'),
        map: src.map ?? null,
        transparent: src.transparent,
        opacity: src.opacity,
        roughness: 0.8,
        metalness: 0,
      })
    }
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(conv) : conv(mesh.material)
  })
  return clone
}

function Baker({ children, onDone }: { children: ReactNode; onDone: (url: string | null) => void }) {
  const ref = useRef<THREE.Group>(null)
  useEffect(() => {
    let cancelled = false
    // Give GLBs / canvas textures a moment to settle (Suspense already resolved the loaders).
    const t = window.setTimeout(async () => {
      const g = ref.current
      if (!g || cancelled) return
      try {
        g.updateMatrixWorld(true)
        const data = await new USDZExporter().parseAsync(toStandard(g), {
          quickLookCompatible: true,
          maxTextureSize: 1024,
          ar: { anchoring: { type: 'plane' }, planeAnchoring: { alignment: 'horizontal' } },
          includeAnchoringProperties: true,
        } as never)
        if (cancelled) return
        onDone(URL.createObjectURL(new Blob([data as unknown as BlobPart], { type: 'model/vnd.usdz+zip' })))
      } catch (e) {
        console.warn('[museum] USDZ export failed', e)
        if (!cancelled) onDone(null)
      }
    }, 1200)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [onDone])
  return <group ref={ref}>{children}</group>
}

const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='

function QuickLookButton({ inspectId }: { inspectId: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [state, setState] = useState<'baking' | 'ready' | 'failed'>('baking')
  const [bakeKey, setBakeKey] = useState(inspectId)
  if (bakeKey !== inspectId) {
    setBakeKey(inspectId)
    setUrl(null)
    setState('baking')
  }
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url)
  }, [url])
  if (state === 'failed') return null
  return (
    <>
      {state === 'baking' && (
        <USDZBaker
          key={inspectId}
          inspectId={inspectId}
          onDone={(u) => {
            setUrl(u)
            setState(u ? 'ready' : 'failed')
          }}
        />
      )}
      {url ? (
        <a className="inspect-btn xr-ar-btn" rel="ar" href={url}>
          <img src={PIXEL} alt="" width={1} height={1} style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} />
          View in your space
        </a>
      ) : (
        <button type="button" className="inspect-btn xr-ar-btn" disabled>
          Preparing AR…
        </button>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ public button */

/**
 * enterAR() rejects until the freshly mounted <XR> root has handed the store its WebXRManager;
 * retry briefly (well inside the click's transient-activation window that requestSession needs).
 */
async function enterARWhenReady() {
  const until = performance.now() + 2500
  for (;;) {
    try {
      return await arStore.enterAR()
    } catch (e) {
      const notReady = e instanceof Error && /not connected|not yet loaded/i.test(e.message)
      if (!notReady || performance.now() > until) throw e
      await new Promise((r) => setTimeout(r, 50))
    }
  }
}

/** Place in the inspection viewer toolbar. Renders nothing when AR isn't available. */
export function ARButton({ inspectId, title }: { inspectId: string | null; title: string }) {
  const [webxr, setWebxr] = useState(false)
  const [ios] = useState(quickLookSupported)
  const [err, setErr] = useState<string | null>(null)
  // The AR canvas (a third WebGL context) mounts only once the visitor asks for AR.
  const [armed, setArmed] = useState(false)
  const [starting, setStarting] = useState(false)
  useEffect(() => {
    let live = true
    void xrSupported('immersive-ar').then((v) => live && setWebxr(v))
    return () => {
      live = false
    }
  }, [])
  if (!inspectId) return null
  if (webxr) {
    return (
      <>
        {armed && <ARCanvas inspectId={inspectId} title={title} />}
        <button
          type="button"
          className="inspect-btn xr-ar-btn"
          title={err ?? 'Place this object in your room at real size'}
          disabled={starting}
          onClick={async () => {
            setErr(null)
            setArmed(true)
            setStarting(true)
            try {
              await enterARWhenReady()
            } catch (e) {
              setErr(e instanceof Error ? e.message : 'AR could not start')
            } finally {
              setStarting(false)
            }
          }}
        >
          View in your space
        </button>
      </>
    )
  }
  if (ios) return <QuickLookButton inspectId={inspectId} />
  return null
}
