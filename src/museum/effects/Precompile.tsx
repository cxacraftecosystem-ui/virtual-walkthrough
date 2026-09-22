/**
 * Compile every scene shader asynchronously (KHR_parallel_shader_compile via
 * renderer.compileAsync) before the first frame is drawn. Without this, ANGLE/D3D
 * compiles programs synchronously on first render and freezes the page for seconds.
 * Rendering (App frameloop) and the "Enter Exhibition" button wait for it.
 */
import { useProgress } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { useMuseum } from '../state/store'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function Precompile() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)

  useEffect(() => {
    const { setSceneCompiled } = useMuseum.getState()
    setSceneCompiled(false)
    let cancelled = false
    const start = performance.now()
    ;(async () => {
      // Wait for loaders (artwork images, models) to go idle, max 20 s.
      for (;;) {
        if (cancelled) return
        const p = useProgress.getState()
        const elapsed = performance.now() - start
        if ((!p.active && elapsed > 900) || elapsed > 20000) break
        await sleep(150)
      }
      await sleep(300) // let Suspense commits and canvas typography settle
      try {
        await gl.compileAsync(scene, camera)
      } catch (err) {
        console.warn('[museum] async shader compile failed; falling back to on-demand compile', err)
      }
      if (!cancelled) setSceneCompiled(true)
    })()
    return () => {
      cancelled = true
    }
  }, [gl, scene, camera])

  return null
}
