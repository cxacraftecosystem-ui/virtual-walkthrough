/**
 * Combobox: type to search, pick one value — for referencing records by id (an artwork for an
 * exhibit, a maker for an item). ARIA 1.2 combobox: `input role="combobox"` + `aria-autocomplete=list`
 * + portalled listbox, highlight via aria-activedescendant.
 * - `options` filters locally; `loadOptions(query, signal)` fetches (debounced 150ms; a late answer
 *   is ignored). Both may be given: static options are shown until the fetch returns.
 * - ↑/↓ open and move, Enter picks, Escape closes (or clears the typing), Tab closes.
 * - `allowFreeText`: Enter with no highlight commits what was typed (ids that do not exist yet).
 * - `valueLabel` is what the input shows for the current value when it is not in `options`.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './icons'
import { textOf, useEscape, usePopover } from './popover'

export interface ComboOption {
  value: string
  label: string
  description?: ReactNode
  /** Small image (thumbnail URL) shown before the label. */
  thumb?: string
}

const MAX_SHOWN = 100

export function Combobox({
  value,
  onChange,
  options,
  loadOptions,
  valueLabel,
  placeholder = 'Search…',
  allowFreeText = false,
  disabled,
  id: idProp,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
  'aria-describedby': ariaDescribedby,
  'aria-invalid': ariaInvalid,
  required,
}: {
  value: string
  onChange: (value: string, option: ComboOption | null) => void
  options?: ComboOption[]
  loadOptions?: (query: string, signal: AbortSignal) => Promise<ComboOption[]>
  valueLabel?: string
  placeholder?: string
  allowFreeText?: boolean
  disabled?: boolean
  id?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
  required?: boolean
}) {
  const auto = useId()
  const id = idProp ?? `cb${auto}`
  const listId = `${id}-list`
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [text, setText] = useState<string | null>(null) // null = not editing → show the value's label
  const [active, setActive] = useState(-1)
  const [remote, setRemote] = useState<ComboOption[] | null>(null)
  const [loading, setLoading] = useState(false)
  const pop = usePopover(inputRef, { wantHeight: 320 })

  const known = useMemo(() => [...(remote ?? []), ...(options ?? [])], [remote, options])
  const current = known.find((o) => o.value === value)
  const shownText = text ?? (value ? current?.label ?? valueLabel ?? value : '')

  const query = (text ?? '').trim().toLowerCase()
  const matches = useMemo(() => {
    const pool = remote ?? options ?? []
    const seen = new Set<string>()
    const out: ComboOption[] = []
    for (const o of pool) {
      if (seen.has(o.value)) continue
      seen.add(o.value)
      if (!query || (o.label + ' ' + o.value + ' ' + textOf(o.description)).toLowerCase().includes(query)) out.push(o)
    }
    return out
  }, [remote, options, query])
  const shown = matches.slice(0, MAX_SHOWN)

  // async search: debounced, abortable, late answers ignored
  useEffect(() => {
    if (!loadOptions || !pop.open) return
    const ctl = new AbortController()
    const t = setTimeout(() => {
      setLoading(true)
      loadOptions(text ?? '', ctl.signal)
        .then((r) => {
          if (!ctl.signal.aborted) setRemote(r)
        })
        .catch(() => undefined)
        .finally(() => {
          if (!ctl.signal.aborted) setLoading(false)
        })
    }, 150)
    return () => {
      clearTimeout(t)
      ctl.abort()
    }
  }, [loadOptions, text, pop.open])

  useEffect(() => {
    if (!pop.open || active < 0) return
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, pop.open])

  const close = () => {
    pop.hide()
    setText(null)
    setActive(-1)
  }
  useEscape(pop.open, close)

  const pick = (o: ComboOption) => {
    onChange(o.value, o)
    close()
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        if (!pop.open) pop.show()
        setActive((a) => (shown.length ? (a + 1) % shown.length : -1))
        break
      case 'ArrowUp':
        e.preventDefault()
        if (!pop.open) pop.show()
        setActive((a) => (shown.length ? (a <= 0 ? shown.length - 1 : a - 1) : -1))
        break
      case 'Enter':
        if (!pop.open) return
        e.preventDefault()
        if (active >= 0 && shown[active]) pick(shown[active])
        else if (allowFreeText && text !== null) {
          onChange(text.trim(), null)
          close()
        }
        break
      case 'Escape':
        if (!pop.open && text !== null) {
          e.preventDefault()
          setText(null)
        }
        break
      case 'Tab':
        if (pop.open) {
          if (allowFreeText && text !== null && text.trim() !== value) onChange(text.trim(), null)
          close()
        }
        break
    }
  }

  const activeId = pop.open && active >= 0 && shown[active] ? `${id}-opt-${active}` : undefined

  return (
    <div className="ui-select">
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={pop.open}
        aria-controls={pop.open ? listId : undefined}
        aria-activedescendant={activeId}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        aria-describedby={ariaDescribedby}
        aria-invalid={ariaInvalid || undefined}
        aria-required={required || undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        disabled={disabled}
        value={shownText}
        style={{ paddingRight: 64 }}
        onChange={(e) => {
          setText(e.target.value)
          setActive(e.target.value ? 0 : -1)
          if (!pop.open) pop.show()
        }}
        onFocus={(e) => e.currentTarget.select()}
        onClick={() => !pop.open && pop.show()}
        onKeyDown={onKey}
        onBlur={(e) => {
          if (pop.panelRef.current?.contains(e.relatedTarget as Node)) return
          if (allowFreeText && text !== null && text.trim() !== value) onChange(text.trim(), null)
          close()
        }}
      />
      <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', gap: 2 }}>
        {loading ? <span className="spinner" aria-hidden="true" style={{ width: 14, height: 14 }} /> : null}
        {value && !disabled ? (
          <button
            type="button"
            className="icon-btn sm"
            aria-label="Clear"
            title="Clear"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onChange('', null)
              setText(null)
              inputRef.current?.focus()
            }}
          >
            <Icon name="close" />
          </button>
        ) : (
          <Icon name="chevronDown" className="chev" style={{ width: 16, height: 16, color: 'rgb(var(--ink-500))' }} />
        )}
      </span>
      {pop.open && pop.anchor
        ? createPortal(
            <div ref={pop.panelRef} className={`ui-popover${pop.anchor.up ? ' up' : ''}`} style={{ ...pop.anchor.style, display: 'flex', flexDirection: 'column' }}>
              <ul ref={listRef} id={listId} role="listbox" className="ui-listbox" aria-label={ariaLabel ?? 'Suggestions'}>
                {shown.length === 0 ? (
                  <li className="ui-list-empty" role="presentation">
                    {loading ? 'Searching…' : allowFreeText && query ? `No matches — press Enter to use “${text?.trim()}”` : 'No matches'}
                  </li>
                ) : (
                  shown.map((o, i) => (
                    <li
                      key={o.value}
                      id={`${id}-opt-${i}`}
                      data-index={i}
                      role="option"
                      className="ui-option"
                      aria-selected={o.value === value}
                      data-active={i === active || undefined}
                      onMouseMove={() => active !== i && setActive(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(o)}
                    >
                      {o.thumb ? <img src={o.thumb} alt="" width={28} height={28} style={{ borderRadius: 6, objectFit: 'cover', flex: 'none' }} /> : null}
                      <span className="opt-text">
                        <span className="opt-label">{o.label}</span>
                        <span className="opt-desc">{o.description ?? o.value}</span>
                      </span>
                      <Icon name="check" className="check-mark" />
                    </li>
                  ))
                )}
              </ul>
              {matches.length > MAX_SHOWN ? <div className="ui-list-note">Showing {MAX_SHOWN} of {matches.length} — type to narrow.</div> : null}
              <div className="sr-only" role="status">{pop.open && !loading ? `${matches.length} ${matches.length === 1 ? 'suggestion' : 'suggestions'}` : ''}</div>
            </div>,
            pop.anchor.container,
          )
        : null}
    </div>
  )
}
