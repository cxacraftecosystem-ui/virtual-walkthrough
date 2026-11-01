/**
 * Buttons.
 * - `Button`: variant primary (the one purple action) | secondary (outline, default) | ghost |
 *   danger (red outline) | danger-solid (the confirm of a destructive dialog) | positive; size md
 *   (40px) | sm (36px); `loading` swaps the icon for a spinner, sets aria-busy and blocks clicks,
 *   and `loadingLabel` names the action in progress ("Saving…"). `href` renders an <a>.
 * - `IconButton`: icon-only; `label` becomes aria-label and title (never information only on hover).
 * - `ButtonRow`: a row of buttons; `destructive` is always last and set apart by a rule from 640px.
 * - `RowActions` / `RowAction`: a table row's separate, rounded action buttons (never a ⋯ menu),
 *   tone edit | neutral | danger | positive. The edit action is worded "Update".
 */
import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react'
import { Icon, type IconName } from './icons'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-solid' | 'positive'
export type ButtonSize = 'sm' | 'md'

const cls = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ')

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', extra?: string) {
  return cls('btn', variant !== 'secondary' && variant, size === 'sm' && 'small', extra)
}

interface CommonProps {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Leading icon (an IconName or any node). */
  icon?: IconName | ReactNode
  /** Trailing icon. */
  iconEnd?: IconName | ReactNode
  loading?: boolean
  /** Label while loading, e.g. "Saving…"; defaults to the normal label. */
  loadingLabel?: ReactNode
  block?: boolean
}

const renderIcon = (i: IconName | ReactNode) => (typeof i === 'string' ? <Icon name={i as IconName} /> : i)

type ButtonProps = CommonProps & ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined }
type LinkProps = CommonProps & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }

export const Button = forwardRef<HTMLButtonElement | HTMLAnchorElement, ButtonProps | LinkProps>(function Button(props, ref) {
  const { variant = 'secondary', size = 'md', icon, iconEnd, loading = false, loadingLabel, block, className, children, ...rest } = props
  const content = (
    <>
      {loading ? <span className="btn-spin" aria-hidden="true" /> : icon ? renderIcon(icon) : null}
      {loading && loadingLabel ? loadingLabel : children}
      {iconEnd && !loading ? renderIcon(iconEnd) : null}
    </>
  )
  const className2 = buttonClass(variant, size, cls(block && 'block', loading && 'is-loading', className))
  if (typeof (rest as LinkProps).href === 'string') {
    return (
      <a ref={ref as Ref<HTMLAnchorElement>} className={className2} {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}>
        {content}
      </a>
    )
  }
  const { type, onClick, ...b } = rest as ButtonHTMLAttributes<HTMLButtonElement>
  return (
    <button
      {...b}
      ref={ref as Ref<HTMLButtonElement>}
      type={type ?? 'button'}
      className={className2}
      aria-busy={loading || undefined}
      onClick={loading ? (e) => e.preventDefault() : onClick}
    >
      {content}
    </button>
  )
})

export const IconButton = forwardRef<
  HTMLButtonElement,
  { label: string; icon: IconName | ReactNode; size?: 'sm' | 'md'; tone?: 'default' | 'danger'; outlined?: boolean } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>
>(function IconButton({ label, icon, size = 'md', tone = 'default', outlined, className, type, ...rest }, ref) {
  return (
    <button
      {...rest}
      ref={ref}
      type={type ?? 'button'}
      aria-label={label}
      title={label}
      className={cls('icon-btn', size === 'sm' && 'sm', tone === 'danger' && 'danger', outlined && 'outlined', className)}
    >
      {renderIcon(icon)}
    </button>
  )
})

export function ButtonRow({ children, destructive, align = 'end', label, className }: { children?: ReactNode; destructive?: ReactNode; align?: 'start' | 'end'; label?: string; className?: string }) {
  return (
    <div className={cls('btn-row', align === 'end' && 'end', className)} role={label ? 'group' : undefined} aria-label={label}>
      {children}
      {destructive ? (
        <>
          {children ? <span className="btn-row-rule" aria-hidden="true" /> : null}
          {destructive}
        </>
      ) : null}
    </div>
  )
}

export type RowActionTone = 'edit' | 'neutral' | 'danger' | 'positive'
export const rowActionClass = (tone: RowActionTone = 'neutral', extra?: string) => cls('row-action', tone !== 'neutral' && tone, extra)

export function RowAction({ tone = 'neutral', icon, className, children, type, ...rest }: { tone?: RowActionTone; icon?: IconName } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} type={type ?? 'button'} className={rowActionClass(tone, className)}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  )
}

/** Right-aligned row of row actions; `destructive` goes last. */
export function RowActions({ children, destructive, label }: { children?: ReactNode; destructive?: ReactNode; label?: string }) {
  return (
    <div className="row-actions" role={label ? 'group' : undefined} aria-label={label}>
      {children}
      {destructive}
    </div>
  )
}
