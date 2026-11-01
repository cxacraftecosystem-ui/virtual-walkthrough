/**
 * PROP SCHEMAS — the typed `props` of the hand block museum's procedural kinds, as pure data.
 *
 * One entry per procedural kind with curator-editable props: the admin renders a typed props
 * editor from it (falling back to raw JSON for anything not listed). Every key and default here
 * is the one the kind's model reads through `num` / `str` (models/types.ts) or `props.<key> === true`.
 * No three.js, no React: safe to import from the admin and from the server.
 *
 * Each building keeps its own copy of this file with the same exports (KIND_SCHEMAS, COMMON_PROPS,
 * kindDefaults and the types), so the shared admin reads whichever building it is built with.
 * `invisible` kinds draw nothing themselves; a `singleton` kind is meant to appear once per
 * exhibition. `owner` names who builds the kind's model ('existing' for every kind here).
 */

export type PropValue = string | number | boolean

export type PropSchema =
  | { key: string; type: 'number'; default?: number; min?: number; max?: number; step?: number; label?: string }
  | { key: string; type: 'bool'; default?: boolean; label?: string }
  | { key: string; type: 'text'; default?: string; multiline?: boolean; label?: string; help?: string }
  | { key: string; type: 'color'; default?: string; label?: string }
  | { key: string; type: 'select'; options: readonly string[]; default?: string; label?: string }
  /** A media library asset (URL). */
  | { key: string; type: 'media'; default?: string; accept?: 'audio' | 'video' | 'image' | 'model'; label?: string }

export interface KindSchema {
  kind: string
  /** Curator-facing name of the kind. */
  label: string
  /** Builds the model. */
  owner: 'WP1' | 'WP2' | 'WP3' | 'WP4' | 'WP5' | 'existing'
  props: readonly PropSchema[]
  /** Meant to exist once per exhibition. */
  singleton?: boolean
  /** Draws nothing of its own (settings carried by an object). */
  invisible?: boolean
}

const n = (key: string, label: string, def?: number, extra: { min?: number; max?: number; step?: number } = {}): PropSchema => ({ key, type: 'number', label, default: def, ...extra })
const b = (key: string, label: string, def?: boolean): PropSchema => ({ key, type: 'bool', label, default: def })
const t = (key: string, label: string, def?: string, help?: string, multiline = false): PropSchema => ({ key, type: 'text', label, default: def, multiline, help })
const c = (key: string, label: string, def?: string): PropSchema => ({ key, type: 'color', label, default: def })
const s = (key: string, label: string, options: readonly string[], def?: string): PropSchema => ({ key, type: 'select', label, options, default: def })
const img = (key: string, label: string, def?: string): PropSchema => ({ key, type: 'media', label, accept: 'image', default: def })

/** The carved block motifs (config/exhibits.ts MotifId), in exhibits/motifs.ts order. */
const MOTIFS = ['rosette', 'teardrop', 'star-lattice', 'leaf-trail', 'diamond'] as const
const MOTIF_LIST_HELP = `Comma-separated, from: ${MOTIFS.join(', ')}`
const seed = (def: number) => n('seed', 'Arrangement (seed)', def, { step: 1 })

