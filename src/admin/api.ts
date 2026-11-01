/** Admin API client (same-origin; session cookie). Contract: docs/API.md. */
import type { ContentCollection, ExhibitionText, MuseumContent } from '../museum/content/types'
import { exQuery, getSelectedExhibition } from './exhibitionsApi'

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

/**
 * Every admin request fails with this: `status` is the HTTP status, `message` the server's words. A 409 from
 * a content save or delete carries the server's `ConflictBody` in `body` (see `isConflict`).
 */
export class ApiError extends Error {
  status: number
  body: unknown
  constructor(status: number, message: string, body: unknown = null) {
    super(message)
    this.status = status
    this.body = body
  }
}

/** The 409 body of a stale content save or delete (`X-Expected-Updated-At` no longer matches). */
export interface ConflictBody {
  error: 'conflict'
  message: string
  /** The item as it is now; null when it has since been deleted. */
  current: Item | null
  updatedAt: string | null
  updatedBy: string | null
}
export const isConflict = (e: unknown): e is ApiError & { body: ConflictBody } =>
  e instanceof ApiError && e.status === 409 && (e.body as { error?: unknown } | null)?.error === 'conflict'

/** The one fetch wrapper every admin call goes through (exhibitionsApi.ts too), so errors are uniform. */
export async function request<T>(method: string, url: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  const h: Record<string, string> = { ...headers }
  if (body !== undefined) h['content-type'] = 'application/json'
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: Object.keys(h).length ? h : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const isJson = (res.headers.get('content-type') ?? '').includes('json')
  const data: unknown = isJson ? await res.json().catch(() => null) : null
  if (!res.ok) {
    const d = data as { error?: string; message?: string } | null
    const msg =
      (d?.error === 'conflict' ? d.message : d?.error) ??
      (res.status === 404 && !isJson ? 'Can’t reach the museum service. Try again.' : 'Something went wrong. Try again.')
    throw new ApiError(res.status, msg, data)
  }
  return data as T
}
const req = request

/* ---- dashboard, activity, history, trash, media usage and bulk moderation (docs/API.md) ---- */

/** One row of the activity log: who changed what, when. */
export interface AuditEntry {
  id: number
  at: string
  actorEmail: string | null
  actorRole: string | null
  /** e.g. 'content.update', 'prints.bulk', 'exhibition.delete' */
  action: string
  targetKind: string
  targetId: string
  exhibitionId: string | null
  summary: string
}
export interface Overview {
  role: Role
  site: string
  counts: {
    pendingPrints: number
    comments7d: number
    hiddenComments: number
    /** null below admin */
    openErrors: number | null
    errors24h: number | null
    /** null below admin */
    users: number | null
    /** items of the exhibition still marked `placeholder` */
    placeholders: number
    items: number
  }
  exhibition: { id: string; title: string; status: 'draft' | 'published' }
  recent: AuditEntry[]
}
/** Last change of one content item; the key in `stamps` is "<collection>/<id>". */
export interface ContentStamp {
  updatedAt: string
  updatedBy: string | null
}
export type RevisionOp = 'create' | 'update' | 'delete' | 'restore'
export interface Revision {
  rev: number
  at: string
  actorEmail: string | null
  op: RevisionOp
  /** The item after the change (for a delete: as it was just before). */
  item: Item | null
}
export interface TrashItem {
  collection: ContentCollection
  id: string
  title: string
  deletedAt: string
  deletedBy: string | null
  /** The revision `contentRestore` brings back. */
  rev: number
}
export interface MediaUsage {
  usage: { exhibitionId: string; exhibitionTitle: string; collection: ContentCollection; id: string; title: string; field: string }[]
  artisans: { id: string; name: string }[]
}
export type MediaKind = 'image' | 'model' | 'video' | 'audio' | 'other'
export interface MediaPage {
  items: MediaRecord[]
  nextCursor: string | null
}
export type PrintStatus = 'pending' | 'approved' | 'rejected'
export interface AdminPrint {
  id: string
  url: string
  displayName: string
  motif: string
  meta: { blocks?: string[]; dyes?: string[]; ground?: string; stamps?: number }
  width: number
  height: number
  size: number
  status: PrintStatus
  createdAt: string
  sessionId: string
  userId: string | null
  reviewedAt: string | null
  reviewedBy: string | null
}
export type PrintsBulkAction = 'approve' | 'reject' | 'pending' | 'delete'
export type CommentsBulkAction = 'hide' | 'unhide' | 'delete'
export type ErrorsBulkAction = 'resolve' | 'reopen' | 'delete'
/** A saved content item: the item plus its new stamp. */
export type SavedItem = Item & { updatedAt?: string; updatedBy?: string | null }
/** Optimistic concurrency for content saves and deletes: the stamp the editor loaded ('new' = must not exist yet). */
export interface WriteGuard {
  expectedUpdatedAt?: string | null
}

const guard = (o?: WriteGuard): Record<string, string> | undefined => (o?.expectedUpdatedAt ? { 'x-expected-updated-at': o.expectedUpdatedAt } : undefined)
/** `?a=1&b=2` from the set values only ('' when none is set). */
function qs(p: Record<string, string | number | null | undefined>): string {
  const out = new URLSearchParams()
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== null && v !== '') out.set(k, String(v))
  const s = out.toString()
  return s ? `?${s}` : ''
}
const itemPath = (c: ContentCollection, id: string) => `/api/admin/content/${c}/${encodeURIComponent(id)}`

