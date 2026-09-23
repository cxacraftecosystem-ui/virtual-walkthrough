/** HUD "Enter VR" button — rendered only when navigator.xr supports immersive-vr. */
import { useEffect, useState } from 'react'
import { useMuseum } from '../state/store'
import { liveToast } from '../live/store'
import { useXRMode, vrStore, xrSupported } from './xrStore'

function IconVR() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 8.5c0-1.1.9-2 2-2h13a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-3.2l-1.9-2.4a1.8 1.8 0 0 0-2.8 0L8.7 16.5H5.5a2 2 0 0 1-2-2z" />
      <circle cx="8.3" cy="11.3" r="1.6" />
      <circle cx="15.7" cy="11.3" r="1.6" />
    </svg>
  )
}

export function useVRSupported() {
  const [ok, setOk] = useState(false)
  useEffect(() => {
    let live = true
    void xrSupported('immersive-vr').then((v) => live && setOk(v))
    return () => {
      live = false
    }
  }, [])
  return ok
}

export function VRHudButton() {
  const supported = useVRSupported()
  const mode = useXRMode((s) => s.mode)
  const [busy, setBusy] = useState(false)
  if (!supported) return null
  const inVR = mode === 'vr'
  return (
    <button
      type="button"
      className="ui-icon-btn"
      aria-label={inVR ? 'Exit VR' : 'Enter VR'}
      data-tip={inVR ? 'Exit VR' : 'Enter VR'}
      aria-pressed={inVR}
      disabled={busy || mode === 'ar'}
      onClick={async () => {
        if (inVR) {
          await vrStore.getState().session?.end().catch(() => {})
          return
        }
        setBusy(true)
        try {
          const s = useMuseum.getState()
          if (s.selection) s.select(null)
          if (s.mouseLook) s.setMouseLook(false)
          await vrStore.enterVR()
        } catch (e) {
          liveToast(`Could not start VR: ${e instanceof Error ? e.message : 'unknown error'}`)
        } finally {
          setBusy(false)
        }
      }}
    >
      <IconVR />
    </button>
  )
}
