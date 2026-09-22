/**
 * Typed client for the museum backend (docs/API.md, v1).
 *
 * Every call goes to the same origin (`/api`, proxied to :8787 in development) with
 * `credentials: 'include'` so the HTTP-only `museum_session` cookie travels along.
 *
 * STATIC MODE: the museum must work as a plain static site. `checkBackend()` probes
 * GET /api/health once (short timeout); when it fails, `isOnline()` stays false and every
 * social feature hides itself. `?static` in the URL forces static mode.
 */
import type { ContentCollection, ExhibitionText, MuseumContent } from '../content/types'

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type Role = 'visitor' | 'admin'

export interface User {
  id: string
  email: string
  displayName: string
  role: Role
  createdAt: string
}

export type ItemKind = 'artwork' | 'exhibit' | 'infographic' | 'video' | 'object'

export interface Favorite {
  itemKind: ItemKind
  itemId: string
  createdAt: string
}

export interface Comment {
  id: string
  itemKind?: ItemKind | null
  itemId?: string | null
  body: string
  displayName: string
  createdAt: string
}

export interface AdminComment extends Comment {
  hidden?: boolean
  userId?: string
}

export type AnalyticsEventType =
  | 'session_start'
  | 'zone_enter'
  | 'zone_dwell'
  | 'item_view'
  | 'item_dwell'
  | 'panel_open'
  | 'inspect_open'
  | 'video_play'
  | 'tour_start'
  | 'tour_complete'

export interface AnalyticsEvent {
  /** epoch ms */
  t: number
  type: AnalyticsEventType
  zone?: string
  itemKind?: ItemKind
  itemId?: string
  seconds?: number
  tier?: string
  meta?: Record<string, string | number | boolean>
}

export interface AnalyticsSummary {
  sessions: number
  avgSessionSec: number
  zoneDwell: { zone: string; seconds: number }[]
  topItems: { itemKind: ItemKind; itemId: string; views: number; dwellSec: number }[]
  quality: { tier: string; count: number }[]
  daily: { date: string; sessions: number }[]
}

export type MediaFolder = 'artworks' | 'models' | 'videos' | 'audio' | 'textures'

export interface MediaRecord {
  id: string
  url: string
  filename: string
  mime: string
  size: number
  createdAt: string
}

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

const BASE = '/api'
const DEFAULT_TIMEOUT = 10000

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

async function request<T>(method: Method, path: string, body?: unknown, timeoutMs = DEFAULT_TIMEOUT): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData
  try {
    let res: Response
    try {
      res = await fetch(path.startsWith('/media') ? path : BASE + path, {
        method,
        credentials: 'include',
        signal: ctrl.signal,
        headers: body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : undefined,
        body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
      })
    } catch {
      throw new ApiError(0, ctrl.signal.aborted ? 'The museum server did not respond in time.' : 'Could not reach the museum server.')
    }
    const type = res.headers.get('content-type') ?? ''
    const data: unknown = type.includes('json') ? await res.json().catch(() => null) : null
    if (!res.ok) {
      const msg = data && typeof data === 'object' && 'error' in data ? String((data as { error: unknown }).error) : `Request failed (${res.status})`
      throw new ApiError(res.status, msg)
    }
    if (method === 'GET' && !type.includes('json')) {
      // e.g. the static host answered with index.html — treat as unavailable
      throw new ApiError(res.status || 0, 'Unexpected response from the museum server.')
    }
    return data as T
  } finally {
    clearTimeout(timer)
  }
}

const enc = encodeURIComponent

/* ------------------------------------------------------------------ */
/* Backend availability                                                */
/* ------------------------------------------------------------------ */

let online = false
let probe: Promise<boolean> | null = null

/** Probe GET /api/health once per page load. Resolves false in static mode; never throws. */
export function checkBackend(timeoutMs = 2500): Promise<boolean> {
  if (probe) return probe
  probe = (async () => {
    try {
      if (new URLSearchParams(window.location.search).has('static')) return false
      const h = await request<{ ok: boolean; version: string }>('GET', '/health', undefined, timeoutMs)
      online = !!h && h.ok === true
    } catch {
      online = false
    }
    return online
  })()
  return probe
}

/** Result of the last health probe (false until it resolves). */
export function isOnline() {
  return online
}

/* ------------------------------------------------------------------ */
/* Endpoints                                                           */
/* ------------------------------------------------------------------ */

