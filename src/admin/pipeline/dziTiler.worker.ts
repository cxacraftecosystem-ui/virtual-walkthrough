/// <reference lib="webworker" />
/**
 * Web Worker: decode a photo and stream its DZI tiles back to the page.
 *
 * in:  { type: 'start', file: Blob, options: TileOptions & { maxSide?: number } }
 *      { type: 'ack', n }         — the page consumed n tiles (flow control)
 * out: { type: 'info', info, originalWidth, originalHeight, scaled, total }
 *      { type: 'tile', path, blob, level }
 *      { type: 'done', tiles } | { type: 'error', message }
 */
import { decodeForTiling, dziTileCount, pyramidInfo, tilePyramid, type TileOptions } from './dziTiler'

declare const self: DedicatedWorkerGlobalScope

const WINDOW = 48 // tiles in flight before the worker waits for the uploader
let credits = WINDOW
let wake: (() => void) | null = null

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as { type: 'start'; file: Blob; options: TileOptions & { maxSide?: number } } | { type: 'ack'; n: number }
  if (msg.type === 'ack') {
    credits += msg.n
    wake?.()
    wake = null
    return
  }
  try {
    const { bitmap, originalWidth, originalHeight, scaled } = await decodeForTiling(msg.file, msg.options.maxSide)
    const info = pyramidInfo(bitmap.width, bitmap.height, msg.options)
    self.postMessage({ type: 'info', info, originalWidth, originalHeight, scaled, total: dziTileCount(info) })
    let n = 0
    for await (const t of tilePyramid(bitmap, msg.options)) {
      while (credits <= 0) await new Promise<void>((r) => (wake = r))
      credits--
      n++
      self.postMessage({ type: 'tile', path: t.path, blob: t.blob, level: t.level })
    }
    bitmap.close()
    self.postMessage({ type: 'done', tiles: n })
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
