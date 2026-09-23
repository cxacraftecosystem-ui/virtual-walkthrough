/** Run the scan optimiser in a Web Worker (main-thread fallback when workers are unavailable). */
import type { ScanFile, ScanOptions, ScanResult } from './scanOptimize'

export async function runScanOptimize(files: File[], options: ScanOptions, onLog: (msg: string) => void): Promise<ScanResult> {
  const input: ScanFile[] = await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })))
  let worker: Worker | null
  try {
    worker = new Worker(new URL('./scanOptimize.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    worker = null
  }
  if (worker) {
    const w = worker
    try {
      return await new Promise<ScanResult>((resolve, reject) => {
        let started = false
        w.onmessage = (e: MessageEvent) => {
          const m = e.data
          started = true
          if (m.type === 'log') onLog(m.msg)
          else if (m.type === 'done') resolve(m.result as ScanResult)
          else if (m.type === 'error') reject(new Error(m.message))
        }
        w.onerror = (e) => {
          e.preventDefault()
          // a worker that failed to even load → fall back below
          reject(started ? new Error(e.message || 'Optimiser crashed') : new WorkerLoadError())
        }
        w.postMessage({ files: input, options }, input.map((f) => f.data.buffer as ArrayBuffer))
      })
    } catch (err) {
      if (!(err instanceof WorkerLoadError)) throw err
      onLog('(worker unavailable — optimising on the main thread)')
      // the transferred buffers are gone: re-read the files
      const again: ScanFile[] = await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })))
      const { optimizeScan } = await import('./scanOptimize')
      return optimizeScan(again, options, onLog)
    } finally {
      w.terminate()
    }
  }
  const { optimizeScan } = await import('./scanOptimize')
  return optimizeScan(input, options, onLog)
}

class WorkerLoadError extends Error {}