export const api = {
  health: () => request<{ ok: true; version: string }>('GET', '/health'),
  content: () => request<MuseumContent>('GET', '/content'),

  auth: {
    register: (email: string, password: string, displayName: string) =>
      request<User>('POST', '/auth/register', { email, password, displayName }),
    login: (email: string, password: string) => request<User>('POST', '/auth/login', { email, password }),
    logout: () => request<{ ok: true }>('POST', '/auth/logout'),
    /** Current user, or null when not signed in (uses /auth/session: always 200, no console error). */
    me: async (): Promise<User | null> => {
      try {
        return (await request<{ user: User | null }>('GET', '/auth/session')).user
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403 || e.status === 404)) return null
        throw e
      }
    },
  },

  favorites: {
    list: () => request<Favorite[]>('GET', '/me/favorites'),
    add: (kind: ItemKind, id: string) => request<{ ok: true }>('PUT', `/me/favorites/${enc(kind)}/${enc(id)}`),
    remove: (kind: ItemKind, id: string) => request<{ ok: true }>('DELETE', `/me/favorites/${enc(kind)}/${enc(id)}`),
  },

  comments: {
    /** Approved comments for an item (newest first); omit both for the museum guestbook. */
    list: (item?: { kind: ItemKind; id: string }) =>
      request<Comment[]>('GET', item ? `/comments?itemKind=${enc(item.kind)}&itemId=${enc(item.id)}` : '/comments'),
    post: (body: string, item?: { kind: ItemKind; id: string }) =>
      request<Comment>('POST', '/comments', item ? { itemKind: item.kind, itemId: item.id, body } : { body }),
  },

  analytics: {
    send: (sessionId: string, events: AnalyticsEvent[]) =>
      request<unknown>('POST', '/analytics/events', { sessionId, events }),
    /** Fire-and-forget for page unload (text/plain JSON, accepted by the server). */
    beacon: (sessionId: string, events: AnalyticsEvent[]) => {
      try {
        const blob = new Blob([JSON.stringify({ sessionId, events })], { type: 'text/plain;charset=UTF-8' })
        return navigator.sendBeacon?.(`${BASE}/analytics/events`, blob) ?? false
      } catch {
        return false
      }
    },
  },

  admin: {
    content: {
      list: <T = unknown>(collection: ContentCollection) => request<T[]>('GET', `/admin/content/${collection}`),
      put: <T>(collection: ContentCollection, id: string, item: T) => request<T>('PUT', `/admin/content/${collection}/${enc(id)}`, item),
      remove: (collection: ContentCollection, id: string) => request<{ ok: true }>('DELETE', `/admin/content/${collection}/${enc(id)}`),
      exhibition: (text: ExhibitionText) => request<ExhibitionText>('PUT', '/admin/content/exhibition', text),
      welcome: (w: { title: string; body: string }) => request<{ title: string; body: string }>('PUT', '/admin/content/welcome', w),
      reset: () => request<{ ok: true }>('POST', '/admin/content/reset'),
    },
    media: {
      upload: (file: File | Blob, folder?: MediaFolder, filename?: string) => {
        const fd = new FormData()
        if (folder) fd.append('folder', folder)
        fd.append('file', file, filename ?? (file instanceof File ? file.name : 'upload'))
        return request<MediaRecord>('POST', '/admin/media', fd, 10 * 60 * 1000)
      },
      list: () => request<MediaRecord[]>('GET', '/admin/media'),
      remove: (id: string) => request<{ ok: true }>('DELETE', `/admin/media/${enc(id)}`),
    },
    comments: {
      list: () => request<AdminComment[]>('GET', '/admin/comments'),
      setHidden: (id: string, hidden: boolean) => request<AdminComment>('PATCH', `/admin/comments/${enc(id)}`, { hidden }),
      remove: (id: string) => request<{ ok: true }>('DELETE', `/admin/comments/${enc(id)}`),
    },
    analytics: (days = 7) => request<AnalyticsSummary>('GET', `/admin/analytics/summary?days=${days}`),
  },
}

/** Human-readable message for any thrown value. */
export function errorMessage(e: unknown) {
  if (e instanceof ApiError) {
    if (e.status === 429) return 'You are posting a little quickly — please wait a moment.'
    return e.message
  }
  return 'Something went wrong. Please try again.'
}
