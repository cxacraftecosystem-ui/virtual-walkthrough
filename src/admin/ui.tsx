/**
 * Shared admin primitives — the one import for pages: `import { … } from '../ui'`.
 *
 * Defined here (providers and page furniture):
 * - `ToastProvider` hosts the toasts and the confirm dialog, so every page under it can call
 *   `useToast()` / `useConfirm()`. Mount it once.
 * - `useToast()` → `toast(text, kind?, { title?, action?: { label, onClick }, duration? })`. Kinds
 *   ok | info | error. 5 s by default (8 s with an action, 7 s for errors, 0 = until dismissed); at
 *   most 3 at once; the countdown pauses on hover and focus. The action button is for Undo — never
 *   put something the user must act on in a toast.
 * - `useConfirm()` → `await confirm({ title, body, confirmLabel, danger, typeToConfirm })`, resolves
 *   true/false (false if superseded). Danger confirms are alertdialogs with focus on Cancel; with
 *   `typeToConfirm: 'delete'` the confirm button stays disabled until that word is typed.
 * - `useConfirmLeave()` → `await leave()` asks before discarding unsaved edits (true = go ahead).
 * - `Modal`, `PageHeader`, `EmptyState`, `Skeleton`, `Spinner`, the unsaved-changes guard and the
 *   formatters (errMsg, formatBytes, formatDate, formatRelative, formatDuration).
 *
 * Re-exported from ./ui/* (each file documents its component): Button, IconButton, ButtonRow,
 * RowAction(s), Field, Input, Textarea, Checkbox, Switch, Segmented, Select, Combobox, SearchInput,
 * Tabs, DataTable, Pagination, CursorPager, Drawer, DialogShell, Menu, Badge, StatusBadge,
 * CountBadge, Kbd, Stat, Tooltip, ProgressBar, Icon.
 */
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { DialogShell, type DialogTone } from './ui/Dialog'
import { ICONS as ICON_SET, Icon, type IconName } from './ui/icons'

export { Button, IconButton, ButtonRow, RowAction, RowActions, buttonClass, rowActionClass } from './ui/Button'
export type { ButtonVariant, ButtonSize, RowActionTone } from './ui/Button'
export { Field, Input, Textarea, Checkbox, Switch, Segmented } from './ui/Field'
export type { FieldWiring } from './ui/Field'
export { Select } from './ui/Select'
export type { SelectOption } from './ui/Select'
export { Combobox } from './ui/Combobox'
export type { ComboOption } from './ui/Combobox'
export { SearchInput } from './ui/SearchInput'
export { Tabs } from './ui/Tabs'
export type { TabItem } from './ui/Tabs'
export { DataTable } from './ui/DataTable'
export type { Column, SortState } from './ui/DataTable'
export { Pagination, CursorPager, pageSlice } from './ui/Pagination'
export { DialogShell, Drawer } from './ui/Dialog'
export type { DialogTone, DialogShellProps } from './ui/Dialog'
export { Menu } from './ui/Menu'
export type { MenuItem } from './ui/Menu'
export { Badge, StatusBadge, CountBadge, Kbd, Stat, Tooltip, ProgressBar, statusLabel, humanize } from './ui/display'
export type { BadgeTone, KnownStatus } from './ui/display'
export { Icon, ICONS } from './ui/icons'
export type { IconName } from './ui/icons'

/* ------------------------------------------------------------------ */
/* Toasts + confirm                                                    */
/* ------------------------------------------------------------------ */

type ToastKind = 'ok' | 'error' | 'info'
export interface ToastOptions {
  /** Bold first line; the text becomes the description. */
  title?: string
  /** One optional action, e.g. `{ label: 'Undo', onClick: restore }`. */
  action?: { label: string; onClick: () => void }
  /** Milliseconds; 0 keeps it until dismissed. */
  duration?: number
}
type Toast = { id: number; text: string; kind: ToastKind } & ToastOptions
export type ToastFn = (text: string, kind?: ToastKind, opts?: ToastOptions) => number
const ToastCtx = createContext<ToastFn>(() => 0)

export interface ConfirmOptions {
  title: string
  body?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Destructive action: red confirm button, alertdialog, focus starts on Cancel. */
  danger?: boolean
  /** Warning tone (amber) for consequential but recoverable actions. */
  tone?: DialogTone
  /** The confirm button stays disabled until this exact word is typed (irreversible bulk ops). */
  typeToConfirm?: string
}
type ConfirmFn = (o: ConfirmOptions | string) => Promise<boolean>
const ConfirmCtx = createContext<ConfirmFn>(async (o) => window.confirm(typeof o === 'string' ? o : o.title))

