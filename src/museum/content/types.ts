/**
 * MuseumContent — the complete editable content of the museum.
 * This is the contract between the frontend, the backend content API
 * (GET /api/content) and the admin UI. Geometry/architecture is NOT content.
 */
import type { ArtworkConfig } from '../config/artworks'
import type { ExhibitConfig } from '../config/exhibits'
import type { InfographicConfig } from '../config/infographics'
import type { SceneObjectConfig } from '../config/objects'
import type { VideoConfig } from '../config/videos'

export interface ExhibitionText {
  kicker: string
  title: string
  subtitle: string
  intro: string
}

export interface MuseumContent {
  /** Monotonic content version (server increments on every change). */
  version: number
  exhibition: ExhibitionText
  welcome: { title: string; body: string }
  artworks: ArtworkConfig[]
  exhibits: ExhibitConfig[]
  infographics: InfographicConfig[]
  videos: VideoConfig[]
  objects: SceneObjectConfig[]
}

export type ContentCollection = 'artworks' | 'exhibits' | 'infographics' | 'videos' | 'objects'
