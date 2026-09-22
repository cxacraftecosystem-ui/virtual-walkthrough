import { useEffect } from 'react'
import { useMuseum } from '../state/store'
import { EntryScreen } from './EntryScreen'
import { HUD } from './HUD'
import { InfoPanel } from './InfoPanel'
import { Minimap, TravelFade } from './Minimap'
import { HelpOverlay } from './HelpOverlay'
import { ProximityPrompt } from './ProximityPrompt'
import { TouchJoystick } from './TouchJoystick'
import { useAmbientAudio } from './audio'
import { AuthModal } from './AuthModal'
import { SocialDrawer } from './Social'
import { TourOverlay } from '../tour/TourOverlay'
import { initSocial } from '../api/social'
import { startAnalytics } from '../analytics/tracker'
import { isCoarsePointer } from './HelpOverlay'

function isTypingTarget(t: EventTarget | null) {
  if (!(t instanceof HTMLElement)) return false
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || t.isContentEditable
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
      if (isTypingTarget(e.target)) return
      const s = useMuseum.getState()
      if (s.phase !== 'entered') return
      // The 3D inspection viewer owns the keyboard while open.
      if (s.inspecting) return

      switch (e.key) {
        case 'Escape':
          if (s.helpOpen) s.setHelpOpen(false)
          else if (s.selection) s.select(null)
          else return
          break
        case 'h':
        case 'H':
        case '?':
          s.setHelpOpen(!s.helpOpen)
          break
        case 'm':
        case 'M':
          s.setMapOpen(!s.mapOpen)
          break
        case 'l':
        case 'L':
          if (isCoarsePointer()) return
          s.setMouseLook(!s.mouseLook)
          break
        case 'e':
        case 'E':
          if (s.nearby && !s.helpOpen) s.select({ kind: s.nearby.kind, id: s.nearby.id })
          else return
          break
        default:
          return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** Releasing pointer lock (Esc, alt-tab, panel opening) always turns mouse look off. */
function usePointerLockSync() {
  useEffect(() => {
    const onChange = () => {
      const s = useMuseum.getState()
      if (!document.pointerLockElement && s.mouseLook) s.setMouseLook(false)
    }
    document.addEventListener('pointerlockchange', onChange)
    return () => document.removeEventListener('pointerlockchange', onChange)
  }, [])
}

/** Subtle centre crosshair while mouse look is on (clicks target the screen centre). */
function Crosshair() {
  const on = useMuseum((s) => s.mouseLook && s.phase === 'entered' && !s.inspecting)
  return <div className={`ui-crosshair${on ? ' is-on' : ''}`} aria-hidden="true" />
}

/** All HTML UI layered over the canvas. The root lets pointer events fall through. */
export function UIOverlay() {
  useAmbientAudio()
  useShortcuts()
  usePointerLockSync()
  useEffect(() => {
    // Backend probe → social features; anonymous analytics (both no-ops on a static host).
    void initSocial()
    startAnalytics()
  }, [])
  return (
    <div className="ui-root">
      <HUD />
      <Minimap />
      <ProximityPrompt />
      <TouchJoystick />
      <TourOverlay />
      <InfoPanel />
      <SocialDrawer />
      <HelpOverlay />
      <Crosshair />
      <AuthModal />
      <TravelFade />
      <EntryScreen />
    </div>
  )
}