const MAX_TOASTS = 3

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])
  const push = useCallback<ToastFn>((text, kind = 'ok', opts = {}) => {
    const id = ++seq.current
    setToasts((t) => [...t, { id, text, kind, ...opts }].slice(-MAX_TOASTS))
    return id
  }, [])

  const [pending, setPending] = useState<{ opts: ConfirmOptions; resolve: (v: boolean) => void; n: number } | null>(null)
  const confirm = useCallback<ConfirmFn>(
    (o) =>
      new Promise<boolean>((resolve) => {
        setPending((prev) => {
          prev?.resolve(false)
          return { opts: typeof o === 'string' ? { title: o } : o, resolve, n: ++seq.current }
        })
      }),
    [],
  )
  // an unmounting provider resolves an open confirm as "no"
  const pendingRef = useRef(pending)
  useEffect(() => {
    pendingRef.current = pending
  })
  useEffect(() => () => pendingRef.current?.resolve(false), [])

  const close = (v: boolean) => {
    pending?.resolve(v)
    setPending(null)
  }

  return (
    <ToastCtx.Provider value={push}>
      <ConfirmCtx.Provider value={confirm}>
        {children}
        {pending && <ConfirmDialog {...pending.opts} key={pending.n} onAnswer={close} />}
        <div className="toasts" role="status" aria-live="polite" aria-atomic="false">
          {toasts.map((t) => (
            <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
          ))}
        </div>
      </ConfirmCtx.Provider>
    </ToastCtx.Provider>
  )
}

const TOAST_ICON: Record<ToastKind, IconName> = { ok: 'check', info: 'info', error: 'alert' }

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const total = toast.duration ?? (toast.kind === 'error' ? 7000 : toast.action ? 8000 : 5000)
  const remaining = useRef(total)
  const [paused, setPaused] = useState(false)
  const dismissRef = useRef(onDismiss)
  useEffect(() => {
    dismissRef.current = onDismiss
  })
  useEffect(() => {
    if (paused || total === 0) return
    const started = Date.now()
    const t = setTimeout(() => dismissRef.current(), remaining.current)
    return () => {
      clearTimeout(t)
      remaining.current = Math.max(800, remaining.current - (Date.now() - started)) // banked, not reset
    }
  }, [paused, total])
  const label = toast.title ?? toast.text
  return (
    <div
      className={`toast ${toast.kind}`}
      role={toast.kind === 'error' ? 'alert' : undefined}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setPaused(false)}
    >
      <span className="toast-icon" aria-hidden="true">
        <Icon name={TOAST_ICON[toast.kind]} />
      </span>
      <div className="toast-body">
        {toast.title ? <span className="toast-title">{toast.title}</span> : null}
        <span className="toast-text">{toast.text}</span>
        {toast.action ? (
          <div className="toast-actions">
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                toast.action?.onClick()
                onDismiss()
              }}
            >
              {toast.action.label}
            </button>
          </div>
        ) : null}
      </div>
      <button type="button" className="toast-x" onClick={onDismiss} aria-label={`Dismiss: ${label}`} title="Dismiss">
        <Icon name="close" />
      </button>
    </div>
  )
}

export const useToast = () => useContext(ToastCtx)
/** `if (!(await confirm({ title, body, danger: true }))) return` — styled replacement for window.confirm. */
export const useConfirm = () => useContext(ConfirmCtx)

/**
 * ConfirmDialog: the confirm used by `useConfirm()`, also usable directly. Danger tone: alertdialog,
 * focus on Cancel, the backdrop does not dismiss, red solid confirm. `typeToConfirm` adds a field
 * that must match before the confirm button enables.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger,
  tone,
  typeToConfirm,
  onAnswer,
}: ConfirmOptions & { onAnswer: (ok: boolean) => void }) {
  const [typed, setTyped] = useState('')
  const inputId = useId()
  const t: DialogTone = tone ?? (danger ? 'danger' : 'neutral')
  const ready = !typeToConfirm || typed.trim().toLowerCase() === typeToConfirm.toLowerCase()
  const isDanger = t === 'danger'
  return (
    <DialogShell
      title={title}
      onClose={() => onAnswer(false)}
      size="small"
      role={isDanger ? 'alertdialog' : 'dialog'}
      tone={t}
      icon={t !== 'neutral'}
      footer={
        <>
          <button type="button" className="btn" onClick={() => onAnswer(false)} data-autofocus={isDanger && !typeToConfirm ? true : undefined}>
            {cancelLabel ?? 'Cancel'}
          </button>
          <button
            type="button"
            className={isDanger ? 'btn danger-solid' : 'btn primary'}
            disabled={!ready}
            onClick={() => ready && onAnswer(true)}
            data-autofocus={!isDanger && !typeToConfirm ? true : undefined}
          >
            {confirmLabel ?? (isDanger ? 'Delete' : 'Confirm')}
          </button>
        </>
      }
    >
      {body || typeToConfirm ? (
        <>
          {body ? <div className="confirm-body">{body}</div> : null}
          {typeToConfirm ? (
            <form
              className="field confirm-type"
              onSubmit={(e) => {
                e.preventDefault()
                if (ready) onAnswer(true)
              }}
            >
              <label htmlFor={inputId} className="field-label">
                Type <strong>{typeToConfirm}</strong> to confirm
              </label>
              <input id={inputId} type="text" autoComplete="off" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} data-autofocus />
            </form>
          ) : null}
        </>
      ) : null}
    </DialogShell>
  )
}

/* ------------------------------------------------------------------ */
/* Modal                                                               */
/* ------------------------------------------------------------------ */

