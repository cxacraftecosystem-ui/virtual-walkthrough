/**
 * Moves the workshop team's pieces to their place in src/museum/config/objects.ts (TEAM_GRID) in a museum whose
 * content already lives in its database — touching nothing but where they stand.
 *   MUSEUM_URL=https://… MUSEUM_ADMIN_EMAIL=… MUSEUM_ADMIN_PASSWORD=… node scripts/place-team-models.mjs [--dry-run]
 *   node scripts/place-team-models.mjs --url http://localhost:3000 --email admin@museum.local [--exhibition <id|slug>]
 *     (the password comes from MUSEUM_ADMIN_PASSWORD, or --password — which lands in your shell history)
 *
 * Why: scripts/add-team-models.mjs adds the twelve Gallery D items of TEAM_PIECES once and never overwrites
 * them; when their layout changes in objects.ts the database copies keep the old one. This script updates ONLY
 * the placement of exactly those twelve items (position and rotationDeg, and a pedestal's height) and keeps
 * every other field as it is in the database, so a curator's edits to titles, descriptions, images and so on
 * survive:
 *   POST /api/auth/login → GET /api/admin/content/stamps (each item's updatedAt) → GET /api/admin/content/objects
 *   → for each item whose placement differs: PUT /api/admin/content/objects/<id> with its current JSON, the new
 *   placement, and X-Expected-Updated-At: <its stamp>. An item changed by someone since the stamps were read
 *   gets 409 and is reported and skipped — never overwritten. Then it logs out.
 * Stamps are read before the items, so an item saved in between carries a newer stamp than the one sent and is
 * refused rather than overwritten. A missing item is reported (run add-team-models.mjs first). Running it again
 * is a no-op. --dry-run prints old → new placement for every item and writes nothing.
 *
 * Output: one line per item (id, title and placement — never credentials or cookies) and a summary; exit 1 on
 * any failure, conflict or missing item.
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
  console.error('usage: MUSEUM_URL=… MUSEUM_ADMIN_EMAIL=… MUSEUM_ADMIN_PASSWORD=… node scripts/place-team-models.mjs [--exhibition <id|slug>] [--dry-run]')
  process.exit(2)
}

const { TEAM_PIECES } = await tsImport('../src/museum/config/objects.ts', import.meta.url)
const q = exhibition ? `?exhibition=${encodeURIComponent(exhibition)}` : ''
const label = (o) => `${o.id} (${o.title})`

/** The placement fields this script owns: where an item stands, how it is turned, and a pedestal's height. */
function placementOf(o) {
  const p = { position: o.position }
  if (o.rotationDeg !== undefined) p.rotationDeg = o.rotationDeg
  if (o.kind === 'pedestal') p.height = o.height
  return p
}
const fmt = (p) =>
  `[${(p.position ?? []).map((v) => Number(v).toFixed(2)).join(', ')}]${p.rotationDeg !== undefined ? ` ${p.rotationDeg}°` : ''}${p.height !== undefined ? ` h ${p.height}` : ''}`
const samePlacement = (a, b) =>
  JSON.stringify(a.position) === JSON.stringify(b.position) && a.rotationDeg === b.rotationDeg && a.height === b.height

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

let moved = 0
let placed = 0
let missing = 0
let conflicts = 0
let failed = 0
try {
  // stamps first: an item saved after this read has a newer stamp than the one sent, so its PUT is refused
  const stamps = await call('GET', `/api/admin/content/stamps${q}`)
  if (!stamps.res.ok) throw new Error(`reading stamps failed: ${why(stamps)}`)
  const list = await call('GET', `/api/admin/content/objects${q}`)
  if (!list.res.ok) throw new Error(`listing objects failed: ${why(list)}`)
  const current = new Map(list.json.map((o) => [o.id, o]))
  for (const want of TEAM_PIECES) {
    const have = current.get(want.id)
    if (!have) {
      missing++
      console.log(`  missing          ${label(want)} — add it first (scripts/add-team-models.mjs)`)
      continue
    }
    const stamp = stamps.json?.stamps?.[`objects/${want.id}`]?.updatedAt
    const next = placementOf(want)
    const prev = { position: have.position, rotationDeg: have.rotationDeg, ...(have.kind === 'pedestal' ? { height: have.height } : {}) }
    const target = { ...prev, ...next }
    if (samePlacement(prev, target)) {
      placed++
      console.log(`  already placed   ${label(have)}  ${fmt(prev)}`)
      continue
    }
    if (dryRun) {
      moved++
      console.log(`  would move       ${label(have)}  ${fmt(prev)} → ${fmt(target)}`)
      continue
    }
    if (!stamp) {
      failed++
      console.error(`  FAILED           ${label(have)}: no stamp for it, not written`)
      continue
    }
    // the item exactly as stored, with only its placement changed (the API strips updatedAt/updatedBy)
    const body = { ...have, ...next }
    delete body.updatedAt
    delete body.updatedBy
    const r = await call('PUT', `/api/admin/content/objects/${encodeURIComponent(want.id)}${q}`, body, { 'x-expected-updated-at': stamp })
    if (r.res.ok) {
      moved++
      console.log(`  moved            ${label(have)}  ${fmt(prev)} → ${fmt(target)}`)
    } else if (r.res.status === 409) {
      conflicts++
      console.error(`  CONFLICT         ${label(have)}: changed at ${r.json?.updatedAt ?? '?'} by someone else — skipped, not overwritten`)
    } else {
      failed++
      console.error(`  FAILED           ${label(have)}: ${why(r)}`)
    }
  }
} catch (e) {
  failed++
  console.error(e instanceof Error ? e.message : String(e))
} finally {
  await call('POST', '/api/auth/logout').catch(() => undefined)
}

console.log(
  `${dryRun ? 'would move' : 'moved'} ${moved}, already placed ${placed}${missing ? `, missing ${missing}` : ''}${conflicts ? `, CONFLICTS ${conflicts}` : ''}${failed ? `, FAILED ${failed}` : ''}`,
)
process.exit(failed || conflicts || missing ? 1 : 0)
