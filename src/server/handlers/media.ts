import 'server-only'
import { randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web'
import Busboy from 'busboy'
import { config } from '../config'
import { type Actor, audit } from '../audit'
import { type Db, nowIso, type Param, parseJson } from '../db'
import { route } from '../http'
import { getStorage } from '../services'
import { siteId } from '../site'
import { LocalDiskStorage, type StorageDriver } from '../storage'
import { fail, HttpError, isRecord } from '../util'
import { DEEPZOOM_FOLDER, DZI_MIME, isDeepZoomKey, removeDeepZoomSet } from './deepzoom'

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

async function record(db: Db, storage: StorageDriver, actor: Actor, folder: string, storedName: string, filename: string, mime: string, size: number) {
  const row: MediaRow = { id: randomUUID(), folder, stored_name: storedName, filename: filename.slice(0, 255), mime, size, created_at: nowIso() }
  await db.tx(async (q) => {
    await q.run('INSERT INTO media (id, folder, stored_name, filename, mime, size, created_at, site) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [
      row.id,
      row.folder,
      row.stored_name,
      row.filename,
      row.mime,
      row.size,
      row.created_at,
      siteId(),
    ])
    await audit(q, actor, { action: 'media.upload', targetKind: 'media', targetId: row.id, summary: `Uploaded “${row.filename}” to ${folder}` })
  })
  return toRecord(storage, row)
}

/** GET /api/admin/media/config — tells the admin UI which upload flow to use. */
export const mediaConfig = route(async (c) => {
  await c.requireCurator()
  return {
    driver: c.storage.kind,
    directUpload: typeof c.storage.presignPut === 'function',
    maxBytes: config.maxUploadBytes,
    folders: MEDIA_FOLDERS,
    extensions: Object.keys(TYPES),
    /** Deep Zoom pyramids have their own flow: POST /api/admin/media/deepzoom (see handlers/deepzoom.ts). */
    deepZoom: true,
  }
})

/**
 * POST /api/admin/media — multipart (`folder` field BEFORE `file`, or ?folder=), streamed to
 * storage with busboy (never buffered in memory). Used with local disk storage and by
 * long-running servers; on Vercel use the presigned flow (request bodies are capped ~4.5 MB).
 */
export const uploadMedia = route(async (c) => {
  const user = await c.requireCurator()
  const ct = c.req.headers.get('content-type') ?? ''
  if (!ct.startsWith('multipart/form-data')) return fail(415, 'Expected multipart/form-data')
  if (!c.req.body) return fail(400, 'Empty body')
  if (config.isVercel && c.storage.kind === 'local') return fail(501, 'Uploads aren’t set up on this site.')

  const { storage, db } = c
  const result = await new Promise<{ folder: string; storedName: string; filename: string; mime: string; size: number }>((resolve, reject) => {
    let bb: Busboy.Busboy
    try {
      bb = Busboy({ headers: { 'content-type': ct }, limits: { fileSize: config.maxUploadBytes, files: 1, fields: 10, fieldSize: 1000 } })
    } catch {
      return reject(new HttpError(400, 'The upload was interrupted. Please try again.'))
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
          out = { folder: p.folder, storedName: p.storedName, filename: info.filename ?? '', mime: p.mime, size: saved.size }
        })
        .catch(async (err) => {
          await storage.remove(p.key).catch(() => undefined)
          failure ??= truncated ? new HttpError(413, TOO_LARGE) : err
        })
    })
    bb.on('error', () => reject(failure ?? new HttpError(400, 'The upload was interrupted. Please try again.')))
    bb.on('close', async () => {
      if (pending) await pending
      if (failure) return reject(failure)
      if (!out) return reject(new HttpError(400, 'Missing "file" field'))
      resolve(out)
    })
    Readable.fromWeb(c.req.body as unknown as NodeWebReadableStream).on('error', reject).pipe(bb)
  })
  c.status = 201
  return record(db, storage, user, result.folder, result.storedName, result.filename, result.mime, result.size)
})

