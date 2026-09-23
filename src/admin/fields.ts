/** Form field definitions per content collection (the raw JSON editor covers everything else). */
import type { ContentCollection } from '../museum/content/types'
import { FRAME_STYLES } from '../museum/config/frames'
import { SURFACES, ZONES } from '../museum/config/layout'

export type FieldType = 'text' | 'textarea' | 'number' | 'checkbox' | 'select' | 'media' | 'frame' | 'kv' | 'lines' | 'vec3' | 'color' | 'surface' | 'at'

export interface FieldDef {
  path: string
  label: string
  type: FieldType
  group: 'Details' | 'Media' | 'Placement' | 'Display' | 'Flags' | 'Metadata' | 'Translations'
  options?: readonly string[]
  /** media picker filter */
  accept?: 'image' | 'model' | 'video' | 'audio'
  hint?: string
  required?: boolean
  step?: number
}

export const SURFACE_IDS = Object.keys(SURFACES)
/** Surfaces grouped by zone for a labelled <select> (zone name → [id, human label][]). */
export const SURFACE_GROUPS: { zone: string; surfaces: { id: string; label: string }[] }[] = (() => {
  const zoneName = new Map<string, string>(ZONES.map((z) => [z.id, z.name]))
  const groups = new Map<string, { id: string; label: string }[]>()
  for (const s of Object.values(SURFACES)) {
    const name = zoneName.get(s.zone) ?? s.zone
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name)!.push({ id: s.id, label: s.label })
  }
  return [...groups.entries()].map(([zone, surfaces]) => ({ zone, surfaces }))
})()
/** Valid `at` range [min, max] (m) along a surface's run axis, and which world axis that is. */
export function surfaceRange(id: unknown): { min: number; max: number; axis: 'x' | 'z'; label: string } | null {
  const s = typeof id === 'string' ? SURFACES[id as keyof typeof SURFACES] : undefined
  if (!s) return null
  return { min: Math.min(...s.range), max: Math.max(...s.range), axis: s.runAxis, label: s.label }
}
export const FRAME_STYLE_IDS = Object.keys(FRAME_STYLES)

const surface: FieldDef = { path: 'placement.surface', label: 'Wall / surface', type: 'surface', group: 'Placement', options: SURFACE_IDS, required: true }
const at: FieldDef = { path: 'placement.at', label: 'Position along wall (m)', type: 'at', group: 'Placement', step: 0.05, required: true }
const centerHeight: FieldDef = { path: 'placement.centerHeight', label: 'Centre height (m)', type: 'number', group: 'Placement', step: 0.05, hint: 'default 1.6' }
const placeholder: FieldDef = { path: 'placeholder', label: 'Placeholder (shows “Placeholder” badge)', type: 'checkbox', group: 'Flags' }
const title: FieldDef = { path: 'title', label: 'Title', type: 'text', group: 'Details', required: true }
const description: FieldDef = { path: 'description', label: 'Description', type: 'textarea', group: 'Details' }
const text = (path: string, label: string, group: FieldDef['group'] = 'Details'): FieldDef => ({ path, label, type: 'text', group })
const num = (path: string, label: string, group: FieldDef['group'] = 'Display', step = 0.05, hint?: string): FieldDef => ({ path, label, type: 'number', group, step, hint })

/** "Meet the maker" profile (admin → Makers). */
const artisanId: FieldDef = { path: 'artisanId', label: 'Maker profile id (Meet the maker)', type: 'text', group: 'Details', hint: 'id from the Makers page; empty = no maker card' }

