/**
 * Anonymous visit analytics → POST /api/analytics/events (docs/API.md).
 *
 * - Random session id in sessionStorage (no personal data).
 * - Events are queued and flushed every 10 s, and via navigator.sendBeacon on pagehide.
 * - Automatic events: session_start (tier), zone_enter / zone_dwell (visitor position polled
 *   2×/s), item_view / item_dwell (store.nearby & selection), panel_open, inspect_open,
 *   video_play (window event, see below).
 * - Manual: `track('tour_start')`, `track('tour_complete')`, `track('panel_open', { meta })`.
 *
 * CUSTOM WINDOW EVENT (for the video engineer):
 *   window.dispatchEvent(new CustomEvent('museum:video_play', { detail: { id: '<video id>' } }))
 *   Dispatch whenever a video actually starts playing (autoplay by proximity or user toggle).
 *   Repeated plays of the same id within 30 s are de-duplicated here.
 *
 * Never throws; a no-op when the backend is offline (static site).
 */
import { api, checkBackend, type AnalyticsEvent, type AnalyticsEventType, type ItemKind } from '../api/client'
import { zoneAt } from '../config/layout'
import { useMuseum } from '../state/store'
import { visitor } from '../state/visitor'
import { startCuratorTracking } from './curatorTracking'

const FLUSH_MS = 10000
const POLL_MS = 500
const MAX_BATCH = 200
const MAX_QUEUE = 2000
const SESSION_KEY = 'museum.sessionId'

let enabled = false
let started = false
/** Health probe answered (nothing is sent before). */
let ready = false
let queue: AnalyticsEvent[] = []
let sessionId = ''

function makeId() {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID()
  } catch {
    /* fall through */
  }
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function getSessionId() {
  if (sessionId) return sessionId
  try {
    sessionId = sessionStorage.getItem(SESSION_KEY) ?? ''
    if (!sessionId) {
      sessionId = makeId()
      sessionStorage.setItem(SESSION_KEY, sessionId)
    }
  } catch {
    sessionId = sessionId || makeId()
  }
  return sessionId
}

type Extra = Omit<AnalyticsEvent, 't' | 'type'>

/** Queue an analytics event. Safe to call any time (dropped when offline). */
export function track(type: AnalyticsEventType, extra: Extra = {}) {
  try {
    if (started && !enabled) return
    if (queue.length >= MAX_QUEUE) queue.shift()
    const ev: AnalyticsEvent = { t: Date.now(), type }
    for (const [k, v] of Object.entries(extra)) if (v !== undefined) (ev as unknown as Record<string, unknown>)[k] = v
    queue.push(ev)
  } catch {
    /* never throw */
  }
}

function flush(useBeacon = false) {
  try {
    if (!ready || !enabled || queue.length === 0) return
    const id = getSessionId()
    while (queue.length) {
      const batch = queue.splice(0, MAX_BATCH)
      if (useBeacon) {
        if (!api.analytics.beacon(id, batch)) void api.analytics.send(id, batch).catch(() => {})
      } else {
        void api.analytics.send(id, batch).catch((err: unknown) => {
          // client errors (4xx: malformed / rate-limited) would fail forever — drop that batch
          const status = (err as { status?: number })?.status ?? 0
          if (status >= 400 && status < 500 && status !== 429) return
          // put back (bounded) and retry next tick
          queue = [...batch, ...queue].slice(-MAX_QUEUE)
        })
        break // one batch per tick keeps things gentle
      }
    }
  } catch {
    /* never throw */
  }
}

const secs = (ms: number) => Math.round(ms / 100) / 10

/* ------------------------------------------------------------------ */
/* Automatic trackers                                                  */
/* ------------------------------------------------------------------ */

function startZoneTracking() {
  let zone: string | undefined
  let since = 0
  const close = (now: number) => {
    if (zone && now - since >= 1000) track('zone_dwell', { zone, seconds: secs(now - since) })
  }
  const poll = () => {
    try {
      if (useMuseum.getState().phase !== 'entered') return
      const z = zoneAt(visitor.x, visitor.z)?.id
      // keep the last zone while crossing thresholds/doorways (outside every rect)
      if (!z || z === zone) return
      const now = Date.now()
      close(now)
      zone = z
      since = now
      track('zone_enter', { zone })
    } catch {
      /* ignore */
    }
  }
  window.setInterval(poll, POLL_MS)
  return () => {
    close(Date.now())
    since = Date.now()
  }
}

