/**
 * Realtime session: one Supabase Realtime channel per exhibition (`live:<room>`).
 *
 *  presence  key = per-tab client id; meta { name, hand, joined, docent } (tracked on change)
 *  broadcast 'p'     visitor position { id, x, z, y, t }            — 5 Hz while moving, keep-alive when idle
 *  broadcast 'chat'  { tour, mid, from, name, text, t }             — sender + receiver rate-limited, filtered
 *  broadcast 'd'     SIGNED docent envelope { tour, from, seq, t, k, d, s }
 *                    k ∈ announce (d = { token, name }) | at | focus | mute | lower | chat | end
 *
 * Docent trust (see src/server/handlers/live.ts): the announce carries a server-minted HMAC token
 * binding the docent's user + public key; followers verify it with GET /api/live/verify, then
 * verify every envelope's ECDSA signature against that key (+ strictly increasing seq). Client
 * role claims are never trusted.
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import { useMuseum } from '../state/store'
import { visitor } from '../state/visitor'
import { itemSummary } from '../ui/items'
import { cleanChat, createWindowLimiter } from './chatFilter'
import { LIVE, LIVE_ROOM, SUPABASE_ANON_KEY, SUPABASE_URL, liveConfigured } from './config'
import { createDocentKeys, cryptoAvailable, importDocentKey, signingInput, signMessage, verifyMessage } from './crypto'
import { followDocent, installFollowOverride, resetFollow } from './follow'
import { liveToast, peers, useLive, type ChatMsg, type Peer } from './store'

/* ------------------------------------------------------------------ identity */

function sessionValue(key: string, make: () => string) {
  try {
    const v = sessionStorage.getItem(key)
    if (v) return v
    const n = make()
    sessionStorage.setItem(key, n)
    return n
  } catch {
    return make()
  }
}
function setSession(key: string, v: string | null) {
  try {
    if (v) sessionStorage.setItem(key, v)
    else sessionStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}
function getSession(key: string) {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

const rid = (n = 12) => {
  const a = new Uint8Array(n)
  crypto.getRandomValues(a)
  return Array.from(a, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('')
}

const K_ID = 'museum.live.id'
const K_ANON = 'museum.live.anon'
const K_JOINED = 'museum.live.joined'
const K_HOST = 'museum.live.host'

function displayName() {
  const u = useMuseum.getState().user
  if (u?.displayName) return u.displayName.slice(0, 40)
  const n = sessionValue(K_ANON, () => String(1 + Math.floor(Math.random() * 98)))
  return `Visitor ${n}`
}

/* ------------------------------------------------------------------ state */

let sb: SupabaseClient | null = null
let channel: RealtimeChannel | null = null
let everSubscribed = false

let started = false

interface VerifiedTour {
  tourId: string
  sub: string
  name: string
  docentId: string
  token: string
  exp: number
  key: CryptoKey
  lastSeq: number
  lastSeen: number
  lostAt: number | null
}
const tours = new Map<string, VerifiedTour>()
const verifyCache = new Map<string, Promise<{ sub: string; name: string; room: string; pub: string; exp: number } | null>>()

/** Docent side. */
let host: { tourId: string; key: CryptoKey; token: string; exp: number; seq: number; lastAnnounce: number; lastFocus: string } | null = null

const lastSent = { x: NaN, z: NaN, yaw: NaN, t: 0 }
const chatSent: number[] = []
const chatLimiter = createWindowLimiter(8, LIVE.chatWindowMs)

/* ------------------------------------------------------------------ public API */

export async function startLive() {
  if (started || !liveConfigured() || typeof window === 'undefined') {
    if (!liveConfigured()) useLive.getState().set({ status: 'unavailable' })
    return
  }
  started = true
  // automation / console handle (like window.__museum)
  ;(window as unknown as { __live?: unknown }).__live = { useLive, peers }
  const selfId = sessionValue(K_ID, () => rid(10))
  useLive.getState().set({ status: 'connecting', selfId, selfName: displayName() })
  try {
    sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 25 } },
    })
  } catch {
    useLive.getState().set({ status: 'unavailable' })
    return
  }
  openChannel(selfId)
  // Name follows sign-in / sign-out.
  useMuseum.subscribe((s, p) => {
    if (s.user !== p.user) {
      useLive.getState().set({ selfName: displayName() })
      void retrack()
    }
  })
  installFollowOverride(
    () => !!useLive.getState().joined && useLive.getState().following,
    () => {
      useLive.getState().set({ following: false })
      liveToast('Auto-follow paused — explore freely, then “Rejoin docent”')
    },
  )
  window.addEventListener('pagehide', () => {
    void channel?.untrack()
  })
  window.setInterval(tick, 100)
}

