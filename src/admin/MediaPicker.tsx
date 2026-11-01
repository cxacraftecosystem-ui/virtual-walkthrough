/**
 * The media library's shared pieces, and the picker used by content and maker forms.
 *
 * - `MediaPicker`: a modal browser over the library — server-side search and type filter, paged
 *   ("Load more"), sort, a keyboard listbox grid (arrows move by cell and by row, Home/End, Enter
 *   picks), a preview of the highlighted file (audio and video play in place), and uploads (three at
 *   a time, with progress; a single upload that fits is picked straight away). `onPick(url)` fills the
 *   field.
 * - `useUploadQueue`, `UploadList`: parallel uploads with per-file progress and Retry (MediaPage too).
 * - `filesFromDrop`: the files of a drop, folders included (walked recursively).
 * - `kindOf`, `mediaMatches`, `MediaThumb`, `useImageDims`: type, thumbnail and pixel size helpers.
 *   Every address is checked with `safeUrl` before it is rendered.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type SyntheticEvent } from 'react'
import { api, uploadMedia, type MediaConfig, type MediaKind, type MediaRecord } from './api'
import { safeUrl } from './safeUrl'
import { Badge, Button, EmptyState, Icon, Modal, ProgressBar, SearchInput, Select, Skeleton, Tabs, errMsg, formatBytes, formatDate, type IconName } from './ui'
import './pages/operations.css'

export type MediaAccept = 'image' | 'model' | 'video' | 'audio'

/* ------------------------------------------------------------------ */
/* Kinds                                                               */
/* ------------------------------------------------------------------ */

const MODEL_EXT = /\.(glb|gltf)$/i

/** The library's five kinds (deep zoom pyramids count as images, like the server's filter). */
export function kindOf(m: Pick<MediaRecord, 'mime' | 'filename'> & { folder?: string }): MediaKind {
  if (m.mime.startsWith('image/') || m.folder === 'deepzoom') return 'image'
  if (m.mime.startsWith('model/') || MODEL_EXT.test(m.filename)) return 'model'
  if (m.mime.startsWith('video/')) return 'video'
  if (m.mime.startsWith('audio/')) return 'audio'
  return 'other'
}

export const mediaMatches = (m: Pick<MediaRecord, 'mime' | 'filename'>, accept?: MediaAccept) => {
  if (!accept) return true
  if (accept === 'model') return m.mime.startsWith('model/') || MODEL_EXT.test(m.filename)
  return m.mime.startsWith(`${accept}/`)
}

export const KIND_LABEL: Record<MediaKind, string> = { image: 'Image', model: '3D model', video: 'Video', audio: 'Audio', other: 'Other' }
export const KIND_PLURAL: Record<MediaKind, string> = { image: 'Images', model: '3D models', video: 'Video', audio: 'Audio', other: 'Other' }
export const KIND_ICON: Record<MediaKind, IconName> = { image: 'image', model: 'box', video: 'media', audio: 'file', other: 'file' }
const ACCEPT_LABEL: Record<MediaAccept, string> = { image: 'image', model: '3D model', video: 'video', audio: 'audio file' }
const ACCEPT_EXT: Record<MediaAccept, RegExp> = {
  image: /\.(jpe?g|png|webp|avif|gif|svg|ktx2)$/i,
  model: MODEL_EXT,
  video: /\.(mp4|webm|mov|m4v)$/i,
  audio: /\.(mp3|ogg|wav|m4a|aac)$/i,
}

export type MediaSort = 'newest' | 'name' | 'size'
export const SORT_OPTIONS: { value: MediaSort; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'size', label: 'Largest first' },
]
const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
/** The server pages newest-first; name and size order what has been loaded so far. */
export function sortMedia(items: MediaRecord[], sort: MediaSort): MediaRecord[] {
  if (sort === 'newest') return items
  const out = [...items]
  if (sort === 'name') out.sort((a, b) => nameCollator.compare(a.filename, b.filename))
  else out.sort((a, b) => b.size - a.size)
  return out
}

/* ------------------------------------------------------------------ */
/* Thumbnails and pixel sizes                                          */
/* ------------------------------------------------------------------ */

export type Dims = Record<string, { w: number; h: number }>

