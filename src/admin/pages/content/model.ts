/**
 * Content page basics shared by its modules and by the checklist, analytics and capture pages:
 * the collections, the `#/content/<tab>/<id>` address, museum deep links and small item helpers.
 */
import type { ContentCollection } from '../../../museum/content/types'
import type { SelectionKind } from '../../../museum/state/store'
import type { Item } from '../../api'
import { useExhibitionList } from '../../ExhibitionSwitcher'
import { useSelectedExhibition } from '../../exhibitionsApi'

export interface CollectionMeta {
  id: ContentCollection
  label: string
  singular: string
  /** Museum deep-link / analytics item kind. */
  kind: SelectionKind
}

export const COLLECTIONS: readonly CollectionMeta[] = [
  { id: 'artworks', label: 'Artworks', singular: 'artwork', kind: 'artwork' },
  { id: 'exhibits', label: 'Exhibits', singular: 'exhibit', kind: 'exhibit' },
  { id: 'infographics', label: 'Infographics', singular: 'infographic panel', kind: 'infographic' },
  { id: 'videos', label: 'Videos', singular: 'video', kind: 'video' },
  { id: 'objects', label: 'Objects', singular: 'object', kind: 'object' },
]
export const metaOf = (c: ContentCollection) => COLLECTIONS.find((x) => x.id === c) as CollectionMeta
export const isCollectionId = (v: unknown): v is ContentCollection => COLLECTIONS.some((c) => c.id === v)
/** Analytics / museum item kind → content collection. */
export const collectionOfKind = (kind: string): ContentCollection | null => COLLECTIONS.find((c) => c.kind === kind)?.id ?? null
export const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a')

export type Tab = ContentCollection | 'texts' | 'trash'

/** Item ids the server accepts (src/server/util.ts ID_RE). */
export const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/
export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)

/** `id`, or `id-2`, `id-3`… — the first not in `taken`. */
export function uniqueId(base: string, taken: Iterable<string>) {
  const used = new Set(taken)
  if (!used.has(base)) return base
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`
}

export interface ContentAddress {
  tab: Tab
  /** An item id, or '+new' (the palette's "New …" action). */
  id: string | null
  /** A field path to scroll to (`?field=`), from the checklist's "jump to field". */
  field: string | null
}

/** `#/content/<tab>[/<id>][?field=<path>]` — shareable, survives a reload. */
export function readContentHash(hash = typeof window === 'undefined' ? '' : window.location.hash): ContentAddress {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?')
  const [, tab, id] = path.split('/')
  const t: Tab = isCollectionId(tab) || tab === 'texts' || tab === 'trash' ? tab : 'artworks'
  const field = new URLSearchParams(query).get('field')
  return { tab: t, id: id ? decodeURIComponent(id) : null, field: field || null }
}
export const contentHref = (tab: Tab, id?: string | null, field?: string | null) =>
  `#/content/${tab}${id ? `/${encodeURIComponent(id)}` : ''}${field ? `?field=${encodeURIComponent(field)}` : ''}`
/** Rewrites the address without a navigation (no hashchange, so the shell's guard is not involved). */
export function writeContentHash(tab: Tab, id?: string | null) {
  const h = contentHref(tab, id)
  if (window.location.hash !== h) window.history.replaceState(null, '', h)
}

/** The selected exhibition's museum address ('/gallery' for the default one). */
export function useMuseumBase() {
  const list = useExhibitionList()
  const sel = useSelectedExhibition()
  const ex = list?.find((e) => e.id === sel) ?? list?.find((e) => e.isDefault)
  return ex?.path || '/gallery'
}
/** The museum opened at an item (`/gallery#artwork=<id>`). */
export const museumHref = (base: string, c: ContentCollection, id: string) => `${base}#${metaOf(c).kind}=${encodeURIComponent(id)}`

export const titleOf = (i: Pick<Item, 'id'> & Record<string, unknown>) => (typeof i.title === 'string' && i.title.trim() ? i.title.trim() : i.id)
export const itemThumb = (c: ContentCollection, i: Record<string, unknown>): string | null => {
  const v = c === 'artworks' ? i.image : c === 'videos' ? i.poster : null
  return typeof v === 'string' && v ? v : null
}
/** The item without the editor's own keys (`__new`) and the stamp the API adds (`updatedAt`, `updatedBy`). */
export function stripInternal(item: Record<string, unknown>): Record<string, unknown> {
  const { __new: _n, updatedAt: _u, updatedBy: _b, ...rest } = item
  void _n
  void _u
  void _b
  return rest
}
export const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0)
