/**
 * Exhibitions: one building, several exhibitions, each with its own content, texts, tour and accent.
 * Structure (create / duplicate / publish / default / delete / settings) needs admin; curators see the
 * list, open an exhibition's content and edit its tour. Consequential actions confirm first; delete
 * asks for the exhibition's name.
 */
import { useEffect, useMemo, useState } from 'react'
import { flushSync } from 'react-dom'
import { type AdminExhibition, exApi, setSelectedExhibition, useSelectedExhibition } from '../exhibitionsApi'
import { EXHIBITIONS_CHANGED, useExhibitionList } from '../ExhibitionSwitcher'
import {
  Badge,
  Button,
  DataTable,
  Drawer,
  EmptyState,
  Field,
  Input,
  Menu,
  PageHeader,
  RowAction,
  RowActions,
  SearchInput,
  StatusBadge,
  errMsg,
  formatDate,
  formatRelative,
  useConfirm,
  useConfirmLeave,
  useToast,
  useUnsavedGuard,
  type Column,
  type MenuItem,
} from '../ui'
import { TourEditor } from './tour/TourEditor'
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

type FormMode = { kind: 'create' } | { kind: 'settings'; ex: AdminExhibition } | { kind: 'duplicate'; ex: AdminExhibition }

export function ExhibitionsPage({ canManage }: { canManage: boolean }) {
  const list = useExhibitionList()
  const selected = useSelectedExhibition()
  const [form, setForm] = useState<FormMode | null>(null)
  const [query, setQuery] = useState('')
  const [tourFor, setTourFor] = useState<string | null>(null)
  /** bumped to remount the tour editor, dropping its unsaved edits */
  const [tourKey, setTourKey] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)
  const toast = useToast()
  const confirm = useConfirm()
  const leave = useConfirmLeave()

  // the palette's "New exhibition" lands on #/exhibitions/+new
  useEffect(() => {
    if (canManage && /^#\/?exhibitions\/\+new/.test(window.location.hash)) {
      setForm({ kind: 'create' })
      window.history.replaceState(null, '', '#/exhibitions')
    }
  }, [canManage])

  async function run(id: string, label: string, fn: () => Promise<unknown>) {
    setBusyId(id)
    try {
      await fn()
      toast(label)
      changed()
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusyId(null)
    }
  }

  const current = list?.find((e) => e.id === selected) ?? list?.find((e) => e.isDefault) ?? list?.[0]
  const tourEx = list?.find((e) => e.id === tourFor) ?? current
  const q = query.trim().toLowerCase()
  const shown = useMemo(() => (list ? list.filter((e) => !q || [e.title, e.slug, e.subtitle, e.path].some((s) => s.toLowerCase().includes(q))) : null), [list, q])

  async function publish(e: AdminExhibition) {
    const ok = await confirm({ title: `Publish “${e.title}”?`, body: `Visitors can open it at ${e.path}.`, confirmLabel: 'Publish' })
    if (ok) void run(e.id, `Published “${e.title}”`, () => exApi.patch(e.id, { status: 'published' }))
  }
  async function unpublish(e: AdminExhibition) {
    const ok = await confirm({ title: `Unpublish “${e.title}”?`, body: `Visitors can no longer open ${e.path}. Its content is kept.`, confirmLabel: 'Unpublish', tone: 'warning' })
    if (ok) void run(e.id, `Unpublished “${e.title}”`, () => exApi.patch(e.id, { status: 'draft' }))
  }
  async function makeDefault(e: AdminExhibition) {
    const ok = await confirm({ title: `Make “${e.title}” the default?`, body: 'It opens at /gallery for every visitor, in place of the current default.', confirmLabel: 'Make default', tone: 'warning' })
    if (ok) void run(e.id, `“${e.title}” is now the default`, () => exApi.setDefault(e.id))
  }
  async function remove(e: AdminExhibition) {
    const ok = await confirm({
      title: `Delete “${e.title}”?`,
      body: `The exhibition, its texts, its tour and all ${e.items} of its content items are deleted. This can’t be undone.`,
      confirmLabel: 'Delete exhibition',
      danger: true,
      typeToConfirm: e.slug,
    })
    if (!ok) return
    void run(e.id, `Deleted “${e.title}”`, async () => {
      await exApi.remove(e.id)
      if (selected === e.id) setSelectedExhibition('')
      if (tourFor === e.id) setTourFor(null)
    })
  }
  /**
   * Once leave() has been answered "Discard changes", really drop this page's edits: close the
   * settings drawer and remount the tour editor. flushSync commits (and runs the guards' cleanups)
   * before returning, so the shell's hashchange guard finds nothing unsaved and does not ask again —
   * a second "Keep editing" there would leave the curator here with the exhibition already switched.
   */
  function discardEdits() {
    flushSync(() => {
      setForm(null)
      setTourKey((k) => k + 1)
    })
  }
  async function editContent(e: AdminExhibition) {
    if (!(await leave())) return
    discardEdits()
    setSelectedExhibition(e.isDefault ? '' : e.id)
    window.location.hash = '#/content'
  }
  async function openTour(e: AdminExhibition) {
    if (e.id === tourEx?.id) return document.getElementById('tour-title')?.scrollIntoView({ block: 'start' })
    if (!(await leave())) return
    discardEdits()
    setTourFor(e.id)
    requestAnimationFrame(() => document.getElementById('tour-title')?.scrollIntoView({ block: 'start' }))
  }

  const columns: Column<AdminExhibition>[] = [
    {
      id: 'title',
      header: 'Exhibition',
      sortValue: (e) => e.title.toLowerCase(),
      cell: (e) => (
        <div className="ex-cell">
          <span className="ex-swatch" style={{ background: HEX_RE.test(e.theme.accent ?? '') ? e.theme.accent : 'transparent' }} aria-hidden="true" />
          <span className="stack">
            <span className="cell-title">{e.title}</span>
            <span className="cell-sub mono">{e.path}</span>
            {e.subtitle ? <span className="cell-sub">{e.subtitle}</span> : null}
          </span>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (e) => (e.isDefault ? 0 : e.status === 'published' ? 1 : 2),
      cell: (e) => (
        <div className="ct-badges">
          <StatusBadge status={e.status} />
          {e.isDefault ? <StatusBadge status="default" /> : null}
          {e.id === current?.id ? <Badge>Editing</Badge> : null}
        </div>
      ),
    },
    { id: 'items', header: 'Items', align: 'right', sortValue: (e) => e.items, cell: (e) => e.items.toLocaleString() },
    { id: 'tour', header: 'Tour', hidePhone: true, sortValue: (e) => (e.hasTour ? 1 : 0), cell: (e) => (e.hasTour ? 'Custom' : 'Standard') },
    {
      id: 'updated',
      header: 'Updated',
      hidePhone: true,
      sortValue: (e) => e.updatedAt,
      cell: (e) => <span title={formatDate(e.updatedAt)}>{formatRelative(e.updatedAt)}</span>,
    },
  ]

  const more = (e: AdminExhibition): MenuItem[] => {
    const items: MenuItem[] = [
      { label: 'Open in museum', icon: 'external', href: e.path, external: true },
      { label: 'Edit tour', icon: 'exhibitions', onSelect: () => void openTour(e) },
    ]
    if (!canManage) return items
    items.push({ label: 'Duplicate', icon: 'copy', onSelect: () => setForm({ kind: 'duplicate', ex: e }) })
    if (e.status === 'draft') items.push({ label: 'Publish', icon: 'check', onSelect: () => void publish(e) })
    else if (!e.isDefault) items.push({ label: 'Unpublish', icon: 'eye', onSelect: () => void unpublish(e) })
    if (!e.isDefault && e.status === 'published') items.push({ label: 'Make default', icon: 'home', onSelect: () => void makeDefault(e) })
    if (!e.isDefault) items.push('separator', { label: 'Delete…', icon: 'trash', danger: true, onSelect: () => void remove(e) })
    return items
  }

  return (
    <>
      <PageHeader
        title="Exhibitions"
        icon="exhibitions"
        description={
          <>
            Each exhibition has its own content, texts, tour and accent colour. The default opens at <span className="mono">/gallery</span>, the others at{' '}
            <span className="mono">/gallery/</span> and their web address.
          </>
        }
        actions={
          canManage ? (
            <Button variant="primary" icon="plus" onClick={() => setForm({ kind: 'create' })}>
              New exhibition
            </Button>
          ) : undefined
        }
      />
      <div className="toolbar">
        <SearchInput value={query} onChange={setQuery} label="Search exhibitions" placeholder="Search exhibitions" />
      </div>
      <DataTable
        rows={shown}
        columns={columns}
        getRowId={(e) => e.id}
        caption="Exhibitions"
        defaultSort={null}
        rowActions={(e) => (
          <RowActions label={`Actions for ${e.title}`}>
            <RowAction tone="edit" icon="content" disabled={busyId === e.id} onClick={() => void editContent(e)}>
              Edit content
            </RowAction>
            {canManage ? (
              <RowAction icon="edit" disabled={busyId === e.id} onClick={() => setForm({ kind: 'settings', ex: e })}>
                Settings
              </RowAction>
            ) : null}
            <Menu label={`More for ${e.title}`} items={more(e)} />
          </RowActions>
        )}
        empty={q ? <EmptyState title="No exhibition matches" icon="search" as="h3" /> : <EmptyState title="No exhibitions yet" icon="exhibitions" as="h3" />}
      />

      {tourEx && <TourEditor key={`${tourEx.id}:${tourKey}`} exhibition={tourEx} />}

      {form && canManage && <ExhibitionForm mode={form} onClose={() => setForm(null)} onDone={() => setForm(null)} />}
    </>
  )
}

