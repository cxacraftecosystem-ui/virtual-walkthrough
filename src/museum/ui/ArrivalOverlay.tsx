/**
 * Letterbox bars, exhibition title card and "Skip" for the cinematic arrival flight
 * (navigation/ArrivalFlight.tsx). Self-contained styles so it touches no shared stylesheet.
 */
import { useEffect, useState } from 'react'
import { EXHIBITION_TITLE } from '../config/infographics'
import { useLoc, useT } from '../i18n'
import { skipArrival, useArrival } from '../navigation/ArrivalFlight'

const CSS = `
.ui-arrival { position: fixed; inset: 0; z-index: 60; pointer-events: none; }
.ui-arrival__bar { position: absolute; left: 0; right: 0; height: 11vh; background: #0b0a09;
  transition: transform 900ms cubic-bezier(.65,0,.35,1); }
.ui-arrival__bar--top { top: 0; transform: translateY(-100%); }
.ui-arrival__bar--bottom { bottom: 0; transform: translateY(100%); }
.ui-arrival.is-on .ui-arrival__bar { transform: none; }
.ui-arrival__card { position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%);
  text-align: center; color: #f5f1e8; opacity: 0; transition: opacity 1400ms ease;
  text-shadow: 0 2px 24px rgba(0,0,0,.45); }
.ui-arrival__card.is-shown { opacity: 1; }
.ui-arrival__kicker { font: 500 12px/1.4 Inter, system-ui, sans-serif; letter-spacing: .32em; text-transform: uppercase; opacity: .85; }
.ui-arrival__title { font: 500 clamp(34px, 6vw, 72px)/1.05 'Cormorant Garamond', Cormorant, Garamond, 'Times New Roman', serif;
  margin: 14px 0 12px; letter-spacing: .01em; }
.ui-arrival__rule { width: 42px; height: 1.5px; background: #c49a6c; margin: 0 auto 12px; }
.ui-arrival__sub { font: 400 15px/1.4 'Cormorant Garamond', Cormorant, Garamond, serif; font-style: italic; opacity: .9; }
.ui-arrival__skip { position: absolute; right: max(20px, env(safe-area-inset-right, 0px)); bottom: calc(5.5vh - 16px);
  pointer-events: auto; background: transparent; border: 1px solid rgba(245,241,232,.35); color: #f5f1e8;
  font: 500 12px/1 Inter, system-ui, sans-serif; letter-spacing: .14em; text-transform: uppercase;
  padding: 10px 16px; border-radius: 999px; cursor: pointer; opacity: 0; transition: opacity 600ms ease 900ms, background 200ms; }
.ui-arrival.is-on .ui-arrival__skip { opacity: .85; }
.ui-arrival__skip:hover, .ui-arrival__skip:focus-visible { background: rgba(245,241,232,.12); opacity: 1; outline: none; }
.ui-arrival__dip { position: absolute; inset: 0; background: #0b0a09; opacity: 0; transition: opacity 300ms ease; }
.ui-arrival__dip.is-on { opacity: 1; }
body.is-arrival .ui-hud, body.is-arrival .ui-map, body.is-arrival .ui-joystick, body.is-arrival .ui-prompt {
  opacity: 0 !important; pointer-events: none !important; transition: opacity 600ms ease; }
@media (max-width: 600px) { .ui-arrival__bar { height: 8vh; } .ui-arrival__skip { bottom: calc(4vh - 16px); } }
`

export function ArrivalOverlay() {
  const active = useArrival((s) => s.active)
  const skipping = useArrival((s) => s.skipping)
  const t = useArrival((s) => s.t)
  const tr = useT()
  const loc = useLoc()
  // keep mounted briefly after the flight so the bars can slide away
  const [mounted, setMounted] = useState(false)
  const [on, setOn] = useState(false)
  const [dip, setDip] = useState(false)

  useEffect(() => {
    if (active) {
      setMounted(true)
      const r = requestAnimationFrame(() => setOn(true))
      document.body.classList.add('is-arrival')
      return () => cancelAnimationFrame(r)
    }
    setOn(false)
    document.body.classList.remove('is-arrival')
    const id = window.setTimeout(() => setMounted(false), 1000)
    return () => window.clearTimeout(id)
  }, [active])

  // Skip: dip to black, then lift once the camera is at the start pose.
  useEffect(() => {
    if (skipping) setDip(true)
    else if (dip) {
      const id = window.setTimeout(() => setDip(false), 60)
      return () => window.clearTimeout(id)
    }
  }, [skipping, dip])

  useEffect(() => () => document.body.classList.remove('is-arrival'), [])

  if (!mounted) return null
  // Title card: in after ~1 s, out at ~65 % (before the swoop through the doors).
  const card = active && t > 0.08 && t < 0.62

  return (
    <div className={`ui-arrival${on ? ' is-on' : ''}`} aria-live="polite">
      <style>{CSS}</style>
      <div className="ui-arrival__bar ui-arrival__bar--top" />
      <div className="ui-arrival__bar ui-arrival__bar--bottom" />
      <div className={`ui-arrival__card${card ? ' is-shown' : ''}`} aria-hidden={!card}>
        <div className="ui-arrival__kicker">{loc(EXHIBITION_TITLE, 'kicker')}</div>
        <div className="ui-arrival__title">{loc(EXHIBITION_TITLE, 'title')}</div>
        <div className="ui-arrival__rule" />
        <div className="ui-arrival__sub">{loc(EXHIBITION_TITLE, 'subtitle')}</div>
      </div>
      <div className={`ui-arrival__dip${dip ? ' is-on' : ''}`} />
      {active && (
        <button type="button" className="ui-arrival__skip" aria-label={tr('arrival.skipHint')} onClick={skipArrival}>
          {tr('arrival.skip')} ›
        </button>
      )}
    </div>
  )
}
