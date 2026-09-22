import { useCallback, useEffect, useRef, useState } from 'react'
import { api, uploadMedia, type MediaConfig, type MediaRecord } from '../api'
import { errMsg, formatBytes, formatDate, useToast } from '../ui'

interface UploadJob {
  id: number
  name: string
  progress: number
  error?: string
  done?: boolean
}

export function MediaPage() {
  const [cfg, setCfg] = useState<MediaConfig | null>(null)
  const [items, setItems] = useState<MediaRecord[] | null>(null)
  const [error, setError] = useState('')
  const [folder, setFolder] = useState('')
  const [filter, setFilter] = useState('')
  const [jobs, setJobs] = useState<UploadJob[]>([])
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const toast = useToast()

  const load = useCallback(() => {
    api.media().then(setItems).catch((e) => setError(errMsg(e)))
  }, [])

  useEffect(() => {
    api.mediaConfig().then(setCfg).catch((e) => setError(errMsg(e)))
    load()
  }, [load])

  async function upload(files: FileList | File[]) {
    if (!cfg) return
    for (const file of Array.from(files)) {
      const id = Date.now() + Math.random()
      setJobs((j) => [{ id, name: file.name, progress: 0 }, ...j])
      const patch = (p: Partial<UploadJob>) => setJobs((j) => j.map((x) => (x.id === id ? { ...x, ...p } : x)))
      try {
        const rec = await uploadMedia(file, folder, cfg, (progress) => patch({ progress }))
        patch({ progress: 1, done: true })
        setItems((list) => [rec, ...(list ?? [])])
      } catch (e) {
        patch({ error: errMsg(e) })
      }
    }
  }

  async function remove(m: MediaRecord) {
    if (!window.confirm(`Delete ${m.filename}? Content that references ${m.url} will show a missing file.`)) return
    try {
      await api.deleteMedia(m.id)
      setItems((list) => (list ?? []).filter((x) => x.id !== m.id))
      toast('Deleted')
    } catch (e) {
      toast(errMsg(e), 'error')
    }
  }

  async function copy(url: string) {
    const abs = url.startsWith('/') ? window.location.origin + url : url
    try {
      await navigator.clipboard.writeText(url)
      toast(`Copied ${url.length > 60 ? url.slice(0, 57) + '…' : url}`)
    } catch {
      window.prompt('Copy this URL', abs)
    }
  }

  const shown = (items ?? []).filter((m) => {
    const q = filter.trim().toLowerCase()
    return !q || m.filename.toLowerCase().includes(q) || m.folder.includes(q) || m.url.toLowerCase().includes(q)
  })

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Media library</h1>
          <p className="muted">
            Upload images, 3D models, video and audio, then paste the URL into a content item.
            {cfg && (
              <>
                {' '}Storage: <strong>{cfg.driver === 's3' ? 'S3 (direct upload)' : 'local disk'}</strong> · max {formatBytes(cfg.maxBytes)}.
              </>
            )}
          </p>
        </div>
      </div>
      {error && <p className="alert">{error}</p>}

      <section
        className={`upload-zone ${over ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          if (e.dataTransfer.files.length) void upload(e.dataTransfer.files)
        }}
      >
        <div className="row" style={{ justifyContent: 'center' }}>
          <label className="field" style={{ width: 200 }}>
            <span>Folder</span>
            <select value={folder} onChange={(e) => setFolder(e.target.value)}>
              <option value="">Automatic (by file type)</option>
              {cfg?.folders.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </label>
          <button className="btn primary" style={{ alignSelf: 'flex-end' }} onClick={() => input.current?.click()} disabled={!cfg}>
            Choose files…
          </button>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            accept={cfg?.extensions.join(',')}
            onChange={(e) => {
              if (e.target.files?.length) void upload(e.target.files)
              e.target.value = ''
            }}
          />
        </div>
        <p className="muted small" style={{ margin: '10px 0 0' }}>
          …or drop files here. Allowed: {cfg?.extensions.map((e) => e.slice(1)).join(', ') ?? '…'}
        </p>
        {jobs.length > 0 && (
          <div className="uploads">
            {jobs.slice(0, 6).map((j) => (
              <div className="upload-row" key={j.id}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={j.error}>
                  {j.name} {j.error && <span style={{ color: 'var(--danger)' }}>— {j.error}</span>}
                </span>
                <div className="progress" aria-label={`${j.name} upload progress`}>
                  <div style={{ width: `${Math.round(j.progress * 100)}%`, background: j.error ? 'var(--danger)' : undefined }} />
                </div>
                <span className="muted" style={{ textAlign: 'right' }}>{j.error ? 'failed' : j.done ? 'done' : `${Math.round(j.progress * 100)}%`}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="row" style={{ margin: '20px 0 12px' }}>
        <h2 style={{ fontSize: 15 }}>{items ? `${items.length} file${items.length === 1 ? '' : 's'}` : 'Loading…'}</h2>
        <span className="spacer" />
        <input type="search" placeholder="Filter by name or folder…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 260 }} aria-label="Filter media" />
      </div>

      {items && items.length === 0 && <div className="card empty">No uploads yet. Files in /public (e.g. /artworks/hero-01.jpg) can also be used directly.</div>}
      <div className="media-grid">
        {shown.map((m) => (
          <article className="media-card" key={m.id}>
            <div className="thumb">
              {m.mime.startsWith('image/') ? (
                <img src={m.url} alt={m.filename} loading="lazy" />
              ) : m.mime.startsWith('video/') ? (
                <video src={m.url} preload="metadata" muted playsInline controls />
              ) : m.mime.startsWith('audio/') ? (
                <audio src={m.url} controls preload="none" style={{ width: '90%' }} />
              ) : (
                <span className="ext">{m.filename.split('.').pop()}</span>
              )}
            </div>
            <div className="meta">
              <span className="name" title={m.filename}>{m.filename}</span>
              <span className="muted small">{m.folder} · {formatBytes(m.size)}</span>
              <span className="muted small">{formatDate(m.createdAt)}</span>
              <span className="mono muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.url}>{m.url}</span>
            </div>
            <div className="actions">
              <button className="btn small" onClick={() => copy(m.url)}>Copy URL</button>
              <a className="btn small ghost" href={m.url} target="_blank" rel="noreferrer">Open</a>
              <span className="spacer" />
              <button className="btn small danger" onClick={() => remove(m)}>Delete</button>
            </div>
          </article>
        ))}
      </div>
    </>
  )
}