/** POST /api/admin/media/presign — direct-to-S3 upload URL (serverless-safe, up to 500 MB). */
export const presignMedia = route(async (c) => {
  await c.requireCurator()
  if (!c.storage.presignPut) return fail(501, 'This site stores uploads itself, so direct uploads aren’t available.')
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
  const user = await c.requireCurator()
  const b = await c.json()
  if (!isRecord(b) || typeof b.key !== 'string' || typeof b.filename !== 'string') return fail(400, 'Body must be { key, filename }')
  const m = KEY_RE.exec(b.key)
  if (!m) return fail(400, 'Invalid key')
  const [, folder, storedName, ext] = m
  if (await c.db.one('SELECT id FROM media WHERE folder = $1 AND stored_name = $2', [folder, storedName])) return fail(409, 'Already recorded')
  const stat = await c.storage.stat(b.key)
  if (!stat) return fail(400, 'The upload didn’t reach storage. Please try again.')
  if (stat.size > config.maxUploadBytes) {
    await c.storage.remove(b.key)
    return fail(413, TOO_LARGE)
  }
  c.status = 201
  return record(c.db, c.storage, user, folder, storedName, b.filename, MIME_BY_EXT[ext], stat.size)
})

export const MEDIA_KINDS = ['image', 'model', 'video', 'audio', 'other'] as const
type MediaKind = (typeof MEDIA_KINDS)[number]

/** SQL condition for one kind (deep zoom pyramids count as images). */
const KIND_SQL: Record<MediaKind, string> = {
  image: "(mime LIKE 'image/%' OR folder = 'deepzoom')",
  model: "mime LIKE 'model/%'",
  video: "mime LIKE 'video/%'",
  audio: "mime LIKE 'audio/%'",
  other: "NOT (mime LIKE 'image/%' OR mime LIKE 'model/%' OR mime LIKE 'video/%' OR mime LIKE 'audio/%' OR folder = 'deepzoom')",
}

/** Opaque page cursor: the last row's (created_at, id). */
const encodeCursor = (r: MediaRow) => Buffer.from(JSON.stringify([r.created_at, r.id])).toString('base64url')
function decodeCursor(v: string): [string, string] {
  try {
    const c = JSON.parse(Buffer.from(v, 'base64url').toString('utf8')) as unknown
    if (Array.isArray(c) && c.length === 2 && typeof c[0] === 'string' && typeof c[1] === 'string' && !Number.isNaN(Date.parse(c[0]))) return [c[0], c[1]]
  } catch {
    /* fall through */
  }
  return fail(400, 'Invalid cursor')
}

/**
 * GET /api/admin/media — this site's library, newest first. Without `limit`: every record (array, as before).
 * With `limit` (1–200), `cursor`, `q` (file name contains), `kind` (image|model|video|audio|other):
 * `{ items, nextCursor }` — pass `nextCursor` back as `cursor` for the next page (null = last page).
 */
export const listMedia = route(async (c) => {
  await c.requireCurator()
  const sp = c.url.searchParams
  if (!sp.has('limit')) {
    const rows = await c.db.query<MediaRow>('SELECT * FROM media WHERE site = $1 ORDER BY created_at DESC, id DESC', [siteId()])
    return rows.map((r) => toRecord(c.storage, r))
  }
  const limit = Math.max(1, Math.min(200, Math.round(Number(sp.get('limit'))) || 60))
  const where = ['site = $1']
  const params: Param[] = [siteId()]
  const cursor = sp.get('cursor')
  if (cursor) {
    const [at, id] = decodeCursor(cursor)
    params.push(at, id)
    where.push(`(created_at < $${params.length - 1} OR (created_at = $${params.length - 1} AND id < $${params.length}))`)
  }
  const q = (sp.get('q') ?? '').trim().toLowerCase().slice(0, 100)
  if (q) {
    params.push(`%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`)
    where.push(`LOWER(filename) LIKE $${params.length} ESCAPE '\\'`)
  }
  const kind = sp.get('kind')
  if (kind) {
    if (!(MEDIA_KINDS as readonly string[]).includes(kind)) return fail(400, `"kind" must be one of ${MEDIA_KINDS.join(', ')}`)
    where.push(KIND_SQL[kind as MediaKind])
  }
  const rows = await c.db.query<MediaRow>(`SELECT * FROM media WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ${limit + 1}`, params)
  const page = rows.slice(0, limit)
  return { items: page.map((r) => toRecord(c.storage, r)), nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null }
})

