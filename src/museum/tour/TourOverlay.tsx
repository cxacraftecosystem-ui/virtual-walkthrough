/** Guided-tour caption card + controls (bottom centre; top on phones). */
import { useEffect } from 'react'
import { TOUR_STOPS } from '../config/tour'
import { useMuseum } from '../state/store'
import { IconClose, IconInfo, IconNarration, IconNext, IconPause, IconPlay, IconPrev } from '../ui/icons'
import { narrationSupported, tour, useTour } from './engine'

export function TourOverlay() {
  const active = useTour((s) => s.active)
  const index = useTour((s) => s.index)
  const phase = useTour((s) => s.phase)
  const paused = useTour((s) => s.paused)
  const pauseReason = useTour((s) => s.pauseReason)
  const narration = useTour((s) => s.narration)
  const progress = useTour((s) => s.progress)
  const entered = useMuseum((s) => s.phase === 'entered')
  const inspecting = useMuseum((s) => !!s.inspecting)
  const select = useMuseum((s) => s.select)

  // Leaving the museum view (e.g. hot reload back to entry) ends the tour.
  useEffect(() => {
    if (!entered && active) tour.exit()
  }, [entered, active])

  // Keyboard: Space = pause/resume, ←/→ are walking keys so use [ and ] / PageUp/PageDown.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.ctrlKey || e.metaKey || e.altKey || useMuseum.getState().inspecting) return
      if (e.key === ' ' && !(t instanceof HTMLButtonElement)) {
        e.preventDefault()
        tour.toggle()
      } else if (e.key === ']' || e.key === 'PageDown') tour.next()
      else if (e.key === '[' || e.key === 'PageUp') tour.prev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  if (!active || !entered || inspecting) return null

  const stop = TOUR_STOPS[index]
  const done = phase === 'done'
  const walking = phase === 'walking' && !paused
  const total = TOUR_STOPS.length

  return (
    <section className={`ui-tour ui-panel${walking ? ' is-walking' : ''}`} aria-label="Guided tour" aria-live="polite">
      <div className="ui-tour__top">
        <span className="ui-kicker">
          Guided tour · {Math.min(index + 1, total)} / {total}
          <span className="ui-tour__place"> · {stop.place}</span>
        </span>
        <button type="button" className="ui-icon-btn ui-tour__exit" aria-label="End the tour" data-tip="End tour" onClick={() => tour.exit()}>
          <IconClose />
        </button>
      </div>

      {done ? (
        <div className="ui-tour__content" key="done">
          <h2 className="ui-tour__title">That concludes the tour</h2>
          <p className="ui-tour__text">Thank you for joining. The museum is yours to explore — use the map to return to any room.</p>
        </div>
      ) : (
        <div className="ui-tour__content" key={stop.id}>
          <h2 className="ui-tour__title">{stop.title}</h2>
          {walking ? (
            <p className="ui-tour__text ui-tour__text--muted">
              <span className="ui-tour__walking" aria-hidden="true" />
              On the way to {stop.place}…
            </p>
          ) : (
            <p className="ui-tour__text">{stop.text}</p>
          )}
          {paused && (
            <p className="ui-tour__paused">
              {pauseReason === 'manual' ? 'Paused while you look around.' : 'Paused.'}{' '}
              <button type="button" className="ui-info__link" onClick={() => tour.resume()}>
                Continue the tour
              </button>
            </p>
          )}
        </div>
      )}

      <div className="ui-tour__bar" aria-hidden="true">
        <div className="ui-tour__bar-fill" style={{ transform: `scaleX(${done ? 1 : (index + (phase === 'viewing' ? progress : 0)) / total})` }} />
      </div>

      <div className="ui-tour__controls">
        {done ? (
          <>
            <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => tour.restart()}>
              Start again
            </button>
            <button type="button" className="ui-btn ui-btn--sm" onClick={() => tour.exit()}>
              Explore freely
            </button>
          </>
        ) : (
          <>
            <div className="ui-tour__transport">
              <button type="button" className="ui-icon-btn" aria-label="Previous stop" data-tip="Previous" disabled={index === 0} onClick={() => tour.prev()}>
                <IconPrev />
              </button>
              <button
                type="button"
                className="ui-icon-btn ui-tour__play"
                aria-label={paused ? 'Resume tour' : 'Pause tour'}
                data-tip={paused ? 'Resume · Space' : 'Pause · Space'}
                onClick={() => tour.toggle()}
              >
                {paused ? <IconPlay /> : <IconPause />}
              </button>
              <button type="button" className="ui-icon-btn" aria-label="Next stop" data-tip="Next" disabled={index >= total - 1} onClick={() => tour.next()}>
                <IconNext />
              </button>
              {narrationSupported() && (
                <button
                  type="button"
                  className="ui-icon-btn"
                  aria-pressed={narration}
                  aria-label={narration ? 'Turn narration off' : 'Turn narration on'}
                  data-tip={narration ? 'Narration on' : 'Narration off'}
                  onClick={() => tour.setNarration(!narration)}
                >
                  <IconNarration />
                  {!narration && <span className="ui-tour__slash" aria-hidden="true" />}
                </button>
              )}
            </div>
            {stop.item && !walking && (
              <button
                type="button"
                className="ui-btn ui-btn--ghost ui-btn--sm ui-tour__more"
                onClick={() => select({ kind: stop.item!.kind, id: stop.item!.id })}
              >
                <IconInfo /> <span className="ui-tour__more-long">More about this</span>
                <span className="ui-tour__more-short">Details</span>
              </button>
            )}
          </>
        )}
      </div>
    </section>
  )
}
