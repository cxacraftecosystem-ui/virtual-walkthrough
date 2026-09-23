/** Admin API client (same-origin; session cookie). Contract: docs/API.md. */
import type { ContentCollection, ExhibitionText, MuseumContent } from '../museum/content/types'
import { exQuery } from './exhibitionsApi'

/** visitor < curator (content + media) < admin (+ comments, analytics, users) < master (+ access list) */
export type Role = 'visitor' | 'curator' | 'admin' | 'master'
const RANK: Record<Role, number> = { visitor: 0, curator: 1, admin: 2, master: 3 }
/** Mirrors the server check (the server is authoritative; this only hides UI). */
export const can = (user: Pick<User, 'role'> | null | undefined, min: Role) => !!user && (RANK[user.role] ?? 0) >= RANK[min]
export const ROLE_LABEL: Record<Role, string> = { visitor: 'Visitor', curator: 'Curator', admin: 'Admin', master: 'Master admin' }
export type ManualRole = 'visitor' | 'curator' | 'admin'
export type AccessRole = 'curator' | 'admin'

export interface AdminUser {
  id: string
  email: string
  displayName: string
  role: Role
  manualRole: ManualRole | null
  accessRole: AccessRole | null
  emailVerified: boolean
  google: boolean
  hasPassword: boolean
  isMaster: boolean
  createdAt: string
  lastLoginAt: string | null
}
export interface AccessEntry {
  pattern: string
  kind: 'email' | 'domain'
  role: AccessRole
  note: string
  createdBy: string | null
  createdAt: string
  updatedAt: string
  users: number
}
export interface User {
  id: string
  email: string
  displayName: string
  role: Role
  createdAt: string
}
export type Item = Record<string, unknown> & { id: string }

export interface MediaRecord {
  id: string
  url: string
  filename: string
  folder: string
  mime: string
  size: number
  createdAt: string
}
export interface MediaConfig {
  driver: 'local' | 's3'
  directUpload: boolean
  maxBytes: number
  folders: string[]
  extensions: string[]
}
export interface AdminComment {
  id: string
  itemKind: string | null
  itemId: string | null
  body: string
  displayName: string
  createdAt: string
  hidden: boolean
  userEmail?: string
}
export interface AnalyticsSummary {
  days: number
  sessions: number
  avgSessionSec: number
  zoneDwell: { zone: string; seconds: number }[]
  topItems: { itemKind: string; itemId: string; views: number; dwellSec: number }[]
  quality: { tier: string; count: number }[]
  daily: { date: string; sessions: number }[]
}

export interface ErrorGroup {
  fingerprint: string
  kind: string
  message: string
  count: number
  firstSeen: string
  lastSeen: string
  resolvedAt: string | null
  lastStack: string | null
  lastUrl: string | null
  lastUa: string | null
  lastTier: string | null
  lastGpu: string | null
  lastRelease: string | null
  last24h?: number
}
export interface ErrorOccurrence {
  id: number
  url: string | null
  ua: string | null
  tier: string | null
  gpu: string | null
  release: string | null
  stack: string | null
  createdAt: string
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const isJson = (res.headers.get('content-type') ?? '').includes('json')
  const data = isJson ? await res.json() : null
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? (res.status === 404 && !isJson ? 'API not reachable — is `npm run server` running?' : res.statusText)
    throw new ApiError(res.status, msg)
  }
  return data as T
}

