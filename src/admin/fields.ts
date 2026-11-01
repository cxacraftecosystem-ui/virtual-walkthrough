/**
 * Form field definitions per content collection (the raw JSON editor covers everything else).
 * Building-neutral: walls come from SURFACES, rooms from ZONES and new-item placements from what the
 * collection already uses, so this file is the same for every building.
 */
import type { ContentCollection } from '../museum/content/types'
import { FRAME_STYLES } from '../museum/config/frames'
import { SURFACES, ZONES } from '../museum/config/layout'
import { PROCEDURAL_KINDS } from '../museum/config/objects'
import { COMMON_PROPS, KIND_SCHEMAS, type PropSchema } from '../museum/models/propSchemas'

export type FieldType = 'text' | 'textarea' | 'number' | 'checkbox' | 'select' | 'media' | 'frame' | 'kv' | 'lines' | 'vec3' | 'color' | 'surface' | 'at' | 'ref' | 'props'
/** What a `ref` field points at: a maker profile, or another item of this exhibition. */
export type RefTarget = 'artisan' | 'artworks' | 'exhibits'

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
  /** Human labels for `options` (value → label). */
  optionLabels?: Readonly<Record<string, string>>
  /** `ref` fields: what the id names. */
  ref?: RefTarget
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
export type RunAxis = 'x' | 'z' | 'along'
/** How the `at` number of a surface is measured, in words. */
export const AXIS_LABEL: Record<RunAxis, string> = { x: 'world x', z: 'world z', along: 'metres along wall' }
export interface SurfaceRange {
  min: number
  max: number
  axis: RunAxis
  /** 'world x' | 'world z' | 'metres along wall' */
  axisLabel: string
  label: string
  zone: string
  /** The installation this surface is kept for (SURFACES[id].reserved), if any. */
  reserved?: string
}
/** Valid `at` range [min, max] (m) of a surface, and how `at` is measured on it (a world axis, or along a curved wall). */
export function surfaceRange(id: unknown): SurfaceRange | null {
  const s = typeof id === 'string' && Object.prototype.hasOwnProperty.call(SURFACES, id) ? SURFACES[id as keyof typeof SURFACES] : undefined
  if (!s) return null
  // widened on purpose: some buildings add 'along' (curved walls) to the layout's run axes
  const raw = s.runAxis as string
  const axis: RunAxis = raw === 'along' ? 'along' : raw === 'z' ? 'z' : 'x'
  const reserved = typeof s.reserved === 'string' && s.reserved ? s.reserved : undefined
  return { min: Math.min(...s.range), max: Math.max(...s.range), axis, axisLabel: AXIS_LABEL[axis], label: s.label, zone: s.zone, ...(reserved ? { reserved } : {}) }
}
/** Non-blocking notice for a surface kept for an installation: "Kept for <reserved>". */
export function surfaceWarning(id: unknown): string | undefined {
  const r = surfaceRange(id)
  return r?.reserved ? `Kept for ${r.reserved}` : undefined
}
/** Zone id → name, for lists and filters. */
export const ZONE_NAMES: ReadonlyMap<string, string> = new Map(ZONES.map((z) => [z.id as string, z.name]))
/** Zones on an upper storey (`level` 2 and up): reached from below, never a place to put things. */
export const UPPER_ZONE_IDS: ReadonlySet<string> = new Set(ZONES.filter((z) => (z.level ?? 1) >= 2).map((z) => z.id as string))
/** Ground-floor zones, in layout order: the zones content can be placed in (the first is the new-object default). */
export const ZONE_IDS: readonly string[] = ZONES.map((z) => z.id as string).filter((id) => !UPPER_ZONE_IDS.has(id))

/** Every built-in (procedural) model kind, and its curator-facing name where the building's prop schemas give one. */
export const KIND_IDS: readonly string[] = PROCEDURAL_KINDS
export const KIND_LABELS: Readonly<Record<string, string>> = Object.fromEntries(KIND_IDS.filter((k) => KIND_SCHEMAS[k]).map((k) => [k, KIND_SCHEMAS[k].label]))
/** The typed props of a kind (its own, then the ones every object may carry; a kind's own entry wins on a shared key). */
export function propSchemasOf(kind: unknown): PropSchema[] {
  const own = typeof kind === 'string' && Object.prototype.hasOwnProperty.call(KIND_SCHEMAS, kind) ? KIND_SCHEMAS[kind].props : []
  const keys = new Set(own.map((p) => p.key))
  return [...own, ...COMMON_PROPS.filter((p) => !keys.has(p.key))]
}
/** The zone an item stands in: its wall's zone, else its own `zone` (objects). */
export function itemZone(item: Record<string, unknown>): string | null {
  const r = surfaceRange(getPath(item, 'placement.surface'))
  if (r) return r.zone
  return typeof item.zone === 'string' && item.zone ? item.zone : null
}
export const FRAME_STYLE_IDS = Object.keys(FRAME_STYLES)