const findMedia = (db: Db, id: string) => db.one<MediaRow>('SELECT * FROM media WHERE id = $1 AND site = $2', [id, siteId()])

/** DELETE /api/admin/media/:id */
export const deleteMedia = route<{ id: string }>(async (c) => {
  const user = await c.requireCurator()
  const row = await findMedia(c.db, c.params.id)
  if (!row) return fail(404, 'Media not found')
  if (row.folder === DEEPZOOM_FOLDER) await removeDeepZoomSet(c.storage, row.stored_name) // whole tile pyramid
  else await c.storage.remove(`${row.folder}/${row.stored_name}`)
  await c.db.tx(async (q) => {
    await q.run('DELETE FROM media WHERE id = $1 AND site = $2', [row.id, siteId()])
    await audit(q, user, { action: 'media.delete', targetKind: 'media', targetId: row.id, summary: `Deleted “${row.filename}” from the media library` })
  })
  return { ok: true }
})

/** Every string inside `v` that contains `needle`, with its path ('image', 'gallery[2].src', …). */
function findRefs(v: unknown, needle: string, path = '', out: string[] = []): string[] {
  if (typeof v === 'string') {
    if (v.includes(needle)) out.push(path || '(value)')
  } else if (Array.isArray(v)) {
    v.forEach((x, i) => findRefs(x, needle, `${path}[${i}]`, out))
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) findRefs(x, needle, path ? `${path}.${k}` : k, out)
  }
  return out
}

/**
 * Where one media record is used: content items of this site's exhibitions (any field, nested too) and maker
 * portraits whose value contains the object's key (`<folder>/<file>`, or `deepzoom/<set>/` for a pyramid) —
 * which matches local /media/… addresses and S3 / CDN addresses alike.
 */
export async function mediaUsage(db: Db, row: Pick<MediaRow, 'folder' | 'stored_name'>) {
  const needle = row.folder === DEEPZOOM_FOLDER ? `${DEEPZOOM_FOLDER}/${row.stored_name.split('/')[0]}/` : `${row.folder}/${row.stored_name}`
  const [items, makers] = await Promise.all([
    db.query<{ exhibition_id: string; title: string; collection: string; json: unknown }>(
      `SELECT ci.exhibition_id, e.title, ci.collection, ci.json FROM content_items ci JOIN exhibitions e ON e.id = ci.exhibition_id
       WHERE e.site = $1 ORDER BY e.is_default DESC, e.sort, ci.collection, ci.sort`,
      [siteId()],
    ),
    db.query<{ id: string; name: string; portrait: string }>('SELECT id, name, portrait FROM artisans WHERE site = $1 ORDER BY sort, name', [siteId()]),
  ])
  const usage = items.flatMap((r) => {
    const item = parseJson<Record<string, unknown>>(r.json)
    const id = String(item.id ?? '')
    const title = typeof item.title === 'string' && item.title ? item.title : id
    return findRefs(item, needle).map((field) => ({ exhibitionId: r.exhibition_id, exhibitionTitle: r.title, collection: r.collection, id, title, field }))
  })
  return { usage, artisans: makers.filter((m) => m.portrait.includes(needle)).map((m) => ({ id: m.id, name: m.name })) }
}

/** GET /api/admin/media/:id/usage — curator → `{ usage: [{ exhibitionId, exhibitionTitle, collection, id, title, field }], artisans: [{ id, name }] }` */
export const mediaUsageRoute = route<{ id: string }>(async (c) => {
  await c.requireCurator()
  const row = await findMedia(c.db, c.params.id)
  if (!row) return fail(404, 'Media not found')
  return mediaUsage(c.db, row)
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
    return KEY_RE.test(key) || isDeepZoomKey(key) ? Response.redirect(storage.urlFor(key), 308) : notFound()
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
    'content-type': (path.extname(file).toLowerCase() === '.dzi' ? DZI_MIME : MIME_BY_EXT[path.extname(file).toLowerCase()]) ?? 'application/octet-stream',
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
