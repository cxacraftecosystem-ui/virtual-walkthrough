/**
 * "Examine closely" (deep zoom) viewer state — kept out of the main store on purpose.
 * Open from anywhere with `openExamine(artworkId)`.
 */
import { create } from 'zustand'
import type { ArtworkConfig } from '../../config/artworks'

interface ExamineState {
  artworkId: string | null
}

export const useExamine = create<ExamineState>(() => ({ artworkId: null }))

export const openExamine = (artworkId: string) => useExamine.setState({ artworkId })
export const closeExamine = () => useExamine.setState({ artworkId: null })
export const isExamineOpen = () => useExamine.getState().artworkId !== null

export type ExamineSource = { kind: 'dzi'; url: string } | { kind: 'image'; url: string }

/**
 * Best source for the viewer: the artwork's DZI pyramid, else its `highRes` image, else the
 * wall image. Content saved to the database before `deepZoom` existed keeps working for the
 * five bundled hero placeholders (while their image is still the bundled placeholder).
 */
export function examineSource(a: ArtworkConfig): ExamineSource | null {
  if (a.deepZoom) return { kind: 'dzi', url: a.deepZoom }
  if (a.placeholder && /^hero-0[1-5]$/.test(a.id) && a.image === `/artworks/${a.id}.jpg`) {
    return { kind: 'dzi', url: `/deepzoom/${a.id}/image.dzi` }
  }
  const img = a.highRes || a.image
  return img ? { kind: 'image', url: img } : null
}
