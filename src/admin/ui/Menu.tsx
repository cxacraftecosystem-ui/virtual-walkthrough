/**
 * Menu: a button that opens a short list of commands (`role="menu"`), for overflow actions and the
 * user menu. Row actions in tables are NOT a menu — use RowActions (separate buttons).
 * - Opens on click, ↓/Enter/Space; focus moves to the first item; ↑/↓/Home/End rove; Escape closes
 *   and returns focus to the button; Tab closes. Items are `{ label, icon?, onSelect, danger?, href? }`
 *   or `'separator'`.
 */
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from './icons'
import { useEscape, usePopover } from './popover'

export type MenuItem =
  | 'separator'
  | {
      label: ReactNode
      icon?: IconName
      onSelect?: () => void
      href?: string
      external?: boolean
      danger?: boolean
      disabled?: boolean
      hint?: ReactNode
    }

export function Menu({
  label,
  items,
  trigger,
  align = 'end',
  triggerClassName = 'icon-btn',
}: {
  /** Accessible name of the menu button (also its title when the trigger is icon-only). */
  label: string
  items: MenuItem[]
  /** Trigger content (defaults to a ⋯ icon). */
  trigger?: ReactNode
  align?: 'start' | 'end'
  triggerClassName?: string
}) {
  const id = useId()
  const btnRef = useRef<HTMLButtonElement>(null)
  const pop = usePopover(btnRef, { wantHeight: 40 * items.length + 16, alignEnd: align === 'end', minWidth: 200 })
  const close = (refocus = true) => {
    pop.hide()
    if (refocus) btnRef.current?.focus()
  }
  useEscape(pop.open, () => close())

  const focusItem = (which: 'first' | 'last' | 1 | -1) => {
    const els = Array.from(pop.panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])
    if (!els.length) return
    const cur = els.indexOf(document.activeElement as HTMLElement)
    const next = which === 'first' ? 0 : which === 'last' ? els.length - 1 : (cur + which + els.length) % els.length
    els[next].focus()
  }
  useEffect(() => {
    if (pop.open) requestAnimationFrame(() => focusItem('first'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pop.open])

  const onMenuKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      focusItem(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      focusItem(-1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      focusItem('first')
    } else if (e.key === 'End') {
      e.preventDefault()
      focusItem('last')
    } else if (e.key === 'Tab') close(false)
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={pop.open}
        aria-controls={pop.open ? `${id}-menu` : undefined}
        aria-label={trigger ? undefined : label}
        title={trigger ? undefined : label}
        onClick={() => (pop.open ? close() : pop.show())}
        onKeyDown={(e) => {
          if (!pop.open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            pop.show()
          }
        }}
      >
        {trigger ?? <Icon name="more" />}
      </button>
      {pop.open && pop.anchor
        ? createPortal(
            <div ref={pop.panelRef} id={`${id}-menu`} role="menu" aria-label={label} className={`ui-popover${pop.anchor.up ? ' up' : ''}`} style={{ ...pop.anchor.style, padding: 6 }} onKeyDown={onMenuKey}>
              {items.map((it, i) => {
                if (it === 'separator') return <hr key={i} className="ui-menu-sep" />
                const inner = (
                  <>
                    {it.icon ? <Icon name={it.icon} /> : null}
                    <span className="grow">{it.label}</span>
                    {it.hint ? <span className="small muted">{it.hint}</span> : null}
                  </>
                )
                const cls = `ui-menu-item${it.danger ? ' danger' : ''}`
                if (it.href)
                  return (
                    <a key={i} role="menuitem" tabIndex={-1} className={cls} href={it.href} target={it.external ? '_blank' : undefined} rel={it.external ? 'noreferrer' : undefined} onClick={() => close(false)}>
                      {inner}
                    </a>
                  )
                return (
                  <button
                    key={i}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    className={cls}
                    aria-disabled={it.disabled || undefined}
                    onClick={() => {
                      if (it.disabled) return
                      close()
                      it.onSelect?.()
                    }}
                  >
                    {inner}
                  </button>
                )
              })}
            </div>,
            pop.anchor.container,
          )
        : null}
    </>
  )
}
