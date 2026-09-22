import { useEffect, useRef, useState } from 'react'
import { useMuseum } from '../state/store'
import { resetVisitor, visitor } from '../state/visitor'
import { zoneAt } from '../config/layout'
import { EXHIBITION_TITLE } from '../config/infographics'
import { QUALITY_PRESETS, withDevOverrides, type QualitySetting } from '../config/quality'
import { travel } from './Minimap'
import { requestAmbientStart } from './audio'
import { AccountMenu } from './Social'
import { isCoarsePointer } from './HelpOverlay'
import { tour, useTour } from '../tour/engine'
import {
  IconFullscreen,
  IconFullscreenExit,
  IconHelp,
  IconMap,
  IconMouseLook,
  IconQuality,
  IconReset,
  IconSoundOff,
  IconSoundOn,
  IconTour,
} from './icons'

const QUALITY_OPTIONS: { value: QualitySetting; label: string; note?: string }[] = [
  { value: 'auto', label: 'Auto', note: 'Adapts to device' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'ultra', label: 'Ultra', note: 'Reflections' },
]

function useZoneName(enabled: boolean) {
  const [name, setName] = useState(() => zoneAt(visitor.x, visitor.z)?.name ?? '')
  useEffect(() => {
    if (!enabled) return
    const id = window.setInterval(() => {
      const n = zoneAt(visitor.x, visitor.z)?.name
      // Keep the last known name while crossing thresholds/doorways.
      if (n) setName((prev) => (prev === n ? prev : n))
    }, 250)
    return () => window.clearInterval(id)
  }, [enabled])
  return name
}

function useFullscreen() {
  const supported =
    typeof document !== 'undefined' && !!document.documentElement.requestFullscreen && document.fullscreenEnabled !== false
  const [on, setOn] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement)
  useEffect(() => {
    const onChange = () => setOn(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  const toggle = () => {
    try {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
      else void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {})
    } catch {
      /* not allowed */
    }
  }
  return { supported, on, toggle }
}

function QualityMenu() {
  const quality = useMuseum((s) => s.quality)
  const tier = useMuseum((s) => s.tier)
  const setQuality = useMuseum((s) => s.setQuality)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const tierLabel = withDevOverrides(QUALITY_PRESETS[tier]).label
  const label = quality === 'auto' ? `Auto · ${tierLabel}` : tierLabel

  return (
    <div className="ui-quality" ref={rootRef}>
      <button
        type="button"
        className="ui-quality__btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Graphics quality: ${label}`}
        title="Graphics quality"
        onClick={() => setOpen((v) => !v)}
      >
        <IconQuality />
        <span className="ui-quality__label">
          {quality === 'auto' ? (
            <>
              Auto <em>· {tierLabel}</em>
            </>
          ) : (
            tierLabel
          )}
        </span>
      </button>
      {open && (
        <div className="ui-quality__menu ui-panel" role="menu" aria-label="Graphics quality">
          <div className="ui-kicker ui-quality__menu-title">Graphics</div>
          {QUALITY_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={quality === o.value}
              className="ui-quality__opt"
              onClick={() => {
                setQuality(o.value)
                setOpen(false)
              }}
            >
              <span>
                {o.label}
                {o.value === 'auto' && quality === 'auto' ? <small> · {tierLabel}</small> : null}
              </span>
              {o.note && quality !== o.value ? <small>{o.note}</small> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function HUD() {
  const entered = useMuseum((s) => s.phase === 'entered')
  const soundOn = useMuseum((s) => s.soundOn)
  const toggleSound = useMuseum((s) => s.toggleSound)
  const helpOpen = useMuseum((s) => s.helpOpen)
  const setHelpOpen = useMuseum((s) => s.setHelpOpen)
  const mapOpen = useMuseum((s) => s.mapOpen)
  const setMapOpen = useMuseum((s) => s.setMapOpen)
  const zone = useZoneName(entered)
  const fs = useFullscreen()
  const mouseLook = useMuseum((s) => s.mouseLook)
  const setMouseLook = useMuseum((s) => s.setMouseLook)
  const touring = useTour((s) => s.active)
  const [coarse] = useState(isCoarsePointer)

  return (
    <div className={`ui-hud${entered ? ' is-visible' : ''}`} aria-hidden={!entered || undefined}>
      <div className="ui-hud__title">
        <div className="ui-hud__name">{EXHIBITION_TITLE.title}</div>
        <div className="ui-hud__zone" aria-live="polite">
          {zone ? <span key={zone}>{zone}</span> : <span>&nbsp;</span>}
        </div>
      </div>

      <div className="ui-hud__right">
      <AccountMenu />
      <nav className="ui-hud__actions ui-panel ui-interactive" aria-label="Exhibition controls">
        <button
          type="button"
          className="ui-icon-btn"
          aria-label={touring ? 'End the guided tour' : 'Take the guided tour'}
          data-tip={touring ? 'End guided tour' : 'Guided tour'}
          aria-pressed={touring}
          onClick={() => (touring ? tour.exit() : tour.start(0))}
        >
          <IconTour />
        </button>
        {!coarse && (
          <button
            type="button"
            className="ui-icon-btn"
            aria-label="Mouse look (L)"
            data-tip="Mouse look (L)"
            aria-pressed={mouseLook}
            onClick={() => setMouseLook(!mouseLook)}
          >
            <IconMouseLook />
          </button>
        )}
        <button
          type="button"
          className="ui-icon-btn"
          aria-label="Help (H)"
          data-tip="Help · H"
          aria-pressed={helpOpen}
          onClick={() => setHelpOpen(!helpOpen)}
        >
          <IconHelp />
        </button>
        <button
          type="button"
          className="ui-icon-btn"
          aria-label={soundOn ? 'Mute ambient sound' : 'Play ambient sound'}
          data-tip={soundOn ? 'Sound on' : 'Sound off'}
          aria-pressed={soundOn}
          onClick={() => {
            if (!soundOn) requestAmbientStart()
            toggleSound()
          }}
        >
          {soundOn ? <IconSoundOn /> : <IconSoundOff />}
        </button>
        {fs.supported && (
          <button
            type="button"
            className="ui-icon-btn"
            aria-label={fs.on ? 'Exit full screen' : 'Full screen'}
            data-tip={fs.on ? 'Exit full screen' : 'Full screen'}
            aria-pressed={fs.on}
            onClick={fs.toggle}
          >
            {fs.on ? <IconFullscreenExit /> : <IconFullscreen />}
          </button>
        )}
        <button
          type="button"
          className="ui-icon-btn"
          aria-label="Return to entrance"
          data-tip="Return to entrance"
          onClick={() => travel(resetVisitor)}
        >
          <IconReset />
        </button>
        <button
          type="button"
          className="ui-icon-btn"
          aria-label={mapOpen ? 'Hide map (M)' : 'Show map (M)'}
          data-tip="Map · M"
          aria-pressed={mapOpen}
          onClick={() => setMapOpen(!mapOpen)}
        >
          <IconMap />
        </button>
        <span className="ui-hud__sep" aria-hidden="true" />
        <QualityMenu />
      </nav>
      </div>
    </div>
  )
}