const surface: FieldDef = { path: 'placement.surface', label: 'Wall / surface', type: 'surface', group: 'Placement', options: SURFACE_IDS, required: true }
/** The form names the measure from the chosen wall's run axis ('world x' / 'world z' / 'metres along wall'). */
const at: FieldDef = { path: 'placement.at', label: 'Position on the wall (m)', type: 'at', group: 'Placement', step: 0.05, required: true }
const centerHeight: FieldDef = { path: 'placement.centerHeight', label: 'Centre height (m)', type: 'number', group: 'Placement', step: 0.05, hint: 'Empty: 1.6 m.' }
const placeholder: FieldDef = { path: 'placeholder', label: 'Needs content from the workshop', type: 'checkbox', group: 'Flags' }
const title: FieldDef = { path: 'title', label: 'Title', type: 'text', group: 'Details', required: true }
const description: FieldDef = { path: 'description', label: 'Description', type: 'textarea', group: 'Details' }
const text = (path: string, label: string, group: FieldDef['group'] = 'Details'): FieldDef => ({ path, label, type: 'text', group })
const num = (path: string, label: string, group: FieldDef['group'] = 'Display', step = 0.05, hint?: string): FieldDef => ({ path, label, type: 'number', group, step, hint })

/** Exhibit stand-in settings: each building draws its own stand-in, and not every one uses them. */
const STAND_IN_HINT = 'Only when there is no 3D model, where the stand-in uses it.'

/** "Meet the maker" profile (admin → Makers). */
const artisanId: FieldDef = { path: 'artisanId', label: 'Maker profile (Meet the maker)', type: 'ref', ref: 'artisan', group: 'Details', hint: 'Empty: no maker card.' }

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
    { path: 'deepZoom', label: 'Deep zoom (Examine closely)', type: 'text', group: 'Media', hint: 'Filled in by Capture tools → Deep zoom.' },
    { path: 'highRes', label: 'High-resolution image', type: 'media', accept: 'image', group: 'Media', hint: 'Optional, up to 8,000 px. Used by Examine closely when there is no deep zoom.' },
    surface,
    at,
    centerHeight,
    { path: 'frame', label: 'Frame style', type: 'frame', group: 'Display', options: FRAME_STYLE_IDS },
    num('maxWidth', 'Max width (m)'),
    num('maxHeight', 'Max height (m)'),
    num('physicalWidth', 'Physical width (m)', 'Display', 0.01, 'Optional: hangs the work at true size.'),
    { path: 'exhibitId', label: 'Related exhibit', type: 'ref', ref: 'exhibits', group: 'Display' },
    { path: 'hero', label: 'Hero work', type: 'checkbox', group: 'Flags' },
    placeholder,
    { path: 'metadata', label: 'Metadata', type: 'kv', group: 'Metadata' },
  ],
  exhibits: [
    title,
    text('tradition', 'Tradition'),
    { path: 'artworkId', label: 'Related artwork', type: 'ref', ref: 'artworks', group: 'Details' },
    text('artisan', 'Artisan'),
    artisanId,
    text('region', 'Region'),
    text('material', 'Material'),
    text('technique', 'Technique'),
    description,
    { path: 'model', label: '3D model (GLB/GLTF)', type: 'media', accept: 'model', group: 'Media', hint: 'Empty: the museum shows a stand-in piece.' },
    num('modelScale', 'Model scale', 'Media', 0.01),
    surface,
    at,
    { path: 'inkColor', label: 'Stand-in colour', type: 'color', group: 'Display', hint: STAND_IN_HINT },
    { path: 'placeholderMotif', label: 'Stand-in motif', type: 'select', group: 'Display', options: ['rosette', 'teardrop', 'star-lattice', 'leaf-trail', 'diamond'], hint: STAND_IN_HINT },
    placeholder,
  ],
  infographics: [
    text('kicker', 'Kicker'),
    title,
    { path: 'body', label: 'Body', type: 'textarea', group: 'Details' },
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
    { path: 'kind', label: 'Built-in model (when there is no 3D model file)', type: 'select', group: 'Details', options: KIND_IDS, optionLabels: KIND_LABELS, required: true },
    { path: 'model', label: '3D model (GLB/GLTF)', type: 'media', accept: 'model', group: 'Media' },
    num('modelScale', 'Model scale', 'Media', 0.01),
    { path: 'position', label: 'Position [x, y, z] (m)', type: 'vec3', group: 'Placement' },
    num('rotationDeg', 'Rotation (°)', 'Placement', 1),
    { path: 'zone', label: 'Zone', type: 'select', group: 'Placement', options: ZONE_IDS, optionLabels: Object.fromEntries(ZONE_NAMES) },
    { path: 'interactive', label: 'Clickable (info panel)', type: 'checkbox', group: 'Flags' },
    { path: 'inspectable', label: 'Inspectable in 3D viewer', type: 'checkbox', group: 'Flags' },
    { path: 'props', label: 'Model settings', type: 'props', group: 'Display', hint: 'Settings of the built-in model. Empty fields use the model’s default.' },
    placeholder,
  ],
}

