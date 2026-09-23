import { useEffect, useState } from 'react'
import { BUNDLED_TOUR_STOPS } from '../../museum/config/tour'
import { type AdminExhibition, exApi, setSelectedExhibition, useSelectedExhibition } from '../exhibitionsApi'
import { EXHIBITIONS_CHANGED, useExhibitionList } from '../ExhibitionSwitcher'
import { Skeleton, errMsg, formatDate, useConfirm, useToast } from '../ui'
import '../exhibitions.css'

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,59}$/
const HEX_RE = /^#[0-9a-f]{6}$/i
const changed = () => window.dispatchEvent(new Event(EXHIBITIONS_CHANGED))
const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)

/**
 * Exhibitions (multi-exhibition platform). Structure (create / duplicate / publish / default /
 * delete / title & theme) needs admin; curators see the list and edit tour stops + content.
 */
export function ExhibitionsPage({ canManage }: { canManage: boolean }) {
  const list = useExhibitionList()
  const selected = useSelectedExhibition()
  const [editing, setEditing] = useState<string | null>(null)
  const [dup, setDup] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const toast = useToast()
  const confirm = useConfirm()

  async function run(label: string, fn: () => Promise<unknown>) {
    try {
      await fn()
      toast(label)
      changed()
    } catch (e) {
      toast(errMsg(e), 'error')
    }
  }

  if (!list) return <Skeleton rows={5} />
  const current = list.find((e) => e.id === selected) ?? list.find((e) => e.isDefault) ?? list[0]

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Exhibitions</h1>
          <p className="muted">
            One building, several exhibitions. Each has its own artworks, exhibits, panels, films, objects, texts, tour and accent colour. The default
            exhibition opens at <span className="mono">/gallery</span>; the others at <span className="mono">/gallery/&lt;slug&gt;</span>.
          </p>
        </div>
        <span className="spacer" />
        {canManage && !creating && (
          <button className="btn primary small" onClick={() => setCreating(true)}>+ New empty exhibition</button>
        )}
      </div>

      {creating && canManage && (
        <ExhibitionForm
          heading="New exhibition (empty draft)"
          submitLabel="Create draft"
          onCancel={() => setCreating(false)}
          onSubmit={(v) =>
            run(`Created “${v.title}”`, async () => {
              await exApi.create(v)
              setCreating(false)
            })
          }
        />
      )}

      <section className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Exhibition</th>
                <th>Status</th>
                <th className="num">Items</th>
                <th>Updated</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id} className={e.id === current?.id ? 'ex-row is-selected' : 'ex-row'}>
                  <td>
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      <span className="ex-swatch" style={{ background: HEX_RE.test(e.theme.accent ?? '') ? e.theme.accent : 'transparent' }} title={`Accent ${e.theme.accent ?? '—'}`} />
                      <div>
                        <div>
                          <strong>{e.title}</strong> {e.isDefault && <span className="badge">default</span>}
                        </div>
                        <div className="mono muted">{e.path}</div>
                        {e.subtitle && <div className="small muted">{e.subtitle}</div>}
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={e.status === 'published' ? 'badge ok' : 'badge warn'}>{e.status}</span>
                  </td>
                  <td className="num">{e.items}</td>
                  <td className="small muted">{formatDate(e.updatedAt)}</td>
                  <td>
                    <div className="row ex-actions">
                      <button
                        className="btn small"
                        onClick={() => {
                          setSelectedExhibition(e.isDefault ? '' : e.id)
                          window.location.hash = '#/content'
                        }}
                      >
                        Edit content
                      </button>
                      <a className="btn small ghost" href={e.path} target="_blank" rel="noreferrer">Open ↗</a>
                      {canManage && (
                        <>
                          <button className="btn small ghost" onClick={() => setEditing(editing === e.id ? null : e.id)}>Settings</button>
                          <button className="btn small ghost" onClick={() => setDup(dup === e.id ? null : e.id)}>Duplicate</button>
                          {e.status === 'draft' ? (
                            <button className="btn small ghost" onClick={() => run(`Published “${e.title}”`, () => exApi.patch(e.id, { status: 'published' }))}>Publish</button>
                          ) : (
                            !e.isDefault && <button className="btn small ghost" onClick={() => run(`Unpublished “${e.title}”`, () => exApi.patch(e.id, { status: 'draft' }))}>Unpublish</button>
                          )}
                          {!e.isDefault && e.status === 'published' && (
                            <button className="btn small ghost" onClick={() => run(`“${e.title}” is now the default`, () => exApi.setDefault(e.id))}>Make default</button>
                          )}
                          {!e.isDefault && (
                            <button
                              className="btn small danger"
                              onClick={async () => {
                                if (!(await confirm({ title: `Delete “${e.title}”?`, body: `The exhibition and all ${e.items} of its content items are deleted. This cannot be undone.`, confirmLabel: 'Delete exhibition', danger: true }))) return
                                void run('Deleted', () => exApi.remove(e.id))
                              }}
                            >
                              Delete
                            </button>
                          )}
                        </>
                      )}
                    </div>
                    {editing === e.id && (
                      <ExhibitionForm
                        heading="Settings"
                        initial={e}
                        submitLabel="Save"
                        onCancel={() => setEditing(null)}
                        onSubmit={(v) =>
                          run('Saved', async () => {
                            await exApi.patch(e.id, v)
                            setEditing(null)
                          })
                        }
                      />
                    )}
                    {dup === e.id && (
                      <ExhibitionForm
                        heading={`Duplicate “${e.title}” (all content is copied into a new draft)`}
                        initial={{ ...e, title: `${e.title} (copy)`, slug: `${e.slug}-copy` }}
                        submitLabel="Duplicate"
                        onCancel={() => setDup(null)}
                        onSubmit={(v) =>
                          run(`Duplicated into “${v.title}”`, async () => {
                            await exApi.duplicate(e.id, { slug: v.slug, title: v.title })
                            setDup(null)
                          })
                        }
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {current && <TourEditor key={current.id} exhibition={current} />}
    </>
  )
}

