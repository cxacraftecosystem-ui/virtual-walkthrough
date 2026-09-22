import 'server-only'
import { randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web'
import Busboy from 'busboy'
import { config } from '../config'
import { type Db, nowIso } from '../db'
import { route } from '../http'
import { getStorage } from '../services'
import { LocalDiskStorage, type StorageDriver } from '../storage'
import { fail, HttpError, isRecord } from '../util'

export const MEDIA_FOLDERS = ['artworks', 'models', 'videos', 'audio', 'textures'] as const
type Folder = (typeof MEDIA_FOLDERS)[number]

/** Extension allow-list → canonical MIME type + default folder. */
const TYPES: Record<string, { mime: string; folder: Folder }> = {
  '.jpg': { mime: 'image/jpeg', folder: 'artworks' },
  '.jpeg': { mime: 'image/jpeg', folder: 'artworks' },
  '.png': { mime: 'image/png', folder: 'artworks' },
  '.webp': { mime: 'image/webp', folder: 'artworks' },
  '.glb': { mime: 'model/gltf-binary', folder: 'models' },
  '.gltf': { mime: 'model/gltf+json', folder: 'models' },
  '.mp4': { mime: 'video/mp4', folder: 'videos' },
  '.webm': { mime: 'video/webm', folder: 'videos' },
  '.mp3': { mime: 'audio/mpeg', folder: 'audio' },
  '.ogg': { mime: 'audio/ogg', folder: 'audio' },
  '.wav': { mime: 'audio/wav', folder: 'audio' },
  '.m4a': { mime: 'audio/mp4', folder: 'audio' },
}
export const MIME_BY_EXT: Record<string, string> = Object.fromEntries(Object.entries(TYPES).map(([e, t]) => [e, t.mime]))
const EXT_LIST = Object.keys(TYPES).map((e) => e.slice(1)).join(', ')
const KEY_RE = new RegExp(`^(${MEDIA_FOLDERS.join('|')})/([a-z0-9-]{1,60}-[0-9a-f]{8}(${Object.keys(TYPES).map((e) => '\\' + e).join('|')}))$`)
const TOO_LARGE = `File too large (max ${Math.round(config.maxUploadBytes / 1048576)} MB)`

interface MediaRow {
  id: string
  folder: string
  stored_name: string
  filename: string
  mime: string
  size: number
  created_at: string
}

/** Resolve type + folder + unique key for an upload, or throw 4xx. */
function plan(filename: string, requestedFolder: unknown) {
  const ext = path.extname(filename).toLowerCase()
  const type = TYPES[ext]
  if (!type) return fail(415, `File type "${ext || '?'}" not allowed (${EXT_LIST})`)
  let folder: Folder = type.folder
  if (requestedFolder !== undefined && requestedFolder !== null && requestedFolder !== '') {
    if (typeof requestedFolder !== 'string' || !(MEDIA_FOLDERS as readonly string[]).includes(requestedFolder)) {
      return fail(400, `Invalid folder (one of ${MEDIA_FOLDERS.join(', ')})`)
    }
    folder = requestedFolder as Folder
  }
  const base =
    path
      .basename(filename, path.extname(filename))
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'file'
  const storedName = `${base}-${randomBytes(4).toString('hex')}${ext}`
  return { folder, storedName, key: `${folder}/${storedName}`, mime: type.mime }
}

const toRecord = (storage: StorageDriver, r: MediaRow) => ({
  id: r.id,
  url: storage.urlFor(`${r.folder}/${r.stored_name}`),
  filename: r.filename,
  folder: r.folder,
  mime: r.mime,
  size: Number(r.size),
  createdAt: r.created_at,
})

async function record(db: Db, storage: StorageDriver, folder: string, storedName: string, filename: string, mime: string, size: number) {
  const row: MediaRow = { id: randomUUID(), folder, stored_name: storedName, filename: filename.slice(0, 255), mime, size, created_at: nowIso() }
  await db.run('INSERT INTO media (id, folder, stored_name, filename, mime, size, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
    row.id,
    row.folder,
    row.stored_name,
    row.filename,
    row.mime,
    row.size,
    row.created_at,
  ])
  return toRecord(storage, row)
}