/**
 * Modal: a dialog with a title, body and optional footer. Same API as before the design system;
 * `description`, `tone`, `icon`, `dismissable` and `busy` are optional extras (see ui/Dialog.tsx).
 * Put `data-autofocus` on the element that should take focus first.
 */
export function Modal({
  title,
  children,
  footer,
  onClose,
  size = 'medium',
  role,
  description,
  tone,
  icon,
  dismissable,
  busy,
}: {
  title: ReactNode
  children?: ReactNode
  footer?: ReactNode
  onClose: () => void
  size?: 'small' | 'medium' | 'large'
  role?: 'dialog' | 'alertdialog'
  description?: ReactNode
  tone?: DialogTone
  icon?: boolean | IconName
  dismissable?: boolean
  busy?: boolean
}) {
  return (
    <DialogShell title={title} footer={footer} onClose={onClose} size={size} role={role} description={description} tone={tone} icon={icon} dismissable={dismissable} busy={busy}>
      {children}
    </DialogShell>
  )
}

/* ------------------------------------------------------------------ */
/* Layout primitives                                                   */
/* ------------------------------------------------------------------ */

/**
 * PageHeader: the page's single <h1>, with an optional eyebrow (`kicker` is the old name), an
 * icon chip (hidden on phones), a description and right-aligned actions. `back` adds the one round
 * back control: `{ href, label? }` or `{ onClick, label? }` — run the unsaved-changes check in onClick.
 */
export function PageHeader({
  title,
  description,
  actions,
  kicker,
  eyebrow,
  icon,
  back,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  kicker?: ReactNode
  eyebrow?: ReactNode
  icon?: IconName
  back?: { href?: string; onClick?: () => void; label?: string }
}) {
  const ey = eyebrow ?? kicker
  const backLabel = back?.label ?? 'Go back'
  return (
    <div className="page-head">
      <div className="page-head-main">
        {back ? (
          back.href ? (
            <a className="back-btn" href={back.href} aria-label={backLabel} title={backLabel} onClick={
                back.onClick
                  ? (e) => {
                      e.preventDefault()
                      back.onClick?.()
                    }
                  : undefined
              }>
              <Icon name="arrowLeft" />
            </a>
          ) : (
            <button type="button" className="back-btn" aria-label={backLabel} title={backLabel} onClick={back.onClick}>
              <Icon name="arrowLeft" />
            </button>
          )
        ) : null}
        {icon ? (
          <span className="page-head-icon" aria-hidden="true">
            <Icon name={icon} />
          </span>
        ) : null}
        <div className="page-head-text">
          {ey && <span className="kicker">{ey}</span>}
          <h1>{title}</h1>
          {description && <p>{description}</p>}
        </div>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  )
}

/**
 * EmptyState: dashed panel with an icon circle, a title and one short line. `icon` is an IconName
 * (or any node); `as` sets the title's element (default h2) so the outline stays right.
 */
export function EmptyState({
  title,
  children,
  action,
  icon = 'archive',
  as: As = 'h2',
}: {
  title: ReactNode
  children?: ReactNode
  action?: ReactNode
  icon?: IconName | ReactNode
  as?: 'h2' | 'h3' | 'h4' | 'p'
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon" aria-hidden="true">
        {typeof icon === 'string' ? icon in ICON_SET ? <Icon name={icon as IconName} /> : icon === '!' ? <Icon name="alert" /> : icon : icon}
      </span>
      <As className="empty-title">{title}</As>
      {children && <p>{children}</p>}
      {action && <div className="row">{action}</div>}
    </div>
  )
}

/**
 * Skeleton: placeholder while data loads (no shimmer under reduced motion). Kinds: lines, list,
 * cards (media grid), form, table, tiles (stat tiles), page (header + panel).
 */
