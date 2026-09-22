import { useEffect, useState } from 'react'
import type * as THREE from 'three'

/**
 * Resolve an async texture factory (e.g. canvas typography that waits for web fonts).
 * Returns null until ready; never throws — failures are logged and yield null.
 */
export function useAsyncTexture(factory: () => Promise<THREE.Texture>, deps: unknown[]) {
  const [tex, setTex] = useState<THREE.Texture | null>(null)
  useEffect(() => {
    let alive = true
    let made: THREE.Texture | null = null
    factory()
      .then((t) => {
        made = t
        if (alive) setTex(t)
        else t.dispose()
      })
      .catch((err) => console.warn('[museum] texture generation failed', err))
    return () => {
      alive = false
      made?.dispose()
    }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  return tex
}
