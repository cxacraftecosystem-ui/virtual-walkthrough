/**
 * Admin "Deep zoom" pipeline: photo → DZI pyramid (Web Worker) → parallel tile upload →
 * server-written image.dzi + one media record. Server side: src/server/handlers/deepzoom.ts.
 *
 * Upload flow per storage driver (GET /api/admin/media/config → directUpload):
 *   S3     batch-presign 200 tile paths at a time, then PUT each tile straight to the bucket
 *   disk   POST each tile body to /api/admin/media/deepzoom/tile
 * Tiles are uploaded while the worker is still producing them (bounded queue, 6 in flight,
 * 3 retries each).
 */
import type { DziInfo } from '../../museum/deepzoom/dzi'
import { ApiError, type MediaRecord } from '../api'
import { MAX_CANVAS_SIDE, type TileOptions } from './dziTiler'

export interface DeepZoomProgress {
  phase: 'decoding' | 'tiling' | 'finishing' | 'done'
  tilesMade: number
  tilesUploaded: number
  total: number
  bytes: number
  info?: DziInfo
  originalWidth?: number
  originalHeight?: number
  scaled?: boolean
}

export interface DeepZoomOptions extends TileOptions {
  maxSide?: number
  concurrency?: number
  signal?: AbortSignal
}

async function json<T>(method: string, url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method, credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const data = (res.headers.get('content-type') ?? '').includes('json') ? await res.json() : null
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? res.statusText)
  return data as T
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Tile {
  path: string
  blob: Blob
}

/** Tile + upload a photo; resolves with the media record of the pyramid (url = …/image.dzi). */
export async function createDeepZoom(file: File, opts: DeepZoomOptions, onProgress: (p: DeepZoomProgress) => void): Promise<MediaRecord> {
  const format = opts.format ?? 'jpg'
  const quality = opts.quality ?? 0.85
  const concurrency = opts.concurrency ?? 6
  const worker = new Worker(new URL('./dziTiler.worker.ts', import.meta.url), { type: 'module' })
  const progress: DeepZoomProgress = { phase: 'decoding', tilesMade: 0, tilesUploaded: 0, total: 0, bytes: 0 }
  const emit = () => onProgress({ ...progress })
  emit()

  const queue: Tile[] = []
  let produced = false
  let failure: unknown = null
  const waiters: (() => void)[] = []
  const poke = () => {
    while (waiters.length) waiters.shift()!()
  }

  let infoResolve!: (v: { info: DziInfo; total: number }) => void
  let infoReject!: (e: unknown) => void
  const infoP = new Promise<{ info: DziInfo; total: number }>((res, rej) => {
    infoResolve = res
    infoReject = rej
  })

  worker.onmessage = (e: MessageEvent) => {
    const m = e.data
    if (m.type === 'info') {
      progress.phase = 'tiling'
      progress.info = m.info
      progress.total = m.total
      progress.originalWidth = m.originalWidth
      progress.originalHeight = m.originalHeight
      progress.scaled = m.scaled
      emit()
      infoResolve({ info: m.info, total: m.total })
    } else if (m.type === 'tile') {
      queue.push({ path: m.path, blob: m.blob })
      progress.tilesMade++
      poke()
    } else if (m.type === 'done') {
      produced = true
      poke()
    } else if (m.type === 'error') {
      failure = new Error(`Could not tile the image: ${m.message}`)
      infoReject(failure)
      poke()
    }
  }
  worker.onerror = (e) => {
    failure = new Error(`Tiling worker failed: ${e.message || 'unknown error'}`)
    infoReject(failure)
    poke()
  }
  const abort = () => {
    failure ??= new DOMException('Cancelled', 'AbortError')
    infoReject(failure)
    poke()
  }
  opts.signal?.addEventListener('abort', abort)

  try {
    worker.postMessage({ type: 'start', file, options: { tileSize: opts.tileSize, overlap: opts.overlap, format, quality, background: opts.background, maxSide: opts.maxSide ?? MAX_CANVAS_SIDE } })
    const { info } = await infoP
    const start = await json<{ set: string; directUpload: boolean }>('POST', '/api/admin/media/deepzoom', { name: file.name, ...info })

    // presigned URL cache (S3)
    const presigned = new Map<string, { uploadUrl: string; method: string; headers: Record<string, string> }>()
    const presignBatch = async (paths: string[]) => {
      const r = await json<{ uploads: { path: string; uploadUrl: string; method: string; headers: Record<string, string> }[] }>(
        'POST',
        '/api/admin/media/deepzoom/presign',
        { set: start.set, paths },
      )
      for (const u of r.uploads) presigned.set(u.path, u)
    }

    const put = async (t: Tile) => {
      for (let attempt = 0; ; attempt++) {
        try {
          let res: Response
          if (start.directUpload) {
            let p = presigned.get(t.path)
            if (!p) {
              await presignBatch([t.path, ...queue.slice(0, 199).map((q) => q.path).filter((x) => !presigned.has(x))])
              p = presigned.get(t.path)!
            }
            res = await fetch(p.uploadUrl, { method: p.method, headers: p.headers, body: t.blob })
            presigned.delete(t.path)
          } else {
            res = await fetch(`/api/admin/media/deepzoom/tile?set=${encodeURIComponent(start.set)}&path=${encodeURIComponent(t.path)}`, {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'content-type': t.blob.type || 'image/jpeg' },
              body: t.blob,
            })
          }
          if (!res.ok) {
            let msg = `HTTP ${res.status}`
            try {
              msg = ((await res.json()) as { error?: string }).error ?? msg
            } catch {
              /* not JSON (S3 XML) */
            }
            // 4xx other than timeouts/rate limits will not get better by retrying
            if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) throw new ApiError(res.status, `${t.path}: ${msg}`)
            throw new Error(`${t.path}: ${msg}`)
          }
          return
        } catch (err) {
          if (err instanceof ApiError || attempt >= 3 || opts.signal?.aborted) throw err
          await sleep(400 * 2 ** attempt)
        }
      }
    }

    const loop = async () => {
      try {
        for (;;) {
          if (failure) throw failure
          const t = queue.shift()
          if (!t) {
            if (produced) return
            await new Promise<void>((r) => waiters.push(r))
            continue
          }
          worker.postMessage({ type: 'ack', n: 1 })
          await put(t)
          progress.tilesUploaded++
          progress.bytes += t.blob.size
          emit()
        }
      } catch (err) {
        failure ??= err
        poke()
        throw err
      }
    }
    await Promise.all(Array.from({ length: concurrency }, loop))
    if (failure) throw failure

    progress.phase = 'finishing'
    emit()
    const rec = await json<MediaRecord>('POST', '/api/admin/media/deepzoom/complete', {
      set: start.set,
      filename: file.name.replace(/\.[a-z0-9]+$/i, '') + ' (deep zoom)',
      ...info,
      bytes: progress.bytes,
    })
    progress.phase = 'done'
    emit()
    return rec
  } finally {
    opts.signal?.removeEventListener('abort', abort)
    worker.terminate()
  }
}