/** GET /api/admin/media/config — tells the admin UI which upload flow to use. */
export const mediaConfig = route(async (c) => {
  await c.requireAdmin()
  return {
    driver: c.storage.kind,
    directUpload: typeof c.storage.presignPut === 'function',
    maxBytes: config.maxUploadBytes,
    folders: MEDIA_FOLDERS,
    extensions: Object.keys(TYPES),
  }
})

/**
 * POST /api/admin/media — multipart (`folder` field BEFORE `file`, or ?folder=), streamed to
 * storage with busboy (never buffered in memory). Used with local disk storage and by
 * long-running servers; on Vercel use the presigned flow (request bodies are capped ~4.5 MB).
 */
export const uploadMedia = route(async (c) => {
  await c.requireAdmin()
  const ct = c.req.headers.get('content-type') ?? ''
  if (!ct.startsWith('multipart/form-data')) return fail(415, 'Expected multipart/form-data')
  if (!c.req.body) return fail(400, 'Empty body')
  if (config.isVercel && c.storage.kind === 'local') return fail(501, 'Local disk storage is not available on Vercel; configure S3_BUCKET')

  const { storage, db } = c
  const result = await new Promise<{ folder: string; storedName: string; filename: string; mime: string; size: number }>((resolve, reject) => {
    let bb: Busboy.Busboy
    try {
      bb = Busboy({ headers: { 'content-type': ct }, limits: { fileSize: config.maxUploadBytes, files: 1, fields: 10, fieldSize: 1000 } })
    } catch {
      return reject(new HttpError(400, 'Malformed multipart body'))
    }
    const fields: Record<string, string> = {}
    let sawFile = false
    let pending: Promise<void> | null = null
    let out: { folder: string; storedName: string; filename: string; mime: string; size: number } | null = null
    let failure: unknown = null

    bb.on('field', (name, value) => (fields[name] = value))
    bb.on('file', (fieldname, stream, info) => {
      if (sawFile || fieldname !== 'file') {
        stream.resume()
        if (fieldname !== 'file') failure ??= new HttpError(400, 'The upload field must be named "file"')
        return
      }
      sawFile = true
      let p: ReturnType<typeof plan>
      try {
        p = plan(info.filename ?? '', fields.folder || c.url.searchParams.get('folder'))
      } catch (err) {
        failure = err
        stream.resume()
        return
      }
      let truncated = false
      stream.on('limit', () => {
        truncated = true
        stream.destroy(new HttpError(413, TOO_LARGE))
      })
      pending = storage
        .save(p.key, stream, p.mime)
        .then(async (saved) => {
          if (truncated) {
            await storage.remove(saved.key)
            throw new HttpError(413, TOO_LARGE)
          }
          out = { folder: p.folder, storedName: p.storedName, filename: info.filename, mime: p.mime, size: saved.size }
        })
        .catch(async (err) => {
          await storage.remove(p.key).catch(() => undefined)
          failure ??= truncated ? new HttpError(413, TOO_LARGE) : err
        })
    })
    bb.on('error', (err) => reject(failure ?? new HttpError(400, `Malformed multipart body: ${(err as Error).message}`)))
    bb.on('close', async () => {
      if (pending) await pending
      if (failure) return reject(failure)
      if (!out) return reject(new HttpError(400, 'Missing "file" field'))
      resolve(out)
    })
    Readable.fromWeb(c.req.body as unknown as NodeWebReadableStream).on('error', reject).pipe(bb)
  })
  c.status = 201
  return record(db, storage, result.folder, result.storedName, result.filename, result.mime, result.size)
})

/** POST /api/admin/media/presign — direct-to-S3 upload URL (serverless-safe, up to 500 MB). */
export const presignMedia = route(async (c) => {
  await c.requireAdmin()
  if (!c.storage.presignPut) return fail(501, 'Direct upload not supported by local storage; use multipart POST /api/admin/media')
  const b = await c.json()
  if (!isRecord(b) || typeof b.filename !== 'string' || !b.filename) return fail(400, 'Body must be { filename, size, folder? }')
  const size = Number(b.size)
  if (!Number.isFinite(size) || size <= 0) return fail(400, '"size" (bytes) is required')
  if (size > config.maxUploadBytes) return fail(413, TOO_LARGE)
  const p = plan(b.filename, b.folder)
  const signed = await c.storage.presignPut(p.key, p.mime)
  return { ...signed, key: p.key, publicUrl: c.storage.urlFor(p.key), mime: p.mime }
})

