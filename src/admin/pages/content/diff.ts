/** Field-level differences between two versions of an item, in reader words ("Title, Image and 2 more"). */
import type { ContentCollection } from '../../../museum/content/types'
import { FIELDS, getPath } from '../../fields'
import { stripInternal } from './model'

const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Dotted paths whose values differ (objects are walked; arrays compare whole). */
export function changedPaths(a: Record<string, unknown> | null | undefined, b: Record<string, unknown> | null | undefined, prefix = ''): string[] {
  const x = a ? (prefix ? a : stripInternal(a)) : {}
  const y = b ? (prefix ? b : stripInternal(b)) : {}
  const out: string[] = []
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
    const p = prefix ? `${prefix}.${k}` : k
    const va = x[k]
    const vb = y[k]
    if (isPlain(va) && isPlain(vb)) out.push(...changedPaths(va, vb, p))
    else if (JSON.stringify(va) !== JSON.stringify(vb)) out.push(p)
  }
  return out
}

/** The form label of a path ("placement.at" → "Position on the wall"), else the path itself. */
export function fieldLabel(c: ContentCollection, path: string) {
  const f = FIELDS[c].find((d) => d.path === path || path.startsWith(`${d.path}.`))
  return f ? f.label.replace(/\s*\(.*\)$/, '') : path
}

export function summarizeChanges(c: ContentCollection, paths: string[], max = 3): string {
  const labels = [...new Set(paths.map((p) => fieldLabel(c, p)))]
  if (!labels.length) return 'No field changes'
  if (labels.length <= max) return labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
  return `${labels.slice(0, max).join(', ')} and ${labels.length - max} more`
}

/** A short printable value for a diff table. */
export function showValue(v: unknown): string {
  if (v === undefined || v === null || v === '') return '–'
  if (typeof v === 'string') return v.length > 160 ? `${v.slice(0, 157)}…` : v
  const s = JSON.stringify(v)
  return s.length > 160 ? `${s.slice(0, 157)}…` : s
}

export const valueAt = getPath
