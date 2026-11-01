/**
 * The `props` of an object, edited through the building's prop schemas (museum/models/propSchemas.ts):
 * one typed control per prop of the chosen kind, then the props every object may carry. Empty means
 * "the model's default" (shown as the placeholder). Keys the schema does not list are kept as they are
 * and edited as text underneath, so nothing set elsewhere is lost on save.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { KIND_LABELS, propSchemasOf, type FieldDef } from '../../fields'
import { kindDefaults, type PropSchema, type PropValue } from '../../../museum/models/propSchemas'
import { Field, Input, Select, Switch, Textarea, humanize, type SelectOption } from '../../ui'

type Props = Record<string, unknown>

const isPrimitive = (v: unknown): v is PropValue => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean'
/** `cardTitle` → 'Card title' (schemas without a label). */
const labelOf = (key: string) => humanize(key.replace(/([a-z0-9])([A-Z])/g, '$1 $2'))
const show = (v: PropValue | undefined) => (v === undefined || v === '' ? undefined : String(v))

export function PropsEditor({
  id,
  def,
  value,
  kind,
  onChange,
  onBlur,
  renderMedia,
}: {
  id: string
  def: FieldDef
  value: unknown
  kind: unknown
  onChange: (v: unknown) => void
  onBlur: () => void
  /** Draws a media field (the item editor's media picker) for a `media` prop. */
  renderMedia: (def: FieldDef, value: unknown, onChange: (v: unknown) => void) => ReactNode
}) {
  const props: Props = value && typeof value === 'object' && !Array.isArray(value) ? (value as Props) : {}
  const schemas = propSchemasOf(kind)
  const defaults = typeof kind === 'string' ? kindDefaults(kind) : {}
  const known = new Set(schemas.map((p) => p.key))
  const extras: Props = Object.fromEntries(Object.entries(props).filter(([k]) => !known.has(k)))
  const extrasJson = Object.keys(extras).length ? JSON.stringify(extras, null, 2) : ''

  /** Writes one key (undefined removes it); no keys left removes `props`. */
  const set = (key: string, v: unknown) => {
    const next = { ...props }
    if (v === undefined) delete next[key]
    else next[key] = v
    onChange(Object.keys(next).length ? next : undefined)
  }

  const [text, setText] = useState(extrasJson)
  const [textError, setTextError] = useState('')
  const textRef = useRef(text)
  useEffect(() => {
    textRef.current = text
  })
  // follow edits made elsewhere (the Advanced text, a revert) unless the text here already says the same
  useEffect(() => {
    let same = false
    try {
      const cur = textRef.current
      same = JSON.stringify(cur.trim() ? JSON.parse(cur) : {}) === JSON.stringify(extrasJson ? JSON.parse(extrasJson) : {})
    } catch {
      /* the text here is mid-edit and invalid: replace it */
    }
    if (same) return
    setText(extrasJson)
    setTextError('')
  }, [extrasJson])

  function onText(t: string) {
    setText(t)
    let parsed: unknown
    try {
      parsed = t.trim() ? JSON.parse(t) : {}
    } catch {
      return setTextError('This text can’t be read — check for a missing comma, quote or bracket.')
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return setTextError('Write the settings inside { }.')
    const entries = Object.entries(parsed as Props)
    const bad = entries.find(([, v]) => !isPrimitive(v))
    if (bad) return setTextError(`“${bad[0]}” must be text, a number, or true / false.`)
    const listed = entries.find(([k]) => known.has(k))
    if (listed) return setTextError(`“${listed[0]}” has its own field above.`)
    setTextError('')
    const kept = Object.fromEntries(Object.entries(props).filter(([k]) => known.has(k)))
    const next = { ...kept, ...Object.fromEntries(entries) }
    onChange(Object.keys(next).length ? next : undefined)
  }

  const kindLabel = typeof kind === 'string' ? (KIND_LABELS[kind] ?? kind) : ''
  return (
    <div className="span-all props-editor" id={id} tabIndex={-1}>
      <div className="props-head">
        <h4>
          {def.label}
          {kindLabel ? <span className="muted"> · {kindLabel}</span> : null}
        </h4>
        {def.hint ? <span className="field-hint">{def.hint}</span> : null}
      </div>
      {schemas.length ? (
        <div className="grid-2">
          {schemas.map((p) => (
            <PropControl key={p.key} id={`${id}-${p.key.replace(/[^A-Za-z0-9_-]/g, '-')}`} schema={p} value={props[p.key]} fallback={defaults[p.key]} onChange={(v) => set(p.key, v)} onBlur={onBlur} renderMedia={renderMedia} />
          ))}
        </div>
      ) : (
        <p className="field-hint">{kindLabel ? 'This built-in model has no settings of its own.' : 'Choose a built-in model to see its settings.'}</p>
      )}
      <details className="props-other" open={!!textError || Object.keys(extras).length > 0}>
        <summary>Other settings as text{Object.keys(extras).length ? ` (${Object.keys(extras).length})` : ''}</summary>
        <Field id={`${id}-other`} label="Other settings" hint='Settings without a field above, e.g. { "key": 1 }. Kept as they are when you save.' error={textError || undefined}>
          <Textarea className={`json-editor small ${textError ? 'invalid' : ''}`} spellCheck={false} rows={Math.max(3, text.split('\n').length + 1)} value={text} onChange={(e) => onText(e.target.value)} onBlur={onBlur} />
        </Field>
      </details>
    </div>
  )
}

function PropControl({
  id,
  schema: p,
  value,
  fallback,
  onChange,
  onBlur,
  renderMedia,
}: {
  id: string
  schema: PropSchema
  value: unknown
  /** The kind's default for this prop (kindDefaults), shown as the placeholder. */
  fallback: PropValue | undefined
  onChange: (v: unknown) => void
  onBlur: () => void
  renderMedia: (def: FieldDef, value: unknown, onChange: (v: unknown) => void) => ReactNode
}) {
  const label = p.label ?? labelOf(p.key)
  const dflt = show(fallback)
  const str = typeof value === 'string' ? value : value === undefined ? '' : String(value)
  const text = (v: string) => onChange(v === '' ? undefined : v)

  switch (p.type) {
    case 'number': {
      const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value)) ? Number(value) : null
      const range = p.min !== undefined && p.max !== undefined ? `${p.min} to ${p.max}` : p.min !== undefined ? `${p.min} or more` : p.max !== undefined ? `up to ${p.max}` : ''
      const out = n !== null && ((p.min !== undefined && n < p.min) || (p.max !== undefined && n > p.max))
      const hint: ReactNode = out ? <span className="fld-warn">Outside {range}.</span> : [range, dflt !== undefined ? `Default ${dflt}` : ''].filter(Boolean).join(' · ') || undefined
      return (
        <Field id={id} label={label} hint={hint}>
          <Input
            type="number"
            inputMode="decimal"
            min={p.min}
            max={p.max}
            step={p.step ?? 'any'}
            placeholder={dflt}
            value={n ?? (typeof value === 'string' ? value : '')}
            onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
            onBlur={onBlur}
          />
        </Field>
      )
    }
    case 'bool': {
      const on = value === undefined ? p.default === true : value === true || value === 'true'
      return (
        <div className="span-all">
          <Switch
            id={id}
            checked={on}
            label={label}
            description={value === undefined ? 'Default' : undefined}
            onChange={(next) => {
              // back at the default: leave it to the model
              onChange(next === (p.default === true) ? undefined : next)
              onBlur()
            }}
          />
        </div>
      )
    }
    case 'text':
      return p.multiline ? (
        <Field id={id} label={label} hint={p.help} className="span-all">
          <Textarea rows={3} placeholder={dflt} value={str} onChange={(e) => text(e.target.value)} onBlur={onBlur} />
        </Field>
      ) : (
        <Field id={id} label={label} hint={p.help}>
          <Input placeholder={dflt} value={str} onChange={(e) => text(e.target.value)} onBlur={onBlur} />
        </Field>
      )
    case 'color': {
      const valid = /^#[0-9a-f]{6}$/i.test(str)
      return (
        <Field id={id} label={label} hint={str && !valid ? <span className="fld-warn">Use a colour like #2c3f6b.</span> : dflt !== undefined ? `Default ${dflt}` : undefined}>
          {(w) => (
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input type="color" className="fld-color" value={valid ? str : /^#[0-9a-f]{6}$/i.test(dflt ?? '') ? dflt : '#000000'} onChange={(e) => onChange(e.target.value)} aria-label={`${label}: picker`} />
              <Input {...w} className="mono" value={str} placeholder={dflt ?? '#2c3f6b'} onChange={(e) => text(e.target.value)} onBlur={onBlur} />
            </div>
          )}
        </Field>
      )
    }
    case 'select': {
      const options: SelectOption[] = [...(str && !p.options.includes(str) ? [{ value: str, label: str }] : []), ...p.options.map((o) => ({ value: o, label: humanize(o), description: o }))]
      return (
        <Field id={id} group label={label}>
          {(w) => (
            <Select
              {...w}
              aria-labelledby={`${id}-label`}
              value={str}
              options={options}
              placeholder={dflt !== undefined ? `Default (${humanize(dflt)})` : 'Default'}
              clearable
              onChange={(s) => {
                text(s)
                onBlur()
              }}
            />
          )}
        </Field>
      )
    }
    case 'media':
      return renderMedia({ path: `props.${p.key}`, label, type: 'media', group: 'Display', accept: p.accept, hint: dflt !== undefined ? `Default ${dflt}` : undefined }, value, onChange)
  }
}