export const FIELDS: Record<ContentCollection, FieldDef[]> = {
  artworks: [
    title,
    text('tradition', 'Tradition'),
    text('artisan', 'Artisan'),
    artisanId,
    text('region', 'Region'),
    text('material', 'Material'),
    text('technique', 'Technique'),
    text('year', 'Year'),
    description,
    { path: 'context', label: 'Context', type: 'textarea', group: 'Details' },
    { path: 'image', label: 'Image', type: 'media', accept: 'image', group: 'Media', required: true },
    { path: 'deepZoom', label: 'Deep zoom (.dzi)', type: 'text', group: 'Media', hint: 'Examine-closely pyramid — create one in Capture tools → Deep zoom' },
    { path: 'highRes', label: 'High-res image (no pyramid)', type: 'media', accept: 'image', group: 'Media', hint: 'optional ≤ 8k px image for the deep-zoom viewer when there is no .dzi' },
    surface,
    at,
    centerHeight,
    { path: 'frame', label: 'Frame style', type: 'frame', group: 'Display', options: FRAME_STYLE_IDS },
    num('maxWidth', 'Max width (m)'),
    num('maxHeight', 'Max height (m)'),
    num('physicalWidth', 'Physical width (m)', 'Display', 0.01, 'optional: true 1:1 size'),
    text('exhibitId', 'Related exhibit id', 'Display'),
    { path: 'hero', label: 'Hero work', type: 'checkbox', group: 'Flags' },
    placeholder,
    { path: 'metadata', label: 'Metadata', type: 'kv', group: 'Metadata' },
  ],
  exhibits: [
    title,
    text('tradition', 'Tradition'),
    text('artworkId', 'Related artwork id'),
    text('artisan', 'Artisan'),
    artisanId,
    text('region', 'Region'),
    text('material', 'Material'),
    text('technique', 'Technique'),
    description,
    { path: 'model', label: '3D model (GLB/GLTF)', type: 'media', accept: 'model', group: 'Media', hint: 'empty = procedural placeholder block' },
    num('modelScale', 'Model scale', 'Media', 0.01),
    surface,
    at,
    { path: 'inkColor', label: 'Ink colour', type: 'color', group: 'Display' },
    { path: 'placeholderMotif', label: 'Placeholder motif', type: 'select', group: 'Display', options: ['rosette', 'teardrop', 'star-lattice', 'leaf-trail', 'diamond'] },
    placeholder,
  ],
  infographics: [
    text('kicker', 'Kicker'),
    title,
    { path: 'body', label: 'Body', type: 'textarea', group: 'Details', required: true },
    { path: 'steps', label: 'Process steps (one per line)', type: 'lines', group: 'Details' },
    { path: 'icon', label: 'Icon', type: 'select', group: 'Display', options: ['map', 'dye', 'block', 'process'] },
    surface,
    at,
    centerHeight,
    num('width', 'Panel width (m)'),
    num('height', 'Panel height (m)'),
    placeholder,
  ],
  videos: [
    title,
    description,
    { path: 'src', label: 'Video file', type: 'media', accept: 'video', group: 'Media', required: true },
    { path: 'poster', label: 'Poster image', type: 'media', accept: 'image', group: 'Media' },
    surface,
    at,
    { ...centerHeight, required: true, hint: undefined },
    num('width', 'Screen width (m)'),
    { path: 'screen', label: 'Screen type', type: 'select', group: 'Display', options: ['flat', 'led-wall', 'curved'] },
    { path: 'playback', label: 'Playback', type: 'select', group: 'Display', options: ['proximity', 'always', 'click'] },
    { path: 'loop', label: 'Loop', type: 'checkbox', group: 'Flags' },
    placeholder,
  ],
  objects: [
    title,
    description,
    text('kind', 'Procedural kind (fallback)'),
    { path: 'model', label: '3D model (GLB/GLTF)', type: 'media', accept: 'model', group: 'Media' },
    num('modelScale', 'Model scale', 'Media', 0.01),
    { path: 'position', label: 'Position [x, y, z] (m)', type: 'vec3', group: 'Placement' },
    num('rotationDeg', 'Rotation (°)', 'Placement', 1),
    { path: 'zone', label: 'Zone', type: 'select', group: 'Placement', options: ['atrium', 'reception', 'passage', 'reveal', 'gallery-a', 'gallery-b', 'gallery-c', 'gallery-d', 'theatre', 'workshop', 'courtyard'] },
    { path: 'interactive', label: 'Clickable (info panel)', type: 'checkbox', group: 'Flags' },
    { path: 'inspectable', label: 'Inspectable in 3D viewer', type: 'checkbox', group: 'Flags' },
    placeholder,
  ],
}

/* ---------------------- alt text + translations ---------------------- */

const ALT_LANGS = [
  ['hi', 'Hindi · हिन्दी'],
  ['bn', 'Bengali · বাংলা'],
] as const

