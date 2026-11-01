/**
 * What a content item still lacks: the placeholder flag, required media, alt text, Hindi / Bengali
 * translations, a maker profile, a placement inside its wall, and references that point nowhere.
 * Used by the content list filters and the checklist page; pure (no React).
 */
import type { ContentCollection } from '../../../museum/content/types'
import { FIELDS, LANGS, getPath, surfaceRange, type FieldDef } from '../../fields'
import { isBlank } from './model'

export type IssueCode = 'placeholder' | 'media' | 'alt' | 'hi' | 'bn' | 'maker' | 'maker-missing' | 'placement' | 'related'
/** Who can close the gap: the workshop sends content, the curator fixes the record. */
export type IssueOwner = 'workshop' | 'curator'

export interface Issue {
  code: IssueCode
  /** Short reader words, e.g. "No image", "Hindi: 3 of 8 texts missing". */
  label: string
  /** The form field to jump to. */
  field: string | null
  who: IssueOwner
}

export const ISSUE_LABEL: Record<IssueCode, string> = {
  placeholder: 'Needs content',
  media: 'Missing media',
  alt: 'Missing alt text',
  hi: 'Missing Hindi',
  bn: 'Missing Bengali',
  maker: 'No maker profile',
  'maker-missing': 'Maker not found',
  placement: 'Placement out of range',
  related: 'Related item not found',
}

/** Ids that references are checked against; `null` = not loaded (references are then not checked). */
export interface RefSets {
  artisans: ReadonlySet<string> | null
  artworks: ReadonlySet<string> | null
  exhibits: ReadonlySet<string> | null
}

const has = (fields: FieldDef[], path: string) => fields.some((f) => f.path === path)

/** Translation fields of one language whose English text is filled but whose translation is not. */
export function missingTranslations(c: ContentCollection, item: Record<string, unknown>, lang: 'hi' | 'bn'): { missing: FieldDef[]; total: number } {
  const prefix = `i18n.${lang}.`
  const fields = FIELDS[c].filter((f) => f.path.startsWith(prefix))
  const needed = fields.filter((f) => !isBlank(getPath(item, f.path.slice(prefix.length))))
  return { missing: needed.filter((f) => isBlank(getPath(item, f.path))), total: needed.length }
}

export function itemIssues(c: ContentCollection, item: Record<string, unknown>, refs?: RefSets): Issue[] {
  const fields = FIELDS[c]
  const out: Issue[] = []
  if (item.placeholder === true) out.push({ code: 'placeholder', label: 'Marked as needing content from the workshop', field: 'placeholder', who: 'workshop' })
  for (const f of fields) {
    if (f.type === 'media' && f.required && isBlank(getPath(item, f.path))) out.push({ code: 'media', label: `No ${f.label.toLowerCase()}`, field: f.path, who: 'workshop' })
  }
  if (has(fields, 'alt') && isBlank(item.alt)) out.push({ code: 'alt', label: 'No alt text', field: 'alt', who: 'curator' })
  for (const l of LANGS) {
    const t = missingTranslations(c, item, l.id)
    if (t.missing.length) out.push({ code: l.id, label: `${l.short}: ${t.missing.length} of ${t.total} ${t.total === 1 ? 'text' : 'texts'} missing`, field: t.missing[0].path, who: 'workshop' })
  }
  if (has(fields, 'artisanId')) {
    const a = item.artisanId
    if (isBlank(a)) out.push({ code: 'maker', label: 'No maker profile', field: 'artisanId', who: 'workshop' })
    else if (refs?.artisans && !refs.artisans.has(String(a))) out.push({ code: 'maker-missing', label: `Maker profile “${String(a)}” not found`, field: 'artisanId', who: 'curator' })
  }
  if (has(fields, 'placement.surface')) {
    const surface = getPath(item, 'placement.surface')
    const at = getPath(item, 'placement.at')
    const r = surfaceRange(surface)
    if (!r) out.push({ code: 'placement', label: isBlank(surface) ? 'No wall chosen' : `Unknown wall “${String(surface)}”`, field: 'placement.surface', who: 'curator' })
    else if (typeof at !== 'number' || !Number.isFinite(at)) out.push({ code: 'placement', label: 'No position on the wall', field: 'placement.at', who: 'curator' })
    else if (at < r.min - 1e-6 || at > r.max + 1e-6) out.push({ code: 'placement', label: `Outside its wall (${r.min.toFixed(2)} to ${r.max.toFixed(2)} m)`, field: 'placement.at', who: 'curator' })
  }
  for (const [path, set, word] of [
    ['exhibitId', refs?.exhibits ?? null, 'exhibit'],
    ['artworkId', refs?.artworks ?? null, 'artwork'],
  ] as const) {
    const v = item[path]
    if (has(fields, path) && set && !isBlank(v) && !set.has(String(v))) out.push({ code: 'related', label: `Related ${word} “${String(v)}” not found`, field: path, who: 'curator' })
  }
  return out
}

/** Every issue code an item has, for filtering. */
export const issueCodes = (issues: Issue[]) => new Set(issues.map((i) => i.code))
