/**
 * Browser DZI tiler: slices an image into a Deep Zoom pyramid with OffscreenCanvas.
 * Runs in a Web Worker (dziTiler.worker.ts) for the admin "Deep zoom" tool and on the main
 * thread of scripts/placeholder-gen.html (scripts/generate-deepzoom.mjs).
 *
 * Levels are produced top-down by successive 2× box-filtered halving (sharper and faster
 * than resampling every level from the full-resolution source).
 */
import { DZI_DEFAULTS, dziLevelSize, dziLevelTiles, dziMaxLevel, dziTileCount, dziTilePath, type DziInfo } from '../../museum/deepzoom/dzi'

export interface TileOptions {
  tileSize?: number
  overlap?: number
  format?: 'jpg' | 'webp' | 'png'
  /** Encoder quality 0..1 (jpg/webp). */
  quality?: number
  /** Colour under transparent pixels (JPEG has no alpha). */
  background?: string
}

export interface TileOut {
  level: number
  col: number
  row: number
  /** Relative to the directory of image.dzi, e.g. `image_files/12/3_4.jpg`. */
  path: string
  blob: Blob
}

type Source = ImageBitmap | OffscreenCanvas | HTMLCanvasElement

const MIME = { jpg: 'image/jpeg', webp: 'image/webp', png: 'image/png' } as const

export function pyramidInfo(width: number, height: number, o: TileOptions = {}): DziInfo {
  return { width, height, tileSize: o.tileSize ?? DZI_DEFAULTS.tileSize, overlap: o.overlap ?? DZI_DEFAULTS.overlap, format: o.format ?? DZI_DEFAULTS.format }
}

function ctx2d(c: OffscreenCanvas) {
  const x = c.getContext('2d', { alpha: true })
  if (!x) throw new Error('2D canvas unavailable')
  x.imageSmoothingEnabled = true
  x.imageSmoothingQuality = 'high'
  return x
}

/** Yields every tile of the pyramid (highest level first). */
export async function* tilePyramid(source: Source, o: TileOptions = {}): AsyncGenerator<TileOut, void, void> {
  const info = pyramidInfo(source.width, source.height, o)
  const mime = MIME[info.format as keyof typeof MIME] ?? 'image/jpeg'
  const quality = o.quality ?? 0.82
  const bg = o.background ?? '#ffffff'
  const tile = new OffscreenCanvas(info.tileSize + 2 * info.overlap, info.tileSize + 2 * info.overlap)
  const tctx = ctx2d(tile)

  let current: Source = source
  const max = dziMaxLevel(info.width, info.height)
  for (let level = max; level >= 0; level--) {
    const { w, h } = dziLevelSize(info, level)
    if (level !== max) {
      const next = new OffscreenCanvas(w, h)
      ctx2d(next).drawImage(current, 0, 0, current.width, current.height, 0, 0, w, h)
      if (current !== source && current instanceof OffscreenCanvas) {
        current.width = current.height = 1 // release memory early
      }
      current = next
    }
    for (const r of dziLevelTiles(info, level)) {
      if (tile.width !== r.w || tile.height !== r.h) {
        tile.width = r.w
        tile.height = r.h
      }
      tctx.imageSmoothingEnabled = false
      if (mime === 'image/jpeg') {
        tctx.fillStyle = bg
        tctx.fillRect(0, 0, r.w, r.h)
      } else tctx.clearRect(0, 0, r.w, r.h)
      tctx.drawImage(current, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h)
      const blob = await tile.convertToBlob({ type: mime, quality })
      yield { level, col: r.col, row: r.row, path: dziTilePath(info, level, r.col, r.row), blob }
    }
  }
}

export { dziTileCount }

/** Largest side any browser canvas reliably supports. */
export const MAX_CANVAS_SIDE = 16384
/** Keep total pixels well under Chrome's 268 MP canvas limit and phone memory. */
export const MAX_PIXELS = 200_000_000

/** Decode a File into an ImageBitmap, downscaling when it exceeds canvas limits. */
export async function decodeForTiling(file: Blob, maxSide = MAX_CANVAS_SIDE): Promise<{ bitmap: ImageBitmap; originalWidth: number; originalHeight: number; scaled: boolean }> {
  const probe = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const ow = probe.width
  const oh = probe.height
  const k = Math.min(1, maxSide / Math.max(ow, oh), Math.sqrt(MAX_PIXELS / (ow * oh)))
  if (k >= 1) return { bitmap: probe, originalWidth: ow, originalHeight: oh, scaled: false }
  probe.close()
  const bitmap = await createImageBitmap(file, {
    imageOrientation: 'from-image',
    resizeWidth: Math.round(ow * k),
    resizeHeight: Math.round(oh * k),
    resizeQuality: 'high',
  })
  return { bitmap, originalWidth: ow, originalHeight: oh, scaled: true }
}