function openChannel(selfId: string) {
  if (!sb) return
  const ch = sb.channel(`live:${LIVE_ROOM}`, {
    config: { presence: { key: selfId, enabled: true }, broadcast: { self: false, ack: false } },
  })
  channel = ch
  ch.on('presence', { event: 'sync' }, onPresenceSync)
  ch.on('broadcast', { event: 'p' }, ({ payload }) => onPos(payload))
  ch.on('broadcast', { event: 'chat' }, ({ payload }) => onChat(payload))
  ch.on('broadcast', { event: 'd' }, ({ payload }) => void onDocent(payload))
  // Hide the feature when the first connection can't be made within ~15 s (the client keeps
  // retrying in the background and the UI reappears once it subscribes).
  const giveUp = window.setTimeout(() => {
    if (!everSubscribed) useLive.getState().set({ status: 'unavailable' })
  }, 15_000)
  ch.subscribe((status) => {
    const L = useLive.getState()
    if (status === 'SUBSCRIBED') {
      window.clearTimeout(giveUp)
      const first = !everSubscribed
      everSubscribed = true
      L.set({ status: 'online' })
      if (!first) liveToast('Live connection restored')
      void retrack()
      lastSent.t = 0
      // Resume a tour this tab was hosting before a reload.
      const resume = getSession(K_HOST)
      if (resume && !host) void startHosting(resume)
      else if (host) void announce(true)
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      if (everSubscribed) L.set({ status: 'reconnecting' })
    }
  })
}

export function isLiveOnline() {
  return useLive.getState().status === 'online'
}

async function retrack() {
  const L = useLive.getState()
  if (!channel || L.status !== 'online') return
  try {
    await channel.track({ name: displayName(), hand: L.handRaised, joined: L.joined, docent: L.hosting, t: Date.now() })
  } catch {
    /* ignored; retried on next change / reconnect */
  }
}

function send(event: string, payload: Record<string, unknown>) {
  if (!channel || useLive.getState().status !== 'online') return
  void channel.send({ type: 'broadcast', event, payload }).catch(() => {})
}

/* ------------------------------------------------------------------ presence */

function onPresenceSync() {
  if (!channel) return
  const state = channel.presenceState<{ name?: string; hand?: boolean; joined?: string | null; docent?: string | null }>()
  const L = useLive.getState()
  const now = Date.now()
  const seen = new Set<string>()
  for (const [id, metas] of Object.entries(state)) {
    if (id === L.selfId) continue
    const m = metas[metas.length - 1]
    if (!m) continue
    seen.add(id)
    const p = ensurePeer(id)
    p.name = String(m.name ?? 'Visitor').slice(0, 40)
    p.hand = !!m.hand
    p.joined = typeof m.joined === 'string' ? m.joined : null
    p.lastT = Math.max(p.lastT, now)
  }
  for (const id of [...peers.keys()]) if (!seen.has(id)) peers.delete(id)
  // Docent disconnected?
  for (const t of tours.values()) {
    const here = seen.has(t.docentId)
    if (!here && t.lostAt === null) t.lostAt = now
    if (here && t.lostAt !== null) t.lostAt = null
  }
  publishTours()
  refreshHostView()
  L.set({ peerCount: seen.size })
}

function ensurePeer(id: string): Peer {
  let p = peers.get(id)
  if (!p) {
    p = { id, name: 'Visitor', tx: 0, tz: 0, tyaw: 0, x: 0, z: 0, yaw: 0, has: false, lastT: Date.now(), hand: false, docentOf: null, joined: null }
    peers.set(id, p)
  }
  return p
}

