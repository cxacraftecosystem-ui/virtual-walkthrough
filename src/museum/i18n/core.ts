/**
 * I18N CORE — framework-free, server-safe (used by the museum UI and the /guide page).
 *
 *   translate('hi', 'map.goTo', { room: 'Gallery A' })   → 'Gallery A पर जाएँ'
 *   loc(artwork, 'title', 'bn')                           → artwork.i18n?.bn?.title ?? artwork.title
 *
 * UI strings live in en.ts / hi.ts / bn.ts (typed: every language has every key).
 * Content (artworks, exhibits, …) carries optional per-language overrides in `i18n`,
 * falling back to the English field.
 */
import { bn } from './bn'
import { en, type Dict, type DictKey } from './en'
import { hi } from './hi'

export type Lang = 'en' | 'hi' | 'bn'
/** Languages other than the default English (keys of content `i18n` overrides). */
export type AltLang = Exclude<Lang, 'en'>

export const LANGS: { value: Lang; native: string; english: string; bcp47: string }[] = [
  { value: 'en', native: 'English', english: 'English', bcp47: 'en-IN' },
  { value: 'hi', native: 'हिन्दी', english: 'Hindi', bcp47: 'hi-IN' },
  { value: 'bn', native: 'বাংলা', english: 'Bengali', bcp47: 'bn-IN' },
]

export const DICTS: Record<Lang, Dict> = { en, hi, bn }

export const isLang = (v: unknown): v is Lang => v === 'en' || v === 'hi' || v === 'bn'

export const bcp47 = (lang: Lang) => LANGS.find((l) => l.value === lang)?.bcp47 ?? 'en'

export type Vars = Record<string, string | number>

export function format(s: string, vars?: Vars) {
  if (!vars) return s
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
}

export function translate(lang: Lang, key: DictKey, vars?: Vars): string {
  return format(DICTS[lang]?.[key] ?? en[key] ?? key, vars)
}

/**
 * Optional per-language content overrides: `{ hi: { title: '…' }, bn: { … } }`.
 * `K` lists the translatable string fields of the item.
 */
export type ContentI18n<K extends string> = Partial<Record<AltLang, Partial<Record<K, string>>>>

/** Localised field of a content item (falls back to the item's English value). */
export function loc<T extends object, K extends keyof T & string>(item: T | null | undefined, field: K, lang: Lang): T[K] | undefined {
  if (!item) return undefined
  if (lang !== 'en') {
    const i18n = (item as { i18n?: Partial<Record<AltLang, Partial<Record<string, unknown>>>> }).i18n
    const v = i18n?.[lang]?.[field]
    if (typeof v === 'string' && v.trim()) return v as T[K]
    if (Array.isArray(v) && v.length) return v as T[K]
  }
  return item[field]
}

export type { Dict, DictKey }
