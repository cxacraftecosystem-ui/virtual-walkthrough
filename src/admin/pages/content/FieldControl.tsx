/**
 * One generated form field of the item editor (fields.ts FieldDef → design-system control).
 * Every control's id is `fieldDomId(path)`, so "jump to field" links can focus it.
 */
import { useState, type ReactNode } from 'react'
import { MediaPicker, mediaMatches } from '../../MediaPicker'
import { SURFACE_GROUPS, getPath, surfaceRange, type FieldDef } from '../../fields'
import { safeUrl } from '../../safeUrl'
import { Button, Combobox, Field, IconButton, Input, Select, Switch, Textarea, type SelectOption } from '../../ui'
import { PropsEditor } from './PropsEditor'
import { useContentRefs } from './refs'

export const fieldDomId = (path: string) => `fld-${path.replace(/[^A-Za-z0-9_-]/g, '-')}`

const SURFACE_OPTIONS: SelectOption[] = SURFACE_GROUPS.flatMap((g) => g.surfaces.map((s) => ({ value: s.id, label: s.label, description: `${g.zone} · ${s.id}` })))

export function FieldControl({
  def,
  value,
  draft,
  error,
  warning,
  onChange,
  onBlur,
}: {
  def: FieldDef
  value: unknown
  draft: Record<string, unknown>
  error?: string
  /** Non-blocking notice (an id that names nothing yet). */
  warning?: string
  onChange: (v: unknown) => void
  /** The field was left (or picked from a list): show its error from now on. */
  onBlur: () => void
}) {
  const refs = useContentRefs()
  const [picking, setPicking] = useState(false)
  const id = fieldDomId(def.path)
  const str = (v: string) => onChange(v === '' && !def.required ? undefined : v)
  const hint: ReactNode = warning ? <span className="fld-warn">{warning}</span> : def.hint
  const num = (raw: string) => onChange(raw === '' ? undefined : Number(raw))

  switch (def.type) {
    case 'checkbox':
      return (
        <div className="span-all">
          <Switch
            id={id}
            checked={value === true}
            label={def.label}
            description={def.hint}
            onChange={(on) => {
              onChange(on ? true : def.path === 'placeholder' ? false : undefined)
              onBlur()
            }}
          />
        </div>
      )
    case 'textarea':
      return (
        <Field id={id} label={def.label} hint={hint} error={error} required={def.required} className="span-all">
          <Textarea rows={def.path.endsWith('body') ? 5 : 3} value={typeof value === 'string' ? value : ''} onChange={(e) => str(e.target.value)} onBlur={onBlur} lang={langOf(def.path)} />
        </Field>
      )
    case 'number':
      return (
        <Field id={id} label={def.label} hint={hint} error={error} required={def.required}>
          <Input type="number" inputMode="decimal" step={def.step ?? 'any'} value={typeof value === 'number' && Number.isFinite(value) ? value : ''} onChange={(e) => num(e.target.value)} onBlur={onBlur} />
        </Field>
      )
    case 'surface': {
      const v = typeof value === 'string' ? value : ''
      const known = SURFACE_OPTIONS.some((o) => o.value === v)
      const options = v && !known ? [{ value: v, label: `${v} (not in this building)` }, ...SURFACE_OPTIONS] : SURFACE_OPTIONS
      return (
        <Field id={id} group label={def.label} hint={hint ?? (v ? <span className="mono">{v}</span> : undefined)} error={error} required={def.required}>
          {(w) => (
            <Select
              {...w}
              aria-labelledby={`${id}-label`}
              value={v}
              options={options}
              placeholder="Choose a wall…"
              searchable
              onChange={(s) => {
                str(s)
                onBlur()
              }}
            />
          )}
        </Field>
      )
    }
    case 'at': {
      const r = surfaceRange(getPath(draft, 'placement.surface'))
      const n = typeof value === 'number' && Number.isFinite(value) ? value : null
      const pct = r && n !== null && r.max > r.min ? Math.max(0, Math.min(1, (n - r.min) / (r.max - r.min))) * 100 : null
      const label = r ? `Position — ${r.axisLabel} (m)` : def.label
      return (
        <Field
          id={id}
          label={label}
          error={error}
          required={def.required}
          hint={
            r ? (
              <span className="surface-hint">
                <span className="num">{r.min.toFixed(2)}</span>
                <span className="range-track" aria-hidden="true">{pct !== null && <span className={`dot ${error ? 'out' : ''}`} style={{ left: `${pct}%` }} />}</span>
                <span className="num">{r.max.toFixed(2)}</span>
              </span>
            ) : (
              'Choose a wall to see its range.'
            )
          }
        >
          {(w) => (
            <div className="input-suffix">
              <Input {...w} type="number" inputMode="decimal" step={def.step ?? 'any'} min={r?.min} max={r?.max} value={n ?? ''} onChange={(e) => num(e.target.value)} onBlur={onBlur} />
              <span aria-hidden="true">m</span>
            </div>
          )}
        </Field>
      )
    }
    case 'select':
    case 'frame': {
      const isFrame = def.type === 'frame'
      // frames: a preset id, or { style, …overrides } of which only `style` is edited here
      const isObj = isFrame && typeof value === 'object' && value !== null
      const v = isObj ? String((value as { style?: string }).style ?? '') : typeof value === 'string' ? value : ''
      const opts = def.options ?? []
      const options: SelectOption[] = [
        ...(v && !opts.includes(v) ? [{ value: v, label: v }] : []),
        ...opts.map((o) => ({ value: o, label: def.optionLabels?.[o] ?? (isFrame ? o.replace(/-/g, ' ') : o), description: def.optionLabels?.[o] ? o : undefined })),
      ]
      return (
        <Field id={id} group label={def.label} hint={isObj ? 'Has custom overrides (see Advanced).' : hint} error={error} required={def.required}>
          {(w) => (
            <Select
              {...w}
              aria-labelledby={`${id}-label`}
              value={v}
              options={options}
              placeholder={isFrame ? 'Default (thin black)' : def.required ? 'Choose…' : 'None'}
              clearable={!def.required}
              onChange={(s) => {
                if (isFrame) onChange(!s ? undefined : isObj ? { ...(value as object), style: s } : s)
                else str(s)
                onBlur()
              }}
            />
          )}
        </Field>
      )
    }
    case 'color': {
      const v = typeof value === 'string' ? value : ''
      return (
        <Field id={id} label={def.label} hint={hint} error={error} required={def.required}>
          {(w) => (
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input type="color" className="fld-color" value={/^#[0-9a-f]{6}$/i.test(v) ? v : '#000000'} onChange={(e) => onChange(e.target.value)} aria-label={`${def.label}: picker`} />
              <Input {...w} className="mono" value={v} placeholder="#2c3f6b" onChange={(e) => str(e.target.value)} onBlur={onBlur} />
            </div>
          )}
        </Field>
      )
    }
    case 'ref': {
      const v = typeof value === 'string' ? value : ''
      const target = def.ref ?? 'artisan'
      return (
        <Field id={id} group label={def.label} hint={hint} error={error} required={def.required}>
          {(w) => (
            <Combobox
              {...w}
              aria-labelledby={`${id}-label`}
              value={v}
              options={refs.options(target)}
              allowFreeText
              placeholder={target === 'artisan' ? 'Search makers…' : 'Search by title or id…'}
              onChange={(next) => {
                str(next)
                onBlur()
              }}
            />
          )}
        </Field>
      )
    }
    case 'media': {
      const v = typeof value === 'string' ? value : ''
      const listId = `media-${def.accept ?? 'any'}`
      const options = refs.media.filter((m) => mediaMatches(m, def.accept))
      const thumb = def.accept === 'image' ? safeUrl(v, 'image') : undefined
      return (
        <Field id={id} label={def.label} hint={hint ?? `From the media library (${options.length.toLocaleString()}) or the address of a file on the site.`} error={error} required={def.required} className="span-all">
          {(w) => (
            <div className="media-input">
              {thumb && <img className="mi-thumb" src={thumb} alt="" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} onLoad={(e) => ((e.target as HTMLImageElement).style.visibility = 'visible')} />}
              <Input
                {...w}
                list={listId}
                value={v}
                placeholder={def.accept === 'model' ? '/models/… .glb' : def.accept === 'video' ? '/video/… .mp4' : '/artworks/… or a library address'}
                onChange={(e) => str(e.target.value)}
                onBlur={onBlur}
              />
              <datalist id={listId}>
                {options.map((m) => (
                  <option key={m.id} value={m.url}>{m.filename}</option>
                ))}
              </datalist>
              <Button icon="image" onClick={() => setPicking(true)}>Browse</Button>
              {v && !def.required && <IconButton icon="close" label={`Clear ${def.label}`} onClick={() => onChange(undefined)} />}
              {picking && (
                <MediaPicker
                  accept={def.accept}
                  value={v}
                  onClose={() => {
                    setPicking(false)
                    refs.refreshMedia()
                  }}
                  onPick={(url) => {
                    onChange(url)
                    setPicking(false)
                    onBlur()
                    refs.refreshMedia()
                  }}
                />
              )}
            </div>
          )}
        </Field>
      )
    }
    case 'props':
      return (
        <PropsEditor
          id={id}
          def={def}
          value={value}
          kind={draft.kind}
          onChange={onChange}
          onBlur={onBlur}
          renderMedia={(d, v, set) => <FieldControl key={d.path} def={d} value={v} draft={draft} onChange={set} onBlur={onBlur} />}
        />
      )
    case 'lines': {
      const arr = Array.isArray(value) ? (value as unknown[]).map(String) : []
      return (
        <Field id={id} label={def.label} hint={hint ?? `${arr.length} ${arr.length === 1 ? 'line' : 'lines'}`} error={error} className="span-all">
          <Textarea
            rows={Math.max(3, arr.length + 1)}
            value={arr.join('\n')}
            lang={langOf(def.path)}
            onBlur={onBlur}
            onChange={(e) => {
              const lines = e.target.value.split('\n')
              onChange(lines.length === 1 && lines[0] === '' ? undefined : lines)
            }}
          />
        </Field>
      )
    }
    case 'vec3': {
      const arr = Array.isArray(value) ? (value as number[]) : [0, 0, 0]
      return (
        <Field id={id} group label={def.label} hint={hint ?? 'World metres: x east, y up, z south.'} error={error} className="span-all">
          {() => (
            <div className="grid-3 keep">
              {['x', 'y', 'z'].map((axis, i) => (
                <div className="input-suffix" key={axis}>
                  <Input
                    id={i === 0 ? id : undefined}
                    type="number"
                    inputMode="decimal"
                    step={0.05}
                    aria-label={`${def.label}: ${axis}`}
                    value={typeof arr[i] === 'number' ? arr[i] : ''}
                    onBlur={onBlur}
                    onChange={(e) => {
                      const next = [0, 1, 2].map((j) => (typeof arr[j] === 'number' ? arr[j] : 0))
                      next[i] = Number(e.target.value)
                      onChange(next)
                    }}
                  />
                  <span aria-hidden="true">{axis}</span>
                </div>
              ))}
            </div>
          )}
        </Field>
      )
    }
    case 'kv': {
      const obj = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, string>) : {}
      const entries = Object.entries(obj)
      const write = (list: [string, string][]) => onChange(list.length ? Object.fromEntries(list) : undefined)
      return (
        <div className="field span-all" id={id} tabIndex={-1}>
          {entries.length === 0 && <span className="field-hint">No extra rows. Rows appear on the item’s info card.</span>}
          {entries.map(([k, v], idx) => (
            <div className="kv-row" key={idx}>
              <Input value={k} placeholder="Label" aria-label={`Row ${idx + 1} label`} onChange={(e) => write(entries.map((en, j) => (j === idx ? [e.target.value, en[1]] : en)))} />
              <Input value={v} placeholder="Value" aria-label={`Row ${idx + 1} value`} onChange={(e) => write(entries.map((en, j) => (j === idx ? [en[0], e.target.value] : en)))} />
              <IconButton icon="close" label={`Remove ${k || `row ${idx + 1}`}`} onClick={() => write(entries.filter((_, j) => j !== idx))} />
            </div>
          ))}
          <div>
            <Button size="sm" icon="plus" onClick={() => write([...entries, [`Field ${entries.length + 1}`, '']])}>Add row</Button>
          </div>
        </div>
      )
    }
    default:
      return (
        <Field id={id} label={def.label} hint={hint} error={error} required={def.required}>
          <Input value={typeof value === 'string' ? value : value === undefined ? '' : String(value)} onChange={(e) => str(e.target.value)} onBlur={onBlur} lang={langOf(def.path)} />
        </Field>
      )
  }
}

/** `i18n.hi.title` → 'hi' (sets the lang attribute so screen readers and fonts get it right). */
function langOf(path: string): string | undefined {
  const m = /^i18n\.([a-z]{2})\./.exec(path)
  return m ? m[1] : undefined
}