export const api = {
  me: () => req<User>('GET', '/api/auth/me'),
  login: (email: string, password: string) => req<User>('POST', '/api/auth/login', { email, password }),
  google: (credential: string) => req<User>('POST', '/api/auth/google', { credential }),
  logout: () => req<{ ok: true }>('POST', '/api/auth/logout'),

  content: () => req<MuseumContent>('GET', `/api/content${exQuery()}`),
  list: (c: ContentCollection) => req<Item[]>('GET', `/api/admin/content/${c}${exQuery()}`),
  put: (c: ContentCollection, item: Item) => req<Item>('PUT', `/api/admin/content/${c}/${encodeURIComponent(item.id)}${exQuery()}`, item),
  remove: (c: ContentCollection, id: string) => req<{ ok: true }>('DELETE', `/api/admin/content/${c}/${encodeURIComponent(id)}${exQuery()}`),
  putExhibition: (e: ExhibitionText) => req<ExhibitionText>('PUT', `/api/admin/content/exhibition${exQuery()}`, e),
  putWelcome: (w: MuseumContent['welcome']) => req<MuseumContent['welcome']>('PUT', `/api/admin/content/welcome${exQuery()}`, w),
  reset: () => req<{ ok: true }>('POST', `/api/admin/content/reset${exQuery()}`),

  mediaConfig: () => req<MediaConfig>('GET', '/api/admin/media/config'),
  media: () => req<MediaRecord[]>('GET', '/api/admin/media'),
  deleteMedia: (id: string) => req<{ ok: true }>('DELETE', `/api/admin/media/${id}`),

  comments: () => req<AdminComment[]>('GET', '/api/admin/comments'),
  setHidden: (id: string, hidden: boolean) => req<{ ok: true }>('PATCH', `/api/admin/comments/${id}`, { hidden }),
  deleteComment: (id: string) => req<{ ok: true }>('DELETE', `/api/admin/comments/${id}`),

  summary: (days: number) => req<AnalyticsSummary>('GET', `/api/admin/analytics/summary?days=${days}`),

  errors: (status: 'open' | 'resolved' | 'all') => req<{ groups: ErrorGroup[]; open: number; resolved: number }>('GET', `/api/admin/errors?status=${status}`),
  errorDetail: (fp: string) => req<{ group: ErrorGroup; occurrences: ErrorOccurrence[] }>('GET', `/api/admin/errors/${fp}`),
  resolveError: (fp: string, resolved: boolean) => req<{ ok: true }>('PATCH', `/api/admin/errors/${fp}`, { resolved }),
  deleteError: (fp: string) => req<{ ok: true }>('DELETE', `/api/admin/errors/${fp}`),

  users: () => req<AdminUser[]>('GET', '/api/admin/users'),
  setUserRole: (id: string, role: ManualRole) => req<AdminUser>('PATCH', `/api/admin/users/${encodeURIComponent(id)}`, { role }),

  access: () => req<{ masters: string[]; entries: AccessEntry[] }>('GET', '/api/admin/access'),
  putAccess: (pattern: string, role: AccessRole, note = '') => req<AccessEntry>('POST', '/api/admin/access', { pattern, role, note }),
  patchAccess: (pattern: string, patch: { role?: AccessRole; note?: string }) =>
    req<AccessEntry>('PATCH', `/api/admin/access/${encodeURIComponent(pattern)}`, patch),
  deleteAccess: (pattern: string) => req<{ ok: true }>('DELETE', `/api/admin/access/${encodeURIComponent(pattern)}`),
}

/** XHR upload with progress (fetch has no upload progress). */
function xhr(method: string, url: string, body: XMLHttpRequestBodyInit, headers: Record<string, string>, onProgress: (f: number) => void) {
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const x = new XMLHttpRequest()
    x.open(method, url)
    for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v)
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    x.onload = () => resolve({ status: x.status, text: x.responseText })
    x.onerror = () => reject(new Error('Network error during upload'))
    x.send(body)
  })
}

/**
 * Upload a file using the flow the server supports: presigned direct-to-S3 PUT when available
 * (large files never touch the API), otherwise multipart through the API.
 */
export async function uploadMedia(file: File, folder: string, cfg: MediaConfig, onProgress: (f: number) => void): Promise<MediaRecord> {
  if (file.size > cfg.maxBytes) throw new Error(`${file.name} is larger than ${Math.round(cfg.maxBytes / 1048576)} MB`)
  if (cfg.directUpload) {
    const p = await req<{ uploadUrl: string; method: 'PUT'; headers: Record<string, string>; key: string }>('POST', '/api/admin/media/presign', {
      filename: file.name,
      size: file.size,
      folder: folder || undefined,
    })
    const r = await xhr(p.method, p.uploadUrl, file, p.headers, onProgress)
    if (r.status < 200 || r.status >= 300) throw new Error(`Storage rejected the upload (HTTP ${r.status}). Check the bucket CORS configuration.`)
    return req<MediaRecord>('POST', '/api/admin/media/complete', { key: p.key, filename: file.name })
  }
  const fd = new FormData()
  if (folder) fd.append('folder', folder) // must precede the file
  fd.append('file', file)
  const r = await xhr('POST', '/api/admin/media', fd, {}, onProgress)
  let data: unknown = null
  try {
    data = JSON.parse(r.text)
  } catch {
    /* non-JSON */
  }
  if (r.status < 200 || r.status >= 300) throw new ApiError(r.status, (data as { error?: string } | null)?.error ?? `Upload failed (HTTP ${r.status})`)
  return data as MediaRecord
}
