/**
 * Reference data for the content editor: maker profiles and this exhibition's artworks and exhibits,
 * loaded once per page so `ref` fields can offer a searchable list and check that an id exists.
 * Also the media library list (for the media fields' suggestions). Shared through context.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, type Item, type MediaRecord } from '../../api'
import { exApi, type AdminArtisan } from '../../exhibitionsApi'
import type { ComboOption } from '../../ui'
import type { RefTarget } from '../../fields'
import type { RefSets } from './completeness'
import { titleOf } from './model'

export interface ContentRefs {
  artisans: AdminArtisan[] | null
  artworks: Item[] | null
  exhibits: Item[] | null
  media: MediaRecord[]
  sets: RefSets
  options: (t: RefTarget) => ComboOption[]
  /** null while loading: the id is not judged yet. */
  exists: (t: RefTarget, id: string) => boolean | null
  refresh: () => void
  refreshMedia: () => void
}

const Ctx = createContext<ContentRefs | null>(null)

export function ContentRefsProvider({ children }: { children: ReactNode }) {
  const [artisans, setArtisans] = useState<AdminArtisan[] | null>(null)
  const [artworks, setArtworks] = useState<Item[] | null>(null)
  const [exhibits, setExhibits] = useState<Item[] | null>(null)
  const [media, setMedia] = useState<MediaRecord[]>([])
  const [n, setN] = useState(0)

  useEffect(() => {
    let alive = true
    exApi.artisans().then((a) => alive && setArtisans(a)).catch(() => undefined)
    api.list('artworks').then((a) => alive && setArtworks(a)).catch(() => undefined)
    api.list('exhibits').then((a) => alive && setExhibits(a)).catch(() => undefined)
    return () => {
      alive = false
    }
  }, [n])
  const refreshMedia = useCallback(() => {
    api.media().then(setMedia).catch(() => undefined)
  }, [])
  useEffect(() => refreshMedia(), [refreshMedia])

  const value = useMemo<ContentRefs>(() => {
    const sets: RefSets = {
      artisans: artisans ? new Set(artisans.map((a) => a.id)) : null,
      artworks: artworks ? new Set(artworks.map((a) => a.id)) : null,
      exhibits: exhibits ? new Set(exhibits.map((a) => a.id)) : null,
    }
    const itemOptions = (list: Item[] | null): ComboOption[] =>
      (list ?? []).map((i) => ({ value: i.id, label: titleOf(i), description: i.id, thumb: typeof i.image === 'string' && i.image ? i.image : undefined }))
    return {
      artisans,
      artworks,
      exhibits,
      media,
      sets,
      options: (t) =>
        t === 'artisan'
          ? (artisans ?? []).map((a) => ({ value: a.id, label: a.name || a.id, description: [a.craft, a.cluster, a.id].filter(Boolean).join(' · ') }))
          : itemOptions(t === 'artworks' ? artworks : exhibits),
      exists: (t, id) => {
        const s = t === 'artisan' ? sets.artisans : t === 'artworks' ? sets.artworks : sets.exhibits
        return s ? s.has(id) : null
      },
      refresh: () => setN((x) => x + 1),
      refreshMedia,
    }
  }, [artisans, artworks, exhibits, media, refreshMedia])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useContentRefs(): ContentRefs {
  const v = useContext(Ctx)
  if (!v) throw new Error('useContentRefs outside ContentRefsProvider')
  return v
}
