import { useEffect, useRef } from 'react'
import { zoneAt } from '../config/layout'
import { useMuseum } from '../state/store'
import { visitor } from '../state/visitor'

/** Dev-only coordinate readout (visitor position, compass heading, pitch, zone, tier). */
export function DebugOverlay() {
  const debug = useMuseum((s) => s.debug)
  const ref = useRef<HTMLPreElement>(null)
  useEffect(() => {
    if (!debug) return
    let raf = 0
    const tick = () => {
      if (ref.current) {
        const heading = ((-visitor.yaw * 180) / Math.PI + 360) % 360
        ref.current.textContent =
          `x ${visitor.x.toFixed(2)}  z ${visitor.z.toFixed(2)}  eye 1.62\n` +
          `heading ${heading.toFixed(0)}°  pitch ${((visitor.pitch * 180) / Math.PI).toFixed(0)}°\n` +
          `zone ${zoneAt(visitor.x, visitor.z)?.short ?? '—'}  tier ${useMuseum.getState().tier}`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [debug])
  if (!debug) return null
  return (
    <pre
      ref={ref}
      style={{
        position: 'fixed',
        left: 8,
        top: 60,
        zIndex: 50,
        margin: 0,
        padding: '6px 8px',
        font: '11px/1.4 ui-monospace, monospace',
        background: 'rgba(0,0,0,.6)',
        color: '#9ef',
        pointerEvents: 'none',
      }}
    />
  )
}
