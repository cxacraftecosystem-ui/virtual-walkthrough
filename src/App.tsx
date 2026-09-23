import { PerformanceMonitor } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { useEffect, useState } from 'react'
import * as THREE from 'three'
import { LIGHTING } from './museum/config/lighting'
import { MUSEUM } from './museum/config/museum'
import { autoCeiling, QUALITY_ORDER, QUALITY_PRESETS, withDevOverrides } from './museum/config/quality'
import { DebugOverlay } from './museum/debug/DebugOverlay'
import { MuseumScene } from './museum/MuseumScene'
import { useArrival } from './museum/navigation/ArrivalFlight'
import { useMuseum } from './museum/state/store'
import { teleport, visitor } from './museum/state/visitor'
import { InspectModal } from './museum/ui/InspectModal'
import { UIOverlay } from './museum/ui/UIOverlay'
import { hasWebGL, WebGLUnsupported } from './museum/ui/WebGLUnsupported'
import { ErrorBoundary } from './museum/utils/ErrorBoundary'
import { tr } from './museum/i18n'
import { reportError } from './museum/utils/errorReporter'
import { webgpuGL, webgpuRequested } from './museum/utils/renderer'

// Small automation/debug handle (used by scripts/screenshots.mjs and handy in the console).
declare global {
  interface Window {
    __museum?: { teleport: typeof teleport; visitor: typeof visitor; store: typeof useMuseum; gl?: THREE.WebGLRenderer }
  }
}
window.__museum = { teleport, visitor, store: useMuseum }

/**
 * Adaptive quality ("auto"):
 *  • continuous resolution scaling inside the tier's DPR range (no reload, every ~1 s),
 *  • step UP a tier when the device holds the display's refresh rate with headroom,
 *  • step DOWN when it can't hold ~32 fps.
 * Tier changes rebuild the renderer (~1–2 s), so they are rationed: at most 3 per session,
 * never above the device-class ceiling, and never back up after a step down (no ping-pong).
 */
const adaptive = { changes: 0, declined: false }

function AdaptiveQuality() {
  const quality = useMuseum((s) => s.quality)
  const phase = useMuseum((s) => s.phase)
  const tier = useMuseum((s) => s.tier)
  const setDpr = useThree((s) => s.setDpr)
  const flying = useArrival((s) => s.active)
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    // The arrival flight is the heaviest view of the visit (no culling): judge the device after it.
    if (phase !== 'entered' || flying) return
    const t = setTimeout(() => setArmed(true), 5000)
    return () => clearTimeout(t)
  }, [phase, tier, flying])
  if (quality !== 'auto' || !armed) return null
  const [lo, hi] = QUALITY_PRESETS[tier].dpr
  const deviceMax = Math.min(hi, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)
  return (
    <PerformanceMonitor
      ms={400}
      iterations={6}
      bounds={(refresh) => [Math.min(34, refresh * 0.55), Math.max(55, refresh * 0.95)]}
      flipflops={4}
      onChange={({ factor }) => setDpr(Math.round((lo + (Math.max(lo, deviceMax) - lo) * factor) * 20) / 20)}
      onIncline={() => {
        const st = useMuseum.getState()
        const i = QUALITY_ORDER.indexOf(st.tier)
        const ceiling = QUALITY_ORDER.indexOf(autoCeiling())
        if (adaptive.declined || adaptive.changes >= 3 || i >= ceiling) return
        adaptive.changes++
        st.setTier(QUALITY_ORDER[i + 1])
      }}
      onDecline={() => {
        const st = useMuseum.getState()
        const i = QUALITY_ORDER.indexOf(st.tier)
        if (i <= 0 || adaptive.changes >= 3) return
        adaptive.changes++
        adaptive.declined = true
        st.setTier(QUALITY_ORDER[i - 1])
      }}
    />
  )
}

/** A runtime error inside the 3D scene — distinct from "no WebGL" so it isn't misdiagnosed. */
function SceneError() {
  return (
    <div className="ui-nogl" role="alert">
      <div className="ui-nogl__inner">
        <div className="ui-kicker">A Virtual Exhibition</div>
        <h1 className="ui-nogl__title">Hand Block Printing</h1>
        <p>Something went wrong while loading the gallery. Reloading usually fixes it.</p>
        <p>
          <button type="button" className="ui-btn ui-btn--ghost" onClick={() => window.location.reload()}>
            Reload
          </button>
        </p>
      </div>
    </div>
  )
}

export default function App() {
  const tier = useMuseum((s) => s.tier)
  const compiled = useMuseum((s) => s.sceneCompiled)
  const entered = useMuseum((s) => s.phase === 'entered')
  const preset = withDevOverrides(QUALITY_PRESETS[tier])
  const [supported] = useState(hasWebGL)
  const [lost, setLost] = useState(false)

  if (!supported || lost) return <WebGLUnsupported />

  const s = MUSEUM.visitor.start
  return (
    <>
      <div className="museum-canvas">
        <ErrorBoundary key={tier} fallback={<SceneError />}>
          <Canvas
            key={tier}
            frameloop={compiled ? 'always' : 'never'}
            dpr={preset.dpr}
            // PCF ('percentage'): three r186 removed PCFSoftShadowMap (its PCF path is already filtered).
            shadows={preset.shadows ? 'percentage' : false}
            // `?renderer=webgpu` (experimental, navigator.gpu only) → WebGPURenderer with WebGL fallback.
            gl={webgpuRequested() ? (webgpuGL({ antialias: preset.antialias, toneMappingExposure: LIGHTING.exposure }) as never) : {
              antialias: preset.antialias,
              powerPreference: 'high-performance',
              stencil: false,
              toneMapping: THREE.NeutralToneMapping,
              toneMappingExposure: LIGHTING.exposure,
            }}
            camera={{ fov: MUSEUM.visitor.fov, near: 0.05, far: 3000, position: [s.x, MUSEUM.visitor.eyeHeight, s.z] }}
            onCreated={({ gl }) => {
              if (window.__museum) window.__museum.gl = gl
              const canvas = gl.domElement
              let restored = false
              canvas.addEventListener('webglcontextrestored', () => {
                restored = true
              })
              canvas.addEventListener('webglcontextlost', (e) => {
                e.preventDefault()
                restored = false
                // R3F disposes (and deliberately loses) the old context whenever the Canvas
                // remounts — e.g. on a quality change. Only a loss on the LIVE canvas that the
                // browser doesn't restore within a few seconds is a genuine GPU failure.
                window.setTimeout(() => {
                  if (canvas.isConnected && !restored) {
                    reportError(new Error('WebGL context lost (not restored within 3 s)'), { kind: 'webgl' })
                    setLost(true)
                  }
                }, 3000)
              })
            }}
          >
            <MuseumScene />
            <AdaptiveQuality />
          </Canvas>
        </ErrorBoundary>
      </div>
      {!compiled && entered && (
        <div
          role="status"
          style={{
            position: 'fixed',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 40,
            padding: '12px 20px',
            borderRadius: 6,
            background: 'rgba(245, 241, 232, 0.92)',
            color: '#2b2621',
            font: '500 13px/1.4 Inter, system-ui, sans-serif',
            letterSpacing: '0.04em',
            boxShadow: '0 12px 32px -12px rgba(43,38,33,.3)',
            pointerEvents: 'none',
          }}
        >
          {tr('hud.applyingGraphics')}
        </div>
      )}
      <UIOverlay />
      <ErrorBoundary fallback={null}>
        <InspectModal />
      </ErrorBoundary>
      <DebugOverlay />
    </>
  )
}
