/**
 * UI-facing state of the photo-mode path tracer (effects/PathTracer.tsx). Kept free of any
 * three-gpu-pathtracer import so the UI never pulls the (lazy-loaded) tracer into the bundle.
 */
import { create } from 'zustand'

export type RayTraceStatus =
  /** not in photo mode / switched off */
  | 'off'
  /** waiting for the view to be still */
  | 'waiting'
  /** loading the library / building the BVH for the visible zones */
  | 'building'
  /** compiling the path-tracing shader */
  | 'compiling'
  | 'tracing'
  | 'converged'
  /** this GPU / browser can't path trace (no float render targets, errors) */
  | 'unsupported'

interface RayTraceState {
  /** Visitor's choice; null = tier default (on for High/Ultra, off for Low/Medium). */
  enabled: boolean | null
  status: RayTraceStatus
  samples: number
  /** Sample count at which tracing stops (converged). */
  target: number
  setEnabled: (v: boolean) => void
}

const KEY = 'museum.raytrace'

function stored(): boolean | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === '1' ? true : v === '0' ? false : null
  } catch {
    return null
  }
}

export const useRayTrace = create<RayTraceState>((set) => ({
  enabled: typeof window !== 'undefined' ? stored() : null,
  status: 'off',
  samples: 0,
  target: 256,
  setEnabled: (enabled) => {
    try {
      localStorage.setItem(KEY, enabled ? '1' : '0')
    } catch {
      /* ignore */
    }
    set({ enabled })
  },
}))

/**
 * Photo capture: when the tracer is running, wait (bounded) for it to converge so the saved PNG
 * is the path-traced image rather than a noisy intermediate or the raster frame.
 */
export function awaitRayTraceForCapture(maxMs = 20000): Promise<void> {
  const busy = (s: RayTraceStatus) => s === 'building' || s === 'compiling' || s === 'tracing'
  if (!busy(useRayTrace.getState().status)) return Promise.resolve()
  return new Promise((resolve) => {
    const t = window.setTimeout(done, maxMs)
    const unsub = useRayTrace.subscribe((s) => {
      if (!busy(s.status)) done()
    })
    function done() {
      window.clearTimeout(t)
      unsub()
      resolve()
    }
  })
}

// Automation / console handle.
if (typeof window !== 'undefined') (window as unknown as { __raytrace?: typeof useRayTrace }).__raytrace = useRayTrace
