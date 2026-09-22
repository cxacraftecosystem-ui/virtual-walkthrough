import { PerformanceMonitor } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useEffect, useState } from 'react'
import * as THREE from 'three'
import { LIGHTING } from './museum/config/lighting'
import { MUSEUM } from './museum/config/museum'
import { QUALITY_ORDER, QUALITY_PRESETS, withDevOverrides } from './museum/config/quality'
import { DebugOverlay } from './museum/debug/DebugOverlay'
import { MuseumScene } from './museum/MuseumScene'
import { useMuseum } from './museum/state/store'
import { teleport, visitor } from './museum/state/visitor'
import { InspectModal } from './museum/ui/InspectModal'
import { UIOverlay } from './museum/ui/UIOverlay'
import { hasWebGL, WebGLUnsupported } from './museum/ui/WebGLUnsupported'
import { ErrorBoundary } from './museum/utils/ErrorBoundary'

// Small automation/debug handle (used by scripts/screenshots.mjs and handy in the console).
declare global {
  interface Window {
    __museum?: { teleport: typeof teleport; visitor: typeof visitor; store: typeof useMuseum }
  }
}
window.__museum = { teleport, visitor, store: useMuseum }

/** In "auto" quality, step down a tier when the frame rate stays low after entering. */
function AdaptiveQuality() {
  const quality = useMuseum((s) => s.quality)
  const phase = useMuseum((s) => s.phase)
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (phase !== 'entered') return
    const t = setTimeout(() => setArmed(true), 4000)
    return () => clearTimeout(t)
  }, [phase])
  if (quality !== 'auto' || !armed) return null
  return (
    <PerformanceMonitor
      bounds={() => [32, 58]}
      flipflops={2}
      onDecline={() => {
        const { tier, setTier } = useMuseum.getState()
        const i = QUALITY_ORDER.indexOf(tier)
        if (i > 0) setTier(QUALITY_ORDER[i - 1])
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
            gl={{
              antialias: preset.antialias,
              powerPreference: 'high-performance',
              stencil: false,
              toneMapping: THREE.NeutralToneMapping,
              toneMappingExposure: LIGHTING.exposure,
            }}
            camera={{ fov: MUSEUM.visitor.fov, near: 0.05, far: 3000, position: [s.x, MUSEUM.visitor.eyeHeight, s.z] }}
            onCreated={({ gl }) => {
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
                  if (canvas.isConnected && !restored) setLost(true)
                }, 3000)
              })
            }}
          >
            <MuseumScene />
            <AdaptiveQuality />
          </Canvas>
        </ErrorBoundary>
      </div>
      {!compiled && useMuseum.getState().phase === 'entered' && (
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
          Applying graphics settings…
        </div>
      )}
      <UIOverlay />
      <InspectModal />
      <DebugOverlay />
    </>
  )
}
