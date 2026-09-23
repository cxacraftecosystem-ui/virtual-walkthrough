/**
 * Focus management for overlays.
 *
 *   useFocusTrap(ref, open, { onEscape })
 *
 * While `open`: Tab / Shift+Tab cycle inside `ref` (modal focus trap), Esc calls
 * `onEscape`, and when it closes focus returns to whatever was focused before
 * (unless that element has gone or focus already moved somewhere meaningful).
 */
import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    if (el.tabIndex < 0) return false
    if (el.closest('[aria-hidden="true"], [inert]')) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 || r.height > 0 || el === document.activeElement
  })
}

interface Options {
  onEscape?: () => void
  /** Focus the first focusable element on open when nothing inside is focused (default true). */
  autoFocus?: boolean
  /** Restore focus to the previously focused element on close (default true). */
  restore?: boolean
}

export function useFocusTrap(ref: RefObject<HTMLElement | null>, open: boolean, opts: Options = {}) {
  const optsRef = useRef(opts)
  useEffect(() => {
    optsRef.current = opts
  })

  useEffect(() => {
    if (!open) return
    const root = ref.current
    if (!root) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null

    if (optsRef.current.autoFocus !== false && !root.contains(document.activeElement)) {
      const first = focusables(root)[0]
      ;(first ?? root).focus({ preventScroll: true })
    }

    const onKey = (e: KeyboardEvent) => {
      const el = ref.current
      if (!el) return
      if (e.key === 'Escape' && optsRef.current.onEscape) {
        e.preventDefault()
        e.stopPropagation()
        optsRef.current.onEscape()
        return
      }
      if (e.key !== 'Tab') return
      const list = focusables(el)
      if (list.length === 0) {
        e.preventDefault()
        el.focus({ preventScroll: true })
        return
      }
      const first = list[0]
      const last = list[list.length - 1]
      const active = document.activeElement
      if (!el.contains(active)) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus({ preventScroll: true })
      } else if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus({ preventScroll: true })
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus({ preventScroll: true })
      }
    }
    // Capture phase so the trap wins over global shortcuts.
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      if (optsRef.current.restore === false) return
      const a = document.activeElement
      const lost = !a || a === document.body || root.contains(a) || !root.isConnected
      if (lost && previous && previous.isConnected) previous.focus({ preventScroll: true })
    }
  }, [open, ref])
}
