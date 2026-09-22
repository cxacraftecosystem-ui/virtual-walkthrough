/**
 * Automatic artwork sizing.
 *
 * Given an image's intrinsic pixel size and the configured display box, compute
 * the image, mat and outer frame dimensions. The image aspect ratio is ALWAYS
 * preserved; the frame adapts to the image, never the other way round.
 */
import type { FrameStyle } from '../config/frames'

export interface ArtworkLayout {
  aspect: number
  image: { w: number; h: number }
  /** Mat (passe-partout) outer size; equals image size when matWidth = 0. */
  mat: { w: number; h: number }
  /** Full outer size including moulding. */
  outer: { w: number; h: number }
  /** Projection from the wall of the frontmost element. */
  depth: number
  /** z of the image plane measured from the wall. */
  imageZ: number
  orientation: 'portrait' | 'landscape' | 'square'
}

export interface FitOptions {
  maxWidth: number
  maxHeight: number
  /** Real-world image width in metres (overrides fitting). */
  physicalWidth?: number
}

export function computeArtworkLayout(pixelW: number, pixelH: number, frame: FrameStyle, opts: FitOptions): ArtworkLayout {
  const aspect = pixelW > 0 && pixelH > 0 ? pixelW / pixelH : 1
  const border = frame.frameWidth + frame.matWidth
  let iw: number
  let ih: number
  if (opts.physicalWidth && opts.physicalWidth > 0) {
    iw = opts.physicalWidth
    ih = iw / aspect
  } else {
    const availW = Math.max(0.05, opts.maxWidth - 2 * border)
    const availH = Math.max(0.05, opts.maxHeight - 2 * border)
    iw = Math.min(availW, availH * aspect)
    ih = iw / aspect
  }
  const mat = { w: iw + 2 * frame.matWidth, h: ih + 2 * frame.matWidth }
  const outer = { w: mat.w + 2 * frame.frameWidth, h: mat.h + 2 * frame.frameWidth }
  const framed = frame.frameWidth > 0
  const depth = framed ? frame.frameDepth : frame.backingDepth
  // Image sits at the recessed mat plane (framed) or on the face of the backing board (frameless).
  const imageZ = framed ? frame.frameDepth - frame.recess : frame.backingDepth
  const orientation = Math.abs(aspect - 1) < 0.03 ? 'square' : aspect > 1 ? 'landscape' : 'portrait'
  return { aspect, image: { w: iw, h: ih }, mat, outer, depth, imageZ, orientation }
}
