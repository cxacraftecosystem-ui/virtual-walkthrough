/*
 * Service worker — offline support for the virtual museum (registered in production only,
 * see src/museum/pwa/ServiceWorkerRegistration.tsx).
 *
 *   cache-first     hashed build assets (/_next/static), /fonts, web fonts, /videos, /deepzoom
 *   stale-while-    /artworks /models /textures /decor /brand /audio — URLs are not content-hashed,
 *   revalidate      so a replaced file is picked up on the next visit (revalidated at most every 6 h)
 *   network-first   GET /api/* (public content: falls back to the last good copy offline)
 *   network-first   page navigations (falls back to the cached page, then /gallery)
 *   never cached    /api/admin, /api/auth, /api/me, /api/live, /api/errors, /api/analytics,
 *                   non-GET requests, Range (partial) requests, opaque / non-200 responses,
 *                   and anything marked Cache-Control: no-store / private
 *
 * The static cache is capped at MAX_STATIC entries (oldest dropped first), so build chunks from
 * earlier deploys do not pile up. Bump VERSION to invalidate every cache. A new worker waits until the page asks it to
 * take over (postMessage 'SKIP_WAITING' from the "update available" toast).
 */
const VERSION = 'v2'
const STATIC = `hbp-static-${VERSION}`
const TILES = `hbp-tiles-${VERSION}`
const API = `hbp-api-${VERSION}`
const PAGES = `hbp-pages-${VERSION}`
const KEEP = [STATIC, TILES, API, PAGES]
const MAX_TILES = 2500
const MAX_API = 200
const MAX_STATIC = 400
/** Stale-while-revalidate: refresh a cached copy in the background at most this often. */
const REVALIDATE_MS = 6 * 60 * 60 * 1000

const IMMUTABLE_PREFIXES = ['/_next/static/', '/fonts/', '/videos/']
const SWR_PREFIXES = ['/artworks/', '/models/', '/textures/', '/decor/', '/brand/', '/audio/']
const NEVER_API = ['/api/admin', '/api/auth', '/api/me', '/api/live', '/api/errors', '/api/analytics']

self.addEventListener('install', (event) => {
  // precache the app shell entry points (best effort — never block install on a failure)
  event.waitUntil(
    caches
      .open(PAGES)
      .then((c) => Promise.allSettled(['/gallery', '/guide', '/manifest.webmanifest', '/favicon.svg'].map((u) => c.add(new Request(u, { credentials: 'same-origin' })))))
      .catch(() => undefined),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((n) => n.startsWith('hbp-') && !KEEP.includes(n)).map((n) => caches.delete(n)))
      await trim(STATIC, MAX_STATIC).catch(() => undefined)
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING' || (event.data && event.data.type === 'SKIP_WAITING')) self.skipWaiting()
})

function cacheable(res) {
  if (!res || res.status !== 200 || res.type === 'opaque' || res.type === 'error') return false
  const cc = (res.headers.get('cache-control') || '').toLowerCase()
  return !cc.includes('no-store') && !cc.includes('private')
}

async function trim(cacheName, max) {
  const c = await caches.open(cacheName)
  const keys = await c.keys()
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i])
}

async function cacheFirst(req, cacheName, max) {
  const c = await caches.open(cacheName)
  const hit = await c.match(req)
  if (hit) return hit
  const res = await fetch(req)
  if (cacheable(res)) {
    c.put(req, res.clone()).then(() => (max ? trim(cacheName, max) : undefined)).catch(() => undefined)
  }
  return res
}

/** Serve the cached copy immediately; refresh it in the background when it is older than REVALIDATE_MS. */
async function staleWhileRevalidate(event, req, cacheName, max) {
  const c = await caches.open(cacheName)
  const hit = await c.match(req)
  const refresh = () =>
    fetch(req).then((res) => {
      if (cacheable(res)) return c.put(req, res.clone()).then(() => (max ? trim(cacheName, max) : undefined)).then(() => res)
      return res
    })
  if (!hit) return refresh()
  const date = Date.parse(hit.headers.get('date') || '')
  if (!Number.isFinite(date) || Date.now() - date > REVALIDATE_MS) event.waitUntil(refresh().catch(() => undefined))
  return hit
}

async function networkFirst(req, cacheName, max, fallbackUrl) {
  const c = await caches.open(cacheName)
  try {
    const res = await fetch(req)
    if (cacheable(res)) c.put(req, res.clone()).then(() => (max ? trim(cacheName, max) : undefined)).catch(() => undefined)
    return res
  } catch (err) {
    const hit = (await c.match(req, { ignoreSearch: req.mode === 'navigate' })) || (fallbackUrl ? await c.match(fallbackUrl) : undefined)
    if (hit) return hit
    throw err
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET' || req.headers.has('range')) return
  const url = new URL(req.url)
  const sameOrigin = url.origin === self.location.origin
  const isFont = req.destination === 'font' || /^https:\/\/fonts\.(gstatic|googleapis)\.com$/.test(url.origin)

  if (sameOrigin && url.pathname.startsWith('/api/')) {
    if (NEVER_API.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`))) return
    event.respondWith(networkFirst(req, API, MAX_API))
    return
  }
  if (sameOrigin && url.pathname.startsWith('/deepzoom/')) {
    event.respondWith(cacheFirst(req, TILES, MAX_TILES))
    return
  }
  if ((sameOrigin && IMMUTABLE_PREFIXES.some((p) => url.pathname.startsWith(p))) || isFont) {
    event.respondWith(cacheFirst(req, STATIC, MAX_STATIC))
    return
  }
  if (sameOrigin && SWR_PREFIXES.some((p) => url.pathname.startsWith(p))) {
    event.respondWith(staleWhileRevalidate(event, req, STATIC, MAX_STATIC))
    return
  }
  if (sameOrigin && req.mode === 'navigate' && !url.pathname.startsWith('/admin')) {
    event.respondWith(networkFirst(req, PAGES, 40, '/gallery'))
  }
})