export function Skeleton({ rows = 4, kind = 'lines' }: { rows?: number; kind?: 'lines' | 'cards' | 'list' | 'form' | 'table' | 'tiles' | 'page' }) {
  const items = Array.from({ length: rows }, (_, i) => i)
  if (kind === 'cards')
    return (
      <div className="media-grid" aria-busy="true" aria-label="Loading">
        {items.map((i) => (
          <div key={i} className="media-card"><div className="thumb skel" /><div className="meta"><span className="skel line" /><span className="skel line short" /></div></div>
        ))}
      </div>
    )
  if (kind === 'form')
    return (
      <div className="card" aria-busy="true" aria-label="Loading">
        <span className="skel line title" />
        <div className="grid-2" style={{ marginTop: 18 }}>
          {items.map((i) => (
            <div key={i} className="field"><span className="skel line tiny" /><span className="skel input" /></div>
          ))}
        </div>
      </div>
    )
  if (kind === 'table')
    return (
      <div className="card ui-table-panel skel-table" aria-busy="true" aria-label="Loading">
        {[-1, ...items].map((i) => (
          <div key={i} className="skel-row">
            <span className="skel line" style={{ width: 16 }} />
            <span className="skel line" style={{ width: i < 0 ? '30%' : `${60 + ((i * 17) % 35)}%` }} />
            <span className="skel line short" />
            <span className="skel line short" />
            <span className="skel line" />
          </div>
        ))}
      </div>
    )
  if (kind === 'tiles')
    return (
      <div className="skel-tiles" aria-busy="true" aria-label="Loading">
        {items.map((i) => (
          <div key={i} className="card"><span className="skel line short" /><span className="skel line title" style={{ width: '45%' }} /><span className="skel line tiny" /></div>
        ))}
      </div>
    )
  if (kind === 'page')
    return (
      <div aria-busy="true" aria-label="Loading">
        <div className="page-head"><div className="page-head-text"><span className="skel line title" style={{ width: 280, maxWidth: '70%' }} /><span className="skel line" style={{ width: 420, maxWidth: '90%', marginTop: 14 }} /></div></div>
        <div className="card"><div className="skel-lines">{items.map((i) => <span key={i} className={`skel line ${i % 3 === 2 ? 'short' : ''}`} />)}</div></div>
      </div>
    )
  return (
    <div className={kind === 'list' ? 'skel-list' : 'skel-lines'} aria-busy="true" aria-label="Loading">
      {items.map((i) => (
        <span key={i} className={`skel line ${i % 3 === 2 ? 'short' : ''}`} />
      ))}
    </div>
  )
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <span className="spinner" role="progressbar" aria-label={label} />
}

/* ------------------------------------------------------------------ */
/* Unsaved-changes guard                                               */
/* ------------------------------------------------------------------ */

const dirtyForms = new Set<string>()
/** True while any mounted form reports unsaved edits (the shell asks before navigating away). */
export const hasUnsavedChanges = () => dirtyForms.size > 0
/** Registers `dirty` with the shell's navigation guard and the browser's leave-page prompt. */
export function useUnsavedGuard(dirty: boolean) {
  const id = useId()
  useEffect(() => {
    if (!dirty) return
    dirtyForms.add(id)
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      dirtyForms.delete(id)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [dirty, id])
}

/** `if (!(await leave())) return` — asks before discarding unsaved edits; true when nothing is dirty. */
export function useConfirmLeave() {
  const confirm = useConfirm()
  return useCallback(
    async (body = 'Your unsaved changes on this page will be lost.') =>
      !hasUnsavedChanges() || (await confirm({ title: 'Leave without saving?', body, confirmLabel: 'Discard changes', cancelLabel: 'Keep editing', danger: true })),
    [confirm],
  )
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`
  return `${(n / 1073741824).toFixed(2)} GB`
}

export function formatDate(iso: string) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** "3 min ago", "yesterday", falls back to the date for older values. */
export function formatRelative(iso: string) {
  const d = new Date(iso)
  const t = d.getTime()
  if (Number.isNaN(t)) return iso
  const s = (Date.now() - t) / 1000
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  if (s < 172800) return 'yesterday'
  if (s < 604800) return `${Math.round(s / 86400)} days ago`
  return d.toLocaleDateString(undefined, { dateStyle: 'medium' })
}

export function formatDuration(sec: number) {
  if (sec < 60) return `${Math.round(sec)} s`
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  if (m < 60) return `${m} min ${s.toString().padStart(2, '0')} s`
  return `${Math.floor(m / 60)} h ${m % 60} min`
}
