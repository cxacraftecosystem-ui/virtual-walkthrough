/**
 * Media library (#/media, curator+): this site's uploaded images, 3D models, video and audio.
 *
 * - Uploads: drop files or whole folders, or choose them; three upload at a time, each with its own
 *   progress, any number queued; failed files say why and can be retried. "Save into" picks a folder
 *   (by default the server files each type into its own).
 * - Browsing: server-side search by file name and type filter, a page of 60 at a time ("Load more"),
 *   sort (newest from the server; name and size order what is loaded, and say so), grid or list view
 *   (remembered in this browser). Image sizes in pixels are read from the thumbnails.
 * - Each file: copy its address, open it, "Where used" (a drawer listing the content items and maker
 *   portraits that reference it), delete. Deleting checks where a file is used first; a file still in
 *   use needs the word typed to confirm. Bulk select works in both views.
 * - `#/media/<id>` opens that file's drawer (links from the activity log).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type MediaConfig, type MediaKind, type MediaRecord, type MediaUsage } from '../api'
import { setSelectedExhibition } from '../exhibitionsApi'
import {
  KIND_LABEL,
  KIND_PLURAL,
  KIND_TABS,
  MediaThumb,
  SORT_OPTIONS,
  UploadList,
  dimsText,
  filesFromDrop,
  kindOf,
  sortMedia,
  splitAllowed,
  useImageDims,
  useMediaPages,
  useUploadQueue,
  type Dims,
  type MediaSort,
} from '../MediaPicker'
import { safeUrl } from '../safeUrl'
import {
  Button,
  ButtonRow,
  Checkbox,
  CursorPager,
  DataTable,
  Drawer,
  EmptyState,
  Field,
  Icon,
  PageHeader,
  RowAction,
  RowActions,
  SearchInput,
  Segmented,
  Select,
  Skeleton,
  Tabs,
  errMsg,
  formatBytes,
  formatDate,
  formatRelative,
  useConfirm,
  useToast,
  type Column,
} from '../ui'
import { hashTail, plural, readStore, writeStore } from './triage'
import './operations.css'

type View = 'grid' | 'list'
const VIEW_KEY = 'museum.admin.media.view'
const COLLECTION_LABEL: Record<string, string> = { artworks: 'Artwork', exhibits: 'Exhibit', infographics: 'Infographic', videos: 'Video', objects: 'Object' }

/** Runs `fn` over `list`, `n` at a time, keeping the order. */
async function mapLimit<T, R>(list: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(list.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(n, list.length) }, async () => {
      while (next < list.length) {
        const i = next++
        out[i] = await fn(list[i])
      }
    }),
  )
  return out
}

const usageCount = (u: MediaUsage | null | undefined) => (u ? u.usage.length + u.artisans.length : 0)

