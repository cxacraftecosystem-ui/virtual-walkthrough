import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { useMuseum } from '../state/store'
import { visitor } from '../state/visitor'

const DEADZONE = 0.08

function useCoarsePointer() {
  const [coarse, setCoarse] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches)
  useEffect(() => {
    const mq = window.matchMedia?.('(pointer: coarse)')
    if (!mq) return
    const on = () => setCoarse(mq.matches)
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])
  return coarse
}

/** Virtual walking joystick for touch devices. Writes visitor.joystick (y = forward). */
export function TouchJoystick() {
  const coarse = useCoarsePointer()
  const entered = useMuseum((s) => s.phase === 'entered')
  const hidden = useMuseum((s) => !!s.inspecting || s.helpOpen || !!s.selection)
  const rootRef = useRef<HTMLDivElement>(null)
  const knobRef = useRef<HTMLDivElement>(null)
  const pointerId = useRef<number | null>(null)
  const [active, setActive] = useState(false)

  const release = () => {
    pointerId.current = null
    visitor.joystick.x = 0
    visitor.joystick.y = 0
    if (knobRef.current) knobRef.current.style.transform = ''
    setActive(false)
  }

  // Never leave the visitor walking when the stick disappears.
  useEffect(() => {
    if (hidden || !entered) release()
  }, [hidden, entered])
  useEffect(() => () => release(), [])

  if (!coarse || !entered) return null

  const update = (e: RPointerEvent<HTMLDivElement>) => {
    const el = rootRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const radius = r.width / 2
    const travel = radius * 0.62
    let dx = e.clientX - (r.left + radius)
    let dy = e.clientY - (r.top + radius)
    const len = Math.hypot(dx, dy)
    if (len > travel) {
      dx = (dx / len) * travel
      dy = (dy / len) * travel
    }
    if (knobRef.current) knobRef.current.style.transform = `translate(${dx}px, ${dy}px)`
    let nx = dx / travel
    let ny = -dy / travel
    const mag = Math.hypot(nx, ny)
    if (mag < DEADZONE) {
      nx = 0
      ny = 0
    } else {
      // Re-map past the dead-zone for a smooth start.
      const k = (mag - DEADZONE) / (1 - DEADZONE) / mag
      nx *= k
      ny *= k
    }
    visitor.joystick.x = Math.max(-1, Math.min(1, nx))
    visitor.joystick.y = Math.max(-1, Math.min(1, ny))
  }

  const stop = (e: RPointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    if (pointerId.current !== e.pointerId) return
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
    release()
  }

  return (
    <div
      ref={rootRef}
      className={`ui-joy ui-interactive${active ? ' is-active' : ''}${hidden ? ' is-hidden' : ''}`}
      role="application"
      aria-label="Walk joystick"
      onPointerDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (pointerId.current !== null) return
        pointerId.current = e.pointerId
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          /* ignore */
        }
        visitor.walkTarget = null
        setActive(true)
        update(e)
      }}
      onPointerMove={(e) => {
        e.stopPropagation()
        if (pointerId.current !== e.pointerId) return
        e.preventDefault()
        update(e)
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={(e) => {
        if (pointerId.current === e.pointerId) release()
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="ui-joy__base" />
      <div className="ui-joy__knob" ref={knobRef} />
    </div>
  )
}
