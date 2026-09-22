/** Title / label lookup for any item kind (favourites list, captions, comments). */
import { ARTWORKS } from '../config/artworks'
import { EXHIBITS } from '../config/exhibits'
import { INFOGRAPHICS } from '../config/infographics'
import { SCENE_OBJECTS } from '../config/objects'
import { VIDEOS } from '../config/videos'
import type { SelectionKind } from '../state/store'

export interface ItemSummary {
  kind: SelectionKind
  id: string
  title: string
  label: string
  image?: string
}

const LABEL: Record<SelectionKind, string> = {
  artwork: 'Textile',
  exhibit: 'Hand block',
  infographic: 'Craft panel',
  video: 'Film',
  object: 'Installation',
}

export function itemSummary(kind: SelectionKind, id: string): ItemSummary | null {
  const base = { kind, id, label: LABEL[kind] }
  switch (kind) {
    case 'artwork': {
      const a = ARTWORKS.find((x) => x.id === id)
      return a ? { ...base, title: a.title, image: a.image } : null
    }
    case 'exhibit': {
      const e = EXHIBITS.find((x) => x.id === id)
      return e ? { ...base, title: e.title } : null
    }
    case 'infographic': {
      const g = INFOGRAPHICS.find((x) => x.id === id)
      return g ? { ...base, title: g.title } : null
    }
    case 'video': {
      const v = VIDEOS.find((x) => x.id === id)
      return v ? { ...base, title: v.title, image: v.poster } : null
    }
    case 'object': {
      const o = SCENE_OBJECTS.find((x) => x.id === id)
      return o ? { ...base, title: o.title } : null
    }
  }
}

const DATE = (() => {
  try {
    return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return null
  }
})()

export function formatDate(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const mins = (Date.now() - d.getTime()) / 60000
  if (mins < 1) return 'just now'
  if (mins < 60) return `${Math.floor(mins)} min ago`
  if (mins < 60 * 24) return `${Math.floor(mins / 60)} h ago`
  return DATE ? DATE.format(d) : d.toDateString()
}