export function MediaPage() {
  const [cfg, setCfg] = useState<MediaConfig | null>(null)
  const [cfgError, setCfgError] = useState('')
  const [folder, setFolder] = useState('')
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<MediaKind | ''>('')
  const [sort, setSort] = useState<MediaSort>('newest')
  const [view, setViewState] = useState<View>(() => readStore<View>(VIEW_KEY, ['grid', 'list'], 'grid'))
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [openId, setOpenId] = useState<string | null>(() => hashTail('media') || null)
  const [over, setOver] = useState(false)
  const [skipped, setSkipped] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const { dims, onLoad } = useImageDims()
  const lib = useMediaPages(q, kind)
  const fileInput = useRef<HTMLInputElement>(null)
  const folderInput = useRef<HTMLInputElement>(null)
  const toast = useToast()
  const confirm = useConfirm()

  useEffect(() => {
    api.mediaConfig().then(setCfg).catch((e) => setCfgError(errMsg(e)))
  }, [])
  useEffect(() => {
    const onHash = () => setOpenId(hashTail('media') || null)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const queue = useUploadQueue(cfg, (rec) => lib.prepend(rec))
  // one summary toast when a batch settles (the list keeps naming each failed file)
  const wasActive = useRef(false)
  useEffect(() => {
    if (queue.active) wasActive.current = true
    else if (wasActive.current) {
      wasActive.current = false
      const { done, failed } = queue.counts
      if (failed) toast(`${plural(failed, 'file')} didn’t upload — the list below says why.`, 'error', { title: `${plural(done, 'file')} uploaded` })
      else if (done) toast(`${plural(done, 'file')} uploaded`)
    }
  }, [queue.active, queue.counts, toast])

  const setView = (v: View) => {
    setViewState(v)
    writeStore(VIEW_KEY, v)
  }

  const addFiles = useCallback(
    (files: File[]) => {
      const { ok, skipped: s } = splitAllowed(files, cfg)
      setSkipped(s)
      queue.add(ok, folder)
    },
    [cfg, folder, queue],
  )

  const shown = useMemo(() => sortMedia(lib.items ?? [], sort), [lib.items, sort])
  const ids = useMemo(() => shown.map((m) => m.id), [shown])
  // forget ticks on files that left the view
  useEffect(() => {
    setSelected((s) => {
      const keep = new Set([...s].filter((id) => ids.includes(id)))
      return keep.size === s.size ? s : keep
    })
  }, [ids])
  const open = openId ? (lib.items ?? []).find((m) => m.id === openId) ?? null : null

  const closeDrawer = () => {
    setOpenId(null)
    if (hashTail('media')) window.history.replaceState(null, '', '#/media')
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      toast(url.length > 64 ? `${url.slice(0, 61)}…` : url, 'ok', { title: 'Address copied' })
    } catch {
      toast(url, 'info', { title: 'Copy this address', duration: 0 })
    }
  }

  /** Checks where each file is used, asks (typed word when any is in use or ten or more), then deletes one by one. */
  async function deleteFiles(list: MediaRecord[]) {
    if (!list.length || busy) return
    setBusy(true)
    try {
      const checks = await mapLimit(list, 4, async (m) => ({ m, u: await api.mediaUsage(m.id).catch(() => null) }))
      const used = checks.filter((c) => usageCount(c.u) > 0)
      const unknown = checks.filter((c) => c.u === null)
      const one = list.length === 1
      const body = (
        <>
          {used.length ? (
            <>
              <p>
                {one ? 'This file is' : `${plural(used.length, 'file')} ${used.length === 1 ? 'is' : 'are'}`} still used. Those places will show a missing file.
              </p>
              <ul className="mx-usage-mini">
                {used.slice(0, 5).map(({ m, u }) => (
                  <li key={m.id}>
                    <strong>{m.filename}</strong> — {plural(usageCount(u), 'place')}
                    {u?.usage[0] ? `, e.g. ${COLLECTION_LABEL[u.usage[0].collection] ?? u.usage[0].collection} “${u.usage[0].title || u.usage[0].id}”` : u?.artisans[0] ? `, e.g. the portrait of ${u.artisans[0].name}` : ''}
                  </li>
                ))}
                {used.length > 5 ? <li className="muted">and {used.length - 5} more</li> : null}
              </ul>
            </>
          ) : (
            <p>{one ? 'Nothing in the exhibitions uses this file.' : 'Nothing in the exhibitions uses these files.'}</p>
          )}
          {unknown.length ? <p className="muted">Couldn’t check {plural(unknown.length, 'file')}; {unknown.length === 1 ? 'it' : 'they'} may still be in use.</p> : null}
          <p>This can’t be undone.</p>
        </>
      )
      setBusy(false) // the dialog is modal; nothing else can start meanwhile
      const ok = await confirm({
        title: one ? `Delete “${list[0].filename}”?` : `Delete ${plural(list.length, 'file')}?`,
        body,
        confirmLabel: one ? 'Delete file' : `Delete ${plural(list.length, 'file')}`,
        danger: true,
        typeToConfirm: used.length || unknown.length || list.length >= 10 ? 'delete' : undefined,
      })
      if (!ok) return
      setBusy(true)
      const done: string[] = []
      const failed: { m: MediaRecord; e: string }[] = []
      for (const m of list) {
        try {
          await api.deleteMedia(m.id)
          done.push(m.id)
        } catch (e) {
          failed.push({ m, e: errMsg(e) })
        }
      }
      lib.drop(done)
      setSelected(new Set(failed.map((f) => f.m.id))) // failed rows stay ticked
      if (open && done.includes(open.id)) closeDrawer()
      if (failed.length)
        toast(failed.map((f) => `${f.m.filename}: ${f.e}`).join(' · '), 'error', { title: done.length ? `Deleted ${plural(done.length, 'file')}; ${failed.length} failed` : 'Not deleted' })
      else toast(one ? `Deleted “${list[0].filename}”` : `Deleted ${plural(done.length, 'file')}`)
    } finally {
      setBusy(false)
    }
  }

  const selectedFiles = shown.filter((m) => selected.has(m.id))
  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s)
      if (on) n.add(id)
      else n.delete(id)
      return n
    })
  const allTicked = ids.length > 0 && ids.every((id) => selected.has(id))

  const columns: Column<MediaRecord>[] = [
    {
      id: 'file',
      header: 'File',
      cell: (m) => (
        <span className="mx-row-file">
          <span className="mx-row-thumb"><MediaThumb m={m} onLoad={onLoad(m.id)} iconSize={18} /></span>
          <span style={{ minWidth: 0 }}>
            <button type="button" className="mx-linkish cell-title truncate" onClick={() => setOpenId(m.id)} title={m.filename}>{m.filename}</button>
            <span className="cell-sub truncate" title={m.url}>{m.folder}</span>
          </span>
        </span>
      ),
    },
    { id: 'kind', header: 'Type', cell: (m) => KIND_LABEL[kindOf(m)] },
    { id: 'size', header: 'Size', align: 'right', cell: (m) => formatBytes(m.size) },
    { id: 'dims', header: 'Pixels', hidePhone: true, cell: (m) => (dims[m.id] ? `${dims[m.id].w} × ${dims[m.id].h}` : '–') },
    { id: 'added', header: 'Added', hidePhone: true, cell: (m) => <time dateTime={m.createdAt} title={formatDate(m.createdAt)}>{formatRelative(m.createdAt)}</time> },
  ]

  const bulk = (
    <>
      <Button size="sm" variant="danger" icon="trash" loading={busy} onClick={() => void deleteFiles(selectedFiles)}>
        Delete
      </Button>
    </>
  )

  const filtering = !!lib.query || !!kind
  const sortNote = sort !== 'newest' && lib.hasMore ? 'sorted among the files loaded so far' : undefined

  return (
    <>
      <PageHeader
        icon="media"
        title="Media library"
        description="Images, 3D models, video and audio for the exhibitions. Copy a file’s address into a content item, or pick it there."
        actions={
          <Button variant="primary" icon="plus" onClick={() => fileInput.current?.click()} disabled={!cfg}>
            Upload files
          </Button>
        }
      />
      {cfgError ? <p className="alert" role="alert">{cfgError}</p> : null}

      <section
        className={`upload-zone mx-drop${over ? ' over' : ''}`}
        aria-label="Upload"
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          void filesFromDrop(e.dataTransfer).then(addFiles)
        }}
      >
        <div className="mx-drop-main">
          <span className="mx-drop-icon" aria-hidden="true"><Icon name="media" /></span>
          <div>
            <strong>Drop files or folders here</strong>
            <p className="muted small">
              {cfg ? `${cfg.extensions.map((x) => x.slice(1)).join(', ')} · up to ${formatBytes(cfg.maxBytes)} each` : 'Loading upload settings…'}
            </p>
          </div>
        </div>
        <div className="mx-drop-actions">
          <Field label="Save into" group className="mx-folder">
            {(w) => (
              <Select
                {...w}
                size="sm"
                value={folder}
                onChange={setFolder}
                options={[{ value: '', label: 'By file type' }, ...(cfg?.folders ?? []).map((f) => ({ value: f, label: f }))]}
                disabled={!cfg}
              />
            )}
          </Field>
          <ButtonRow>
            <Button icon="plus" onClick={() => fileInput.current?.click()} disabled={!cfg}>Choose files</Button>
            <Button icon="archive" onClick={() => folderInput.current?.click()} disabled={!cfg}>Choose a folder</Button>
          </ButtonRow>
        </div>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          accept={cfg?.extensions.join(',')}
          onChange={(e) => {
            if (e.target.files?.length) addFiles(Array.from(e.target.files))
            e.target.value = ''
          }}
        />
        <input
          ref={(el) => {
            folderInput.current = el
            el?.setAttribute('webkitdirectory', '')
          }}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) addFiles(Array.from(e.target.files).filter((f) => !f.name.startsWith('.')))
            e.target.value = ''
          }}
        />
      </section>
      {skipped.length ? (
        <p className="banner-warn mx-skipped" role="status">
          Not uploaded (type not allowed): {skipped.slice(0, 8).join(', ')}
          {skipped.length > 8 ? ` and ${skipped.length - 8} more` : ''}.
        </p>
      ) : null}
      <UploadList queue={queue} />

      <div className="toolbar mx-toolbar">
        <SearchInput value={q} onChange={setQ} label="Search media by file name" placeholder="Search by file name" />
        <Select<MediaSort> size="sm" value={sort} onChange={setSort} options={SORT_OPTIONS} aria-label="Sort files" />
        <span className="spacer" />
        <Segmented<View>
          label="View"
          value={view}
          onChange={setView}
          options={[
            { value: 'grid', label: <span className="sr-only">Grid</span>, icon: 'media', title: 'Grid' },
            { value: 'list', label: <span className="sr-only">List</span>, icon: 'content', title: 'List' },
          ]}
        />
      </div>
      <Tabs<MediaKind | 'all'> label="File type" tabs={KIND_TABS()} value={kind || 'all'} onChange={(id) => setKind(id === 'all' ? '' : id)} className="mx-kinds" />
      {lib.error ? <p className="alert" role="alert">{lib.error}</p> : null}

      {lib.items === null ? (
        view === 'grid' ? <Skeleton kind="cards" rows={8} /> : <Skeleton kind="table" rows={6} />
      ) : shown.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="media"
            title={filtering ? 'No matching files' : 'No uploads yet'}
            action={filtering ? undefined : <Button variant="primary" icon="plus" onClick={() => fileInput.current?.click()} disabled={!cfg}>Upload files</Button>}
          >
            {lib.query ? `Nothing is named like “${lib.query}”${kind ? ` among ${KIND_PLURAL[kind].toLowerCase()}` : ''}.` : kind ? `No ${KIND_PLURAL[kind].toLowerCase()} yet.` : 'Drop files above or choose them from your computer.'}
          </EmptyState>
        </div>
      ) : view === 'list' ? (
        <div className="ops-table">
          <DataTable<MediaRecord>
            rows={shown}
            columns={columns}
            getRowId={(m) => m.id}
            caption="Media files"
            selectable
            selected={selected}
            onSelectedChange={setSelected}
            bulkActions={() => bulk}
            rowActionsLabel="File actions"
            rowActions={(m) => (
              <RowActions destructive={<RowAction tone="danger" icon="trash" onClick={() => void deleteFiles([m])} disabled={busy}>Delete</RowAction>}>
                <RowAction icon="copy" onClick={() => void copy(m.url)}>Copy URL</RowAction>
                <RowAction icon="link" onClick={() => setOpenId(m.id)}>Where used</RowAction>
              </RowActions>
            )}
            footer={<CursorPager shown={shown.length} hasMore={lib.hasMore} loading={lib.loadingMore} onMore={() => void lib.more()} noun="files" note={sortNote} />}
          />
        </div>
      ) : (
        <>
          <div className="mx-grid-head">
            <Checkbox checked={allTicked} indeterminate={selected.size > 0 && !allTicked} onChange={(c) => setSelected(c ? new Set(ids) : new Set())} label={allTicked ? 'Clear selection' : `Select all ${shown.length} shown`} />
          </div>
          <div className="media-grid">
            {shown.map((m) => (
              <MediaCard
                key={m.id}
                m={m}
                dims={dims}
                onImgLoad={onLoad(m.id)}
                ticked={selected.has(m.id)}
                onTick={(on) => toggle(m.id, on)}
                onOpen={() => setOpenId(m.id)}
                onCopy={() => void copy(m.url)}
                onDelete={() => void deleteFiles([m])}
                busy={busy}
              />
            ))}
          </div>
          <div className="card mx-pager">
            <CursorPager shown={shown.length} hasMore={lib.hasMore} loading={lib.loadingMore} onMore={() => void lib.more()} noun="files" note={sortNote} />
          </div>
          {selected.size > 0 ? (
            <div className="ui-bulkbar" role="region" aria-label="Bulk actions">
              <span className="count" aria-live="polite">{selected.size} selected</span>
              {bulk}
              <button type="button" className="btn ghost small pill" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          ) : null}
        </>
      )}

      {open ? <MediaDrawer m={open} dims={dims} onImgLoad={onLoad(open.id)} onClose={closeDrawer} onCopy={() => void copy(open.url)} onDelete={() => void deleteFiles([open])} busy={busy} /> : null}
    </>
  )
}

