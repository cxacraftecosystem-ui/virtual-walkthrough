/**
 * Accessibility layer (mounted once by UIOverlay):
 *  • applies the a11y settings as classes on <html> (a11y-contrast / a11y-large / a11y-reduce-motion),
 *  • a skip link to the text-only guide (first Tab stop),
 *  • a polite live region announcing zone changes and the nearby item (with its alt text),
 *  • labels the 3D canvas for assistive technology.
 */
import { useEffect, useRef, useState } from 'react'
import { zoneAt } from '../config/layout'
import { useMuseum } from '../state/store'
import { visitor } from '../state/visitor'
import { useLang, useT } from '../i18n'
import { itemAlt, itemTitle, zoneName } from '../i18n/content'
import { isCoarsePointer } from '../ui/HelpOverlay'

export function useA11yDocumentClasses() {
  const reducedMotion = useMuseum((s) => s.reducedMotion)
  const highContrast = useMuseum((s) => s.highContrast)
  const largeText = useMuseum((s) => s.largeText)
  useEffect(() => {
    const c = document.documentElement.classList
    c.toggle('a11y-reduce-motion', reducedMotion)
    c.toggle('a11y-contrast', highContrast)
    c.toggle('a11y-large', largeText)
  }, [reducedMotion, highContrast, largeText])
}

/** Follow later OS-level changes of prefers-reduced-motion (until the visitor chooses in the UI). */
function useSystemReducedMotion() {
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const on = () => {
      let stored = false
      try {
        stored = 'reducedMotion' in (JSON.parse(localStorage.getItem('museum.a11y') ?? '{}') as object)
      } catch {
        /* ignore */
      }
      if (!stored) useMuseum.setState({ reducedMotion: mq.matches })
    }
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])
}

export function A11yLayer() {
  useA11yDocumentClasses()
  useSystemReducedMotion()
  const t = useT()
  const lang = useLang()
  const entered = useMuseum((s) => s.phase === 'entered')
  const nearby = useMuseum((s) => s.nearby)
  const [message, setMessage] = useState('')
  const lastZone = useRef<string | null>(null)

  // Zone changes (polled — visitor position is not React state).
  useEffect(() => {
    if (!entered) return
    const id = window.setInterval(() => {
      const z = zoneAt(visitor.x, visitor.z)?.id
      if (!z || z === lastZone.current) return
      const first = lastZone.current === null
      lastZone.current = z
      if (!first) setMessage(t('a11y.enteredZone', { zone: zoneName(z, lang) }))
    }, 600)
    return () => window.clearInterval(id)
  }, [entered, t, lang])

  // Nearby item (debounced so walking past things does not chatter).
  useEffect(() => {
    if (!entered || !nearby) return
    const h = window.setTimeout(() => {
      const title = itemTitle(nearby.kind, nearby.id, lang, nearby.title)
      const alt = itemAlt(nearby.kind, nearby.id, lang)
      const label = alt && alt !== title ? `${title} — ${alt}` : title
      setMessage(t(isCoarsePointer() ? 'a11y.nearbyTouch' : 'a11y.nearby', { title: label }))
    }, 700)
    return () => window.clearTimeout(h)
  }, [entered, nearby, lang, t])

  // Describe the WebGL canvas.
  useEffect(() => {
    const label = t('a11y.canvas')
    const apply = () => {
      const c = document.querySelector('.museum-canvas canvas')
      if (!c) return false
      c.setAttribute('role', 'img')
      c.setAttribute('aria-label', label)
      return true
    }
    if (apply()) return
    const id = window.setInterval(() => apply() && window.clearInterval(id), 1000)
    return () => window.clearInterval(id)
  }, [t])

  const guideHref = `/guide${lang === 'en' ? '' : `?lang=${lang}`}`
  return (
    <>
      <a className="ui-skip ui-interactive" href={guideHref}>
        {t('a11y.skipGuide')}
      </a>
      <div className="ui-sr-only" role="status" aria-live="polite" aria-atomic="true">
        {message}
      </div>
    </>
  )
}
