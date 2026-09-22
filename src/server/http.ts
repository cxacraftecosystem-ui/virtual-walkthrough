/**
 * Minimal framework for Next.js Route Handlers (Web Request/Response, so the logic is also
 * testable without Next). Usage in app/api/.../route.ts:
 *
 *   export const runtime = 'nodejs'
 *   export const GET = route(async (c) => ({ hello: 'world' }))
 *
 * A handler returns data (sent as JSON, status `c.status`), or a Response. Throw HttpError
 * (or call `fail`) for 4xx/5xx; the body is always `{ error }`.
 */
import 'server-only'
import { requireAdminUser, requireUser, type User, userFromRequest } from './auth'
import { config } from './config'
import { services, type Services } from './services'
import { fail, HttpError } from './util'

export interface Call<P> extends Services {
  req: Request
  url: URL
  params: P
  /** Response status for returned data (default 200). */
  status: number
  /** Response headers (e.g. set-cookie). */
  headers: Headers
  ip: string
  user(): Promise<User | null>
  requireUser(): Promise<User>
  requireAdmin(): Promise<User>
  /** Parse the JSON body (application/json; text/plain only when `allowText`). */
  json(opts?: { allowText?: boolean; maxBytes?: number }): Promise<unknown>
}

type Ctx<P> = { params: Promise<P> }

function clientIp(req: Request) {
  const xf = req.headers.get('x-forwarded-for')
  return (xf ? xf.split(',')[0] : req.headers.get('x-real-ip'))?.trim() || 'local'
}

/** CSRF defence in depth (cookie is SameSite=Lax): state-changing calls must be same-origin. */
function checkOrigin(req: Request) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return
  const origin = req.headers.get('origin')
  if (!origin) return
  let host = ''
  try {
    host = new URL(origin).host
  } catch {
    /* invalid → rejected */
  }
  const allowed = [req.headers.get('host'), req.headers.get('x-forwarded-host'), ...config.extraOrigins]
  if (!allowed.includes(host)) fail(403, 'Cross-origin request rejected')
}

export function jsonResponse(data: unknown, status = 200, headers = new Headers()) {
  headers.set('content-type', 'application/json; charset=utf-8')
  if (!headers.has('cache-control')) headers.set('cache-control', 'no-store')
  headers.set('x-content-type-options', 'nosniff')
  return new Response(JSON.stringify(data), { status, headers })
}

export function route<P = Record<string, never>>(
  fn: (c: Call<P>) => Promise<unknown>,
  opts: { crossOrigin?: boolean } = {},
) {
  return async (req: Request, ctx?: Ctx<P>): Promise<Response> => {
    const headers = new Headers()
    try {
      if (!opts.crossOrigin) checkOrigin(req)
      const svc = await services()
      const params = ((ctx?.params ? await ctx.params : {}) ?? {}) as P
      let userP: Promise<User | null> | undefined
      const call: Call<P> = {
        ...svc,
        req,
        url: new URL(req.url),
        params,
        status: 200,
        headers,
        ip: clientIp(req),
        user: () => (userP ??= userFromRequest(svc.db, req)),
        requireUser: async () => requireUser(await call.user()),
        requireAdmin: async () => requireAdminUser(await call.user()),
        async json({ allowText = false, maxBytes = 1024 * 1024 } = {}) {
          const ct = req.headers.get('content-type') ?? ''
          const isJson = ct.includes('application/json') || ct.includes('+json')
          if (!isJson && !(allowText && ct.startsWith('text/plain'))) fail(415, 'Expected application/json')
          const text = await req.text()
          if (text.length > maxBytes) fail(413, 'Body too large')
          if (!text) return undefined
          try {
            return JSON.parse(text)
          } catch {
            return fail(400, 'Invalid JSON')
          }
        },
      }
      const out = await fn(call)
      if (out instanceof Response) return out
      return jsonResponse(out ?? { ok: true }, call.status, headers)
    } catch (err) {
      if (err instanceof HttpError) return jsonResponse({ error: err.message }, err.status, headers)
      console.error(`[museum] ${req.method} ${new URL(req.url).pathname} failed:`, err)
      return jsonResponse({ error: 'Internal server error' }, 500, headers)
    }
  }
}