function applyPos(p: Peer, x: number, z: number, yaw: number) {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(yaw)) return
  if (Math.abs(x) > 500 || Math.abs(z) > 500) return
  p.tx = x
  p.tz = z
  p.tyaw = yaw
  if (!p.has) {
    p.x = x
    p.z = z
    p.yaw = yaw
    p.has = true
  }
  p.lastT = Date.now()
}

function onPos(m: unknown) {
  if (!isObj(m) || typeof m.id !== 'string' || m.id === useLive.getState().selfId) return
  const p = peers.get(m.id)
  // Positions for ids not in presence are ignored; docents move via signed 'at' only.
  if (!p || p.docentOf) return
  applyPos(p, Number(m.x), Number(m.z), Number(m.y))
}

/* ------------------------------------------------------------------ chat */

function onChat(m: unknown) {
  const L = useLive.getState()
  if (!isObj(m) || typeof m.from !== 'string' || typeof m.text !== 'string' || typeof m.tour !== 'string') return
  const tour = L.hosting ?? L.joined
  if (!tour || m.tour !== tour) return
  if (L.muted.includes(m.from) || tours.get(tour)?.docentId === m.from) return // docent chat arrives signed only
  if (!chatLimiter(m.from)) return
  const text = cleanChat(m.text, LIVE.chatMaxLen)
  if (!text) return
  pushChat({ mid: String(m.mid ?? rid(6)).slice(0, 16), from: m.from, name: String(m.name ?? 'Visitor').slice(0, 40), text, t: Date.now(), docent: false })
}

function pushChat(msg: ChatMsg) {
  const L = useLive.getState()
  if (L.chat.some((c) => c.mid === msg.mid && c.from === msg.from)) return
  L.set({ chat: [...L.chat, msg].slice(-LIVE.chatHistory) })
}

/** Returns an error message or null. */
export function sendChat(raw: string): string | null {
  const L = useLive.getState()
  const tour = L.hosting ?? L.joined
  if (!tour) return 'Join a live tour to chat'
  if (L.selfMuted && !L.hosting) return 'The docent has muted chat for you'
  const text = cleanChat(raw, LIVE.chatMaxLen)
  if (!text) return null
  const now = Date.now()
  while (chatSent.length && now - chatSent[0] > LIVE.chatWindowMs) chatSent.shift()
  if (chatSent.length && now - chatSent[chatSent.length - 1] < LIVE.chatMinIntervalMs) return 'Slow down a little…'
  if (chatSent.length >= LIVE.chatBurst) return 'Too many messages — wait a few seconds'
  chatSent.push(now)
  const mid = rid(8)
  if (L.hosting) void sendSigned('chat', { mid, text })
  else send('chat', { tour, mid, from: L.selfId, name: L.selfName, text, t: now })
  pushChat({ mid, from: L.selfId, name: L.selfName, text, t: now, docent: !!L.hosting })
  return null
}

/* ------------------------------------------------------------------ tours: follower side */

