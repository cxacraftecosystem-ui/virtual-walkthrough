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
import { enterPhotoMode } from './PhotoMode'
import { TIME_OPTIONS } from './timeOfDay'
import { useLang, useLoc, useT } from '../i18n'
import type { DictKey } from '../i18n/en'
import { zoneName } from '../i18n/content'
import { LanguageMenu } from './LanguageMenu'
import { TrailButton } from '../trail/TrailUI'
import { LiveHudButton } from '../live/LivePanel'
import { VRHudButton } from '../xr/XRButtons'
import {
  IconCamera,
  IconFullscreen,
  IconFullscreenExit,
  IconHelp,
  IconMap,
  IconMouseLook,
  IconQuality,
  IconReset,
  IconSoundOff,
  IconSoundOn,
  IconSun,
  IconTour,
} from './icons'

const QUALITY_OPTIONS: { value: QualitySetting; label: DictKey; note?: DictKey }[] = [
  { value: 'auto', label: 'quality.auto', note: 'quality.autoNote' },
  { value: 'low', label: 'quality.low' },
  { value: 'medium', label: 'quality.medium' },
  { value: 'high', label: 'quality.high' },
  { value: 'ultra', label: 'quality.ultra', note: 'quality.ultraNote' },
]

function useZoneName(enabled: boolean) {
  const [name, setName] = useState(() => zoneAt(visitor.x, visitor.z)?.id ?? '')
  useEffect(() => {
    if (!enabled) return
    const id = window.setInterval(() => {
      const n = zoneAt(visitor.x, visitor.z)?.id
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

/** Close a HUD popover on outside press or Esc. */
function usePopover() {
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
  return { open, setOpen, rootRef }
}

function TimeMenu() {
  const time = useMuseum((s) => s.timeOfDay)
  const setTime = useMuseum((s) => s.setTimeOfDay)
  const { open, setOpen, rootRef } = usePopover()
  const t = useT()
  const timeLabel = (v: string) => t(`time.${v}` as DictKey)
  return (
    <div className="ui-quality ui-time" ref={rootRef}>
      <button
        type="button"
        className="ui-icon-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('hud.timeOfDay', { time: timeLabel(time) })}
        data-tip={open ? undefined : `${timeLabel(time)} · T`}
        onClick={() => setOpen((v) => !v)}
      >
        <IconSun />
      </button>
      {open && (
        <div className="ui-quality__menu ui-panel" role="menu" aria-label={t('time.title')}>
          <div className="ui-kicker ui-quality__menu-title">{t('time.title')}</div>
          {TIME_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={time === o.value}
              className="ui-quality__opt"
              onClick={() => {
                setTime(o.value)
                setOpen(false)
              }}
            >
              <span>{timeLabel(o.value)}</span>
              {time !== o.value ? <small>{t(`time.${o.value}Note` as DictKey)}</small> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function QualityMenu() {
  const quality = useMuseum((s) => s.quality)
  const tier = useMuseum((s) => s.tier)
  const setQuality = useMuseum((s) => s.setQuality)
  const { open, setOpen, rootRef } = usePopover()

  const t = useT()
  const devLabel = withDevOverrides(QUALITY_PRESETS[tier]).label
  // Preset labels are English ('Medium'…); translate the plain tier names, keep dev-override labels.
  const tierLabel = devLabel === QUALITY_PRESETS[tier].label ? t(`quality.${tier}` as DictKey) : devLabel
  const label = quality === 'auto' ? `${t('quality.auto')} · ${tierLabel}` : tierLabel

  return (
    <div className="ui-quality" ref={rootRef}>
      <button
        type="button"
        className="ui-quality__btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('hud.quality', { label })}
        title={t('hud.qualityTitle')}
        onClick={() => setOpen((v) => !v)}
      >
        <IconQuality />
        <span className="ui-quality__label">
          {quality === 'auto' ? (
            <>
              {t('quality.auto')} <em>· {tierLabel}</em>
            </>
          ) : (
            tierLabel
          )}
        </span>
      </button>
      {open && (
        <div className="ui-quality__menu ui-panel" role="menu" aria-label={t('hud.qualityTitle')}>
          <div className="ui-kicker ui-quality__menu-title">{t('hud.graphics')}</div>
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
                {t(o.label)}
                {o.value === 'auto' && quality === 'auto' ? <small> · {tierLabel}</small> : null}
              </span>
              {o.note && quality !== o.value ? <small>{t(o.note)}</small> : null}
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
  const t = useT()
  const L = useLoc()
  const lang = useLang()
  const zoneLabel = zone ? zoneName(zone, lang) : ''

  return (
    <div className={`ui-hud${entered ? ' is-visible' : ''}`} aria-hidden={!entered || undefined} inert={!entered || undefined}>
      <div className="ui-hud__title">
        <div className="ui-hud__name">{L(EXHIBITION_TITLE, 'title')}</div>
        <div className="ui-hud__zone" aria-live="polite">
          {zoneLabel ? <span key={zone}>{zoneLabel}</span> : <span>&nbsp;</span>}
        </div>
      </div>

      <div className="ui-hud__right">
      <AccountMenu />
      <nav className="ui-hud__actions ui-panel ui-interactive" aria-label={t('hud.controls')}>
        <TrailButton />
        <button
          type="button"
          className="ui-icon-btn"
          aria-label={touring ? t('hud.tourEnd') : t('hud.tourStart')}
          data-tip={touring ? t('hud.tourEndTip') : t('hud.tourStartTip')}
          aria-pressed={touring}
          onClick={() => (touring ? tour.exit() : tour.start(0))}
        >
          <IconTour />
        </button>
        <LiveHudButton />
        <VRHudButton />
        {!coarse && (
          <button
            type="button"
            className="ui-icon-btn"
            aria-label={t('hud.mouseLook')}
            data-tip={t('hud.mouseLook')}
            aria-pressed={mouseLook}
            onClick={() => setMouseLook(!mouseLook)}
          >
            <IconMouseLook />
          </button>
        )}
        <TimeMenu />
        <button type="button" className="ui-icon-btn" aria-label={t('hud.photo')} data-tip={t('hud.photoTip')} onClick={enterPhotoMode}>
          <IconCamera />
        </button>
        <button
          type="button"
          className="ui-icon-btn"
          aria-label={t('hud.help')}
          data-tip={t('hud.helpTip')}
          aria-pressed={helpOpen}
          onClick={() => setHelpOpen(!helpOpen)}
        >
          <IconHelp />
        </button>
        <button
          type="button"
          className="ui-icon-btn"
          aria-label={soundOn ? t('hud.soundMute') : t('hud.soundPlay')}
          data-tip={soundOn ? t('hud.soundOnTip') : t('hud.soundOffTip')}
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
            aria-label={fs.on ? t('hud.fullscreenExit') : t('hud.fullscreen')}
            data-tip={fs.on ? t('hud.fullscreenExit') : t('hud.fullscreen')}
            aria-pressed={fs.on}
            onClick={fs.toggle}
          >
            {fs.on ? <IconFullscreenExit /> : <IconFullscreen />}
          </button>
        )}
        <button
          type="button"
          className="ui-icon-btn"
          aria-label={t('hud.reset')}
          data-tip={t('hud.reset')}
          onClick={() => travel(resetVisitor)}
        >
          <IconReset />
        </button>
        <button
          type="button"
          className="ui-icon-btn"
          aria-label={mapOpen ? t('hud.mapHide') : t('hud.mapShow')}
          data-tip={t('hud.mapTip')}
          aria-pressed={mapOpen}
          onClick={() => setMapOpen(!mapOpen)}
        >
          <IconMap />
        </button>
        <LanguageMenu />
        <span className="ui-hud__sep" aria-hidden="true" />
        <QualityMenu />
      </nav>
      </div>
    </div>
  )
}
