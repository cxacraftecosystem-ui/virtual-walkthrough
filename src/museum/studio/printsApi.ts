/** Client for the Visitors' Wall API (docs/API.md → "Visitor prints"). */
import { getSessionId } from '../analytics/tracker'

export interface WallPrint {
  id: string
  url: string
  displayName: string
  motif: string
  meta: Record<string, unknown>
  width: number
  height: number
  createdAt: string
}

export const PRINT_MAX_BYTES = 2 * 1024 * 1024

function staticMode() {
  try {
    return new URLSearchParams(window.location.search).has('static')
  } catch {
    return false
  }
}

const blobToDataUrl = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('Could not read the image'))
    r.readAsDataURL(b)
  })

export async function submitPrint(png: Blob, displayName: string, summary: { motif: string; meta: Record<string, unknown> }) {
  if (png.size > PRINT_MAX_BYTES) throw new Error('The print is larger than 2 MB')
  const res = await fetch('/api/prints', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ image: await blobToDataUrl(png), sessionId: getSessionId(), displayName, motif: summary.motif, meta: summary.meta }),
  })
  const data = (await res.json().catch(() => null)) as { error?: string; id?: string } | null
  if (!res.ok) throw new Error(data?.error ?? `The wall could not accept the print (HTTP ${res.status})`)
  return data as { id: string; status: 'pending'; createdAt: string }
}

let wall: Promise<WallPrint[]> | null = null
/** Latest approved prints (once per page load; [] when offline / static). */
export function approvedPrints(): Promise<WallPrint[]> {
  if (typeof window === 'undefined' || staticMode()) return Promise.resolve([])
  wall ??= fetch('/api/prints?status=approved&limit=24', { credentials: 'include' })
    .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? (r.json() as Promise<WallPrint[]>) : []))
    .then((list) => (Array.isArray(list) ? list.filter((p) => p && typeof p.url === 'string') : []))
    .catch(() => [])
  return wall
}