function verifyToken(token: string) {
  let p = verifyCache.get(token)
  if (!p) {
    p = fetch(`/api/live/verify?token=${encodeURIComponent(token)}`, { credentials: 'omit', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (j && j.ok && isObj(j.claims) ? (j.claims as { sub: string; name: string; room: string; pub: string; exp: number }) : null))
      .catch(() => null)
      .then((claims) => {
        // Don't pin a transient failure (network / cold start): the next announce retries.
        if (!claims) window.setTimeout(() => verifyCache.delete(token), 5000)
        return claims
      })
    verifyCache.set(token, p)
    if (verifyCache.size > 200) verifyCache.delete(verifyCache.keys().next().value as string)
  }
  return p
}

async function onDocent(m: unknown) {
  if (!cryptoAvailable()) return
  if (!isObj(m)) return
  const { tour, from, seq, t, k, d, s } = m as Record<string, unknown>
  if (typeof tour !== 'string' || typeof from !== 'string' || typeof seq !== 'number' || typeof t !== 'number' || typeof k !== 'string' || typeof d !== 'string' || typeof s !== 'string') return
  if (tour.length > 32 || d.length > 4096) return
  const L = useLive.getState()
  if (from === L.selfId) return
  let data: Record<string, unknown>
  try {
    const parsed = JSON.parse(d)
    if (!isObj(parsed)) return
    data = parsed
  } catch {
    return
  }
  const input = signingInput(tour, seq, t, k, d)

  if (k === 'announce') {
    const token = typeof data.token === 'string' ? data.token : ''
    const known = tours.get(tour)
    if (known && known.token === token) {
      if (seq <= known.lastSeq || !(await verifyMessage(known.key, input, s))) return
      known.lastSeq = seq
      known.lastSeen = Date.now()
      known.lostAt = null
      known.docentId = from
      markDocent(known)
      publishTours()
      return
    }
    const claims = await verifyToken(token)
    if (!claims || claims.room !== LIVE_ROOM || claims.exp * 1000 < Date.now()) return
    if (known && known.sub !== claims.sub) return // someone else's tour id
    const key = await importDocentKey(claims.pub).catch(() => null)
    if (!key || !(await verifyMessage(key, input, s))) return
    const vt: VerifiedTour = { tourId: tour, sub: claims.sub, name: claims.name, docentId: from, token, exp: claims.exp, key, lastSeq: seq, lastSeen: Date.now(), lostAt: null }
    if (known) peersClearDocent(known)
    tours.set(tour, vt)
    markDocent(vt)
    publishTours()
    if (!known && getSession(K_JOINED) === tour && !L.joined) joinTour(tour)
    return
  }

  const vt = tours.get(tour)
  if (!vt || vt.docentId !== from || seq <= vt.lastSeq) return
  if (vt.exp * 1000 < Date.now() - 60_000) return
  if (!(await verifyMessage(vt.key, input, s))) return
  if (seq <= vt.lastSeq) return
  vt.lastSeq = seq
  vt.lastSeen = Date.now()
  vt.lostAt = null
  const joined = useLive.getState().joined === tour

  switch (k) {
    case 'at': {
      const p = ensurePeer(from)
      p.docentOf = tour
      applyPos(p, Number(data.x), Number(data.z), Number(data.y))
      break
    }
    case 'focus': {
      if (!joined) break
      if (typeof data.kind === 'string' && typeof data.id === 'string') {
        const title = itemSummary(data.kind as never, data.id)?.title ?? ''
        useLive.getState().set({ focus: { kind: data.kind, id: data.id, title } })
      } else useLive.getState().set({ focus: null })
      break
    }
    case 'mute': {
      if (!joined || typeof data.target !== 'string') break
      const S = useLive.getState()
      const muted = new Set(S.muted)
      if (data.muted) muted.add(data.target)
      else muted.delete(data.target)
      const me = data.target === S.selfId
      S.set({ muted: [...muted], ...(me ? { selfMuted: !!data.muted } : {}) })
      if (me) liveToast(data.muted ? 'The docent has muted your chat' : 'The docent has unmuted your chat')
      break
    }
    case 'lower': {
      if (joined && data.target === useLive.getState().selfId && useLive.getState().handRaised) {
        setHandRaised(false)
        liveToast(`${vt.name} has seen your raised hand`)
      }
      break
    }
    case 'chat': {
      if (!joined || typeof data.text !== 'string') break
      const text = cleanChat(data.text, LIVE.chatMaxLen)
      if (text) pushChat({ mid: String(data.mid ?? rid(6)).slice(0, 16), from, name: vt.name, text, t: Date.now(), docent: true })
      break
    }
    case 'end': {
      removeTour(tour, 'The live tour has ended — thank you for joining')
      break
    }
  }
}

function markDocent(vt: VerifiedTour) {
  const p = ensurePeer(vt.docentId)
  p.docentOf = vt.tourId
  p.name = vt.name
}
function peersClearDocent(vt: VerifiedTour) {
  const p = peers.get(vt.docentId)
  if (p && p.docentOf === vt.tourId) p.docentOf = null
}

function removeTour(tourId: string, message?: string) {
  const vt = tours.get(tourId)
  if (vt) peersClearDocent(vt)
  tours.delete(tourId)
  const L = useLive.getState()
  if (L.joined === tourId) {
    leaveTour()
    if (message) liveToast(message)
  }
  publishTours()
}

function publishTours() {
  const out: Record<string, { tourId: string; name: string; docentId: string; lost: boolean }> = {}
  for (const t of tours.values()) out[t.tourId] = { tourId: t.tourId, name: t.name, docentId: t.docentId, lost: t.lostAt !== null }
  const L = useLive.getState()
  const prev = L.tours
  const same = Object.keys(prev).length === Object.keys(out).length && Object.values(out).every((t) => prev[t.tourId] && prev[t.tourId].lost === t.lost && prev[t.tourId].name === t.name)
  if (!same) L.set({ tours: out })
}

export function joinTour(tourId: string) {
  if (!tours.has(tourId)) return
  const L = useLive.getState()
  setSession(K_JOINED, tourId)
  resetFollow()
  L.set({ joined: tourId, following: true, chat: [], muted: [], selfMuted: false, focus: null, chatOpen: true })
  void retrack()
  liveToast(`Joined ${tours.get(tourId)!.name}'s live tour — you'll follow automatically`)
}

export function leaveTour() {
  const L = useLive.getState()
  setSession(K_JOINED, null)
  L.set({ joined: null, focus: null, chat: [], handRaised: false, muted: [], selfMuted: false })
  if (visitor.walkTarget) visitor.walkTarget = null
  void retrack()
}

export function dismissInvite(tourId: string) {
  const L = useLive.getState()
  L.set({ dismissed: [...L.dismissed, tourId] })
}

export function setFollowing(v: boolean) {
  useLive.getState().set({ following: v })
  if (v) resetFollow()
}

export function setHandRaised(v: boolean) {
  useLive.getState().set({ handRaised: v })
  void retrack()
}

/* ------------------------------------------------------------------ tours: docent side */

export async function startHosting(resumeTourId?: string): Promise<string | null> {
  const L = useLive.getState()
  if (!cryptoAvailable()) return 'This browser cannot sign live-tour messages (needs HTTPS)'
  if (L.status !== 'online') return 'Live connection is not available'
  if (L.hosting || L.hostingStarting) return null
  L.set({ hostingStarting: true })
  try {
    if (L.joined) leaveTour()
    const { privateKey, pub } = await createDocentKeys()
    const res = await fetch('/api/live/token', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ room: LIVE_ROOM, pub }),
    })
    const j = (await res.json().catch(() => ({}))) as { token?: string; claims?: { exp: number }; error?: string }
    if (!res.ok || !j.token || !j.claims) {
      if (resumeTourId) setSession(K_HOST, null)
      return j.error ?? `Could not start the live tour (${res.status})`
    }
    const tourId = resumeTourId ?? rid(12)
    host = { tourId, key: privateKey, token: j.token, exp: j.claims.exp, seq: Date.now(), lastAnnounce: 0, lastFocus: '' }
    setSession(K_HOST, tourId)
    useLive.getState().set({ hosting: tourId, chat: [], muted: [], hands: [], followers: 0 })
    await retrack()
    await announce(true)
    lastSent.t = 0
    liveToast(resumeTourId ? 'Live tour resumed' : 'Your live tour has started — visitors are being invited')
    return null
  } catch {
    return 'Could not start the live tour'
  } finally {
    useLive.getState().set({ hostingStarting: false })
  }
}

