/**
 * Media storage drivers. Routes only talk to `StorageDriver`:
 *  - LocalDiskStorage — `.data/media/<folder>/<file>`, served by app/media/[...path]/route.ts
 *  - S3Storage        — AWS S3 or any S3-compatible store (Supabase Storage, R2, MinIO) with
 *                       presigned PUT uploads so large files never pass through the API
 *                       (required on Vercel, whose functions accept ~4.5 MB request bodies).
 * Keys are always `<folder>/<file>`; the driver maps them to disk paths / bucket keys.
 */
import 'server-only'
import fs from 'node:fs'
import path from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export interface StoredObject {
  key: string
  size: number
}

export interface PresignedUpload {
  uploadUrl: string
  method: 'PUT'
  /** Headers the client MUST send with the PUT (they are part of the signature). */
  headers: Record<string, string>
  expiresIn: number
}

export interface StorageDriver {
  readonly kind: 'local' | 's3'
  /** Stream `data` into `key`. Rejects (and leaves nothing behind) on stream error. */
  save(key: string, data: Readable, contentType: string): Promise<StoredObject>
  remove(key: string): Promise<void>
  /** Size of a stored object, or null when it does not exist. */
  stat(key: string): Promise<{ size: number } | null>
  /** Public URL the browser uses (relative for local disk, absolute for S3/CDN). */
  urlFor(key: string): string
  /** Direct-to-storage upload URL (S3 only). */
  presignPut?(key: string, contentType: string): Promise<PresignedUpload>
}

const encodeKey = (key: string) => key.split('/').map(encodeURIComponent).join('/')

/* ------------------------------------------------------------------ */

export class LocalDiskStorage implements StorageDriver {
  readonly kind = 'local' as const
  readonly root: string
  readonly publicPrefix: string

  constructor(root: string, publicPrefix = '/media') {
    this.root = path.resolve(root)
    this.publicPrefix = publicPrefix
    fs.mkdirSync(this.root, { recursive: true })
  }

  /** Absolute path for a key (throws on traversal). */
  filePath(key: string) {
    const p = path.resolve(this.root, key)
    if (!p.startsWith(this.root + path.sep)) throw new Error('invalid storage key')
    return p
  }

  async save(key: string, data: Readable): Promise<StoredObject> {
    const file = this.filePath(key)
    await fs.promises.mkdir(path.dirname(file), { recursive: true })
    try {
      await pipeline(data, fs.createWriteStream(file, { flags: 'wx' }))
    } catch (err) {
      await fs.promises.rm(file, { force: true })
      throw err
    }
    return { key, size: (await fs.promises.stat(file)).size }
  }

  async remove(key: string) {
    await fs.promises.rm(this.filePath(key), { force: true })
  }

  async stat(key: string) {
    try {
      return { size: (await fs.promises.stat(this.filePath(key))).size }
    } catch {
      return null
    }
  }

  urlFor(key: string) {
    return `${this.publicPrefix}/${encodeKey(key)}`
  }
}

/* ------------------------------------------------------------------ */

export interface S3Options {
  bucket: string
  region: string
  /** S3-compatible endpoint (Supabase Storage: https://<ref>.supabase.co/storage/v1/s3). */
  endpoint?: string
  /** Public base URL (CloudFront / custom domain / Supabase public bucket URL). */
  publicBaseUrl?: string
  /** Key prefix inside the bucket, e.g. "museum/". */
  prefix?: string
}

/** Credentials come from the standard AWS chain (AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, profile, role). */
export class S3Storage implements StorageDriver {
  readonly kind = 's3' as const
  readonly client: S3Client
  readonly bucket: string
  readonly prefix: string
  readonly publicBaseUrl: string

  constructor(opts: S3Options) {
    this.bucket = opts.bucket
    this.prefix = opts.prefix ? opts.prefix.replace(/^\/+/, '').replace(/\/?$/, '/') : ''
    this.client = new S3Client({
      region: opts.region,
      ...(opts.endpoint ? { endpoint: opts.endpoint, forcePathStyle: true } : {}),
      // presigned PUTs must not require checksum headers the browser won't send
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })
    this.publicBaseUrl = (
      opts.publicBaseUrl ||
      (opts.endpoint
        ? `${opts.endpoint.replace(/\/$/, '')}/${opts.bucket}`
        : `https://${opts.bucket}.s3.${opts.region}.amazonaws.com`)
    ).replace(/\/$/, '')
  }

  private objectKey(key: string) {
    if (key.includes('..') || key.startsWith('/')) throw new Error('invalid storage key')
    return this.prefix + key
  }

  async save(key: string, data: Readable, contentType: string): Promise<StoredObject> {
    const upload = new Upload({
      client: this.client,
      params: { Bucket: this.bucket, Key: this.objectKey(key), Body: data, ContentType: contentType, CacheControl: CACHE_CONTROL },
      queueSize: 4,
      partSize: 8 * 1024 * 1024,
    })
    await upload.done()
    const s = await this.stat(key)
    return { key, size: s?.size ?? 0 }
  }

  async remove(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }))
  }

  async stat(key: string) {
    try {
      const r = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }))
      return { size: Number(r.ContentLength ?? 0) }
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
      if (status === 404 || status === 403) return null
      throw err
    }
  }

  urlFor(key: string) {
    return `${this.publicBaseUrl}/${encodeKey(this.objectKey(key))}`
  }

  /** `size` is validated by the caller; the real size is re-checked with HEAD on /complete. */
  async presignPut(key: string, contentType: string): Promise<PresignedUpload> {
    const expiresIn = 15 * 60
    const cmd = new PutObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key), ContentType: contentType, CacheControl: CACHE_CONTROL })
    const uploadUrl = await getSignedUrl(this.client, cmd, {
      expiresIn,
      signableHeaders: new Set(['content-type', 'cache-control']),
    })
    return { uploadUrl, method: 'PUT', headers: { 'Content-Type': contentType, 'Cache-Control': CACHE_CONTROL }, expiresIn }
  }
}

/** Uploaded object names are unique (random suffix) → safe to cache for a long time. */
const CACHE_CONTROL = 'public, max-age=31536000, immutable'