/** Pixel sizes learnt from thumbnails as they load: `onLoad(id)` goes on the <img>. */
export function useImageDims() {
  const [dims, setDims] = useState<Dims>({})
  const onLoad = useCallback(
    (id: string) => (e: SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget
      if (!img.naturalWidth) return
      setDims((d) => (d[id] ? d : { ...d, [id]: { w: img.naturalWidth, h: img.naturalHeight } }))
    },
    [],
  )
  return { dims, onLoad }
}
export const dimsText = (d?: { w: number; h: number }) => (d ? `${d.w.toLocaleString()} × ${d.h.toLocaleString()} px` : '')

/** A file's thumbnail: the picture, a video frame, or the kind's icon (3D files get the cube, no three.js). */
export function MediaThumb({ m, onLoad, iconSize = 28 }: { m: Pick<MediaRecord, 'mime' | 'url' | 'filename'> & { folder?: string }; onLoad?: (e: SyntheticEvent<HTMLImageElement>) => void; iconSize?: number }) {
  const kind = kindOf(m)
  if (m.mime.startsWith('image/')) {
    const src = safeUrl(m.url, 'image')
    if (src) return <img src={src} alt="" loading="lazy" decoding="async" onLoad={onLoad} />
  }
  if (kind === 'video') {
    const src = safeUrl(m.url, 'video')
    if (src) return <video src={`${src}#t=0.5`} preload="metadata" muted playsInline />
  }
  const ext = m.filename.split('.').pop() ?? ''
  return (
    <span className="mx-fileicon" data-kind={kind}>
      <Icon name={KIND_ICON[kind]} size={iconSize} />
      {ext && ext !== m.filename ? <span className="ext">{ext}</span> : null}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Drops (folders included)                                            */
/* ------------------------------------------------------------------ */

const readAll = (reader: FileSystemDirectoryReader) =>
  new Promise<FileSystemEntry[]>((resolve, reject) => {
    const out: FileSystemEntry[] = []
    const next = () =>
      reader.readEntries((batch) => {
        if (!batch.length) return resolve(out)
        out.push(...batch)
        next() // readEntries returns at most ~100 at a time
      }, reject)
    next()
  })
const fileOf = (entry: FileSystemFileEntry) => new Promise<File>((resolve, reject) => entry.file(resolve, reject))

async function walk(entry: FileSystemEntry, out: File[], depth = 0): Promise<void> {
  if (entry.name.startsWith('.')) return // .DS_Store and friends
  if (entry.isFile) {
    out.push(await fileOf(entry as FileSystemFileEntry))
  } else if (entry.isDirectory && depth < 12) {
    for (const child of await readAll((entry as FileSystemDirectoryEntry).createReader())) await walk(child, out, depth + 1)
  }
}

/** The files of a drop; dropped folders are walked. Call it from the drop handler (entries vanish after the event). */
export function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const entries = Array.from(dt.items ?? [])
    .filter((i) => i.kind === 'file')
    .map((i) => i.webkitGetAsEntry?.() ?? null)
  if (!entries.some((e) => e?.isDirectory)) return Promise.resolve(Array.from(dt.files))
  return (async () => {
    const out: File[] = []
    for (const e of entries) if (e) await walk(e, out)
    return out
  })()
}

/** Splits files into the ones the library accepts and the names it would refuse. */
export function splitAllowed(files: File[], cfg: MediaConfig | null, only?: MediaAccept) {
  const ok: File[] = []
  const skipped: string[] = []
  for (const f of files) {
    const ext = `.${f.name.split('.').pop()?.toLowerCase() ?? ''}`
    const allowed = (!cfg || cfg.extensions.includes(ext)) && (!only || ACCEPT_EXT[only].test(f.name))
    if (allowed) ok.push(f)
    else skipped.push(f.name)
  }
  return { ok, skipped }
}

/* ------------------------------------------------------------------ */
/* Upload queue                                                        */
/* ------------------------------------------------------------------ */

export interface UploadJob {
  id: number
  name: string
  size: number
  progress: number
  state: 'queued' | 'uploading' | 'done' | 'failed'
  error?: string
  /** How many files were added together (a single upload may be picked automatically). */
  batch: number
}
interface QueueEntry extends UploadJob {
  file: File
  folder: string
}

/**
 * Uploads `concurrency` files at a time, any number queued. `onUploaded(record, job)` runs per file.
 * While anything is in flight the browser asks before the tab is closed (moving between admin pages
 * does not stop an upload).
 */
export function useUploadQueue(cfg: MediaConfig | null, onUploaded: (rec: MediaRecord, job: UploadJob) => void, concurrency = 3) {
  const [jobs, setJobs] = useState<UploadJob[]>([])
  const queue = useRef<QueueEntry[]>([])
  const running = useRef(0)
  const seq = useRef(0)
  const live = useRef({ cfg, onUploaded })
  useEffect(() => {
    live.current = { cfg, onUploaded }
  })

  const publish = useCallback(
    () => setJobs(queue.current.map((j) => ({ id: j.id, name: j.name, size: j.size, progress: j.progress, state: j.state, error: j.error, batch: j.batch }))),
    [],
  )
  const patch = useCallback(
    (id: number, p: Partial<QueueEntry>) => {
      queue.current = queue.current.map((j) => (j.id === id ? { ...j, ...p } : j))
      publish()
    },
    [publish],
  )

  const pump = useCallback(() => {
    const c = live.current.cfg
    if (!c) return
    while (running.current < concurrency) {
      const next = queue.current.find((j) => j.state === 'queued')
      if (!next) break
      running.current++
      patch(next.id, { state: 'uploading', progress: 0, error: undefined })
      let shown = 0
      uploadMedia(next.file, next.folder, c, (f) => {
        if (f - shown >= 0.02 || f >= 1) {
          shown = f
          patch(next.id, { progress: f })
        }
      })
        .then((rec) => {
          patch(next.id, { state: 'done', progress: 1 })
          live.current.onUploaded(rec, next)
        })
        .catch((e: unknown) => patch(next.id, { state: 'failed', error: errMsg(e) }))
        .finally(() => {
          running.current--
          pump()
        })
    }
  }, [concurrency, patch])

  const add = useCallback(
    (files: File[], folder = '') => {
      if (!files.length) return
      const batch = files.length
      queue.current = [
        ...queue.current,
        ...files.map((file) => ({ id: ++seq.current, name: file.name, size: file.size, progress: 0, state: 'queued' as const, batch, file, folder })),
      ]
      publish()
      pump()
    },
    [publish, pump],
  )
  const retry = useCallback(
    (id: number) => {
      patch(id, { state: 'queued', progress: 0, error: undefined, batch: 0 })
      pump()
    },
    [patch, pump],
  )
  const retryFailed = useCallback(() => {
    queue.current = queue.current.map((j) => (j.state === 'failed' ? { ...j, state: 'queued', progress: 0, error: undefined, batch: 0 } : j))
    publish()
    pump()
  }, [publish, pump])
  const clearFinished = useCallback(() => {
    queue.current = queue.current.filter((j) => j.state !== 'done' && j.state !== 'failed')
    publish()
  }, [publish])

  // start anything queued before the config arrived
  useEffect(() => {
    if (cfg) pump()
  }, [cfg, pump])

  const counts = useMemo(() => {
    const c = { queued: 0, uploading: 0, done: 0, failed: 0 }
    for (const j of jobs) c[j.state]++
    return c
  }, [jobs])
  const active = counts.queued + counts.uploading > 0

  useEffect(() => {
    if (!active) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [active])

  return { jobs, counts, active, add, retry, retryFailed, clearFinished }
}

/** The queue as a list: every file with its progress; failed files name the reason and offer Retry. */
export function UploadList({ queue, compact = false }: { queue: ReturnType<typeof useUploadQueue>; compact?: boolean }) {
  const { jobs, counts, active, retry, retryFailed, clearFinished } = queue
  if (!jobs.length) return null
  const total = jobs.length
  const finished = counts.done + counts.failed
  return (
    <section className={`mx-uploads${compact ? ' compact' : ''}`} aria-label="Uploads">
      <div className="mx-uploads-head">
        <span aria-live="polite">
          <span className="num">{counts.done}</span> of <span className="num">{total}</span> uploaded
          {active ? <span className="muted"> · {counts.uploading} in progress{counts.queued ? `, ${counts.queued} waiting` : ''}</span> : null}
          {counts.failed ? <span className="danger-text"> · {counts.failed} failed</span> : null}
        </span>
        <span className="spacer" />
        {counts.failed > 1 ? (
          <Button size="sm" icon="refresh" onClick={retryFailed}>Retry failed</Button>
        ) : null}
        {finished > 0 ? (
          <Button size="sm" variant="ghost" onClick={clearFinished}>Clear finished</Button>
        ) : null}
      </div>
      <ul className="mx-upload-list">
        {jobs.map((j) => (
          <li key={j.id} className="upload-row" data-state={j.state}>
            <span className="mx-up-name">
              <span className="truncate" title={j.name}>{j.name}</span>
              {j.error ? <span className="danger-text small">{j.error}</span> : null}
            </span>
            {j.state === 'failed' ? (
              <Button size="sm" icon="refresh" onClick={() => retry(j.id)} aria-label={`Retry ${j.name}`}>Retry</Button>
            ) : (
              <ProgressBar value={j.progress * 100} label={`${j.name} upload progress`} done={j.state === 'done'} />
            )}
            <span className="num muted">{j.state === 'failed' ? 'Failed' : j.state === 'done' ? 'Done' : j.state === 'queued' ? 'Waiting' : `${Math.round(j.progress * 100)}%`}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Paged library loading                                               */
/* ------------------------------------------------------------------ */

export const PAGE_SIZE = 60

/**
 * One filtered view of the library, a page at a time. Changing `q` (debounced) or `kind` starts over;
 * a late answer to an older query is ignored. A failed "Load more" keeps what is shown.
 */
export function useMediaPages(q: string, kind: MediaKind | '') {
  const [items, setItems] = useState<MediaRecord[] | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const gen = useRef(0)
  const [debounced, setDebounced] = useState(q)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), q.trim() ? 250 : 0)
    return () => clearTimeout(t)
  }, [q])

  const reload = useCallback(() => {
    const g = ++gen.current
    setError('')
    api
      .mediaPage({ limit: PAGE_SIZE, q: debounced || undefined, kind: kind || undefined })
      .then((p) => {
        if (g !== gen.current) return
        setItems(p.items)
        setCursor(p.nextCursor)
      })
      .catch((e: unknown) => {
        if (g !== gen.current) return
        setError(errMsg(e))
        setItems((cur) => cur ?? [])
      })
  }, [debounced, kind])

  useEffect(() => {
    setItems(null)
    setCursor(null)
    reload()
  }, [reload])

  const more = useCallback(async () => {
    if (!cursor || loadingMore) return
    const g = gen.current
    setLoadingMore(true)
    try {
      const p = await api.mediaPage({ limit: PAGE_SIZE, cursor, q: debounced || undefined, kind: kind || undefined })
      if (g !== gen.current) return
      setItems((cur) => {
        const seen = new Set((cur ?? []).map((m) => m.id))
        return [...(cur ?? []), ...p.items.filter((m) => !seen.has(m.id))]
      })
      setCursor(p.nextCursor)
    } catch (e) {
      if (g === gen.current) setError(errMsg(e))
    } finally {
      setLoadingMore(false)
    }
  }, [cursor, loadingMore, debounced, kind])

  /** Put a fresh upload at the top (when it belongs to this view). */
  const prepend = useCallback(
    (rec: MediaRecord) => {
      if (kind && kindOf(rec) !== kind) return
      if (debounced && !rec.filename.toLowerCase().includes(debounced.toLowerCase())) return
      setItems((cur) => [rec, ...(cur ?? []).filter((m) => m.id !== rec.id)])
    },
    [kind, debounced],
  )
  const drop = useCallback((ids: string[]) => {
    const s = new Set(ids)
    setItems((cur) => (cur ?? []).filter((m) => !s.has(m.id)))
  }, [])

  return { items, hasMore: !!cursor, loadingMore, error, more, reload, prepend, drop, query: debounced }
}

export const KIND_TABS = (counts?: Partial<Record<MediaKind | '', number>>) =>
  ([['', 'All'], ['image', 'Images'], ['model', '3D models'], ['video', 'Video'], ['audio', 'Audio'], ['other', 'Other']] as [MediaKind | '', string][]).map(([id, label]) => ({
    id: (id || 'all') as MediaKind | 'all',
    label,
    count: counts?.[id] ?? undefined,
  }))

/* ------------------------------------------------------------------ */
/* Picker                                                              */
/* ------------------------------------------------------------------ */

/** Columns of a CSS grid as laid out right now (for ↑/↓ in the listbox). */
function gridColumns(el: HTMLElement | null) {
  if (!el) return 1
  const cols = getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length
  return Math.max(1, cols)
}

function Preview({ m, dims }: { m: MediaRecord; dims?: { w: number; h: number } }) {
  const kind = kindOf(m)
  let stage: ReactNode
  if (kind === 'audio') {
    const src = safeUrl(m.url, 'audio')
    stage = src ? <audio src={src} controls preload="none" className="mx-preview-audio" /> : null
  } else if (kind === 'video') {
    const src = safeUrl(m.url, 'video')
    stage = src ? <video src={src} controls preload="metadata" playsInline /> : null
  } else {
    stage = <MediaThumb m={m} iconSize={40} />
  }
  return (
    <div className="mx-preview">
      <div className={`mx-preview-stage${kind === 'audio' ? ' audio' : ''}`}>{stage}</div>
      <div className="mx-preview-meta">
        <strong className="truncate" title={m.filename}>{m.filename}</strong>
        <span className="muted small">
          {KIND_LABEL[kind]} · {formatBytes(m.size)}
          {dims ? ` · ${dimsText(dims)}` : ''}
        </span>
        <span className="muted small">
          {m.folder} · added {formatDate(m.createdAt)}
        </span>
      </div>
    </div>
  )
}

export function MediaPicker({ accept, value, onPick, onClose }: { accept?: MediaAccept; value?: string; onPick: (url: string) => void; onClose: () => void }) {
  const [cfg, setCfg] = useState<MediaConfig | null>(null)
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<MediaKind | ''>(accept ?? '')
  const [sort, setSort] = useState<MediaSort>('newest')
  const [over, setOver] = useState(false)
  const [skipped, setSkipped] = useState<string[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const { dims, onLoad } = useImageDims()
  const lib = useMediaPages(q, kind)
  const input = useRef<HTMLInputElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const baseId = useId()
  const optId = (id: string) => `${baseId}-o-${id}`

  useEffect(() => {
    api.mediaConfig().then(setCfg).catch(() => undefined)
  }, [])

  const pickRef = useRef(onPick)
  useEffect(() => {
    pickRef.current = onPick
  })
  const queue = useUploadQueue(cfg, (rec, job) => {
    lib.prepend(rec)
    setActiveId(rec.id)
    if (job.batch === 1 && mediaMatches(rec, accept)) pickRef.current(rec.url)
  })

  const shown = useMemo(() => sortMedia(lib.items ?? [], sort), [lib.items, sort])
  const active = shown.find((m) => m.id === activeId) ?? null

  // start on the current value once it is in view, else on nothing (the first arrow press picks the first)
  useEffect(() => {
    if (activeId || !value || !lib.items) return
    const cur = lib.items.find((m) => m.url === value || safeUrl(m.url, 'link') === safeUrl(value, 'link'))
    if (cur) setActiveId(cur.id)
  }, [lib.items, value, activeId])

  // keep the highlighted option visible
  useEffect(() => {
    if (!activeId) return
    document.getElementById(optId(activeId))?.scrollIntoView({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!shown.length) return
    const i = active ? shown.indexOf(active) : -1
    const cols = gridColumns(gridRef.current)
    let next: number
    switch (e.key) {
      case 'ArrowRight':
        next = Math.min(shown.length - 1, i + 1)
        break
      case 'ArrowLeft':
        next = Math.max(0, i < 0 ? 0 : i - 1)
        break
      case 'ArrowDown':
        next = i < 0 ? 0 : Math.min(shown.length - 1, i + cols)
        break
      case 'ArrowUp':
        next = i < 0 ? 0 : Math.max(0, i - cols)
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = shown.length - 1
        break
      case 'Enter':
        if (active) {
          e.preventDefault()
          onPick(active.url)
        }
        return
      default:
        return
    }
    e.preventDefault()
    setActiveId(shown[next].id)
    if (next >= shown.length - cols && lib.hasMore) void lib.more() // reached the last row: fetch the next page
  }

  const label = accept ? ACCEPT_LABEL[accept] : 'file'
  const acceptAttr = accept ? cfg?.extensions.filter((x) => ACCEPT_EXT[accept].test(x)).join(',') : cfg?.extensions.join(',')
  const addFiles = (files: File[]) => {
    const { ok, skipped: s } = splitAllowed(files, cfg)
    setSkipped(s)
    queue.add(ok)
  }
  const fits = !active || !accept || mediaMatches(active, accept)

  return (
    <Modal
      title={`Choose ${/^[aeiou]/i.test(label) ? 'an' : 'a'} ${label}`}
      size="large"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="check" disabled={!active} onClick={() => active && onPick(active.url)}>
            {active ? `Use ${fits ? 'this' : 'this file'}` : `Choose ${/^[aeiou]/i.test(label) ? 'an' : 'a'} ${label}`}
          </Button>
        </>
      }
    >
      <div
        className={`mx-picker${over ? ' over' : ''}`}
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
        <div className="toolbar mx-picker-tools">
          <SearchInput
            value={q}
            onChange={setQ}
            label="Search the media library by file name"
            placeholder="Search by file name"
            shortcutHint={false}
            data-autofocus
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' && shown.length) {
                e.preventDefault()
                if (!activeId) setActiveId(shown[0].id)
                gridRef.current?.focus()
              }
            }}
          />
          <Select<MediaSort> size="sm" value={sort} onChange={setSort} options={SORT_OPTIONS} aria-label="Sort files" />
          <span className="spacer" />
          <Button icon="plus" onClick={() => input.current?.click()} disabled={!cfg}>Upload</Button>
          <input
            ref={input}
            type="file"
            hidden
            multiple
            accept={acceptAttr}
            onChange={(e) => {
              if (e.target.files?.length) addFiles(Array.from(e.target.files))
              e.target.value = ''
            }}
          />
        </div>
        <Tabs<MediaKind | 'all'>
          label="File type"
          tabs={KIND_TABS()}
          value={kind || 'all'}
          onChange={(id) => {
            setKind(id === 'all' ? '' : id)
            setActiveId(null)
          }}
        />
        <p className="muted small mx-drop-hint">Drop files here to upload them{accept ? `; a single ${label} is chosen as soon as it arrives` : ''}.</p>
        {skipped.length ? (
          <p className="banner-warn" role="status">
            Not uploaded (type not allowed): {skipped.slice(0, 6).join(', ')}
            {skipped.length > 6 ? ` and ${skipped.length - 6} more` : ''}.
          </p>
        ) : null}
        <UploadList queue={queue} compact />
        {lib.error ? <p className="alert" role="alert">{lib.error}</p> : null}

        <div className="mx-picker-body">
          <div className="mx-picker-list">
            {lib.items === null ? (
              <Skeleton kind="cards" rows={8} />
            ) : shown.length === 0 ? (
              <EmptyState title={lib.query ? 'No matching files' : kind ? `No ${KIND_PLURAL[kind].toLowerCase()} in the library yet` : 'The library is empty'} icon="media" as="h3">
                {lib.query ? `Nothing is named like “${lib.query}”.` : 'Upload one, or close this and type the address of a file already on the site.'}
              </EmptyState>
            ) : (
              <>
                <div
                  ref={gridRef}
                  className="picker-grid mx-listbox"
                  role="listbox"
                  aria-label="Media files"
                  tabIndex={0}
                  aria-activedescendant={active ? optId(active.id) : undefined}
                  onKeyDown={onGridKey}
                  onFocus={() => {
                    if (!activeId && shown.length) setActiveId(shown[0].id)
                  }}
                >
                  {shown.map((m) => {
                    const isActive = m.id === activeId
                    const isCurrent = !!value && m.url === value
                    return (
                      <div
                        key={m.id}
                        id={optId(m.id)}
                        role="option"
                        aria-selected={isActive}
                        className={`picker-item${isActive ? ' selected' : ''}`}
                        onClick={() => setActiveId(m.id)}
                        onDoubleClick={() => onPick(m.url)}
                        title={m.filename}
                      >
                        <span className="thumb"><MediaThumb m={m} onLoad={onLoad(m.id)} /></span>
                        <span className="name">{m.filename}</span>
                        <span className="muted small">
                          {formatBytes(m.size)}
                          {dims[m.id] ? ` · ${dims[m.id].w}×${dims[m.id].h}` : ''}
                        </span>
                        {isCurrent ? <span className="mx-current"><Badge tone="info">Current</Badge></span> : null}
                      </div>
                    )
                  })}
                </div>
                <div className="mx-picker-more">
                  <span className="muted small">
                    {shown.length.toLocaleString()} {shown.length === 1 ? 'file' : 'files'}
                    {lib.hasMore ? ' shown — more in the library' : ''}
                    {sort !== 'newest' && lib.hasMore ? ' · sorted among those shown' : ''}
                  </span>
                  {lib.hasMore ? (
                    <Button size="sm" loading={lib.loadingMore} loadingLabel="Loading…" onClick={() => void lib.more()}>Load more</Button>
                  ) : null}
                </div>
                <p className="sr-only">Use the arrow keys to move between files and Enter to choose one.</p>
              </>
            )}
          </div>
          {active ? (
            <aside className="mx-picker-side" aria-label="Preview">
              <Preview m={active} dims={dims[active.id]} />
              {!fits ? <p className="banner-warn small" style={{ margin: 0 }}>This isn’t {/^[aeiou]/i.test(label) ? 'an' : 'a'} {label}.</p> : null}
            </aside>
          ) : null}
        </div>
      </div>
    </Modal>
  )
}
