'use client'

import { useEffect, useState, type ComponentType } from 'react'

/**
 * Client boot: load content (content API → bundled config fallback) BEFORE importing
 * the scene graph, so every module that reads the content arrays sees the final data.
 * WebGL/three never runs on the server.
 */
export function MuseumClient() {
  const [App, setApp] = useState<ComponentType | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { loadContent } = await import('../src/museum/content/content')
      await loadContent()
      const mod = await import('../src/App')
      if (alive) setApp(() => mod.default)
    })()
    return () => {
      alive = false
    }
  }, [])

  return <div id="root">{App ? <App /> : <div className="ui-boot" aria-busy="true" />}</div>
}
