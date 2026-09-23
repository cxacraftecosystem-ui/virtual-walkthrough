'use client'

import { useEffect, useState, type ComponentType } from 'react'

const RELOAD_FLAG = 'museum.bootReload'

/** A stale tab after a deploy asks for chunks that no longer exist. */
const isChunkError = (e: unknown) => /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|importing a module script failed/i.test(String((e as Error)?.message ?? e))

/**
 * Client boot: load content (content API → bundled config fallback) BEFORE importing
 * the scene graph, so every module that reads the content arrays sees the final data.
 * WebGL/three never runs on the server.
 * `exhibition`: slug of the exhibition to show (/gallery/<slug>); omitted = the default exhibition.
 */
export function MuseumClient({ exhibition }: { exhibition?: string } = {}) {
  const [App, setApp] = useState<ComponentType | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    void import('../src/museum/utils/errorReporter').then((m) => m.installErrorReporting()).catch(() => {})
    ;(async () => {
      try {
        const { loadContent } = await import('../src/museum/content/content')
        await loadContent(exhibition)
        const mod = await import('../src/App')
        try {
          sessionStorage.removeItem(RELOAD_FLAG)
        } catch {
          /* storage blocked */
        }
        if (alive) setApp(() => mod.default)
      } catch (e) {
        void import('../src/museum/utils/errorReporter').then((m) => m.reportError(e, { extra: { stage: 'boot' } })).catch(() => {})
        try {
          const reloaded = sessionStorage.getItem(RELOAD_FLAG) === '1'
          if (isChunkError(e) && !reloaded) {
            sessionStorage.setItem(RELOAD_FLAG, '1')
            window.location.reload()
            return
          }
        } catch {
          /* storage blocked */
        }
        if (alive) setFailed(true)
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boots once per page
  }, [])

  if (failed) {
    return (
      <div id="root">
        <div className="ui-nogl" role="alert">
          <div className="ui-nogl__inner">
            <div className="ui-kicker">A Virtual Exhibition</div>
            <h1 className="ui-nogl__title">The museum could not load</h1>
            <p>Something went wrong while loading the gallery. Check your connection and try again.</p>
            <p>
              <button type="button" className="ui-btn ui-btn--ghost" onClick={() => window.location.reload()}>
                Reload
              </button>
            </p>
          </div>
        </div>
      </div>
    )
  }
  return <div id="root">{App ? <App /> : <div className="ui-boot" aria-busy="true" />}</div>
}
