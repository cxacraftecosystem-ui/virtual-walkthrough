/**
 * I18N (client) — current language store + React hooks.
 *
 *   const t = useT();  t('hud.help')            // re-renders when the language changes
 *   t('map.goTo', { room })                      // interpolation
 *   tr('entry.enter')                            // non-React (current language)
 *   useLang() / setLang('hi')                    // persisted (localStorage) + `?lang=`
 *
 * `<html lang>` follows the language (fonts/screen readers/speech pick it up).
 */
import { Fragment, createElement, useCallback, type ReactNode } from 'react'
import { create } from 'zustand'
import { bcp47, isLang, loc as locFor, translate, type Lang, type Vars } from './core'
import type { DictKey } from './en'

export * from './core'

const KEY = 'museum.lang'

function initialLang(): Lang {
  if (typeof window === 'undefined') return 'en'
  try {
    const q = new URLSearchParams(window.location.search).get('lang')
    if (isLang(q)) return q
    const s = localStorage.getItem(KEY)
    if (isLang(s)) return s
  } catch {
    /* storage unavailable */
  }
  return 'en'
}

interface LangState {
  lang: Lang
  setLang: (l: Lang) => void
}

function applyDocumentLang(l: Lang) {
  if (typeof document === 'undefined') return
  document.documentElement.lang = l === 'en' ? 'en' : bcp47(l)
}

export const useLangStore = create<LangState>((set) => ({
  lang: initialLang(),
  setLang: (lang) => {
    try {
      localStorage.setItem(KEY, lang)
    } catch {
      /* ignore */
    }
    applyDocumentLang(lang)
    set({ lang })
  },
}))
applyDocumentLang(useLangStore.getState().lang)

export const getLang = () => useLangStore.getState().lang
export const setLang = (l: Lang) => useLangStore.getState().setLang(l)
export const useLang = () => useLangStore((s) => s.lang)

/** Translate in the current language (non-React callers; does not subscribe). */
export const tr = (key: DictKey, vars?: Vars) => translate(getLang(), key, vars)

export type T = (key: DictKey, vars?: Vars) => string

/** Translator bound to the current language; re-renders on change. */
export function useT(): T {
  const lang = useLang()
  return useCallback<T>((key, vars) => translate(lang, key, vars), [lang])
}

/** Localised content field in the current language (React). */
export function useLoc() {
  const lang = useLang()
  return useCallback(<O extends object, K extends keyof O & string>(item: O | null | undefined, field: K) => locFor(item, field, lang), [lang])
}

/**
 * Translate with React nodes as placeholders:
 *   rich(t('prompt.press'), { key: <kbd>E</kbd> })
 */
export function rich(template: string, nodes: Record<string, ReactNode>): ReactNode {
  const parts = template.split(/\{(\w+)\}/g)
  return parts.map((p, i) => (i % 2 === 1 ? createElement(Fragment, { key: i }, p in nodes ? nodes[p] : `{${p}}`) : p))
}