/* ---------------------- alt text + translations ---------------------- */

const ALT_LANGS = [
  ['hi', 'Hindi · हिन्दी'],
  ['bn', 'Bengali · বাংলা'],
] as const
/** Translation languages of the content forms. */
export const LANGS: readonly { id: 'hi' | 'bn'; name: string; short: string }[] = [
  { id: 'hi', name: 'Hindi · हिन्दी', short: 'Hindi' },
  { id: 'bn', name: 'Bengali · বাংলা', short: 'Bengali' },
]

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
  hint: `A short description of the ${what} for screen readers and the text-only guide.`,
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
  alt('piece'),
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

/** The value most items of `existing` share at `path` (ties: the first seen), or undefined. */
function commonValue(existing: readonly Record<string, unknown>[], path: string): unknown {
  const counts = new Map<string, { v: unknown; n: number }>()
  for (const it of existing) {
    const v = getPath(it, path)
    if (v === undefined || v === null || v === '') continue
    const k = JSON.stringify(v)
    const c = counts.get(k)
    if (c) c.n++
    else counts.set(k, { v, n: 1 })
  }
  let best: { v: unknown; n: number } | undefined
  for (const c of counts.values()) if (!best || c.n > best.n) best = c
  return best?.v
}

/** A wall for a new item: the one this collection uses most, else the building's first display surface. */
function defaultPlacement(existing: readonly Record<string, unknown>[]): { surface: string; at: number } {
  const used = commonValue(existing, 'placement.surface')
  const surface = typeof used === 'string' && surfaceRange(used) ? used : SURFACE_IDS[0]
  const r = surfaceRange(surface)
  return { surface, at: r ? Math.round(((r.min + r.max) / 2) * 20) / 20 : 0 }
}

/**
 * Minimal valid new item per collection. `existing` (the collection's items) picks the wall, room,
 * tradition and stand-in settings most items already use, so a new item starts beside its neighbours;
 * the fallbacks are the content schema's own defaults, not any one building's.
 */
export function template(c: ContentCollection, id: string, existing: readonly Record<string, unknown>[] = []): Record<string, unknown> {
  const tradition = commonValue(existing, 'tradition')
  const trad = typeof tradition === 'string' ? { tradition } : {}
  const common = (path: string, fallback: string) => {
    const v = commonValue(existing, path)
    return typeof v === 'string' ? v : fallback
  }
  switch (c) {
    case 'artworks':
      return { id, title: 'New artwork', ...trad, image: '', placement: defaultPlacement(existing), maxWidth: 1.2, maxHeight: 1.5, frame: 'natural-wood', placeholder: true }
    case 'exhibits':
      return { id, title: 'New exhibit', ...trad, artworkId: '', placement: defaultPlacement(existing), placeholderMotif: common('placeholderMotif', 'rosette'), inkColor: common('inkColor', '#2c3f6b'), placeholder: true }
    case 'infographics':
      // 'process' is the neutral steps pictogram; the others draw a particular craft
      return { id, kicker: '', title: 'New panel', body: '', icon: common('icon', 'process'), placement: defaultPlacement(existing), width: 1.45, height: 1.95, placeholder: true }
    case 'videos':
      return {
        id,
        title: 'New video',
        src: '',
        placement: { ...defaultPlacement(existing), centerHeight: 2 },
        width: 3,
        screen: 'flat',
        audio: { mode: 'spatial', volume: 0.8, refDistance: 3, rolloff: 1.2, maxDistance: 25 },
        playback: 'proximity',
        activationDistance: 8,
        loop: true,
        placeholder: true,
      }
    case 'objects': {
      const zone = commonValue(existing, 'zone')
      const kind = commonValue(existing, 'kind')
      return {
        id,
        title: 'New object',
        kind: typeof kind === 'string' && KIND_IDS.includes(kind) ? kind : KIND_IDS[0],
        position: [0, 0, 0],
        rotationDeg: 0,
        zone: typeof zone === 'string' && ZONE_IDS.includes(zone) ? zone : ZONE_IDS[0],
        placeholder: true,
      }
    }
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