export default MediaPage

/* ------------------------------------------------------------------ */

function MediaCard({
  m,
  dims,
  onImgLoad,
  ticked,
  onTick,
  onOpen,
  onCopy,
  onDelete,
  busy,
}: {
  m: MediaRecord
  dims: Dims
  onImgLoad: ReturnType<ReturnType<typeof useImageDims>['onLoad']>
  ticked: boolean
  onTick: (on: boolean) => void
  onOpen: () => void
  onCopy: () => void
  onDelete: () => void
  busy: boolean
}) {
  const kind = kindOf(m)
  const d = dims[m.id]
  return (
    <article className={`media-card mx-card${ticked ? ' is-ticked' : ''}`}>
      <div className="thumb">
        <MediaThumb m={m} onLoad={onImgLoad} iconSize={36} />
        <span className="mx-tick">
          <Checkbox checked={ticked} onChange={onTick} label={`Select ${m.filename}`} labelHidden />
        </span>
      </div>
      <div className="meta">
        <button type="button" className="mx-linkish name" onClick={onOpen} title={m.filename}>{m.filename}</button>
        <span className="muted small">
          {KIND_LABEL[kind]} · {formatBytes(m.size)}
          {d ? ` · ${d.w} × ${d.h}` : ''}
        </span>
        <span className="muted small">
          {m.folder} · <time dateTime={m.createdAt} title={formatDate(m.createdAt)}>{formatRelative(m.createdAt)}</time>
        </span>
      </div>
      <div className="actions">
        <RowAction icon="copy" onClick={onCopy}>Copy URL</RowAction>
        <RowAction icon="link" onClick={onOpen}>Where used</RowAction>
        <span className="spacer" />
        <RowAction tone="danger" icon="trash" onClick={onDelete} disabled={busy} aria-label={`Delete ${m.filename}`} title="Delete" />
      </div>
    </article>
  )
}

