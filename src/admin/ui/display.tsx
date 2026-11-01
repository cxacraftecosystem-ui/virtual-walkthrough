/**
 * Small display primitives.
 * - `Badge`: tone neutral | info | ok | warn | danger; always carries a word (colour never alone).
 * - `StatusBadge`: the curated label + tone for a record status (draft, published, pending,
 *   approved, rejected, hidden, visible, open, resolved, needs-content, placeholder); unknown values
 *   are humanised ("SOME_STATUS" → "Some status").
 * - `CountBadge`: the small amber count (nav, tabs) with screen-reader words.
 * - `Kbd`: a key cap; `Kbd keys="g c"` renders two.
 * - `Stat`: a dashboard tile (label, value, sub line, icon; `href` makes the whole tile a link).
 * - `Tooltip`: a hover/focus bubble that only repeats a name the control already has.
 * - `ProgressBar`: themed track/fill, clamped 0–100, `done` tone.
 */
import type { MouseEvent, ReactNode } from 'react'
import { Icon, type IconName } from './icons'

export type BadgeTone = 'neutral' | 'info' | 'ok' | 'warn' | 'danger'
const TONE_CLASS: Record<BadgeTone, string> = { neutral: '', info: 'info', ok: 'ok', warn: 'warn', danger: 'danger' }

export function Badge({ tone = 'neutral', children, dot = false, size = 'sm', title }: { tone?: BadgeTone; children: ReactNode; dot?: boolean; size?: 'sm' | 'lg'; title?: string }) {
  return (
    <span className={['badge', TONE_CLASS[tone], size === 'lg' && 'lg'].filter(Boolean).join(' ')} title={title}>
      {dot ? <span className="dot" aria-hidden="true" /> : null}
      {children}
    </span>
  )
}

export type KnownStatus = 'draft' | 'published' | 'pending' | 'approved' | 'rejected' | 'hidden' | 'visible' | 'open' | 'resolved' | 'needs-content' | 'placeholder' | 'default'
const STATUS: Record<KnownStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  published: { label: 'Published', tone: 'ok' },
  pending: { label: 'Pending', tone: 'warn' },
  approved: { label: 'Approved', tone: 'ok' },
  rejected: { label: 'Rejected', tone: 'danger' },
  hidden: { label: 'Hidden', tone: 'danger' },
  visible: { label: 'Visible', tone: 'ok' },
  open: { label: 'Open', tone: 'warn' },
  resolved: { label: 'Resolved', tone: 'ok' },
  'needs-content': { label: 'Needs content', tone: 'info' },
  placeholder: { label: 'Placeholder', tone: 'info' },
  default: { label: 'Default', tone: 'info' },
}

export function humanize(status: string) {
  const w = status.replace(/[_-]+/g, ' ').trim().toLowerCase()
  return w.charAt(0).toUpperCase() + w.slice(1)
}
/** The reader's word for a status (the same word every badge prints). */
export const statusLabel = (status: string) => STATUS[status.toLowerCase() as KnownStatus]?.label ?? humanize(status)

export function StatusBadge({ status, label }: { status: KnownStatus | string; label?: ReactNode }) {
  const s = STATUS[status.toLowerCase() as KnownStatus]
  return (
    <Badge tone={s?.tone ?? 'neutral'} size="lg">
      {label ?? s?.label ?? humanize(status)}
    </Badge>
  )
}

export function CountBadge({ count, label, tone = 'warn' }: { count: number; label: string; tone?: 'warn' | 'danger' | 'neutral' }) {
  if (!count) return null
  return (
    <span className={`count-badge nav-badge${tone === 'warn' ? '' : ` ${tone}`}`}>
      <span aria-hidden="true">{count > 99 ? '99+' : count}</span>
      <span className="sr-only">
        {count} {label}
      </span>
    </span>
  )
}

export function Kbd({ children, keys }: { children?: ReactNode; keys?: string }) {
  if (keys)
    return (
      <span style={{ display: 'inline-flex', gap: 3 }}>
        {keys.split(' ').map((k, i) => (
          <kbd key={i} className="ui-kbd">{k}</kbd>
        ))}
      </span>
    )
  return <kbd className="ui-kbd">{children}</kbd>
}

export function Stat({
  label,
  value,
  sub,
  icon,
  tone = 'brand',
  href,
  onClick,
  loading = false,
}: {
  label: ReactNode
  value: ReactNode
  sub?: ReactNode
  icon?: IconName
  tone?: 'brand' | 'warn' | 'danger'
  href?: string
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void
  loading?: boolean
}) {
  const body = (
    <>
      <div className="ui-stat-head">
        {icon ? (
          <span className={`ui-stat-icon${tone === 'brand' ? '' : ` ${tone}`}`} aria-hidden="true">
            <Icon name={icon} />
          </span>
        ) : null}
        <span className="ui-stat-label">{label}</span>
      </div>
      {loading ? <span className="skel line title" style={{ width: '40%', height: 32 }} /> : <span className="ui-stat-value">{value}</span>}
      {sub ? <span className="ui-stat-sub">{sub}</span> : null}
      {href ? <Icon name="arrowUpRight" className="ui-stat-go" /> : null}
    </>
  )
  if (href)
    return (
      <a className="card ui-stat" href={href} onClick={onClick}>
        {body}
      </a>
    )
  return <div className="card ui-stat">{body}</div>
}

export function Tooltip({ text, children, placement = 'top' }: { text: string; children: ReactNode; placement?: 'top' | 'bottom' }) {
  return (
    <span className="ui-tip">
      {children}
      <span className={`ui-tip-bubble${placement === 'bottom' ? ' below' : ''}`} aria-hidden="true">
        {text}
      </span>
    </span>
  )
}

export function ProgressBar({ value, label, done = false }: { value: number; label: string; done?: boolean }) {
  const v = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)} data-tone={done ? 'done' : undefined}>
      <div style={{ width: `${v}%` }} />
    </div>
  )
}
