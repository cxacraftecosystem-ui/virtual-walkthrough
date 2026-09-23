/**
 * Media library browser in a modal: thumbnails, search, drag-and-drop upload with progress.
 * Used by content forms (image / video / model / audio fields) — `onPick(url)` fills the field.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, uploadMedia, type MediaConfig, type MediaRecord } from './api'
import { EmptyState, Modal, Skeleton, errMsg, formatBytes } from './ui'

export type MediaAccept = 'image' | 'model' | 'video' | 'audio'

export const mediaMatches = (m: Pick<MediaRecord, 'mime' | 'filename'>, accept?: MediaAccept) => {
  if (!accept) return true
  if (accept === 'model') return m.mime.startsWith('model/') || /\.(glb|gltf)$/i.test(m.filename)
  return m.mime.startsWith(`${accept}/`)
}

const ACCEPT_LABEL: Record<MediaAccept, string> = { image: 'image', model: '3D model', video: 'video', audio: 'audio file' }
const ACCEPT_EXT: Record<MediaAccept, RegExp> = {
  image: /\.(jpe?g|png|webp|avif|gif|svg|ktx2)$/i,
  model: /\.(glb|gltf)$/i,
  video: /\.(mp4|webm|mov|m4v)$/i,
  audio: /\.(mp3|ogg|wav|m4a|aac)$/i,
}

export function MediaThumb({ m }: { m: Pick<MediaRecord, 'mime' | 'url' | 'filename'> }) {
  if (m.mime.startsWith('image/')) return <img src={m.url} alt="" loading="lazy" />
  if (m.mime.startsWith('video/')) return <video src={`${m.url}#t=0.5`} preload="metadata" muted playsInline />
  return <span className="ext">{m.filename.split('.').pop()}</span>
}

export function MediaPicker({ accept, value, onPick, onClose }: { accept?: MediaAccept; value?: string; onPick: (url: string) => void; onClose: () => void }) {
  const [items, setItems] = useState<MediaRecord[] | null>(null)
  const [cfg, setCfg] = useState<MediaConfig | null>(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [over, setOver] = useState(false)
  const [uploads, setUploads] = useState<{ id: number; name: string; progress: number; error?: string }[]>([])
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.media().then(setItems).catch((e) => setError(errMsg(e)))
    api.mediaConfig().then(setCfg).catch(() => undefined)
  }, [])

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (items ?? []).filter((m) => (showAll || mediaMatches(m, accept)) && (!s || m.filename.toLowerCase().includes(s) || m.url.toLowerCase().includes(s)))
  }, [items, q, accept, showAll])

  async function upload(files: FileList | File[]) {
    if (!cfg) return
    for (const file of Array.from(files)) {
      const id = Date.now() + Math.random()
      setUploads((u) => [...u, { id, name: file.name, progress: 0 }])
      const patch = (p: Partial<{ progress: number; error: string }>) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, ...p } : x)))
      try {
        const rec = await uploadMedia(file, '', cfg, (progress) => patch({ progress }))
        setItems((list) => [rec, ...(list ?? [])])
        setUploads((u) => u.filter((x) => x.id !== id))
        if (files.length === 1 && mediaMatches(rec, accept)) onPick(rec.url)
      } catch (e) {
        patch({ error: errMsg(e) })
      }
    }
  }

  const kind = accept ? ACCEPT_LABEL[accept] : 'file'
  const acceptAttr = accept ? cfg?.extensions.filter((e) => ACCEPT_EXT[accept].test(e)).join(',') : cfg?.extensions.join(',')

  return (
    <Modal
      title={`Choose ${/^[aeiou]/i.test(kind) ? 'an' : 'a'} ${kind}`}
      size="large"
      onClose={onClose}
      footer={
        <>
          {accept && (
            <label className="check small">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show all file types
            </label>
          )}
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>Cancel</button>
        </>
      }
    >
      <div
        className={`picker-drop ${over ? 'over' : ''}`}
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
        <input type="search" placeholder={`Search ${items ? items.length : ''} files…`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search media" data-autofocus />
        <button className="btn" onClick={() => input.current?.click()} disabled={!cfg}>Upload…</button>
        <input
          ref={input}
          type="file"
          hidden
          multiple
          accept={acceptAttr}
          onChange={(e) => {
            if (e.target.files?.length) void upload(e.target.files)
            e.target.value = ''
          }}
        />
        <span className="muted small picker-drop-hint">or drop files anywhere here</span>
      </div>
      {uploads.map((u) => (
        <div className="upload-row" key={u.id}>
          <span className="truncate" title={u.error}>{u.name}{u.error && <span className="danger-text"> — {u.error}</span>}</span>
          <div className="progress"><div style={{ width: `${Math.round(u.progress * 100)}%` }} className={u.error ? 'failed' : ''} /></div>
          <span className="muted num">{u.error ? 'failed' : `${Math.round(u.progress * 100)}%`}</span>
        </div>
      ))}
      {error && <p className="alert">{error}</p>}
      {!items && !error ? (
        <Skeleton kind="cards" rows={8} />
      ) : shown.length === 0 ? (
        <EmptyState title={q ? 'No matching files' : `No ${kind}s in the library yet`}>Upload one above, or close this and type a path under /public.</EmptyState>
      ) : (
        <div className="picker-grid" role="listbox" aria-label="Media files">
          {shown.map((m) => (
            <button
              key={m.id}
              role="option"
              aria-selected={m.url === value}
              className={`picker-item ${m.url === value ? 'selected' : ''}`}
              onClick={() => onPick(m.url)}
              title={m.url}
            >
              <span className="thumb"><MediaThumb m={m} /></span>
              <span className="name">{m.filename}</span>
              <span className="muted small">{m.folder} · {formatBytes(m.size)}</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}
