/**
 * Admin: multi-exhibition state (the exhibition selected in the header switcher, persisted in
 * localStorage) + API calls for exhibitions, makers (artisans), tour stops and curator analytics.
 * Content calls in api.ts append `exQuery()` so every content page is scoped to the selection.
 */
import { useSyncExternalStore } from 'react'

export interface AdminExhibition {
  id: string
  slug: string
  title: string
  subtitle: string
  status: 'draft' | 'published'
  isDefault: boolean
  theme: { accent?: string }
  sort: number
  createdAt: string
  updatedAt: string
  path: string
  items: number
  hasTour: boolean
}

export interface AdminArtisan {
  id: string
  name: string
  cluster: string
  craft: string
  bio: string
  portrait: string
  contact: string
  website: string
  shopUrl: string
  commissionUrl: string
  verified: boolean
  placeholder: boolean
  sort: number
  createdAt?: string
  updatedAt?: string
}

export interface HeatmapData {
  exhibition: string
  from: string
  to: string
  zone: string | null
  cellSize: number
  sampleSec: number
  cells: [number, number, number][]
  totalSamples: number
  maxSamples: number
  zones: { zone: string; samples: number; seconds: number }[]
}

export interface CuratorData {
  exhibition: string
  from: string
  to: string
  funnel: { starts: number; completes: number; steps: { stopId: string; index: number; sessions: number }[] }
  attention: { itemKind: string; itemId: string; views: number; viewers: number; dwellSec: number; avgDwellSec: number }[]
}

export interface RetentionInfo {
  days: number
  defaultDays: number
  lastCleanup: { retentionDays: number; cutoff: string; deletedEvents: number; deletedHeatRows: number; ranAt: string } | null
}

/* ------------------------------------------------------------------ */
/* Selected exhibition (header switcher)                               */
/* ------------------------------------------------------------------ */

const KEY = 'museum.admin.exhibition'
let selected = ''
try {
  if (typeof window !== 'undefined') selected = window.localStorage.getItem(KEY) ?? ''
} catch {
  /* private mode */
}
const listeners = new Set<() => void>()

/** '' = the default exhibition. */
export const getSelectedExhibition = () => selected
export function setSelectedExhibition(id: string) {
  if (id === selected) return
  selected = id
  try {
    window.localStorage.setItem(KEY, id)
  } catch {
    /* ignore */
  }
  for (const l of listeners) l()
}
export function useSelectedExhibition() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => selected,
    () => '',
  )
}

/** `?exhibition=<id>` (or `&…` with `sep`) for content calls; '' for the default exhibition. */
export const exQuery = (sep: '?' | '&' = '?') => (selected ? `${sep}exhibition=${encodeURIComponent(selected)}` : '')

/* ------------------------------------------------------------------ */
/* Requests                                                            */
/* ------------------------------------------------------------------ */

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const isJson = (res.headers.get('content-type') ?? '').includes('json')
  const data = isJson ? await res.json() : null
  if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? res.statusText)
  return data as T
}
const enc = encodeURIComponent

export const exApi = {
  list: () => req<AdminExhibition[]>('GET', '/api/admin/exhibitions'),
  create: (b: { slug: string; title: string; subtitle?: string; theme?: { accent?: string } }) => req<AdminExhibition>('POST', '/api/admin/exhibitions', b),
  duplicate: (id: string, b: { slug: string; title?: string }) => req<AdminExhibition>('POST', `/api/admin/exhibitions/${enc(id)}/duplicate`, b),
  patch: (id: string, b: Partial<Pick<AdminExhibition, 'title' | 'subtitle' | 'slug' | 'theme' | 'status' | 'sort'>>) =>
    req<AdminExhibition>('PATCH', `/api/admin/exhibitions/${enc(id)}`, b),
  setDefault: (id: string) => req<AdminExhibition>('POST', `/api/admin/exhibitions/${enc(id)}/default`),
  remove: (id: string) => req<{ ok: true }>('DELETE', `/api/admin/exhibitions/${enc(id)}`),
  /** Tour stops of an exhibition (null = bundled tour). */
  tour: async (id: string) => (await req<{ tour?: unknown[] }>('GET', `/api/content?exhibition=${enc(id)}`)).tour ?? null,
  putTour: (id: string, stops: unknown[] | null) => req<{ stops: unknown[] | null }>('PUT', `/api/admin/content/tour?exhibition=${enc(id)}`, { stops }),

  artisans: () => req<AdminArtisan[]>('GET', '/api/admin/artisans'),
  putArtisan: (a: AdminArtisan) => req<AdminArtisan>('PUT', `/api/admin/artisans/${enc(a.id)}`, a),
  deleteArtisan: (id: string) => req<{ ok: true }>('DELETE', `/api/admin/artisans/${enc(id)}`),

  heatmap: (p: { exhibition: string; from: string; to: string; zone?: string }) =>
    req<HeatmapData>('GET', `/api/admin/analytics/heatmap?${new URLSearchParams(clean(p))}`),
  curator: (p: { exhibition: string; from: string; to: string; kind?: string }) =>
    req<CuratorData>('GET', `/api/admin/analytics/curator?${new URLSearchParams(clean(p))}`),
  exportUrl: (dataset: string, p: Record<string, string | undefined>) => `/api/admin/analytics/export?${new URLSearchParams(clean({ dataset, ...p }))}`,
  retention: () => req<RetentionInfo>('GET', '/api/admin/analytics/retention'),
  putRetention: (days: number) => req<RetentionInfo>('PUT', '/api/admin/analytics/retention', { days }),
  cleanup: () => req<RetentionInfo['lastCleanup']>('POST', '/api/admin/analytics/cleanup'),
}

function clean(p: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(p)) if (v) out[k] = v
  return out
}