/* ------------------------------------------------------------------ */

function ExhibitionForm({ mode, onClose, onDone }: { mode: FormMode; onClose: () => void; onDone: () => void }) {
  const initial = mode.kind === 'settings' ? mode.ex : mode.kind === 'duplicate' ? { ...mode.ex, title: `${mode.ex.title} (copy)`, slug: `${mode.ex.slug}-copy`.slice(0, 60) } : null
  const [title, setTitle] = useState(initial?.title ?? '')
  const [slug, setSlug] = useState(initial?.slug ?? '')
  const [slugTouched, setSlugTouched] = useState(!!initial?.slug)
  const [subtitle, setSubtitle] = useState(initial?.subtitle ?? '')
  const [accent, setAccent] = useState(initial?.theme?.accent ?? '#7a3fb0')
  const [touched, setTouched] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const toast = useToast()
  const confirm = useConfirm()
  const dirty = title !== (initial?.title ?? '') || slug !== (initial?.slug ?? '') || subtitle !== (initial?.subtitle ?? '') || accent !== (initial?.theme?.accent ?? '#7a3fb0')
  useUnsavedGuard(dirty && !busy)

  const errs: Record<string, string> = {}
  if (!title.trim()) errs.title = 'A title is required.'
  if (!SLUG_RE.test(slug)) errs.slug = 'Lower-case letters, digits and “-”, 2 to 60 characters.'
  if (!HEX_RE.test(accent)) errs.accent = 'Use a colour like #7a3fb0.'
  const show = (k: string) => (touched.has(k) ? errs[k] : undefined)
  const touch = (k: string) => setTouched((t) => new Set(t).add(k))

  const heading = mode.kind === 'create' ? 'New exhibition' : mode.kind === 'settings' ? `Settings — ${mode.ex.title}` : `Duplicate “${mode.ex.title}”`
  const close = async () => {
    if (dirty && !busy && !(await confirm({ title: 'Discard these changes?', confirmLabel: 'Discard', danger: true }))) return
    onClose()
  }

  async function submit() {
    setTouched(new Set(['title', 'slug', 'accent']))
    if (Object.keys(errs).length) return
    setBusy(true)
    setError('')
    const v = { title: title.trim(), slug, subtitle: subtitle.trim(), theme: { accent } }
    try {
      if (mode.kind === 'create') await exApi.create(v)
      else if (mode.kind === 'settings') await exApi.patch(mode.ex.id, v)
      else await exApi.duplicate(mode.ex.id, { slug: v.slug, title: v.title })
      toast(mode.kind === 'create' ? `Created “${v.title}” as a draft` : mode.kind === 'settings' ? 'Settings saved' : `Duplicated into “${v.title}” (draft)`)
      changed()
      onDone()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer
      title={heading}
      description={mode.kind === 'duplicate' ? 'All content, texts and the tour are copied into a new draft.' : mode.kind === 'create' ? 'Starts as an empty draft.' : undefined}
      busy={busy}
      onClose={() => void close()}
      footer={
        <>
          <Button variant="ghost" onClick={() => void close()} disabled={busy}>Cancel</Button>
          <Button variant="primary" loading={busy} loadingLabel="Saving…" onClick={() => void submit()}>
            {mode.kind === 'create' ? 'Create draft' : mode.kind === 'settings' ? 'Save' : 'Duplicate'}
          </Button>
        </>
      }
    >
      <form
        className="grid-2"
        style={{ gridTemplateColumns: '1fr' }}
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Field label="Title" required error={show('title')}>
          <Input
            value={title}
            maxLength={120}
            data-autofocus
            onBlur={() => touch('title')}
            onChange={(e) => {
              setTitle(e.target.value)
              if (!slugTouched) setSlug(slugify(e.target.value))
            }}
          />
        </Field>
        <Field label="Web address" required error={show('slug')} hint={`/gallery/${slug || '…'}`}>
          <Input
            className="mono"
            value={slug}
            maxLength={60}
            spellCheck={false}
            onBlur={() => touch('slug')}
            onChange={(e) => {
              setSlugTouched(true)
              setSlug(e.target.value.toLowerCase())
            }}
          />
        </Field>
        {mode.kind !== 'duplicate' ? (
          <>
            <Field label="Subtitle">
              <Input value={subtitle} maxLength={200} onChange={(e) => setSubtitle(e.target.value)} />
            </Field>
            <Field label="Accent colour" error={show('accent')} hint="Used for the exhibition’s buttons and highlights in the museum.">
              {(w) => (
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <input type="color" className="fld-color" value={HEX_RE.test(accent) ? accent : '#000000'} onChange={(e) => setAccent(e.target.value)} aria-label="Accent colour: picker" />
                  <Input {...w} className="mono" value={accent} onBlur={() => touch('accent')} onChange={(e) => setAccent(e.target.value)} />
                </div>
              )}
            </Field>
          </>
        ) : null}
        <button hidden type="submit" />
      </form>
      {error ? <p className="alert" role="alert" style={{ marginTop: 16 }}>{error}</p> : null}
    </Drawer>
  )
}
