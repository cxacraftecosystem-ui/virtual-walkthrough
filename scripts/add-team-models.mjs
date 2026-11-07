/**
 * Adds the workshop team's pieces to a museum whose content already lives in its database.
 *   MUSEUM_URL=https://… MUSEUM_ADMIN_EMAIL=… MUSEUM_ADMIN_PASSWORD=… node scripts/add-team-models.mjs [--dry-run]
 *   node scripts/add-team-models.mjs --url http://localhost:3000 --email admin@museum.local [--exhibition <id|slug>]
 *     (the password comes from MUSEUM_ADMIN_PASSWORD, or --password — which lands in your shell history)
 *
 * Why: a database is seeded from the bundled config once (src/server/contentStore.ts seedContent with
 * onlyIfEmpty); later additions to src/museum/config/objects.ts reach it only through a reset, which
 * replaces every curator edit. This script adds ONLY the twelve Gallery D items of TEAM_PIECES (six mini
 * pedestals + the six pieces on them, read from objects.ts through tsx) to the hand-block site's default
 * exhibition (or --exhibition) with the admin API, as a curator would:
 *   POST /api/auth/login → for each item PUT /api/admin/content/objects/<id> with X-Expected-Updated-At: new,
 *   so an item that already exists — added before, or edited by a curator since — is never overwritten
 *   (409, reported as "already present"). Running it again is a no-op. Then it logs out.
 * Before writing it checks that the server serves every piece's GLB (public/models/team/, scripts/import-team-models.mjs),
 * so run it after the deploy that ships them. --dry-run reports what would be added and writes nothing.
 * To move items that are already there to a new layout in objects.ts, use scripts/place-team-models.mjs.
 *
 * Output: one line per item (id and title, never credentials or cookies) and a summary; exit 1 on any failure.
 */
import { tsImport } from 'tsx/esm/api'

const args = process.argv.slice(2)
const arg = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const base = (arg('url') ?? process.env.MUSEUM_URL ?? '').replace(/\/+$/, '')
const email = arg('email') ?? process.env.MUSEUM_ADMIN_EMAIL
const password = arg('password') ?? process.env.MUSEUM_ADMIN_PASSWORD
const exhibition = arg('exhibition')
const dryRun = args.includes('--dry-run')
if (!base || !email || !password) {
  console.error('usage: MUSEUM_URL=… MUSEUM_ADMIN_EMAIL=… MUSEUM_ADMIN_PASSWORD=… node scripts/add-team-models.mjs [--exhibition <id|slug>] [--dry-run]')
  process.exit(2)
}

const { TEAM_PIECES } = await tsImport('../src/museum/config/objects.ts', import.meta.url)
const q = exhibition ? `?exhibition=${encodeURIComponent(exhibition)}` : ''
const label = (o) => `${o.id} (${o.title})`

let cookie = ''
async function call(method, path, body, headers = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  })
  const text = await res.text()
  let json
  try {
    json = text ? JSON.parse(text) : undefined
  } catch {
    json = undefined
  }
  return { res, json }
}
const why = (r) => `${r.res.status} ${r.json?.message ?? r.json?.error ?? r.res.statusText}`

console.log(`museum: ${base}${exhibition ? `, exhibition ${exhibition}` : ' (default exhibition)'}${dryRun ? ' — dry run' : ''}`)

// 1. the GLBs must be live first, or the pieces would show their procedural stand-in
const models = [...new Set(TEAM_PIECES.map((o) => o.model).filter(Boolean))]
const missing = []
for (const m of models) {
  const r = await fetch(`${base}${m}`, { method: 'HEAD' })
  if (!r.ok) missing.push(`${m} (${r.status})`)
}
if (missing.length) {
  console.error(`not served yet — deploy public/models/team/ first:\n  ${missing.join('\n  ')}`)
  process.exit(1)
}
console.log(`models: all ${models.length} served`)

// 2. sign in (curator or above)
const login = await call('POST', '/api/auth/login', { email, password })
if (!login.res.ok) {
  console.error(`sign-in failed: ${why(login)}`)
  process.exit(1)
}
cookie = login.res.headers
  .getSetCookie()
  .map((c) => c.split(';')[0])
  .join('; ')
console.log(`signed in (${login.json?.role ?? 'unknown role'})`)

let added = 0
let present = 0
let failed = 0
try {
  if (dryRun) {
    const list = await call('GET', `/api/admin/content/objects${q}`)
    if (!list.res.ok) throw new Error(`listing objects failed: ${why(list)}`)
    const have = new Set(list.json.map((o) => o.id))
    for (const o of TEAM_PIECES) {
      if (have.has(o.id)) present++
      else added++
      console.log(`  ${have.has(o.id) ? 'already present' : 'would add      '}  ${label(o)}`)
    }
  } else {
    // pedestal before its piece, in the order of objects.ts
    for (const o of TEAM_PIECES) {
      const r = await call('PUT', `/api/admin/content/objects/${encodeURIComponent(o.id)}${q}`, o, { 'x-expected-updated-at': 'new' })
      if (r.res.ok) {
        added++
        console.log(`  added            ${label(o)}`)
      } else if (r.res.status === 409) {
        present++
        console.log(`  already present  ${label(o)}`)
      } else {
        failed++
        console.error(`  FAILED           ${label(o)}: ${why(r)}`)
      }
    }
  }
} catch (e) {
  failed++
  console.error(e instanceof Error ? e.message : String(e))
} finally {
  await call('POST', '/api/auth/logout').catch(() => undefined)
}

// 3. what visitors now get (the public content of the default exhibition / the named one)
if (!dryRun && !failed) {
  const pub = await call('GET', `/api/content${q}`)
  if (pub.res.ok) {
    const ids = new Set((pub.json?.objects ?? []).map((o) => o.id))
    console.log(`museum now serves ${TEAM_PIECES.filter((o) => ids.has(o.id)).length}/${TEAM_PIECES.length} of the team items`)
  }
}
console.log(`${dryRun ? 'would add' : 'added'} ${added}, already present ${present}${failed ? `, FAILED ${failed}` : ''}`)
process.exit(failed ? 1 : 0)
