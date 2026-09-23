/**
 * Localised views of the museum content (client): titles / alt text for any item,
 * zone names, exhibition + welcome text. Falls back to the English content.
 */
import { ARTWORKS } from '../config/artworks'
import { EXHIBITS } from '../config/exhibits'
import { EXHIBITION_TITLE, INFOGRAPHICS, RECEPTION_WELCOME } from '../config/infographics'
import { ZONES, type ZoneId } from '../config/layout'
import { SCENE_OBJECTS } from '../config/objects'
import { VIDEOS } from '../config/videos'
import type { SelectionKind } from '../state/store'
import { loc, translate, type Lang } from './core'
import type { DictKey } from './en'

function find(kind: SelectionKind, id: string): { title: string; alt?: string; i18n?: unknown } | undefined {
  switch (kind) {
    case 'artwork':
      return ARTWORKS.find((x) => x.id === id)
    case 'exhibit':
      return EXHIBITS.find((x) => x.id === id)
    case 'infographic':
      return INFOGRAPHICS.find((x) => x.id === id)
    case 'video':
      return VIDEOS.find((x) => x.id === id)
    case 'object':
      return SCENE_OBJECTS.find((x) => x.id === id)
  }
}

export function itemTitle(kind: SelectionKind, id: string, lang: Lang, fallback = ''): string {
  const it = find(kind, id)
  return (it && loc(it, 'title', lang)) || fallback
}

/** Alternative text: `alt` (localised) — undefined when none was authored. */
export function itemAlt(kind: SelectionKind, id: string, lang: Lang): string | undefined {
  const it = find(kind, id)
  return it ? loc(it as { alt?: string }, 'alt', lang) : undefined
}

export function zoneName(id: ZoneId | string, lang: Lang, short = false): string {
  const key = `zone.${id}${short ? '.short' : ''}`
  const v = translate(lang, key as DictKey)
  if (v !== key) return v
  // Zone without a dictionary entry: use the layout's English name.
  const z = ZONES.find((x) => x.id === id)
  return (short ? z?.short : z?.name) ?? String(id)
}

export function exhibitionText(field: 'kicker' | 'title' | 'subtitle' | 'intro', lang: Lang): string {
  return loc(EXHIBITION_TITLE, field, lang) ?? ''
}

export function welcomeText(field: 'title' | 'body', lang: Lang): string {
  return loc(RECEPTION_WELCOME, field, lang) ?? ''
}