function startItemTracking() {
  let current: { kind: ItemKind; id: string; since: number } | null = null
  const viewed = (s: ReturnType<typeof useMuseum.getState>) => s.selection ?? (s.nearby ? { kind: s.nearby.kind, id: s.nearby.id } : null)
  const close = (now: number) => {
    if (current && now - current.since >= 1000) {
      track('item_dwell', { itemKind: current.kind, itemId: current.id, seconds: secs(now - current.since), zone: zoneAt(visitor.x, visitor.z)?.id })
    }
  }
  useMuseum.subscribe((s, prev) => {
    try {
      // item view / dwell
      const v = viewed(s)
      if ((v?.kind ?? null) !== (current?.kind ?? null) || (v?.id ?? null) !== (current?.id ?? null)) {
        const now = Date.now()
        close(now)
        current = v ? { kind: v.kind, id: v.id, since: now } : null
        if (v) track('item_view', { itemKind: v.kind, itemId: v.id, zone: zoneAt(visitor.x, visitor.z)?.id })
      }
      // panels
      if (s.selection && (s.selection.kind !== prev.selection?.kind || s.selection.id !== prev.selection?.id)) {
        track('panel_open', { itemKind: s.selection.kind, itemId: s.selection.id, meta: { panel: 'info' } })
      }
      if (s.helpOpen && !prev.helpOpen) track('panel_open', { meta: { panel: 'help' } })
      if (s.mapOpen && !prev.mapOpen && s.phase === 'entered') track('panel_open', { meta: { panel: 'map' } })
      if (s.drawer && s.drawer !== prev.drawer) track('panel_open', { meta: { panel: s.drawer } })
      if (s.auth && !prev.auth) track('panel_open', { meta: { panel: 'auth' } })
      // 3D inspection: 'object:<id>' for scene objects, otherwise an exhibit id
      if (s.inspecting && s.inspecting !== prev.inspecting) {
        const [kind, id] = s.inspecting.startsWith('object:') ? (['object', s.inspecting.slice(7)] as const) : (['exhibit', s.inspecting] as const)
        track('inspect_open', { itemKind: kind, itemId: id })
      }
      // session start once the visitor enters
      if (s.phase === 'entered' && prev.phase !== 'entered') track('session_start', { tier: s.tier, meta: { quality: s.quality, coarse: isCoarse() } })
    } catch {
      /* ignore */
    }
  })
  return () => {
    close(Date.now())
    if (current) current.since = Date.now()
  }
}

function isCoarse() {
  try {
    return !!window.matchMedia?.('(pointer: coarse)').matches
  } catch {
    return false
  }
}

function startVideoTracking() {
  const last = new Map<string, number>()
  window.addEventListener('museum:video_play', (e: Event) => {
    try {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id
      if (!id) return
      const now = Date.now()
      if (now - (last.get(id) ?? 0) < 30000) return
      last.set(id, now)
      track('video_play', { itemKind: 'video', itemId: id, zone: zoneAt(visitor.x, visitor.z)?.id })
    } catch {
      /* ignore */
    }
  })
}

/**
 * Start the tracker once (UIOverlay calls this on mount). Events recorded before the
 * health probe resolves are kept and sent if the backend is reachable, dropped otherwise.
 */
export function startAnalytics() {
  if (started || typeof window === 'undefined') return
  try {
    if (new URLSearchParams(window.location.search).has('noanalytics')) return
    started = true
    enabled = true // provisional until the probe answers
    const closeZone = startZoneTracking()
    const closeItem = startItemTracking()
    startVideoTracking()
    startCuratorTracking(track) // 'pos' every 2 s + 'tour_step' (curator heatmap / funnel)
    // already entered (e.g. hot reload)
    const st = useMuseum.getState()
    if (st.phase === 'entered') track('session_start', { tier: st.tier })

    void checkBackend().then((ok) => {
      enabled = ok
      ready = true
      if (!ok) queue = []
    })

    window.setInterval(() => flush(false), FLUSH_MS)
    const onHide = () => {
      closeZone()
      closeItem()
      flush(true)
    }
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') onHide()
    })
  } catch {
    /* never throw */
  }
}
