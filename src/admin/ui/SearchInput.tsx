/**
 * SearchInput: the search field — magnifier on the left, a red clear (×) button while there is a
 * query, a `/` hint while empty and unfocused. The shell's `/` shortcut focuses the first
 * `input[type=search]` in the page, which is this. Enter calls `onSubmit`; Escape clears.
 * Always give it a `label` (aria-label); the placeholder is not a label.
 */
import { forwardRef, type InputHTMLAttributes } from 'react'
import { Icon } from './icons'

export const SearchInput = forwardRef<
  HTMLInputElement,
  {
    value: string
    onChange: (v: string) => void
    onSubmit?: () => void
    label: string
    placeholder?: string
    /** Show the `/` shortcut hint (default true). */
    shortcutHint?: boolean
    className?: string
  } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onSubmit' | 'type'>
>(function SearchInput({ value, onChange, onSubmit, label, placeholder = 'Search', shortcutHint = true, className, onKeyDown, ...rest }, ref) {
  return (
    <div className={['ui-search', className].filter(Boolean).join(' ')}>
      <input
        ref={ref}
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        autoComplete="off"
        spellCheck={false}
        {...rest}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          onKeyDown?.(e)
          if (e.defaultPrevented) return
          if (e.key === 'Enter') {
            e.preventDefault()
            onSubmit?.()
          } else if (e.key === 'Escape' && value) {
            e.preventDefault()
            e.stopPropagation()
            onChange('')
          }
        }}
      />
      {value ? (
        <button type="button" className="ui-search-clear" aria-label="Clear search" title="Clear search" onClick={() => onChange('')}>
          <Icon name="close" />
        </button>
      ) : shortcutHint ? (
        <kbd className="ui-search-kbd hide-phone" aria-hidden="true">/</kbd>
      ) : null}
    </div>
  )
})
