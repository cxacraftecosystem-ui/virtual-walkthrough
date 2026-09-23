/**
 * Lightweight built-in client error reporting (no SDK).
 *
 *  - window `error` + `unhandledrejection`, React error boundaries (ErrorBoundary.tsx) and WebGL
 *    context loss (App.tsx) → POST /api/errors (sendBeacon, text/plain JSON; server: handlers/errors.ts).
 *  - Sampled (NEXT_PUBLIC_ERROR_SAMPLE_RATE, default 1), deduped (same fingerprint ≤ once / 30 s),
 *    capped at 20 reports per page load, PII-scrubbed (no query strings, emails, tokens; no user id).
 *  - Sentry-ready: when NEXT_PUBLIC_SENTRY_DSN is set every report is ALSO sent to Sentry's
 *    envelope endpoint (plain HTTP, no @sentry/* SDK).
 */

export type ErrorKind = 'error' | 'unhandledrejection' | 'react' | 'webgl' | 'manual'

export interface ErrorReport {
  kind: ErrorKind
  message: string
  stack?: string
  url: string
  ua: string
  tier?: string
  gpu?: string
  release?: string
  extra?: Record<string, string | number | boolean>
}

const ENDPOINT = '/api/errors'
const MAX_PER_PAGE = 20
const DEDUPE_MS = 30_000
const SAMPLE_RATE = (() => {
  const raw = process.env.NEXT_PUBLIC_ERROR_SAMPLE_RATE
  const n = Number(raw)
  return raw && Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : 1
})()
const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN ?? ''
const RELEASE = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? ''
const ENVIRONMENT = process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV ?? 'development'

let installed = false
let sent = 0
const recent = new Map<string, number>()
let gpuCache: string | undefined

/** Remove things that can identify a person or carry secrets. Exported for the server too. */
export function scrub(s: string): string {
  return s
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '<email>')
    .replace(/(https?:\/\/[^\s?#)'"]+)[?#][^\s)'":]*/g, '$1') // query strings / hashes
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g, '<jwt>')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '<token>')
}

function gpuInfo(): string | undefined {
  if (gpuCache !== undefined) return gpuCache || undefined
  gpuCache = ''
  try {
    const gl = window.__museum?.gl?.getContext()
    const ctx = gl ?? document.createElement('canvas').getContext('webgl')
    if (ctx) {
      const ext = ctx.getExtension('WEBGL_debug_renderer_info')
      gpuCache = String(ext ? ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ctx.getParameter(ctx.RENDERER)).slice(0, 200)
    }
  } catch {
    /* ignore */
  }
  return gpuCache || undefined
}

function currentTier(): string | undefined {
  try {
    return window.__museum?.store.getState().tier
  } catch {
    return undefined
  }
}

function toParts(err: unknown): { message: string; stack?: string; type: string } {
  if (err instanceof Error) return { message: err.message || err.name, stack: err.stack, type: err.name || 'Error' }
  if (typeof err === 'string') return { message: err, type: 'Error' }
  try {
    return { message: JSON.stringify(err)?.slice(0, 500) ?? String(err), type: 'Error' }
  } catch {
    return { message: String(err), type: 'Error' }
  }
}

/** Report an error. Safe to call anywhere (never throws, no-op on the server). */
export function reportError(err: unknown, opts: { kind?: ErrorKind; extra?: ErrorReport['extra']; componentStack?: string } = {}) {
  try {
    if (typeof window === 'undefined') return
    const kind = opts.kind ?? 'manual'
    const p = toParts(err)
    let stack = p.stack ? scrub(p.stack).slice(0, 3500) : undefined
    if (opts.componentStack) stack = `${stack ?? ''}\n--- component stack ---${scrub(opts.componentStack).slice(0, 1000)}`.slice(0, 4000)
    const message = scrub(p.message).slice(0, 500)
    const key = `${kind}|${message}`
    const now = Date.now()
    if ((recent.get(key) ?? 0) > now - DEDUPE_MS) return
    recent.set(key, now)
    if (sent >= MAX_PER_PAGE || Math.random() >= SAMPLE_RATE) return
    sent++
    const report: ErrorReport = {
      kind,
      message,
      stack,
      url: location.pathname.slice(0, 300),
      ua: navigator.userAgent.slice(0, 300),
      tier: currentTier(),
      gpu: gpuInfo(),
      release: RELEASE || undefined,
      extra: opts.extra,
    }
    const body = JSON.stringify(report)
    const blob = new Blob([body], { type: 'text/plain;charset=UTF-8' })
    if (!(navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, blob))) {
      void fetch(ENDPOINT, { method: 'POST', body, headers: { 'content-type': 'text/plain;charset=UTF-8' }, keepalive: true }).catch(() => undefined)
    }
    if (SENTRY_DSN) sendToSentry(report, p.type)
  } catch {
    /* reporting must never throw */
  }
}

/* ---------------- Sentry envelope API (https://develop.sentry.dev/sdk/envelopes/) ---------------- */

function sendToSentry(r: ErrorReport, type: string) {
  const m = /^(https?):\/\/([^@]+)@([^/]+)\/(?:(.*)\/)?(\d+)$/.exec(SENTRY_DSN.trim())
  if (!m) return
  const [, proto, key, host, path, projectId] = m
  const url = `${proto}://${host}/${path ? `${path}/` : ''}api/${projectId}/envelope/?sentry_key=${encodeURIComponent(key)}&sentry_version=7`
  const eventId = crypto.randomUUID().replace(/-/g, '')
  const frames = (r.stack ?? '')
    .split('\n')
    .map((l) => /(?:at\s+(?:(.+?)\s+\()?)?(\S+?):(\d+):(\d+)\)?\s*$/.exec(l.trim()))
    .filter((x): x is RegExpExecArray => !!x)
    .slice(0, 50)
    .map((x) => ({ function: x[1] || '?', filename: x[2], lineno: Number(x[3]), colno: Number(x[4]), in_app: true }))
    .reverse() // Sentry wants oldest → newest
  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: 'javascript',
    level: 'error',
    environment: ENVIRONMENT,
    ...(r.release ? { release: r.release } : {}),
    exception: { values: [{ type, value: r.message, ...(frames.length ? { stacktrace: { frames } } : {}) }] },
    request: { url: location.origin + r.url, headers: { 'User-Agent': r.ua } },
    tags: { kind: r.kind, tier: r.tier ?? 'unknown', gpu: (r.gpu ?? 'unknown').slice(0, 200) },
    ...(r.extra ? { extra: r.extra } : {}),
  }
  const envelope = [
    JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString(), dsn: SENTRY_DSN }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(event),
  ].join('\n')
  void fetch(url, { method: 'POST', body: envelope, headers: { 'content-type': 'text/plain;charset=UTF-8' }, keepalive: true, mode: 'no-cors' }).catch(
    () => undefined,
  )
}

/** Install the global listeners once (idempotent). */
export function installErrorReporting() {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', (e) => {
    // resource load errors (img/script) bubble here without `error`; ignore those (handled by loaders)
    // "Script error." = a cross-origin script (extension, third party) with muted details: nothing actionable
    if (!e.error && (!e.message || /^script error\.?$/i.test(e.message))) return
    reportError(e.error ?? e.message, { kind: 'error' })
  })
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason, { kind: 'unhandledrejection' }))
}
