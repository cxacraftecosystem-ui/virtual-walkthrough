/**
 * Form controls.
 * - `Field`: label + control + hint + error. Pass a render function to receive the wiring
 *   (`{ id, 'aria-describedby', 'aria-invalid', required }`) or a single Input/Textarea child, which
 *   is wired automatically. `group` renders a `<div role="group">` with a sibling label (use it for
 *   anything that contains a button — select, combobox — never wrap a dropdown in a <label>).
 * - `Input`, `Textarea`: the input recipe (42px, radius 12, purple focus ring); `invalid` sets
 *   aria-invalid. Number inputs have no spinners.
 * - `Checkbox`: the 16px box, for choosing rows only (never a setting); supports `indeterminate`.
 * - `Switch`: every on/off setting. Row shape with label + description, or `bare` with aria-label.
 *   Shows On only when `checked` is true — pass the confirmed value, not the optimistic one.
 * - `Segmented`: 2–4 modes (`role="group"`, `aria-pressed`).
 */
import {
  Children,
  cloneElement,
  forwardRef,
  isValidElement,
  useEffect,
  useId,
  useRef,
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react'
import { Icon, type IconName } from './icons'

export interface FieldWiring {
  id: string
  'aria-describedby'?: string
  'aria-invalid'?: true
  required?: boolean
}

export function Field({
  label,
  hint,
  error,
  required,
  group = false,
  className,
  id: idProp,
  children,
}: {
  label: ReactNode
  hint?: ReactNode
  /** Shown under the control and announced through aria-describedby. */
  error?: ReactNode
  required?: boolean
  /** Control contains buttons (select/combobox): div role=group + label htmlFor instead of a wrapping label. */
  group?: boolean
  className?: string
  id?: string
  children: ReactNode | ((wiring: FieldWiring) => ReactNode)
}) {
  const auto = useId()
  const id = idProp ?? `f${auto}`
  const hintId = hint ? `${id}-hint` : undefined
  const errId = error ? `${id}-err` : undefined
  const describedby = [errId, hintId].filter(Boolean).join(' ') || undefined
  const wiring: FieldWiring = { id, 'aria-describedby': describedby, 'aria-invalid': error ? true : undefined, required: required || undefined }
  let control: ReactNode
  if (typeof children === 'function') control = children(wiring)
  else {
    const only = Children.count(children) === 1 && isValidElement(children) ? (children as ReactElement<Record<string, unknown>>) : null
    control = only ? cloneElement(only, { ...wiring, ...only.props, id: (only.props.id as string | undefined) ?? id }) : children
  }
  const labelEl = (
    <span className="field-label" id={`${id}-label`}>
      {label}
      {required ? <span className="req" aria-hidden="true"> *</span> : null}
    </span>
  )
  const foot = (
    <>
      {error ? <span className="field-error" id={errId}>{error}</span> : null}
      {hint ? <span className="field-hint" id={hintId}>{hint}</span> : null}
    </>
  )
  const cls = ['field', error ? 'invalid' : '', className ?? ''].filter(Boolean).join(' ')
  if (group)
    return (
      <div className={cls} role="group" aria-labelledby={`${id}-label`}>
        <label htmlFor={id} className="field-label-wrap" style={{ display: 'contents' }}>{labelEl}</label>
        {control}
        {foot}
      </div>
    )
  return (
    <div className={cls}>
      <label htmlFor={id} style={{ display: 'contents' }}>{labelEl}</label>
      {control}
      {foot}
    </div>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input({ invalid, type = 'text', ...rest }, ref) {
  return <input ref={ref} type={type} aria-invalid={invalid || rest['aria-invalid'] || undefined} {...rest} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea({ invalid, rows = 4, ...rest }, ref) {
  return <textarea ref={ref} rows={rows} aria-invalid={invalid || rest['aria-invalid'] || undefined} {...rest} />
})

export function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  label,
  labelHidden = false,
  disabled,
  id,
  className,
}: {
  checked: boolean
  indeterminate?: boolean
  onChange: (checked: boolean, e: ChangeEvent<HTMLInputElement>) => void
  /** Accessible name; visually hidden with `labelHidden` (e.g. "Select row Foo"). */
  label: ReactNode
  labelHidden?: boolean
  disabled?: boolean
  id?: string
  className?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked
  }, [indeterminate, checked])
  return (
    <label className={['ui-check-label', className].filter(Boolean).join(' ')}>
      <span className="ui-check">
        <input ref={ref} id={id} type="checkbox" checked={checked} disabled={disabled} aria-checked={indeterminate && !checked ? 'mixed' : checked} onChange={(e) => onChange(e.target.checked, e)} />
        <span className="box" aria-hidden="true">
          <svg className="tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4.5 4.5L19 7" /></svg>
          <svg className="dash" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" style={{ position: 'absolute' }}><path d="M6 12h12" /></svg>
        </span>
      </span>
      <span className={labelHidden ? 'sr-only' : undefined}>{label}</span>
    </label>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  bare = false,
  busy = false,
  disabled = false,
  id: idProp,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: ReactNode
  description?: ReactNode
  /** Only the track (48×32 hit area); `label` becomes the aria-label (must be a string then). */
  bare?: boolean
  /** Waiting for the server: dims the track and refuses presses. */
  busy?: boolean
  disabled?: boolean
  id?: string
}) {
  const auto = useId()
  const id = idProp ?? `sw${auto}`
  const press = () => {
    if (!busy && !disabled) onChange(!checked)
  }
  if (bare)
    return (
      <button
        type="button"
        role="switch"
        id={id}
        className="ui-switch"
        aria-checked={checked}
        aria-busy={busy || undefined}
        aria-label={typeof label === 'string' ? label : undefined}
        disabled={disabled}
        onClick={press}
      />
    )
  return (
    <div className={`ui-switch-row${disabled ? ' disabled' : ''}`} onClick={(e) => e.target === e.currentTarget && press()}>
      <span className="ui-switch-text">
        <span className="ui-switch-label" id={`${id}-l`} onClick={press}>{label}</span>
        {description ? <span className="ui-switch-desc" id={`${id}-d`}>{description}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        id={id}
        className="ui-switch"
        aria-checked={checked}
        aria-busy={busy || undefined}
        aria-labelledby={`${id}-l`}
        aria-describedby={description ? `${id}-d` : undefined}
        disabled={disabled}
        onClick={press}
      />
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode; icon?: IconName; title?: string }[]
  /** Names the group for assistive technology. */
  label: string
  className?: string
}) {
  return (
    <div className={['ui-segmented', className].filter(Boolean).join(' ')} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} title={o.title} onClick={() => onChange(o.value)}>
          {o.icon ? <Icon name={o.icon} /> : null}
          {o.label}
        </button>
      ))}
    </div>
  )
}