export async function stopHosting() {
  if (!host) return
  await sendSigned('end', {})
  host = null
  setSession(K_HOST, null)
  useLive.getState().set({ hosting: null, hands: [], followers: 0, chat: [], muted: [] })
  void retrack()
}

async function sendSigned(k: string, data: Record<string, unknown>) {
  if (!host || !channel) return
  const h = host
  const seq = ++h.seq
  const t = Date.now()
  const d = JSON.stringify(data)
  const s = await signMessage(h.key, signingInput(h.tourId, seq, t, k, d))
  send('d', { tour: h.tourId, from: useLive.getState().selfId, seq, t, k, d, s })
}

async function announce(force = false) {
  if (!host) return
  const now = Date.now()
  if (!force && now - host.lastAnnounce < LIVE.announceMs) return
  host.lastAnnounce = now
  // Refresh the token (same key) well before it expires.
  if (host.exp * 1000 - now < 10 * 60_000) void refreshToken()
  await sendSigned('announce', { token: host.token, name: useLive.getState().selfName })
}

let refreshing = false
async function refreshToken() {
  if (!host || refreshing) return
  refreshing = true
  try {
    // A new key pair each time: the token binds exactly one public key.
    const { privateKey, pub } = await createDocentKeys()
    const res = await fetch('/api/live/token', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ room: LIVE_ROOM, pub }),
    })
    const j = (await res.json().catch(() => ({}))) as { token?: string; claims?: { exp: number } }
    if (res.ok && j.token && j.claims && host) {
      host.key = privateKey
      host.token = j.token
      host.exp = j.claims.exp
      await announce(true)
    }
  } finally {
    refreshing = false
  }
}

