/**
 * Tabs: a row of filter chips (`variant="chips"`, default) or an underlined strip
 * (`variant="underline"`) that switch a view. WAI-ARIA tabs with roving focus: one tab is in the tab
 * order, ←/→ (and Home/End) move between tabs and select them. Each tab may show a `count`.
 * Pass `panelId` when the controlled content has that id (adds aria-controls).
 */
import { useRef, type KeyboardEvent, type ReactNode } from 'react'

export interface TabItem<T extends string = string> {
  id: T
  label: ReactNode
  count?: number | null
  /** Screen-reader words for the count, e.g. "waiting for a decision". */
  countLabel?: string
}

export function Tabs<T extends string = string>({
  tabs,
  value,
  onChange,
  label,
  variant = 'chips',
  panelId,
  className,
}: {
  tabs: TabItem<T>[]
  value: T
  onChange: (id: T) => void
  /** Names the tab list, e.g. "Collections". */
  label: string
  variant?: 'chips' | 'underline'
  panelId?: string
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    let next = -1
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    if (next < 0) return
    e.preventDefault()
    onChange(tabs[next].id)
    ref.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }
  return (
    <div ref={ref} role="tablist" aria-label={label} className={['ui-tabs', variant === 'underline' && 'underline', className].filter(Boolean).join(' ')}>
      {tabs.map((t, i) => {
        const selected = t.id === value
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            className="ui-tab"
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t.label}
            {t.count !== undefined && t.count !== null ? (
              <span className="count">
                {t.count.toLocaleString()}
                {t.countLabel ? <span className="sr-only"> {t.countLabel}</span> : null}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
