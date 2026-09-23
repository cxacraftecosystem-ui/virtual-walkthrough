/** Guided-tour caption card + controls (bottom centre; top on phones). */
import { useEffect } from 'react'
import { TOUR_STOPS } from '../config/tour'
import { useMuseum } from '../state/store'
import { IconClose, IconInfo, IconNarration, IconNext, IconPause, IconPlay, IconPrev } from '../ui/icons'
import { narrationSupported, tour, useTour } from './engine'
import { usePhoto } from '../ui/PhotoMode'
import { useLang, useT } from '../i18n'
import { tourField } from '../i18n/tourText'

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
  const mapOpen = useMuseum((s) => s.mapOpen)
  const panelOpen = useMuseum((s) => !!s.selection)
  const t = useT()
  const lang = useLang()

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
      if (e.ctrlKey || e.metaKey || e.altKey || useMuseum.getState().inspecting || usePhoto.getState().on) return
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
    <section
      className={`ui-tour ui-panel${walking ? ' is-walking' : ''}${mapOpen ? ' has-map' : ''}${panelOpen ? ' has-panel' : ''}`}
      aria-label={t('tour.label')}
      aria-live="polite"
    >
      <div className="ui-tour__top">
        <span className="ui-kicker">
          {t('tour.progress', { i: Math.min(index + 1, total), n: total })}
          <span className="ui-tour__place"> · {tourField(stop, 'place', lang)}</span>
        </span>
        <button type="button" className="ui-icon-btn ui-tour__exit" aria-label={t('tour.exit')} data-tip={t('tour.exitTip')} onClick={() => tour.exit()}>
          <IconClose />
        </button>
      </div>

      {done ? (
        <div className="ui-tour__content" key="done">
          <h2 className="ui-tour__title">{t('tour.doneTitle')}</h2>
          <p className="ui-tour__text">{t('tour.doneText')}</p>
        </div>
      ) : (
        <div className="ui-tour__content" key={stop.id}>
          <h2 className="ui-tour__title">{tourField(stop, 'title', lang)}</h2>
          {walking ? (
            <p className="ui-tour__text ui-tour__text--muted">
              <span className="ui-tour__walking" aria-hidden="true" />
              {t('tour.onTheWay', { place: tourField(stop, 'place', lang) })}
            </p>
          ) : (
            <p className="ui-tour__text">{tourField(stop, 'text', lang)}</p>
          )}
          {paused && (
            <p className="ui-tour__paused">
              {pauseReason === 'manual' ? t('tour.pausedManual') : t('tour.paused')}{' '}
              <button type="button" className="ui-info__link" onClick={() => tour.resume()}>
                {t('tour.continue')}
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
              {t('tour.restart')}
            </button>
            <button type="button" className="ui-btn ui-btn--sm" onClick={() => tour.exit()}>
              {t('tour.explore')}
            </button>
          </>
        ) : (
          <>
            <div className="ui-tour__transport">
              <button type="button" className="ui-icon-btn" aria-label={t('tour.prev')} data-tip={t('tour.prevTip')} disabled={index === 0} onClick={() => tour.prev()}>
                <IconPrev />
              </button>
              <button
                type="button"
                className="ui-icon-btn ui-tour__play"
                aria-label={paused ? t('tour.resume') : t('tour.pause')}
                data-tip={paused ? t('tour.resumeTip') : t('tour.pauseTip')}
                onClick={() => tour.toggle()}
              >
                {paused ? <IconPlay /> : <IconPause />}
              </button>
              <button type="button" className="ui-icon-btn" aria-label={t('tour.next')} data-tip={t('tour.nextTip')} disabled={index >= total - 1} onClick={() => tour.next()}>
                <IconNext />
              </button>
              {narrationSupported() && (
                <button
                  type="button"
                  className="ui-icon-btn"
                  aria-pressed={narration}
                  aria-label={narration ? t('tour.narrationOff') : t('tour.narrationOn')}
                  data-tip={narration ? t('tour.narrationOnTip') : t('tour.narrationOffTip')}
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
                <IconInfo /> <span className="ui-tour__more-long">{t('tour.more')}</span>
                <span className="ui-tour__more-short">{t('tour.moreShort')}</span>
              </button>
            )}
          </>
        )}
      </div>
    </section>
  )
}