export function muteVisitor(id: string, muted: boolean) {
  const L = useLive.getState()
  if (!L.hosting) return
  const set = new Set(L.muted)
  if (muted) set.add(id)
  else set.delete(id)
  L.set({ muted: [...set] })
  void sendSigned('mute', { target: id, muted })
}

export function acknowledgeHand(id: string) {
  void sendSigned('lower', { target: id })
  const L = useLive.getState()
  L.set({ hands: L.hands.filter((h) => h.id !== id) })
}

function refreshHostView() {
  const L = useLive.getState()
  if (!L.hosting) return
  let followers = 0
  const hands: { id: string; name: string }[] = []
  for (const p of peers.values()) {
    if (p.joined !== L.hosting) continue
    followers++
    if (p.hand) hands.push({ id: p.id, name: p.name })
  }
  const changed = followers !== L.followers || hands.length !== L.hands.length || hands.some((h, i) => L.hands[i]?.id !== h.id)
  if (changed) L.set({ followers, hands })
}

/* ------------------------------------------------------------------ loop */

function tick() {
  const L = useLive.getState()
  const now = Date.now()
  if (L.status !== 'online') return
  const entered = useMuseum.getState().phase === 'entered'

  // Own position: 5 Hz while moving, keep-alive when idle.
  if (entered) {
    const moved = Math.hypot(visitor.x - lastSent.x, visitor.z - lastSent.z) > 0.05 || Math.abs(visitor.yaw - lastSent.yaw) > 0.035
    const interval = moved ? 1000 / LIVE.posHz : LIVE.idleMs
    if (now - lastSent.t >= interval || Number.isNaN(lastSent.x)) {
      lastSent.x = visitor.x
      lastSent.z = visitor.z
      lastSent.yaw = visitor.yaw
      lastSent.t = now
      const x = Math.round(visitor.x * 100) / 100
      const z = Math.round(visitor.z * 100) / 100
      const y = Math.round(visitor.yaw * 1000) / 1000
      if (host) void sendSigned('at', { x, z, y })
      else send('p', { id: L.selfId, x, z, y, t: now })
    }
  }

  if (host) {
    void announce()
    // Docent pointer: what the docent has open (or hovers).
    const st = useMuseum.getState()
    const f = st.selection ?? st.hovered
    const key = f ? `${f.kind}:${f.id}` : ''
    if (key !== host.lastFocus) {
      host.lastFocus = key
      void sendSigned('focus', f ? { kind: f.kind, id: f.id } : {})
    }
  }

  // Stale peers / lost docents.
  for (const [id, p] of peers) if (now - p.lastT > LIVE.staleMs && !p.docentOf) peers.delete(id)
  for (const t of tours.values()) {
    if (t.lostAt === null && now - t.lastSeen > 3 * LIVE.announceMs) t.lostAt = now
    if (t.lostAt !== null && now - t.lostAt > 90_000) removeTour(t.tourId, 'The docent has left — the live tour has ended')
    else if (t.exp * 1000 < now - 5 * 60_000) removeTour(t.tourId)
  }
  publishTours()

  // Follow the docent.
  if (L.joined && L.following && entered) {
    const vt = tours.get(L.joined)
    const p = vt ? peers.get(vt.docentId) : undefined
    if (p?.has && vt && vt.lostAt === null) followDocent(p.tx, p.tz, p.tyaw)
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
