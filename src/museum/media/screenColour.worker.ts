/**
 * Mean colour of a small picture (a playing film's frame, already scaled to 16 × 9 by createImageBitmap on the
 * main thread). Reading pixels back from the GPU blocks the thread that asks, for as long as the GPU takes to
 * catch up — tens of milliseconds while the museum renders — so that wait happens here, not in the frame loop.
 * In: { id, bmp: ImageBitmap }. Out: { id, r, g, b } in sRGB 0–1, or { id } when the picture could not be read.
 */
let canvas: OffscreenCanvas | null = null
let ctx: OffscreenCanvasRenderingContext2D | null = null

self.onmessage = (e: MessageEvent<{ id: number; bmp: ImageBitmap }>) => {
  const { id, bmp } = e.data
  try {
    if (!canvas || canvas.width !== bmp.width || canvas.height !== bmp.height) {
      canvas = new OffscreenCanvas(bmp.width, bmp.height)
      ctx = canvas.getContext('2d', { willReadFrequently: true })
    }
    if (!ctx) throw new Error('no 2d context')
    ctx.drawImage(bmp, 0, 0)
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data
    let r = 0
    let g = 0
    let b = 0
    for (let i = 0; i < d.length; i += 4) {
      r += d[i]
      g += d[i + 1]
      b += d[i + 2]
    }
    const n = (d.length / 4) * 255
    self.postMessage({ id, r: r / n, g: g / n, b: b / n })
  } catch {
    self.postMessage({ id })
  } finally {
    bmp.close()
  }
}