/* ------------------------------------------------------------------ */

type FormValue = { title: string; slug: string; subtitle: string; theme: { accent?: string } }

function ExhibitionForm({
  heading,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  heading: string
  initial?: Partial<AdminExhibition>
  submitLabel: string
  onSubmit: (v: FormValue) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [slug, setSlug] = useState(initial?.slug ?? '')
  const [slugTouched, setSlugTouched] = useState(!!initial?.slug)
  const [subtitle, setSubtitle] = useState(initial?.subtitle ?? '')
  const [accent, setAccent] = useState(initial?.theme?.accent ?? '#8a5a3b')
  const slugOk = SLUG_RE.test(slug)
  const accentOk = HEX_RE.test(accent)
  return (
    <form
      className="card ex-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (!title.trim() || !slugOk || !accentOk) return
        onSubmit({ title: title.trim(), slug, subtitle: subtitle.trim(), theme: { accent } })
      }}
    >
      <h3>{heading}</h3>
      <div className="grid-2">
        <label className="field">
          <span>Title<span className="req"> *</span></span>
          <input
            type="text"
            value={title}
            maxLength={120}
            onChange={(e) => {
              setTitle(e.target.value)
              if (!slugTouched) setSlug(slugify(e.target.value))
            }}
          />
        </label>
        <label className="field">
          <span>Slug (URL)<span className="req"> *</span></span>
          <input
            type="text"
            value={slug}
            maxLength={60}
            onChange={(e) => {
              setSlugTouched(true)
              setSlug(e.target.value.toLowerCase())
            }}
            aria-invalid={!slugOk}
          />
          <span className="hint">/gallery/{slug || '…'} — lower-case letters, digits and “-”</span>
        </label>
        <label className="field span-all">
          <span>Subtitle</span>
          <input type="text" value={subtitle} maxLength={200} onChange={(e) => setSubtitle(e.target.value)} />
        </label>
        <label className="field">
          <span>Accent colour (UI theme)</span>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input type="color" value={accentOk ? accent : '#000000'} onChange={(e) => setAccent(e.target.value)} style={{ width: 40, height: 34, padding: 0, border: 0, background: 'none' }} aria-label="Pick accent colour" />
            <input type="text" value={accent} onChange={(e) => setAccent(e.target.value)} aria-invalid={!accentOk} aria-label="Accent colour hex" />
          </div>
        </label>
      </div>
      <div className="save-bar">
        <button className="btn primary" disabled={!title.trim() || !slugOk || !accentOk}>{submitLabel}</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

/* ------------------------------------------------------------------ */

/** Per-exhibition tour stops (JSON). Empty / cleared = the bundled tour (src/museum/config/tour.ts). */
function TourEditor({ exhibition }: { exhibition: AdminExhibition }) {
  const [text, setText] = useState<string | null>(null)
  const [custom, setCustom] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  useEffect(() => {
    let alive = true
    exApi
      .tour(exhibition.id)
      .then((t) => {
        if (!alive) return
        setCustom(!!t)
        setText(t ? JSON.stringify(t, null, 2) : '')
      })
      .catch((e) => alive && setError(errMsg(e)))
    return () => {
      alive = false
    }
  }, [exhibition.id])

  function parse(): unknown[] | null {
    const v = JSON.parse(text || '[]') as unknown
    if (!Array.isArray(v)) throw new Error('Tour must be a JSON array of stops')
    return v
  }

  async function save(stops: unknown[] | null) {
    setBusy(true)
    try {
      const r = await exApi.putTour(exhibition.id, stops)
      setCustom(!!r.stops)
      if (!r.stops) setText('')
      toast(r.stops ? `Saved ${r.stops.length} tour stops` : 'Using the bundled tour')
      window.dispatchEvent(new Event(EXHIBITIONS_CHANGED))
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <div className="form-head">
        <h2>Guided tour — {exhibition.title}</h2>
        <span className={custom ? 'badge ok' : 'badge'}>{custom ? 'custom tour' : 'bundled tour'}</span>
      </div>
      <p className="muted small">
        Each stop: <span className="mono">{'{ id, place, title, text, view: { x, z, yawDeg, pitchDeg? }, item?: { kind, id }, dwellSec? }'}</span>. Leave empty to use
        the bundled tour. Stops that name an item missing from this exhibition simply show no “More about this” link.
      </p>
      {error && <p className="alert">{error}</p>}
      {text === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <textarea
            className="json-editor"
            spellCheck={false}
            rows={Math.min(24, Math.max(6, text.split('\n').length + 1))}
            value={text}
            placeholder="[] — empty: the bundled tour is used"
            onChange={(e) => setText(e.target.value)}
            aria-label="Tour stops JSON"
          />
          <div className="save-bar">
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => {
                try {
                  const stops = parse()
                  void save(stops && stops.length ? stops : null)
                } catch (e) {
                  toast(errMsg(e), 'error')
                }
              }}
            >
              Save tour
            </button>
            <button className="btn ghost" disabled={busy} onClick={() => setText(JSON.stringify(BUNDLED_TOUR_STOPS, null, 2))}>Load bundled stops as a template</button>
            <span className="spacer" />
            {custom && (
              <button className="btn small danger" disabled={busy} onClick={() => void save(null)}>Revert to bundled tour</button>
            )}
          </div>
        </>
      )}
    </section>
  )
}
