/**
 * Shared helpers for the moderation pages (Prints, Comments, Errors) and the other operations pages.
 *
 * - `useTriageKeys(map, enabled)`: single-letter shortcuts for working through a queue (j/k move, x tick,
 *   a/r/h… act, Enter open). Ignored while typing, while a dialog is open, with Ctrl/Cmd/Alt held, and
 *   for the key that follows the shell's `g` prefix (so "g k" still goes to Makers instead of moving up).
 * - `useCursor(ids)`: the highlighted row of a queue, kept on a valid row as the list changes, scrolled
 *   into view and announced politely.
 * - `sortRows`: the same stable, blanks-last ordering DataTable uses, so a page can sort, then paginate,
 *   then hand the slice to DataTable without the two disagreeing.
 * - `chunked`: run a bulk endpoint 200 ids at a time (its limit), collecting the ids of failed chunks.
 * - `overviewStale()`: tell the shell a dashboard count moved (nav badges refresh).
 * - `useRefreshOnFocus(fn)`: reload quietly when the tab comes back into view.
 * - `readStore` / `writeStore`: localStorage behind try/catch. `KeyLegend`: the shortcut line under a toolbar.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Kbd } from '../ui'

/** Same event name as AdminApp's OVERVIEW_STALE (not imported: pages must not pull the shell into their chunk). */
export const overviewStale = () => window.dispatchEvent(new Event('museum-admin:overview'))

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  if (!el || !el.tagName) return false
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.getAttribute('role') === 'combobox'
}

export type TriageMap = Record<string, (e: KeyboardEvent) => void>

/** Keys are matched on `e.key` (case-sensitive: 'a', 'Enter'). */
export function useTriageKeys(map: TriageMap, enabled = true) {
  const live = useRef(map)
  useEffect(() => {
    live.current = map
  })
  useEffect(() => {
    if (!enabled) return
    let gAt = 0
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
      if (isTyping(e.target)) return
      if (document.querySelector('dialog[open]') || document.querySelector('.ui-popover')) return
      if (e.key === 'g') {
        gAt = Date.now()
        return
      }
      if (Date.now() - gAt < 1200) {
        gAt = 0
        return // the shell's "g <key>" navigation owns this key
      }
      // Enter on a focused link or button keeps its own meaning
      if (e.key === 'Enter' && (e.target as HTMLElement | null)?.closest?.('a, button, [role="button"], summary')) return
      const fn = live.current[e.key]
      if (!fn) return
      e.preventDefault()
      fn(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}

/**
 * The keyboard cursor over a list of ids. `index` stays in range when rows leave (after approving the
 * last row the one above becomes current). `move(+1)` / `move(-1)` step; `scrollSel` is a CSS selector
 * for the current row's element (`[data-cursor="true"]` by default).
 */
export function useCursor(ids: string[], scrollSel = '[data-cursor="true"]') {
  const [index, setIndex] = useState(-1)
  const [announce, setAnnounce] = useState('')
  const byKey = useRef(false)
  const clamped = ids.length ? Math.min(Math.max(index, -1), ids.length - 1) : -1
  const currentId = clamped >= 0 ? ids[clamped] : null

  useEffect(() => {
    if (!byKey.current || !currentId) return
    byKey.current = false
    const el = document.querySelector<HTMLElement>(scrollSel)
    if (!el) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.querySelector('[data-reduced-motion="true"]')
    el.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' })
  }, [currentId, scrollSel])

  const move = useCallback(
    (delta: number, label?: (id: string, i: number) => string) => {
      if (!ids.length) return
      const next = clamped < 0 ? (delta > 0 ? 0 : ids.length - 1) : Math.min(ids.length - 1, Math.max(0, clamped + delta))
      byKey.current = true
      setIndex(next)
      setAnnounce(label ? label(ids[next], next) : `${next + 1} of ${ids.length}`)
    },
    [ids, clamped],
  )
  const setCurrent = useCallback(
    (id: string | null) => {
      const i = id ? ids.indexOf(id) : -1
      setIndex(i)
    },
    [ids],
  )
  return { index: clamped, currentId, move, setCurrent, announce }
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
type SortVal = string | number | null | undefined

/** Stable sort; blanks last in either direction (matches DataTable). */
export function sortRows<R>(rows: R[], value: ((r: R) => SortVal) | undefined, dir: 'asc' | 'desc'): R[] {
  if (!value) return rows
  const d = dir === 'asc' ? 1 : -1
  return rows
    .map((r, i) => ({ r, i, v: value(r) }))
    .sort((a, b) => {
      if (a.v === b.v) return a.i - b.i
      if (a.v === null || a.v === undefined || a.v === '') return 1
      if (b.v === null || b.v === undefined || b.v === '') return -1
      const c = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : collator.compare(String(a.v), String(b.v))
      return c * d || a.i - b.i
    })
    .map((x) => x.r)
}

/** Bulk endpoints take at most 200 ids: run the chunks one after another, keep going past a failure. */
export async function chunked(ids: string[], run: (chunk: string[]) => Promise<{ updated: number }>, size = 200) {
  let updated = 0
  const failed: string[] = []
  let lastError: unknown = null
  for (let i = 0; i < ids.length; i += size) {
    const chunk = ids.slice(i, i + size)
    try {
      updated += (await run(chunk)).updated
    } catch (e) {
      failed.push(...chunk)
      lastError = e
    }
  }
  return { updated, failed, lastError }
}

/** Reload when the window regains focus or the tab becomes visible (at most every 5 s). */
export function useRefreshOnFocus(fn: () => void, enabled = true) {
  const live = useRef(fn)
  useEffect(() => {
    live.current = fn
  })
  useEffect(() => {
    if (!enabled) return
    let last = Date.now()
    const run = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 5000) return
      last = Date.now()
      live.current()
    }
    window.addEventListener('focus', run)
    document.addEventListener('visibilitychange', run)
    return () => {
      window.removeEventListener('focus', run)
      document.removeEventListener('visibilitychange', run)
    }
  }, [enabled])
}

export function readStore<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = window.localStorage.getItem(key)
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
  } catch {
    return fallback
  }
}
export function writeStore(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* storage blocked: the choice lasts for this visit only */
  }
}

/** Sub-path of the page's hash: `#/prints/abc` → 'abc' (decoded), '' when none. Query (`?…`) excluded. */
export function hashTail(page: string): string {
  const h = window.location.hash.replace(/^#\/?/, '').split('?')[0]
  if (!h.startsWith(`${page}/`)) return ''
  try {
    return decodeURIComponent(h.slice(page.length + 1))
  } catch {
    return ''
  }
}
/** Query of the page's hash: `#/activity?target=a:b` → URLSearchParams. */
export const hashQuery = () => new URLSearchParams(window.location.hash.split('?')[1] ?? '')

/** "3 prints" / "1 print". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`

/** A line of key caps, e.g. `[['j k', 'move'], ['a', 'approve']]`. Hidden on phones (no keyboard there). */
export function KeyLegend({ keys }: { keys: [string, string][] }) {
  return (
    <p className="ops-keys hide-phone" aria-label="Keyboard shortcuts">
      {keys.map(([k, what]) => (
        <span key={k}>
          <Kbd keys={k} /> {what}
        </span>
      ))}
    </p>
  )
}
