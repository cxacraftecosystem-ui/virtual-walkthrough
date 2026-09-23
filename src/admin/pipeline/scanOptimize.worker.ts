/// <reference lib="webworker" />
/**
 * Web Worker wrapper for optimizeScan (glTF-Transform + meshoptimizer off the main thread).
 * in:  { files: ScanFile[], options: ScanOptions }
 * out: { type: 'log', msg } … then { type: 'done', result } | { type: 'error', message }
 */
import { optimizeScan, type ScanFile, type ScanOptions } from './scanOptimize'

declare const self: DedicatedWorkerGlobalScope

self.onmessage = async (e: MessageEvent<{ files: ScanFile[]; options: ScanOptions }>) => {
  try {
    const result = await optimizeScan(e.data.files, e.data.options, (msg) => self.postMessage({ type: 'log', msg }))
    self.postMessage({ type: 'done', result }, [result.glb.buffer as ArrayBuffer])
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