export const api = {
  me: () => req<User>('GET', '/api/auth/me'),
  login: (email: string, password: string) => req<User>('POST', '/api/auth/login', { email, password }),
  google: (credential: string) => req<User>('POST', '/api/auth/google', { credential }),
  logout: () => req<{ ok: true }>('POST', '/api/auth/logout'),

  content: () => req<MuseumContent>('GET', `/api/content${exQuery()}`),
  list: (c: ContentCollection) => req<Item[]>('GET', `/api/admin/content/${c}${exQuery()}`),
  /** With `{ expectedUpdatedAt }` a stale save fails with a 409 ApiError (`isConflict`) instead of overwriting. */
  put: (c: ContentCollection, item: Item, opts?: WriteGuard) => req<SavedItem>('PUT', `${itemPath(c, item.id)}${exQuery()}`, item, guard(opts)),
  remove: (c: ContentCollection, id: string, opts?: WriteGuard) => req<{ ok: true }>('DELETE', `${itemPath(c, id)}${exQuery()}`, undefined, guard(opts)),
  contentStamps: () => req<{ stamps: Record<string, ContentStamp> }>('GET', `/api/admin/content/stamps${exQuery()}`),
  contentHistory: (c: ContentCollection, id: string) => req<{ revisions: Revision[] }>('GET', `${itemPath(c, id)}/history${exQuery()}`),
  contentRestore: (c: ContentCollection, id: string, rev: number) =>
    req<{ item: Item; updatedAt: string }>('POST', `${itemPath(c, id)}/restore${exQuery()}`, { rev }),
  contentTrash: () => req<{ items: TrashItem[] }>('GET', `/api/admin/content/trash${exQuery()}`),
  putExhibition: (e: ExhibitionText) => req<ExhibitionText>('PUT', `/api/admin/content/exhibition${exQuery()}`, e),
  putWelcome: (w: MuseumContent['welcome']) => req<MuseumContent['welcome']>('PUT', `/api/admin/content/welcome${exQuery()}`, w),
  reset: () => req<{ ok: true }>('POST', `/api/admin/content/reset${exQuery()}`),

  mediaConfig: () => req<MediaConfig>('GET', '/api/admin/media/config'),
  media: () => req<MediaRecord[]>('GET', '/api/admin/media'),
  /** One page of the library, newest first; pass the previous page's `nextCursor` as `cursor`. */
  mediaPage: (p: { limit?: number; cursor?: string | null; q?: string; kind?: MediaKind } = {}) =>
    req<MediaPage>('GET', `/api/admin/media${qs({ limit: p.limit ?? 60, cursor: p.cursor, q: p.q, kind: p.kind })}`),
  mediaUsage: (id: string) => req<MediaUsage>('GET', `/api/admin/media/${encodeURIComponent(id)}/usage`),
  deleteMedia: (id: string) => req<{ ok: true }>('DELETE', `/api/admin/media/${id}`),

  prints: (status: PrintStatus | 'all' = 'all') => req<AdminPrint[]>('GET', `/api/admin/prints?status=${status}`),
  patchPrint: (id: string, status: PrintStatus) => req<AdminPrint>('PATCH', `/api/admin/prints/${encodeURIComponent(id)}`, { status }),
  deletePrint: (id: string) => req<{ ok: true }>('DELETE', `/api/admin/prints/${encodeURIComponent(id)}`),
  printsBulk: (ids: string[], action: PrintsBulkAction) => req<{ updated: number }>('POST', '/api/admin/prints/bulk', { ids, action }),

  comments: () => req<AdminComment[]>('GET', '/api/admin/comments'),
  setHidden: (id: string, hidden: boolean) => req<{ ok: true }>('PATCH', `/api/admin/comments/${id}`, { hidden }),
  deleteComment: (id: string) => req<{ ok: true }>('DELETE', `/api/admin/comments/${id}`),
  commentsBulk: (ids: string[], action: CommentsBulkAction) => req<{ updated: number }>('POST', '/api/admin/comments/bulk', { ids, action }),

  summary: (days: number) => req<AnalyticsSummary>('GET', `/api/admin/analytics/summary?days=${days}`),

  errors: (status: 'open' | 'resolved' | 'all') => req<{ groups: ErrorGroup[]; open: number; resolved: number }>('GET', `/api/admin/errors?status=${status}`),
  errorDetail: (fp: string) => req<{ group: ErrorGroup; occurrences: ErrorOccurrence[] }>('GET', `/api/admin/errors/${fp}`),
  resolveError: (fp: string, resolved: boolean) => req<{ ok: true }>('PATCH', `/api/admin/errors/${fp}`, { resolved }),
  deleteError: (fp: string) => req<{ ok: true }>('DELETE', `/api/admin/errors/${fp}`),
  errorsBulk: (fingerprints: string[], action: ErrorsBulkAction) => req<{ updated: number }>('POST', '/api/admin/errors/bulk', { fingerprints, action }),

  /** Dashboard counts + the latest activity; `exhibition` defaults to the header switcher's selection. */
  overview: (exhibition?: string) => req<Overview>('GET', `/api/admin/overview${qs({ exhibition: exhibition ?? getSelectedExhibition() })}`),
  /** The activity log, newest first; pass the previous page's `nextBefore` as `before`. `target` is "<kind>:<id>". */
  activity: (p: { limit?: number; before?: number | null; target?: string; exhibition?: string } = {}) =>
    req<{ entries: AuditEntry[]; nextBefore: number | null }>('GET', `/api/admin/activity${qs({ limit: p.limit, before: p.before, target: p.target, exhibition: p.exhibition })}`),

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
    x.onerror = () => reject(new Error('The upload didn’t finish. Check your connection and try again.'))
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
    if (r.status < 200 || r.status >= 300) throw new Error('The upload didn’t reach storage. Check your connection and try again.')
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
  if (r.status < 200 || r.status >= 300) throw new ApiError(r.status, (data as { error?: string } | null)?.error ?? 'The upload didn’t finish. Try again.', data)
  return data as MediaRecord
}