/* ------------------------------------------------------------------ */

function MediaDrawer({
  m,
  dims,
  onImgLoad,
  onClose,
  onCopy,
  onDelete,
  busy,
}: {
  m: MediaRecord
  dims: Dims
  onImgLoad: ReturnType<ReturnType<typeof useImageDims>['onLoad']>
  onClose: () => void
  onCopy: () => void
  onDelete: () => void
  busy: boolean
}) {
  const [usage, setUsage] = useState<MediaUsage | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    setUsage(null)
    setError('')
    api
      .mediaUsage(m.id)
      .then((u) => alive && setUsage(u))
      .catch((e) => alive && setError(errMsg(e)))
    return () => {
      alive = false
    }
  }, [m.id])
  const kind = kindOf(m)
  const href = safeUrl(m.url, 'link')
  const n = usageCount(usage)

  let stage
  if (kind === 'video') {
    const src = safeUrl(m.url, 'video')
    stage = src ? <video src={src} controls preload="metadata" playsInline /> : null
  } else if (kind === 'audio') {
    const src = safeUrl(m.url, 'audio')
    stage = src ? <audio src={src} controls preload="none" className="mx-preview-audio" /> : null
  } else stage = <MediaThumb m={m} onLoad={onImgLoad} iconSize={48} />

  return (
    <Drawer
      title={m.filename}
      description={`${KIND_LABEL[kind]} · ${formatBytes(m.size)}`}
      onClose={onClose}
      footer={
        <ButtonRow destructive={<Button variant="danger" icon="trash" onClick={onDelete} loading={busy}>Delete</Button>}>
          <Button icon="copy" onClick={onCopy}>Copy URL</Button>
          {href ? (
            <Button href={href} target="_blank" rel="noreferrer" icon="external">
              Open<span className="sr-only"> (opens in a new tab)</span>
            </Button>
          ) : null}
        </ButtonRow>
      }
    >
      <div className={`mx-preview-stage drawer${kind === 'audio' ? ' audio' : ''}`}>{stage}</div>
      <dl className="mx-facts">
        <dt>Type</dt>
        <dd>{KIND_LABEL[kind]} <span className="muted">({m.mime})</span></dd>
        <dt>Size</dt>
        <dd>{formatBytes(m.size)}</dd>
        {kind === 'image' ? (
          <>
            <dt>Pixels</dt>
            <dd>{dimsText(dims[m.id]) || '–'}</dd>
          </>
        ) : null}
        <dt>Folder</dt>
        <dd>{m.folder}</dd>
        <dt>Added</dt>
        <dd>{formatDate(m.createdAt)}</dd>
        <dt>Address</dt>
        <dd className="mono mx-url">{m.url}</dd>
      </dl>

      <h3 className="mx-section-title">Where used</h3>
      {error ? (
        <p className="alert" role="alert">{error}</p>
      ) : usage === null ? (
        <Skeleton kind="list" rows={3} />
      ) : n === 0 ? (
        <p className="muted" style={{ margin: 0 }}>Nothing in this museum’s exhibitions or maker profiles uses this file.</p>
      ) : (
        <>
          <p className="muted small" style={{ margin: '0 0 8px' }}>{plural(n, 'place')}</p>
          <ul className="mx-usage">
            {usage.usage.map((u) => (
              <li key={`${u.exhibitionId}/${u.collection}/${u.id}/${u.field}`}>
                <a
                  href={`#/content/${u.collection}/${encodeURIComponent(u.id)}`}
                  onClick={() => setSelectedExhibition(u.exhibitionId)}
                >
                  <Icon name="content" />
                  <span className="grow">
                    <span className="truncate" style={{ display: 'block', fontWeight: 500 }}>{u.title || u.id}</span>
                    <span className="muted small">
                      {COLLECTION_LABEL[u.collection] ?? u.collection} · {u.exhibitionTitle} · field <span className="mono">{u.field}</span>
                    </span>
                  </span>
                  <Icon name="chevronRight" />
                </a>
              </li>
            ))}
            {usage.artisans.map((a) => (
              <li key={`maker/${a.id}`}>
                <a href={`#/makers/${encodeURIComponent(a.id)}`}>
                  <Icon name="makers" />
                  <span className="grow">
                    <span className="truncate" style={{ display: 'block', fontWeight: 500 }}>{a.name || a.id}</span>
                    <span className="muted small">Maker portrait</span>
                  </span>
                  <Icon name="chevronRight" />
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </Drawer>
  )
}
