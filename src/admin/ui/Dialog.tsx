/**
 * DialogShell: the one dialog frame (native modal <dialog>: top layer, inert background, Tab stays
 * inside, focus returns to the opener on close). Used by Modal, ConfirmDialog and Drawer.
 * - Header: optional tone icon chip, <h2> title (aria-labelledby), description (aria-describedby),
 *   close × (hidden when `dismissable` is false).
 * - Initial focus: the first `[data-autofocus]` inside, else the browser's first focusable.
 * - Escape and the backdrop dismiss unless `dismissable` is false or `busy`; the backdrop never
 *   dismisses an alertdialog or the danger tone. Mounted = open: render it conditionally.
 * - The admin's scroll layer is locked while any dialog is open (reference-counted).
 */
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Icon, type IconName } from './icons'

let locks = 0
function lockScroll() {
  locks++
  const root = document.querySelector<HTMLElement>('.adm-root')
  if (root && locks === 1) {
    const gutter = root.offsetWidth - root.clientWidth
    root.style.overflow = 'hidden'
    if (gutter > 0) root.style.paddingRight = `${gutter}px`
  }
  return () => {
    locks = Math.max(0, locks - 1)
    if (root && locks === 0) {
      root.style.overflow = ''
      root.style.paddingRight = ''
    }
  }
}

export type DialogTone = 'neutral' | 'danger' | 'warning'
const TONE_ICON: Record<DialogTone, IconName> = { neutral: 'info', danger: 'alert', warning: 'alert' }

export interface DialogShellProps {
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  onClose: () => void
  size?: 'small' | 'medium' | 'large'
  role?: 'dialog' | 'alertdialog'
  tone?: DialogTone
  /** Show the tone's icon chip beside the title (or pass an IconName). */
  icon?: boolean | IconName
  /** false: no ×, Escape and backdrop do nothing (the dialog must be answered). */
  dismissable?: boolean
  /** While true every way of dismissing is suspended. */
  busy?: boolean
  className?: string
}

export function DialogShell({
  title,
  description,
  children,
  footer,
  onClose,
  size = 'medium',
  role,
  tone = 'neutral',
  icon = false,
  dismissable = true,
  busy = false,
  className,
}: DialogShellProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descId = useId()
  const live = useRef({ onClose, dismissable, busy })
  useEffect(() => {
    live.current = { onClose, dismissable, busy }
  })
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (!d.open) d.showModal()
    const unlock = lockScroll()
    const raf = requestAnimationFrame(() => d.querySelector<HTMLElement>('[data-autofocus]')?.focus())
    const onCancel = (e: Event) => {
      e.preventDefault()
      const l = live.current
      if (l.dismissable && !l.busy) l.onClose()
    }
    d.addEventListener('cancel', onCancel)
    return () => {
      cancelAnimationFrame(raf)
      d.removeEventListener('cancel', onCancel)
      if (d.open) d.close()
      unlock()
    }
  }, [])
  const backdropCloses = dismissable && role !== 'alertdialog' && tone !== 'danger'
  const iconName: IconName | null = icon === true ? TONE_ICON[tone] : typeof icon === 'string' ? icon : null
  return (
    <dialog
      ref={ref}
      className={['adm-dialog', size, tone !== 'neutral' && `tone-${tone}`, className].filter(Boolean).join(' ')}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      aria-modal="true"
      role={role}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && backdropCloses && !live.current.busy) live.current.onClose()
      }}
    >
      <div className="dlg-head">
        {iconName ? (
          <span className="dlg-icon" aria-hidden="true">
            <Icon name={iconName} />
          </span>
        ) : null}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 id={titleId}>{title}</h2>
          {description ? (
            <p id={descId} className="confirm-body" style={{ margin: '6px 0 0' }}>
              {description}
            </p>
          ) : null}
        </div>
        {dismissable ? (
          <button type="button" className="icon-btn" onClick={() => !busy && onClose()} aria-label="Close dialog" title="Close dialog" disabled={busy}>
            <Icon name="close" />
          </button>
        ) : null}
      </div>
      {children !== undefined && children !== null && children !== false && <div className="dlg-body">{children}</div>}
      {footer && <div className="dlg-foot">{footer}</div>}
    </dialog>
  )
}

/**
 * Drawer: a side sheet for detail views and longer forms (right by default). Same behaviour as a
 * dialog (focus stays inside, Escape closes, focus returns to the opener).
 */
export function Drawer({ side = 'right', wide = false, className, ...props }: Omit<DialogShellProps, 'size'> & { side?: 'left' | 'right'; wide?: boolean }) {
  return <DialogShell {...props} size="large" className={['ui-drawer', side === 'left' && 'left', wide && 'wide', className].filter(Boolean).join(' ')} />
}
