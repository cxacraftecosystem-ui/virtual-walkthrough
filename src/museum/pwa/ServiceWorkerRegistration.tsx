'use client'

/**
 * Registers /sw.js (public/sw.js) in production builds only, and offers a safe update:
 * when a new worker has installed while an old one controls the page, a small toast offers
 * "Reload"; only then is the waiting worker told to take over (SKIP_WAITING) and the page
 * reloaded once it has. In development any previously installed worker is unregistered so
 * stale caches never mask code changes.
 */
import { useEffect, useState } from 'react'
import '../amenities/amenities.css'

export function ServiceWorkerRegistration() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null)

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    if (process.env.NODE_ENV !== 'production') {
      void navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.active?.scriptURL.endsWith('/sw.js') && void r.unregister()))
      return
    }
    let alive = true
    let updateTimer = 0
    const watch = (reg: ServiceWorkerRegistration) => {
      if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting)
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing
        nw?.addEventListener('statechange', () => {
          if (alive && nw.state === 'installed' && navigator.serviceWorker.controller) setWaiting(nw)
        })
      })
    }
    const onLoad = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((reg) => {
          if (!alive) return
          watch(reg)
          // look for updates now and then on long visits
          updateTimer = window.setInterval(() => void reg.update().catch(() => {}), 60 * 60 * 1000)
        })
        .catch(() => {
          /* unsupported / blocked — the site works without it */
        })
    }
    if (document.readyState === 'complete') onLoad()
    else window.addEventListener('load', onLoad, { once: true })
    return () => {
      alive = false
      window.clearInterval(updateTimer)
      window.removeEventListener('load', onLoad)
    }
  }, [])

  if (!waiting) return null
  return (
    <div className="ui-sw-toast" role="status">
      <span>A new version of the museum is available.</span>
      <button
        type="button"
        className="ui-btn"
        onClick={() => {
          let reloaded = false
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (reloaded) return
            reloaded = true
            window.location.reload()
          })
          waiting.postMessage('SKIP_WAITING')
        }}
      >
        Reload
      </button>
      <button type="button" className="ui-btn ui-btn--ghost" onClick={() => setWaiting(null)}>
        Later
      </button>
    </div>
  )
}