const LIST: KindSchema[] = [
  // ── Atrium, theatre ──────────────────────────────────────────────────────────────
  {
    kind: 'textile-banner',
    label: 'Suspended textile banner',
    owner: 'existing',
    props: [n('width', 'Cloth width (m)', 1.3, { min: 0.3, max: 4, step: 0.05 }), n('cable', 'Cable drop (m)', 0.4, { min: 0, max: 3, step: 0.05 }), img('image', 'Printed cloth image')],
  },
  { kind: 'theatre-seating', label: 'Theatre seating', owner: 'existing', props: [n('seats', 'Seats', 8, { min: 1, max: 40, step: 1 })] },

  // ── Craft court, Gallery D ───────────────────────────────────────────────────────
  {
    kind: 'centrepiece',
    label: 'Carved block centrepiece',
    owner: 'existing',
    props: [
      s('motif', 'Carved motif', MOTIFS, 'rosette'),
      c('ink', 'Ink colour', '#8a3b2b'),
      s('wood', 'Block wood', ['teak', 'rosewood'], 'teak'),
      b('dome', 'Glass dome', false),
      n('spin', 'Turntable speed (rad/s)', 0.15, { min: 0, max: 1, step: 0.01 }),
      n('light', 'Accent light strength', 1, { min: 0, max: 2, step: 0.05 }),
    ],
  },
  { kind: 'vitrine', label: 'Table vitrine of hand blocks', owner: 'existing', props: [t('motifs', 'Blocks shown', 'rosette,diamond,leaf-trail', MOTIF_LIST_HELP)] },
  { kind: 'pedestal', label: 'Plaster pedestal', owner: 'existing', props: [b('cover', 'Glass cover', false)] },
  {
    kind: 'map-wall',
    label: 'Map of India wall',
    owner: 'existing',
    props: [
      n('width', 'Panel width (m)', 8, { min: 1, max: 12, step: 0.05 }),
      n('height', 'Panel height (m)', 4.6, { min: 1, max: 8, step: 0.05 }),
      n('bottom', 'Bottom edge height (m)', 0.65, { min: 0, max: 3, step: 0.05 }),
      t('title', 'Title', 'A Map of Making'),
      t('pins', 'Craft cluster pins', undefined, 'longitude,latitude pairs separated by “;”, e.g. 73.6,25.2;78.2,22.6. Not drawn while the object needs content.', true),
    ],
  },

  // ── Workshop ─────────────────────────────────────────────────────────────────────
  {
    kind: 'printing-table',
    label: 'Printing table',
    owner: 'existing',
    props: [s('motif', 'Block motif', MOTIFS, 'rosette'), c('ink', 'Ink colour', '#2c3f6b'), n('printed', 'Share of the cloth printed', 0.62, { min: 0, max: 1, step: 0.01 })],
  },
  { kind: 'dye-vat', label: 'Dye vat', owner: 'existing', props: [c('liquid', 'Dye colour', '#1f2d52')] },
  { kind: 'carving-bench', label: 'Carving bench', owner: 'existing', props: [s('motif', 'Block being carved', MOTIFS, 'star-lattice')] },
  {
    kind: 'visitors-wall',
    label: 'Visitors’ Wall (approved prints)',
    owner: 'existing',
    singleton: true,
    props: [
      n('cols', 'Columns', 8, { min: 1, max: 20, step: 1 }),
      n('rows', 'Rows', 3, { min: 1, max: 8, step: 1 }),
      n('width', 'Wall width (m)', 6.2, { min: 1, max: 12, step: 0.05 }),
      n('bottom', 'Bottom edge height (m)', 1, { min: 0, max: 3, step: 0.05 }),
      t('title', 'Title', 'The Visitors’ Wall'),
    ],
  },
  {
    kind: 'splat',
    label: 'Artisan capture (figure in light)',
    owner: 'existing',
    props: [
      n('seat', 'Seat height (m)', 0.6, { min: 0.2, max: 1.2, step: 0.01 }),
      n('tableHeight', 'Table height (m)', 0.86, { min: 0.4, max: 1.4, step: 0.01 }),
      n('reach', 'Reach to the table (m)', 0.42, { min: 0, max: 1, step: 0.01 }),
      c('glow', 'Glow colour', '#e6eef5'),
      t('cardTitle', 'Card title', 'The printer’s place'),
      t('cardText', 'Card text', 'A figure in light, seated where the printing is done.', undefined, true),
      n('cardSide', 'Card side (1 right, −1 left)', 1, { min: -1, max: 1, step: 2 }),
      n('splatScale', 'Capture scale', 1, { min: 0.05, max: 10, step: 0.05 }),
      n('splatY', 'Capture height offset (m)', 0, { step: 0.01 }),
      n('splatRotDeg', 'Capture rotation (°)', 0, { min: -180, max: 180, step: 1 }),
    ],
  },

  // ── Dye garden courtyard ─────────────────────────────────────────────────────────
  {
    kind: 'drying-line',
    label: 'Drying line',
    owner: 'existing',
    props: [n('cloths', 'Cloths', 4, { min: 1, max: 12, step: 1 }), t('images', 'Cloth images', undefined, 'Comma-separated image addresses, one per cloth.', true)],
  },

  // ── Shop ─────────────────────────────────────────────────────────────────────────
  { kind: 'shop-shelf', label: 'Shop shelf', owner: 'existing', props: [seed(1), b('cushions', 'Cushions on the shelves', false)] },
  { kind: 'shop-table', label: 'Shop table', owner: 'existing', props: [seed(3), b('cushions', 'Cushions on the table', false)] },
  { kind: 'stole-rail', label: 'Stole rail', owner: 'existing', props: [n('count', 'Stoles', 7, { min: 1, max: 16, step: 1 }), seed(21)] },

  // ── Reading room and library ─────────────────────────────────────────────────────
  { kind: 'bookcase', label: 'Bookcase', owner: 'existing', props: [seed(31)] },
  { kind: 'reading-table', label: 'Reading table', owner: 'existing', props: [n('chairs', 'Chairs', 3, { min: 0, max: 8, step: 1 }), n('lamps', 'Lamps', 2, { min: 0, max: 4, step: 1 })] },
  { kind: 'pattern-lectern', label: 'Pattern book lectern', owner: 'existing', props: [seed(41)] },
  {
    kind: 'drawing-wall',
    label: 'Drawing wall',
    owner: 'existing',
    props: [n('cols', 'Columns', 3, { min: 1, max: 8, step: 1 }), n('rows', 'Rows', 2, { min: 1, max: 6, step: 1 }), n('bottom', 'Bottom edge height (m)', 0.95, { min: 0, max: 3, step: 0.05 })],
  },
  { kind: 'resource-board', label: 'Resource board', owner: 'existing', props: [n('width', 'Board width (m)', 0.9, { min: 0.3, max: 3, step: 0.05 })] },

  // ── Credits ──────────────────────────────────────────────────────────────────────
  {
    kind: 'credits-panel',
    label: 'Credits / partners panel',
    owner: 'existing',
    props: [
      n('width', 'Panel width (m)', 2.3, { min: 0.5, max: 6, step: 0.05 }),
      n('panelHeight', 'Panel height (m)', 1.5, { min: 0.3, max: 4, step: 0.05 }),
      n('center', 'Centre height (m)', 1.75, { min: 0.5, max: 4, step: 0.05 }),
      t('kicker', 'Kicker', 'Presented by'),
      img('logo', 'Logo', '/brand/dc-handicrafts.png'),
    ],
  },
]

export const KIND_SCHEMAS: Readonly<Record<string, KindSchema>> = Object.fromEntries(LIST.map((k) => [k.kind, k]))

/** Props any object may carry, whatever its kind. The hand block museum has none. */
export const COMMON_PROPS: readonly PropSchema[] = []

/** Defaults of a kind's props (only those with a default). */
export function kindDefaults(kind: string): Record<string, PropValue> {
  const out: Record<string, PropValue> = {}
  for (const p of KIND_SCHEMAS[kind]?.props ?? []) if (p.default !== undefined) out[p.key] = p.default
  return out
}
