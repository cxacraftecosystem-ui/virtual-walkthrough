/**
 * The exhibition's own texts: the gallery introduction (kicker, title, subtitle, intro) and the
 * welcome, with optional Hindi / Bengali. The API stores them separately, so a save sends only the
 * part that changed; if one part saves and the other fails, the page says exactly which.
 */
import { useEffect, useState } from 'react'
import type { ExhibitionText, MuseumContent } from '../../../museum/content/types'
import { api } from '../../api'
import { LANGS } from '../../fields'
import { Button, EmptyState, Field, Input, Skeleton, Textarea, errMsg, useToast, useUnsavedGuard } from '../../ui'

type Welcome = MuseumContent['welcome']
type Lang = 'hi' | 'bn'

/** Immutable update of `i18n[lang][field]` (an empty string removes the override). */
function withText<F extends string>(i18n: Partial<Record<Lang, Partial<Record<F, string>>>> | undefined, lang: Lang, field: F, value: string) {
  const cur = { ...(i18n?.[lang] ?? {}) } as Partial<Record<F, string>>
  if (value) cur[field] = value
  else delete cur[field]
  return { ...(i18n ?? {}), [lang]: cur }
}

export function TextsEditor({ onSaved }: { onSaved: () => void }) {
  const [ex, setEx] = useState<ExhibitionText | null>(null)
  const [welcome, setWelcome] = useState<Welcome | null>(null)
  const [saved, setSaved] = useState<{ ex: string; welcome: string } | null>(null)
  const [error, setError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const toast = useToast()
  const exDirty = !!saved && JSON.stringify(ex) !== saved.ex
  const wDirty = !!saved && JSON.stringify(welcome) !== saved.welcome
  const dirty = exDirty || wDirty
  useUnsavedGuard(dirty && !busy)

  useEffect(() => {
    let alive = true
    setError('')
    api
      .content()
      .then((c) => {
        if (!alive) return
        setEx({ ...c.exhibition })
        setWelcome({ ...c.welcome })
        setSaved({ ex: JSON.stringify({ ...c.exhibition }), welcome: JSON.stringify({ ...c.welcome }) })
      })
      .catch((e) => alive && setError(errMsg(e)))
    return () => {
      alive = false
    }
  }, [reload])

  async function save() {
    if (!ex || !welcome || !saved) return
    setBusy(true)
    setSaveError('')
    let exOk = !exDirty
    try {
      if (exDirty) {
        await api.putExhibition(ex)
        exOk = true
        setSaved((s) => (s ? { ...s, ex: JSON.stringify(ex) } : s))
      }
      if (wDirty) {
        await api.putWelcome(welcome)
        setSaved((s) => (s ? { ...s, welcome: JSON.stringify(welcome) } : s))
      }
      toast(exDirty && wDirty ? 'Introduction and welcome saved' : exDirty ? 'Introduction saved' : 'Welcome saved')
      onSaved()
    } catch (e) {
      const msg = errMsg(e)
      setSaveError(exDirty && exOk && wDirty ? `The introduction was saved, but the welcome wasn’t: ${msg} Save again to retry the welcome.` : `Nothing was saved: ${msg}`)
      if (exOk && exDirty) onSaved()
    } finally {
      setBusy(false)
    }
  }

  if (error)
    return (
      <div className="card">
        <EmptyState title="Couldn’t load the texts" icon="alert" action={<Button onClick={() => setReload((n) => n + 1)}>Try again</Button>}>
          {error}
        </EmptyState>
      </div>
    )
  if (!ex || !welcome || !saved) return <div className="ct-narrow"><Skeleton kind="form" rows={4} /></div>

  return (
    <div className="card ct-narrow">
      <div className="group">
        <h3>Gallery introduction</h3>
        <div className="grid-2">
          <Field label="Kicker">
            <Input value={ex.kicker} onChange={(e) => setEx({ ...ex, kicker: e.target.value })} />
          </Field>
          <Field label="Title">
            <Input value={ex.title} onChange={(e) => setEx({ ...ex, title: e.target.value })} />
          </Field>
          <Field label="Subtitle" className="span-all">
            <Input value={ex.subtitle} onChange={(e) => setEx({ ...ex, subtitle: e.target.value })} />
          </Field>
          <Field label="Introduction" className="span-all">
            <Textarea rows={4} value={ex.intro} onChange={(e) => setEx({ ...ex, intro: e.target.value })} />
          </Field>
        </div>
      </div>
      <div className="group">
        <h3>Welcome</h3>
        <div className="grid-2">
          <Field label="Title" className="span-all">
            <Input value={welcome.title} onChange={(e) => setWelcome({ ...welcome, title: e.target.value })} />
          </Field>
          <Field label="Body" className="span-all">
            <Textarea rows={4} value={welcome.body} onChange={(e) => setWelcome({ ...welcome, body: e.target.value })} />
          </Field>
        </div>
      </div>
      <details className="group">
        <summary>
          Localisation <span className="hint">— optional; empty fields fall back to English</span>
        </summary>
        {LANGS.map(({ id: lang, name }) => (
          <div className="lang-block" key={lang}>
            <h4 lang={lang}>{name}</h4>
            <div className="grid-2">
              {(['kicker', 'title', 'subtitle', 'intro'] as const).map((f) => (
                <Field key={`ex-${f}`} label={`Introduction · ${f}`} className={f === 'intro' || f === 'subtitle' ? 'span-all' : undefined}>
                  {f === 'intro' ? (
                    <Textarea rows={3} lang={lang} value={ex.i18n?.[lang]?.[f] ?? ''} onChange={(e) => setEx({ ...ex, i18n: withText(ex.i18n, lang, f, e.target.value) })} />
                  ) : (
                    <Input lang={lang} value={ex.i18n?.[lang]?.[f] ?? ''} onChange={(e) => setEx({ ...ex, i18n: withText(ex.i18n, lang, f, e.target.value) })} />
                  )}
                </Field>
              ))}
              {(['title', 'body'] as const).map((f) => (
                <Field key={`w-${f}`} label={`Welcome · ${f}`} className="span-all">
                  {f === 'body' ? (
                    <Textarea rows={3} lang={lang} value={welcome.i18n?.[lang]?.[f] ?? ''} onChange={(e) => setWelcome({ ...welcome, i18n: withText(welcome.i18n, lang, f, e.target.value) })} />
                  ) : (
                    <Input lang={lang} value={welcome.i18n?.[lang]?.[f] ?? ''} onChange={(e) => setWelcome({ ...welcome, i18n: withText(welcome.i18n, lang, f, e.target.value) })} />
                  )}
                </Field>
              ))}
            </div>
          </div>
        ))}
      </details>
      {saveError ? <p className="alert" role="alert" style={{ marginTop: 12 }}>{saveError}</p> : null}
      <div className={`save-bar ${dirty ? 'is-dirty' : ''}`}>
        <Button variant="primary" onClick={() => void save()} loading={busy} loadingLabel="Saving…" disabled={!dirty}>
          Save texts
        </Button>
        {dirty && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setEx(JSON.parse(saved.ex) as ExhibitionText)
              setWelcome(JSON.parse(saved.welcome) as Welcome)
              setSaveError('')
            }}
          >
            Revert
          </Button>
        )}
        {dirty && <span className="dirty">Unsaved changes</span>}
      </div>
    </div>
  )
}
