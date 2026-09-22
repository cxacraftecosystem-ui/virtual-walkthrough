/**
 * Runtime content loading.
 *
 * The bundled config files are the default content (the museum works as a pure static
 * site). When the backend is reachable, GET /api/content replaces it before the scene
 * mounts. Arrays are replaced IN PLACE so every module that imported them sees the
 * server content (main.tsx loads content before importing the App/scene graph).
 */
import { ARTWORKS } from '../config/artworks'
import { EXHIBITS } from '../config/exhibits'
import { EXHIBITION_TITLE, INFOGRAPHICS, RECEPTION_WELCOME } from '../config/infographics'
import { SCENE_OBJECTS } from '../config/objects'
import { VIDEOS } from '../config/videos'
import type { MuseumContent } from './types'

export type ContentSource = 'bundled' | 'server'
export let contentSource: ContentSource = 'bundled'
export let contentVersion = 0

/** Snapshot of the bundled content (used by the backend seed and as fallback). */
export function bundledContent(): MuseumContent {
  return {
    version: 0,
    exhibition: { ...EXHIBITION_TITLE },
    welcome: { ...RECEPTION_WELCOME },
    artworks: structuredClone(ARTWORKS),
    exhibits: structuredClone(EXHIBITS),
    infographics: structuredClone(INFOGRAPHICS),
    videos: structuredClone(VIDEOS),
    objects: structuredClone(SCENE_OBJECTS),
  }
}

function replace<T>(target: T[], next: T[] | undefined) {
  if (!Array.isArray(next)) return
  target.splice(0, target.length, ...next)
}

export function applyContent(c: Partial<MuseumContent>) {
  replace(ARTWORKS, c.artworks)
  replace(EXHIBITS, c.exhibits)
  replace(INFOGRAPHICS, c.infographics)
  replace(VIDEOS, c.videos)
  replace(SCENE_OBJECTS, c.objects)
  if (c.exhibition) Object.assign(EXHIBITION_TITLE, c.exhibition)
  if (c.welcome) Object.assign(RECEPTION_WELCOME, c.welcome)
  if (typeof c.version === 'number') contentVersion = c.version
}

/** Try the content API (short timeout); silently keep bundled content on any failure. */
export async function loadContent(timeoutMs = 2500): Promise<ContentSource> {
  if (new URLSearchParams(window.location.search).has('static')) return contentSource
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch('/api/content', { signal: ctrl.signal, credentials: 'include' })
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return contentSource
    const data = (await res.json()) as Partial<MuseumContent>
    if (!Array.isArray(data.artworks)) return contentSource
    applyContent(data)
    contentSource = 'server'
  } catch {
    /* backend not running — static mode */
  } finally {
    clearTimeout(t)
  }
  return contentSource
}
