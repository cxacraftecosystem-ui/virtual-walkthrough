import { useEffect, useRef, useState } from 'react'
import { useProgress } from '@react-three/drei'
import { useMuseum } from '../state/store'
import { EXHIBITION_TITLE } from '../config/infographics'
import { Rosette } from './icons'
import { requestAmbientStart } from './audio'
import { tour } from '../tour/engine'

/** Delay before the tour starts walking, so the entry fade has cleared. */
const TOUR_DELAY_MS = 1300

const SAFETY_TIMEOUT_MS = 40000
/** If no loader ever reports (fully procedural scene), declare ready after this. */
const IDLE_GRACE_MS = 1600
const LEAVE_MS = 1150

const isCoarse = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches

export function EntryScreen() {
  const phase = useMuseum((s) => s.phase)
  const setPhase = useMuseum((s) => s.setPhase)
  const { progress, loaded, total } = useProgress()
  const [gone, setGone] = useState(phase === 'entered')
  const [shown, setShown] = useState(0)
  const mountedAt = useRef(performance.now())
  const enterRef = useRef<HTMLButtonElement>(null)
  const autostart = useRef(
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('autostart'),
  )

  // Loading → ready.
  useEffect(() => {
    if (phase !== 'loading') return
    const check = () => {
      const s = useProgress.getState()
      const elapsed = performance.now() - mountedAt.current
      const assetsDone = !s.active && (s.progress >= 100 || (s.total === 0 && elapsed > IDLE_GRACE_MS))
      // Also wait for the scene's shaders to finish compiling (see Precompile in MuseumScene).
      const finished = assetsDone && useMuseum.getState().sceneCompiled
      if (finished || elapsed > SAFETY_TIMEOUT_MS) {
        if (useMuseum.getState().phase === 'loading') setPhase('ready')
      }
    }
    check()
    const id = window.setInterval(check, 250)
    return () => window.clearInterval(id)
  }, [phase, setPhase])

  // Smoothly animated progress figure.
  useEffect(() => {
    const target = phase === 'loading' ? (total === 0 ? 60 : progress) : 100
    let raf = 0
    const tick = () => {
      setShown((v) => {
        const next = v + (target - v) * 0.12
        return Math.abs(target - next) < 0.4 ? target : next
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    const stop = window.setTimeout(() => cancelAnimationFrame(raf), 1500)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(stop)
    }
  }, [progress, total, phase])

  const enter = (withTour = false) => {
    if (useMuseum.getState().phase === 'entered') return
    setPhase('entered')
    if (useMuseum.getState().soundOn) requestAmbientStart()
    if (withTour) window.setTimeout(() => tour.start(0), TOUR_DELAY_MS)
  }

  // Autostart / focus when ready.
  useEffect(() => {
    if (phase !== 'ready') return
    if (autostart.current) {
      enter(new URLSearchParams(window.location.search).has('tour'))
      return
    }
    enterRef.current?.focus({ preventScroll: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // Unmount after the fade-out.
  useEffect(() => {
    if (phase !== 'entered' || gone) return
    const t = window.setTimeout(() => setGone(true), LEAVE_MS)
    return () => window.clearTimeout(t)
  }, [phase, gone])

  if (gone) return null

  const leaving = phase === 'entered'
  const ready = phase !== 'loading'
  const pct = Math.round(shown)
  const coarse = isCoarse()

  return (
    <div
      className={`ui-entry${leaving ? ' is-leaving' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ui-entry-title"
      aria-hidden={leaving || undefined}
    >
      <div className="ui-entry__motif" aria-hidden="true">
        <svg preserveAspectRatio="xMidYMid slice">
          <defs>
            <pattern id="ui-entry-pattern" width="72" height="72" patternUnits="userSpaceOnUse">
              <g fill="none" stroke="currentColor" strokeWidth="1">
                <circle cx="36" cy="36" r="10" />
                <path d="M36 18c5 6 5 12 0 18-5-6-5-12 0-18zM36 54c5-6 5-12 0-18-5 6-5 12 0 18zM18 36c6-5 12-5 18 0-6 5-12 5-18 0zM54 36c-6-5-12-5-18 0 6 5 12 5 18 0z" />
                <circle cx="0" cy="0" r="3" />
                <circle cx="72" cy="0" r="3" />
                <circle cx="0" cy="72" r="3" />
                <circle cx="72" cy="72" r="3" />
              </g>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#ui-entry-pattern)" />
        </svg>
      </div>

      <header className="ui-entry__brand" aria-label="Presented by">
        {/* Plain <img>: tiny static brand marks from /public (next/image adds nothing here). */}
        <img
          className="ui-entry__logo ui-entry__logo--dc"
          src="/brand/dc-handicrafts.png"
          width={642}
          height={240}
          alt="DC Handicrafts — Indian Handicrafts, continuing tradition"
          decoding="async"
          draggable={false}
        />
        <img
          className="ui-entry__logo ui-entry__logo--iit"
          src="/brand/iit-kharagpur.svg"
          width={268}
          height={300}
          alt="Indian Institute of Technology Kharagpur"
          decoding="async"
          draggable={false}
        />
      </header>

      <div className="ui-entry__inner">
        <Rosette className="ui-entry__ornament" />
        <div className="ui-kicker">{EXHIBITION_TITLE.kicker}</div>
        <h1 id="ui-entry-title" className="ui-entry__title">
          {EXHIBITION_TITLE.title}
        </h1>
        <p className="ui-entry__subtitle">
          Carved wood, natural dye and cloth — a walk through the craft of printing by hand.
        </p>

        <div className="ui-entry__rule" />

        <div className="ui-entry__status" aria-live="polite">
          {!ready ? (
            <div className="ui-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Loading exhibition">
              <div className="ui-progress__track">
                <div className="ui-progress__bar" style={{ transform: `scaleX(${Math.max(0.02, shown / 100)})` }} />
              </div>
              <div className="ui-progress__meta">
                <span>{total > 0 ? 'Hanging the works' : 'Preparing the galleries'}</span>
                <span>{total > 0 ? `${loaded} / ${total}` : `${pct}%`}</span>
              </div>
            </div>
          ) : (
            <div className="ui-entry__actions">
              <button ref={enterRef} type="button" className="ui-btn ui-entry__enter" onClick={() => enter()} disabled={leaving}>
                Enter Exhibition
              </button>
              <button type="button" className="ui-btn ui-btn--ghost ui-entry__tour" onClick={() => enter(true)} disabled={leaving}>
                Take the guided tour
              </button>
            </div>
          )}
          <p className="ui-entry__note">
            {coarse ? 'Best experienced in landscape with headphones' : 'Best experienced on desktop with headphones'}
          </p>
          <p className="ui-entry__hint">
            {coarse
              ? 'Drag to look · joystick to walk · tap an artwork for details'
              : 'Drag to look · W A S D to walk · click an artwork for details'}
          </p>
        </div>
      </div>

      <div className="ui-entry__footer">{EXHIBITION_TITLE.subtitle}</div>
    </div>
  )
}