/** Optional per-language overrides stored under `i18n.<lang>.<field>` (the museum falls back to English). */
function translations(fields: [path: string, label: string, type?: 'text' | 'textarea' | 'lines'][]): FieldDef[] {
  return ALT_LANGS.flatMap(([lang, name]) =>
    fields.map(([path, label, type = 'text']): FieldDef => ({ path: `i18n.${lang}.${path}`, label: `${label} — ${name}`, type, group: 'Translations' })),
  )
}

const alt = (what: string): FieldDef => ({
  path: 'alt',
  label: 'Alt text',
  type: 'textarea',
  group: 'Details',
  hint: `short description of the ${what} for screen readers and the text-only guide`,
})

FIELDS.artworks.push(
  alt('image'),
  ...translations([
    ['title', 'Title'],
    ['tradition', 'Tradition'],
    ['artisan', 'Artisan'],
    ['region', 'Region'],
    ['material', 'Material'],
    ['technique', 'Technique'],
    ['description', 'Description', 'textarea'],
    ['context', 'Context', 'textarea'],
    ['alt', 'Alt text', 'textarea'],
  ]),
)
FIELDS.exhibits.push(
  alt('block'),
  ...translations([
    ['title', 'Title'],
    ['tradition', 'Tradition'],
    ['artisan', 'Artisan'],
    ['region', 'Region'],
    ['material', 'Material'],
    ['technique', 'Technique'],
    ['description', 'Description', 'textarea'],
    ['alt', 'Alt text', 'textarea'],
  ]),
)
FIELDS.infographics.push(
  ...translations([
    ['kicker', 'Kicker'],
    ['title', 'Title'],
    ['body', 'Body', 'textarea'],
    ['steps', 'Process steps (one per line)', 'lines'],
  ]),
)
FIELDS.videos.push(alt('film'), ...translations([['title', 'Title'], ['description', 'Description', 'textarea'], ['alt', 'Alt text', 'textarea']]))
FIELDS.objects.push(alt('object'), ...translations([['title', 'Title'], ['description', 'Description', 'textarea'], ['alt', 'Alt text', 'textarea']]))

/** Minimal valid new item per collection. */
export function template(c: ContentCollection, id: string): Record<string, unknown> {
  switch (c) {
    case 'artworks':
      return { id, title: 'New artwork', tradition: 'Hand Block Printing', image: '', placement: { surface: 'gallery-a-outer', at: 0 }, maxWidth: 1.2, maxHeight: 1.5, frame: 'natural-wood', placeholder: true }
    case 'exhibits':
      return { id, title: 'New exhibit', tradition: 'Hand Block Printing', artworkId: '', placement: { surface: 'gallery-a-outer', at: 0 }, placeholderMotif: 'rosette', inkColor: '#2c3f6b', placeholder: true }
    case 'infographics':
      return { id, kicker: '', title: 'New panel', body: '', icon: 'block', placement: { surface: 'product-wall', at: 0 }, width: 1.45, height: 1.95, placeholder: true }
    case 'videos':
      return {
        id,
        title: 'New video',
        src: '',
        placement: { surface: 'atrium-west', at: 0, centerHeight: 2 },
        width: 3,
        screen: 'flat',
        audio: { mode: 'spatial', volume: 0.8, refDistance: 3, rolloff: 1.2, maxDistance: 25 },
        playback: 'proximity',
        activationDistance: 8,
        loop: true,
        placeholder: true,
      }
    case 'objects':
      return { id, title: 'New object', kind: 'planter', position: [0, 0, 0], rotationDeg: 0, zone: 'atrium', placeholder: true }
  }
}

/* ---------------------------- path helpers ---------------------------- */

export function getPath(obj: Record<string, unknown>, path: string): unknown {
  let cur: unknown = obj
  for (const k of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[k]
  }
  return cur
}

/** Immutable set; `undefined` deletes the key. */
export function setPath(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const [k, ...rest] = path.split('.')
  const next = { ...obj }
  if (rest.length === 0) {
    if (value === undefined) delete next[k]
    else next[k] = value
    return next
  }
  const child = next[k] && typeof next[k] === 'object' && !Array.isArray(next[k]) ? (next[k] as Record<string, unknown>) : {}
  next[k] = setPath(child, rest.join('.'), value)
  return next
}
