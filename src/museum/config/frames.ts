/**
 * FRAME STYLES — reusable museum framing presets.
 *
 * All dimensions in metres. An artwork references a style by id and may
 * override any field (e.g. `frame: { style: 'natural-wood', matWidth: 0.1 }`).
 */

export type FrameStyleId =
  | 'frameless'
  | 'textile-panel'
  | 'thin-black'
  | 'white'
  | 'natural-wood'
  | 'dark-wood'

export type FrameMaterialKind = 'none' | 'paint' | 'oak' | 'walnut'

export interface FrameStyle {
  /** Visible moulding face width. 0 = frameless. */
  frameWidth: number
  /** Projection of the frame from the wall. */
  frameDepth: number
  /** Passe-partout (mat) border around the image. 0 = no mat. */
  matWidth: number
  /** How far the image/mat plane sits behind the frame's front face. */
  recess: number
  material: FrameMaterialKind
  color: string
  roughness: number
  matColor: string
  /** Depth of the backing board/stretcher for frameless mounting. */
  backingDepth: number
  backingColor: string
}

export const FRAME_STYLES: Record<FrameStyleId, FrameStyle> = {
  frameless: {
    frameWidth: 0,
    frameDepth: 0,
    matWidth: 0,
    recess: 0,
    material: 'none',
    color: '#ffffff',
    roughness: 0.8,
    matColor: '#f4f1ea',
    backingDepth: 0.025,
    backingColor: '#e8e2d6',
  },
  /** Textile stretched over a fabric-wrapped board — typical for block-printed cloth. */
  'textile-panel': {
    frameWidth: 0,
    frameDepth: 0,
    matWidth: 0,
    recess: 0,
    material: 'none',
    color: '#ffffff',
    roughness: 0.9,
    matColor: '#f4f1ea',
    backingDepth: 0.04,
    backingColor: '#ddd5c6',
  },
  'thin-black': {
    frameWidth: 0.02,
    frameDepth: 0.035,
    matWidth: 0.07,
    recess: 0.012,
    material: 'paint',
    color: '#1d1c1a',
    roughness: 0.55,
    matColor: '#f6f3ec',
    backingDepth: 0.01,
    backingColor: '#e8e2d6',
  },
  white: {
    frameWidth: 0.03,
    frameDepth: 0.04,
    matWidth: 0.08,
    recess: 0.014,
    material: 'paint',
    color: '#f2f0eb',
    roughness: 0.6,
    matColor: '#faf8f3',
    backingDepth: 0.01,
    backingColor: '#e8e2d6',
  },
  'natural-wood': {
    frameWidth: 0.042,
    frameDepth: 0.045,
    matWidth: 0.09,
    recess: 0.016,
    material: 'oak',
    color: '#c9a67c',
    roughness: 0.6,
    matColor: '#f6f2e9',
    backingDepth: 0.01,
    backingColor: '#e8e2d6',
  },
  'dark-wood': {
    frameWidth: 0.045,
    frameDepth: 0.045,
    matWidth: 0.09,
    recess: 0.016,
    material: 'walnut',
    color: '#4a3326',
    roughness: 0.5,
    matColor: '#f4efe5',
    backingDepth: 0.01,
    backingColor: '#e8e2d6',
  },
}

export type FrameConfig = { style: FrameStyleId } & Partial<FrameStyle>

export function resolveFrame(frame: FrameConfig | FrameStyleId | undefined): FrameStyle {
  if (!frame) return FRAME_STYLES['thin-black']
  if (typeof frame === 'string') return FRAME_STYLES[frame] ?? FRAME_STYLES['thin-black']
  const { style, ...overrides } = frame
  return { ...(FRAME_STYLES[style] ?? FRAME_STYLES['thin-black']), ...overrides }
}
