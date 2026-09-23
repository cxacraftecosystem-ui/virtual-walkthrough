/**
 * Shared admin primitives: toasts, promise-based confirm dialog, modal, page header, empty
 * states, skeletons and the unsaved-changes guard. `ToastProvider` hosts both the toasts and
 * the confirm dialog, so every page under it can call `useToast()` / `useConfirm()`.
 */
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'

/* ------------------------------------------------------------------ */
/* Toasts + confirm                                                    */
/* ------------------------------------------------------------------ */

type ToastKind = 'ok' | 'error' | 'info'
type Toast = { id: number; text: string; kind: ToastKind }
const ToastCtx = createContext<(text: string, kind?: ToastKind) => void>(() => undefined)

export interface ConfirmOptions {
  title: string
  body?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Destructive action: red confirm button. */
  danger?: boolean
}
type ConfirmFn = (o: ConfirmOptions | string) => Promise<boolean>
const ConfirmCtx = createContext<ConfirmFn>(async (o) => window.confirm(typeof o === 'string' ? o : o.title))

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])
  const push = useCallback(
    (text: string, kind: ToastKind = 'ok') => {
      const id = Date.now() + Math.random()
      setToasts((t) => [...t.slice(-3), { id, text, kind }])
      setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 3200)
    },
    [dismiss],
  )

  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null)
  const confirm = useCallback<ConfirmFn>(
    (o) =>
      new Promise<boolean>((resolve) => {
        setPending((prev) => {
          prev?.resolve(false)
          return { ...(typeof o === 'string' ? { title: o } : o), resolve }
        })
      }),
    [],
  )
  const close = (v: boolean) => {
    pending?.resolve(v)
    setPending(null)
  }

  return (
    <ToastCtx.Provider value={push}>
      <ConfirmCtx.Provider value={confirm}>
        {children}
        {pending && (
          <Modal
            title={pending.title}
            onClose={() => close(false)}
            size="small"
            role="alertdialog"
            footer={
              <>
                <button className="btn ghost" onClick={() => close(false)}>{pending.cancelLabel ?? 'Cancel'}</button>
                <button className={pending.danger ? 'btn danger-solid' : 'btn primary'} onClick={() => close(true)} data-autofocus>
                  {pending.confirmLabel ?? (pending.danger ? 'Delete' : 'Confirm')}
                </button>
              </>
            }
          >
            {pending.body && <div className="confirm-body">{pending.body}</div>}
          </Modal>
        )}
        <div className="toasts" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : undefined}>
              <span className="toast-icon" aria-hidden="true">{t.kind === 'error' ? '!' : t.kind === 'info' ? 'i' : '✓'}</span>
              <span className="toast-text">{t.text}</span>
              <button className="toast-x" onClick={() => dismiss(t.id)} aria-label="Dismiss notification">×</button>
            </div>
          ))}
        </div>
      </ConfirmCtx.Provider>
    </ToastCtx.Provider>
  )
}

export const useToast = () => useContext(ToastCtx)
/** `if (!(await confirm({ title, body, danger: true }))) return` — styled replacement for window.confirm. */
export const useConfirm = () => useContext(ConfirmCtx)

/* ------------------------------------------------------------------ */
/* Modal (native <dialog>: focus trap, Esc, inert background)           */
/* ------------------------------------------------------------------ */

export function Modal({
  title,
  children,
  footer,
  onClose,
  size = 'medium',
  role,
}: {
  title: ReactNode
  children?: ReactNode
  footer?: ReactNode
  onClose: () => void
  size?: 'small' | 'medium' | 'large'
  role?: 'dialog' | 'alertdialog'
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (!d.open) d.showModal()
    d.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    const onCancel = (e: Event) => {
      e.preventDefault()
      onCloseRef.current()
    }
    d.addEventListener('cancel', onCancel)
    return () => {
      d.removeEventListener('cancel', onCancel)
      if (d.open) d.close()
    }
  }, [])
  return (
    <dialog
      ref={ref}
      className={`adm-dialog ${size}`}
      aria-labelledby={titleId}
      role={role}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCloseRef.current() // backdrop click
      }}
    >
      <div className="dlg-head">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
      </div>
      {children !== undefined && children !== null && children !== false && <div className="dlg-body">{children}</div>}
      {footer && <div className="dlg-foot">{footer}</div>}
    </dialog>
  )
}

/* ------------------------------------------------------------------ */
/* Layout primitives                                                   */
/* ------------------------------------------------------------------ */

/** Page title + description + primary actions (right-aligned, wraps under on phones). */
export function PageHeader({ title, description, actions, kicker }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; kicker?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="page-head-text">
        {kicker && <span className="kicker">{kicker}</span>}
        <h1>{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  )
}

export function EmptyState({ title, children, action, icon = '◇' }: { title: ReactNode; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-icon" aria-hidden="true">{icon}</span>
      <strong>{title}</strong>
      {children && <p className="muted">{children}</p>}
      {action && <div className="row" style={{ justifyContent: 'center' }}>{action}</div>}
    </div>
  )
}

/** Shimmering placeholder rows while data loads (respects reduced motion via CSS). */
export function Skeleton({ rows = 4, kind = 'lines' }: { rows?: number; kind?: 'lines' | 'cards' | 'list' | 'form' }) {
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
