/**
 * Select: the design system's SearchableSelect (no native <select>).
 * - Trigger `button role="combobox"` + portalled `role="listbox"`; the highlight is announced through
 *   aria-activedescendant, focus stays on the trigger (or on the search box once there are 8+ options).
 * - Keys: ↑/↓, Home/End, Enter/Space to pick, Escape closes (only this popover), Tab closes;
 *   typing jumps to an option (700ms window) — when closed it changes the value directly.
 * - `clearable` adds a separate sibling clear button (never inside the trigger).
 * - Wire it with `<Field group>` (pass the Field's id/aria props through), never inside a <label>.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './icons'
import { textOf, useEscape, usePopover } from './popover'

export interface SelectOption<T extends string = string> {
  value: T
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
}

export function Select<T extends string = string>({
  value,
  onChange,
  options,
  placeholder = 'Choose…',
  id: idProp,
  disabled,
  size = 'md',
  clearable = false,
  searchable,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
  'aria-describedby': ariaDescribedby,
  'aria-invalid': ariaInvalid,
  required,
}: {
  value: T | '' | null
  onChange: (v: T) => void
  options: SelectOption<T>[]
  placeholder?: string
  id?: string
  disabled?: boolean
  size?: 'sm' | 'md'
  /** Shows a clear button; `onChange('')` is called with an empty value. */
  clearable?: boolean
  /** Force the search row on/off (default: on at 8+ options). */
  searchable?: boolean
  className?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
  required?: boolean
}) {
  const auto = useId()
  const id = idProp ?? `sel${auto}`
  const listId = `${id}-list`
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(-1)
  const typeahead = useRef({ buf: '', at: 0 })
  const pop = usePopover(triggerRef, { wantHeight: 340, onClose: () => setQuery('') })
  const withSearch = searchable ?? options.length >= 8

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => (textOf(o.label) + ' ' + textOf(o.description) + ' ' + o.value).toLowerCase().includes(q))
  }, [options, query])

  const selected = options.find((o) => o.value === value)

  const openList = () => {
    if (disabled) return
    const i = options.findIndex((o) => o.value === value)
    setActive(i >= 0 ? i : options.findIndex((o) => !o.disabled))
    pop.show()
  }
  const close = (refocus = true) => {
    pop.hide()
    if (refocus) triggerRef.current?.focus()
  }
  const pick = (o: SelectOption<T> | undefined) => {
    if (!o || o.disabled) return
    onChange(o.value)
    close()
  }
  useEscape(pop.open, () => close())

  // focus the search box after opening; keep the highlighted option in view
  useEffect(() => {
    if (pop.open && withSearch) requestAnimationFrame(() => searchRef.current?.focus())
  }, [pop.open, withSearch])
  useEffect(() => {
    if (!pop.open || active < 0) return
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, pop.open])

  const move = (from: number, dir: 1 | -1, list = filtered) => {
    if (!list.length) return -1
    let i = from
    for (let n = 0; n < list.length; n++) {
      i = (i + dir + list.length) % list.length
      if (!list[i].disabled) return i
    }
    return from
  }

  const onTypeahead = (key: string) => {
    const now = Date.now()
    const t = typeahead.current
    t.buf = now - t.at < 700 ? t.buf + key.toLowerCase() : key.toLowerCase()
    t.at = now
    const i = options.findIndex((o) => !o.disabled && textOf(o.label).toLowerCase().startsWith(t.buf))
    if (i < 0) return
    if (pop.open) setActive(i)
    else onChange(options[i].value)
  }

  const onKey = (e: KeyboardEvent) => {
    if (!pop.open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        openList()
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) onTypeahead(e.key)
      return
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActive((a) => move(a, 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActive((a) => move(a < 0 ? 0 : a, -1))
        break
      case 'Home':
        e.preventDefault()
        setActive(move(-1, 1))
        break
      case 'End':
        e.preventDefault()
        setActive(move(filtered.length, -1))
        break
      case 'Enter':
        e.preventDefault()
        pick(filtered[active])
        break
      case ' ':
        if (e.currentTarget === triggerRef.current) {
          e.preventDefault()
          pick(filtered[active])
        }
        break
      case 'Tab':
        close(false)
        break
      default:
        if (e.currentTarget === triggerRef.current && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) onTypeahead(e.key)
    }
  }

  const activeId = pop.open && active >= 0 && filtered[active] ? `${id}-opt-${active}` : undefined

  return (
    <div className={['ui-select', size === 'sm' && 'sm', className].filter(Boolean).join(' ')}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        role="combobox"
        className="ui-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={pop.open}
        aria-controls={pop.open ? listId : undefined}
        aria-activedescendant={withSearch ? undefined : activeId}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        aria-describedby={ariaDescribedby}
        aria-invalid={ariaInvalid || undefined}
        aria-required={required || undefined}
        disabled={disabled}
        onClick={() => (pop.open ? close() : openList())}
        onKeyDown={onKey}
        style={clearable && selected ? { paddingRight: 70 } : undefined}
      >
        <span className={selected ? 'value' : 'value placeholder'}>{selected ? selected.label : placeholder}</span>
        <Icon name="chevronDown" className="chev" />
      </button>
      {clearable && selected && !disabled ? (
        <button
          type="button"
          className="icon-btn sm"
          aria-label="Clear selection"
          title="Clear selection"
          style={{ position: 'absolute', right: 36, top: '50%', transform: 'translateY(-50%)' }}
          onClick={() => {
            onChange('' as T)
            triggerRef.current?.focus()
          }}
        >
          <Icon name="close" />
        </button>
      ) : null}
      {pop.open && pop.anchor
        ? createPortal(
            <div ref={pop.panelRef} className={`ui-popover${pop.anchor.up ? ' up' : ''}`} style={{ ...pop.anchor.style, display: 'flex', flexDirection: 'column' }}>
              {withSearch ? (
                <div className="ui-popover-search">
                  <input
                    ref={searchRef}
                    type="search"
                    value={query}
                    placeholder="Search"
                    aria-label="Search options"
                    aria-controls={listId}
                    aria-activedescendant={activeId}
                    autoComplete="off"
                    onChange={(e) => {
                      e.stopPropagation()
                      setQuery(e.target.value)
                      setActive(0)
                    }}
                    onInput={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      onKey(e)
                    }}
                  />
                </div>
              ) : null}
              <ul ref={listRef} id={listId} role="listbox" className="ui-listbox" aria-labelledby={ariaLabelledby} aria-label={ariaLabelledby ? undefined : ariaLabel ?? 'Options'} tabIndex={-1}>
                {filtered.length === 0 ? (
                  <li className="ui-list-empty" role="presentation">{options.length ? 'No matches' : 'No options'}</li>
                ) : (
                  filtered.map((o, i) => (
                    <li
                      key={o.value}
                      id={`${id}-opt-${i}`}
                      data-index={i}
                      role="option"
                      className="ui-option"
                      aria-selected={o.value === value}
                      aria-disabled={o.disabled || undefined}
                      data-active={i === active || undefined}
                      onMouseMove={() => active !== i && setActive(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(o)}
                    >
                      <span className="opt-text">
                        <span className="opt-label">{o.label}</span>
                        {o.description ? <span className="opt-desc">{o.description}</span> : null}
                      </span>
                      <Icon name="check" className="check-mark" />
                    </li>
                  ))
                )}
              </ul>
              {withSearch && query ? <div className="sr-only" role="status">{filtered.length} {filtered.length === 1 ? 'option' : 'options'}</div> : null}
            </div>,
            pop.anchor.container,
          )
        : null}
    </div>
  )
}