/** POST /api/admin/media/complete — record an object uploaded via /presign. */
export const completeMedia = route(async (c) => {
  await c.requireAdmin()
  const b = await c.json()
  if (!isRecord(b) || typeof b.key !== 'string' || typeof b.filename !== 'string') return fail(400, 'Body must be { key, filename }')
  const m = KEY_RE.exec(b.key)
  if (!m) return fail(400, 'Invalid key')
  const [, folder, storedName, ext] = m
  if (await c.db.one('SELECT id FROM media WHERE folder = $1 AND stored_name = $2', [folder, storedName])) return fail(409, 'Already recorded')
  const stat = await c.storage.stat(b.key)
  if (!stat) return fail(400, 'Object not found in storage; upload it to uploadUrl first')
  if (stat.size > config.maxUploadBytes) {
    await c.storage.remove(b.key)
    return fail(413, TOO_LARGE)
  }
  c.status = 201
  return record(c.db, c.storage, folder, storedName, b.filename, MIME_BY_EXT[ext], stat.size)
})

/** GET /api/admin/media */
export const listMedia = route(async (c) => {
  await c.requireAdmin()
  const rows = await c.db.query<MediaRow>('SELECT * FROM media ORDER BY created_at DESC')
  return rows.map((r) => toRecord(c.storage, r))
})

/** DELETE /api/admin/media/:id */
export const deleteMedia = route<{ id: string }>(async (c) => {
  await c.requireAdmin()
  const row = await c.db.one<MediaRow>('SELECT * FROM media WHERE id = $1', [c.params.id])
  if (!row) return fail(404, 'Media not found')
  await c.storage.remove(`${row.folder}/${row.stored_name}`)
  await c.db.run('DELETE FROM media WHERE id = $1', [row.id])
  return { ok: true }
})

/* ------------------------------------------------------------------ */
/* GET /media/<folder>/<file> — local disk files with Range support     */
/* ------------------------------------------------------------------ */

function notFound() {
  return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json' } })
}

export async function serveMediaFile(req: Request, segments: string[]): Promise<Response> {
  const storage = getStorage()
  const key = segments.map((s) => decodeURIComponent(s)).join('/')
  // (kind check, not instanceof: the singleton may predate a dev hot reload of the class)
  if (storage.kind !== 'local') {
    // S3 mode: old relative /media/ URLs keep working by redirecting to the bucket/CDN.
    return KEY_RE.test(key) ? Response.redirect(storage.urlFor(key), 308) : notFound()
  }
  let file: string
  try {
    file = (storage as LocalDiskStorage).filePath(key)
  } catch {
    return notFound()
  }
  let st: fs.Stats
  try {
    st = await fs.promises.stat(file)
    if (!st.isFile()) return notFound()
  } catch {
    return notFound()
  }
  const size = st.size
  const etag = `W/"${size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`
  const headers = new Headers({
    'content-type': MIME_BY_EXT[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=31536000, immutable',
    'last-modified': st.mtime.toUTCString(),
    etag,
    'x-content-type-options': 'nosniff',
  })
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers })

  let start = 0
  let end = size - 1
  let status = 200
  const range = req.headers.get('range')
  const ifRange = req.headers.get('if-range')
  if (range && (!ifRange || ifRange === etag)) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
    if (!m || (m[1] === '' && m[2] === '')) {
      headers.set('content-range', `bytes */${size}`)
      return new Response(null, { status: 416, headers })
    }
    if (m[1] === '') {
      start = Math.max(size - Number(m[2]), 0) // suffix range: last N bytes
    } else {
      start = Number(m[1])
      end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
    }
    if (start > end || start >= size) {
      headers.set('content-range', `bytes */${size}`)
      return new Response(null, { status: 416, headers })
    }
    status = 206
    headers.set('content-range', `bytes ${start}-${end}/${size}`)
  }
  headers.set('content-length', String(end - start + 1))
  if (req.method === 'HEAD' || size === 0) return new Response(null, { status, headers })
  const stream = Readable.toWeb(fs.createReadStream(file, { start, end })) as unknown as ReadableStream
  return new Response(stream, { status, headers })
}
