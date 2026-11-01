/**
 * Anchored popover plumbing shared by Select, Combobox and Menu.
 *
 * The panel is portalled (fixed position, measured from the trigger) so a scrolling card, a
 * clipped dialog body or the sidebar never cut it off. The portal target is the open <dialog> the
 * trigger sits in (dialogs live in the top layer, so anything outside them would be hidden behind),
 * otherwise the sidebar or `.adm-root`. It opens below the trigger with a 6px gap and flips up only
 * when the room below is too small *and* the room above is larger. Escape is caught on window in the
 * capture phase and stopped, so it closes only the topmost popover and not the dialog behind it.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'

export interface Anchor {
  container: HTMLElement
  style: CSSProperties
  up: boolean
}

const GAP = 6
const GUTTER = 8
const MIN_ROOM = 220

export function measureAnchor(trigger: HTMLElement, wantHeight = 320, alignEnd = false, minWidth?: number): Anchor {
  const r = trigger.getBoundingClientRect()
  const vh = window.innerHeight
  const vw = window.innerWidth
  const below = vh - r.bottom - GUTTER
  const above = r.top - GUTTER
  const up = below < Math.max(MIN_ROOM, Math.min(wantHeight, 360)) && above > below
  const width = Math.max(r.width, minWidth ?? 0)
  const style: CSSProperties = {
    position: 'fixed',
    minWidth: Math.min(width, vw - GUTTER * 2),
    maxHeight: Math.max(160, (up ? above : below) - GAP),
  }
  if (alignEnd) {
    style.right = Math.max(GUTTER, vw - r.right)
    style.left = 'auto'
  } else {
    style.left = Math.max(GUTTER, Math.min(r.left, vw - GUTTER - Math.min(width, vw - GUTTER * 2)))
    style.right = 'auto'
  }
  if (up) {
    style.bottom = vh - r.top + GAP
    style.top = 'auto'
  } else {
    style.top = r.bottom + GAP
    style.bottom = 'auto'
  }
  const container = (trigger.closest('dialog[open]') as HTMLElement | null) ?? (trigger.closest('.adm-side') as HTMLElement | null) ?? (trigger.closest('.adm-root') as HTMLElement | null) ?? document.body
  return { container, style, up }
}

/**
 * Open/close state + anchor for a popover owned by `triggerRef`. `panelRef` is the portalled panel;
 * clicks outside both close it, and so do resize and scrolling outside the panel (after a short grace
 * period so the scroll caused by opening does not close it at once).
 */
export function usePopover(triggerRef: RefObject<HTMLElement | null>, opts: { wantHeight?: number; alignEnd?: boolean; minWidth?: number; onClose?: () => void } = {}) {
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const optsRef = useRef(opts)
  useEffect(() => {
    optsRef.current = opts
  })
  const open = anchor !== null

  const show = useCallback(() => {
    const t = triggerRef.current
    if (!t) return
    const o = optsRef.current
    setAnchor(measureAnchor(t, o.wantHeight, o.alignEnd, o.minWidth))
  }, [triggerRef])

  const hide = useCallback(() => {
    setAnchor((a) => {
      if (a) optsRef.current.onClose?.()
      return null
    })
  }, [])

  useEffect(() => {
    if (!open) return
    const openedAt = performance.now()
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return
      hide()
    }
    const onScroll = (e: Event) => {
      if (panelRef.current && e.target instanceof Node && panelRef.current.contains(e.target)) return
      if (performance.now() - openedAt < 600) {
        const t = triggerRef.current
        if (t) {
          const o = optsRef.current
          setAnchor(measureAnchor(t, o.wantHeight, o.alignEnd, o.minWidth))
        }
        return
      }
      hide()
    }
    const onResize = () => hide()
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open, hide, triggerRef])

  return { open, anchor, show, hide, panelRef }
}

/** Escape closes only the topmost popover: capture phase on window + stopPropagation. */
export function useEscape(active: boolean, onEscape: () => void) {
  const ref = useRef(onEscape)
  useEffect(() => {
    ref.current = onEscape
  })
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      e.preventDefault()
      ref.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active])
}

/** Recursive text of a React label (for typeahead and filtering), never a typeof-string test. */
export function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'object' && 'props' in (node as object)) return textOf((node as { props: { children?: unknown } }).props.children)
  return ''
}
