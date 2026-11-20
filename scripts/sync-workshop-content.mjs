/**
 * Brings a deployed hand-block museum's database in line with the bundled config for
 *   1. the forty-one artwork slots: the workshop's twenty textiles (src/museum/config/workshopTextiles.ts) and the
 *      twenty-one open-access museum textiles (sourcedTextiles.ts);
 *   2. the printing block whose slot now holds a museum textile (exhibits.ts: it names no artwork any more);
 *   3. the salon key panel (infographics.ts 'info-salon'), which now introduces its seven fragments;
 *   4. the new descriptions of the workshop team's six 3D pieces in Gallery D (objects.ts TEAM_PIECES)
 * — touching nothing else.
 *
 *   MUSEUM_URL=https://… MUSEUM_ADMIN_EMAIL=… MUSEUM_ADMIN_PASSWORD=… node scripts/sync-workshop-content.mjs [--dry-run]
 *     [--exhibition <id|slug>]   (default: the site's default exhibition)
 *
 * Why: the database is seeded from the bundled config once (contentStore seedContent, onlyIfEmpty), so content
 * changes reach a live museum only through the admin API. This script acts as a careful curator would:
 *   - refuses to run until the server serves every textile image (/artworks/<slug>.jpg and its .1024/.2048.webp);
 *   - signs in, reads every item's stamp (GET /api/admin/content/stamps) and the current items;
 *   - changes an item only while it is still exactly what was seeded — never saved by a person (no `updatedBy`
 *     in its stamp) and still the stand-in: an artwork slot with its generated image, title and stand-in note;
 *     the block still naming that slot; the key panel still empty; a team piece with its previous description.
 *     The slot's maker link (if any) is kept, and a team piece keeps every field but its description. Anything
 *     a curator has changed or removed is LEFT and reported (exit 1);
 *   - every write sends the item's stamp as X-Expected-Updated-At, so an item saved by someone in the meantime
 *     is refused by the server (409): reported, skipped, exit 1;
 *   - a saved tour override (if the exhibition has one) is reported, not rewritten: its captions are the
 *     curators' own (the bundled tour's new captions ship with the deploy);
 *   - signs out, then reads the public content to confirm what visitors get.
 * Running it again is a no-op. --dry-run prints the plan and writes nothing. Never prints credentials or cookies.
 */
import { tsImport } from 'tsx/esm/api'

const args = process.argv.slice(2)
const arg = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const base = (arg('url') ?? process.env.MUSEUM_URL ?? '').replace(/\/+$/, '')
const email = arg('email') ?? process.env.MUSEUM_ADMIN_EMAIL
const password = process.env.MUSEUM_ADMIN_PASSWORD
const exhibition = arg('exhibition')
const dryRun = args.includes('--dry-run')
if (!base || !email || !password) {
  console.error('usage: MUSEUM_URL=… MUSEUM_ADMIN_EMAIL=… MUSEUM_ADMIN_PASSWORD=… node scripts/sync-workshop-content.mjs [--exhibition <id|slug>] [--dry-run]')
  process.exit(2)
}

const { WORKSHOP_TEXTILES } = await tsImport('../src/museum/config/workshopTextiles.ts', import.meta.url)
const { SOURCED_TEXTILES } = await tsImport('../src/museum/config/sourcedTextiles.ts', import.meta.url)
const { ARTWORKS, standInFor } = await tsImport('../src/museum/config/artworks.ts', import.meta.url)
const { EXHIBITS } = await tsImport('../src/museum/config/exhibits.ts', import.meta.url)
const { INFOGRAPHICS } = await tsImport('../src/museum/config/infographics.ts', import.meta.url)
const { TEAM_PIECES } = await tsImport('../src/museum/config/objects.ts', import.meta.url)

const TEXTILES = [...WORKSHOP_TEXTILES.map((t) => ({ ...t, from: 'workshop' })), ...SOURCED_TEXTILES.map((t) => ({ ...t, from: 'open access' }))]
const SOURCED_SLOTS = new Set(SOURCED_TEXTILES.map((t) => t.slot))

/** The team pieces' descriptions as first seeded (objects.ts before the workshop's descriptions). */
const OLD_TEAM_SHARED =
  'It comes from the workshop’s team. The 3D model carries no colour of its own, so the finish shown here is a stand-in; its maker, materials and story are still to be recorded.'
const PREVIOUS_TEAM_TEXT = {
  'gd-team-wooden-spoon-object': 'A wooden spoon, displayed upright, with a deep oval bowl and a handle worked in openwork.',
  'gd-team-bamboo-frame-on-table-object': 'An open, box-like bamboo frame on four legs, braced on every side with an octagonal ring of bamboo.',
  'gd-team-bamboo-sentinel-object':
    'Two upright bamboo poles rise from a length of bamboo laid on split-bamboo feet; a pierced bamboo cylinder hangs from a short arm near the top.',
  'gd-team-bamboo-stand-object': 'A length of bamboo with a surface in low relief, raised on a central post and slender curved legs.',
  'gd-team-ganesha-object': 'A figure of Ganesha in relief on an upright panel, above a stepped base.',
  'gd-team-ganesha-statue-object': 'A seated, four-armed figure of Ganesha on a lotus base, framed by a halo behind the head.',
}
const previousTeamDescription = (id) => PREVIOUS_TEAM_TEXT[id] && `${PREVIOUS_TEAM_TEXT[id]} ${OLD_TEAM_SHARED}`

const q = exhibition ? `?exhibition=${encodeURIComponent(exhibition)}` : ''
const label = (o) => `${o.id} (${o.title})`
/** JSON with sorted keys: a stored item may come back with its keys in another order (Postgres jsonb). */
const canon = (v) =>
  Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v ?? null)
/** Does the stored item hold every field of `want` (and none of `gone`)? Other stored keys are not ours to judge. */
const holds = (cur, want, gone = []) => Object.keys(want).every((k) => canon(cur[k]) === canon(want[k])) && gone.every((k) => cur[k] === undefined)
/** Fields a stand-in carried that its textile may not. */
const STAND_IN_ONLY = ['deepZoom', 'highRes', 'physicalWidth', 'metadata', 'context', 'year', 'exhibitId', 'artisan', 'material', 'technique']

let cookie = ''
/**
 * One admin API request. A dropped connection is retried (twice); safe for writes too: they carry the item's stamp,
 * so if a lost response hid a write that did land, the retry is refused (409) and reported, never applied twice.
 */
async function call(method, path, body, headers = {}) {
  let res
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(`${base}${path}`, {
        method,
        headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'manual',
      })
      break
    } catch (e) {
      if (attempt >= 2) throw e
      await new Promise((ok) => setTimeout(ok, 1000 * (attempt + 1)))
    }
  }
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

// 1. the images must be live first, or the slots would show "image unavailable"
const files = TEXTILES.flatMap((t) => [`/artworks/${t.slug}.jpg`, `/artworks/${t.slug}.1024.webp`, `/artworks/${t.slug}.2048.webp`])
const missing = []
for (const f of files) {
  // a dropped connection is retried (twice); a real 404 is not
  let r = null
  for (let attempt = 0; attempt < 3 && !r; attempt++) {
    r = await fetch(`${base}${f}`, { method: 'HEAD' }).catch(() => null)
    if (!r) await new Promise((ok) => setTimeout(ok, 1000 * (attempt + 1)))
  }
  if (!r?.ok) missing.push(`${f} (${r ? r.status : 'fetch failed'})`)
}
if (missing.length) {
  console.error(`not served yet — deploy public/artworks first:\n  ${missing.join('\n  ')}`)
  process.exit(1)
}
console.log(`images: all ${files.length} served`)

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

const counts = { written: 0, upToDate: 0, left: 0, conflicts: 0, failed: 0 }
try {
  const read = async (collection) => {
    const r = await call('GET', `/api/admin/content/${collection}${q}`)
    if (!r.res.ok) throw new Error(`reading ${collection} failed: ${why(r)}`)
    return new Map(r.json.map((x) => [x.id, x]))
  }
  const stampsR = await call('GET', `/api/admin/content/stamps${q}`)
  if (!stampsR.res.ok) throw new Error(`reading stamps failed: ${why(stampsR)}`)
  const stamps = stampsR.json.stamps ?? {}
  const [artworks, exhibits, infographics, objects] = [await read('artworks'), await read('exhibits'), await read('infographics'), await read('objects')]

  async function save(collection, item, stamp, verb) {
    if (dryRun) {
      console.log(`  would ${verb.padEnd(9)} ${label(item)}`)
      return
    }
    const r = await call('PUT', `/api/admin/content/${collection}/${encodeURIComponent(item.id)}${q}`, item, { 'x-expected-updated-at': stamp })
    if (r.res.status === 409) {
      counts.conflicts++
      console.log(`  CONFLICT  ${label(item)} — saved by ${r.json?.updatedBy ?? 'someone'} at ${r.json?.updatedAt ?? '?'}; skipped`)
      return
    }
    if (!r.res.ok) {
      counts.failed++
      console.log(`  FAILED    ${label(item)} — ${why(r)}`)
      return
    }
    counts.written++
    console.log(`  ${verb.padEnd(9)} ${label(item)}`)
  }
  const upToDate = (cur) => {
    counts.upToDate++
    console.log(`  ok        ${label(cur)}`)
  }
  const left = (what, why) => {
    counts.left++
    console.log(`  LEFT      ${what} — ${why}`)
  }

  // 3. the textiles
  console.log('the textiles (workshop and open access):')
  for (const t of TEXTILES) {
    const want = ARTWORKS.find((a) => a.id === t.slot)
    const was = standInFor(t.slot)
    const cur = artworks.get(t.slot)
    const stamp = stamps[`artworks/${t.slot}`]
    if (!cur) {
      left(t.slot, `not in the museum (removed by a curator?); hang “${t.title}” (${t.slug}.jpg) from the admin if wanted`)
      continue
    }
    const next = { ...want, ...(cur.artisanId && t.from === 'workshop' ? { artisanId: cur.artisanId } : {}) }
    if (holds(cur, next, STAND_IN_ONLY.filter((k) => next[k] === undefined))) {
      upToDate(cur)
      continue
    }
    // the stand-in as seeded (its note is today's DESIGN_NOTE or the earlier calibration note) and never saved since
    const standInNote = cur.description === was.description || /^Placeholder image generated for layout and lighting calibration\./.test(cur.description ?? '')
    const untouched = cur.placeholder === true && cur.image === was.image && cur.title === was.title && standInNote && !stamp?.updatedBy
    if (!untouched) {
      left(label(cur), `a curator has changed this slot; hang “${t.title}” (${t.slug}.jpg) from the admin if wanted`)
      continue
    }
    await save('artworks', next, stamp?.updatedAt ?? 'new', 'replace')
  }

  // 4. a block whose slot now holds a museum textile names no artwork
  console.log('the printing blocks:')
  for (const want of EXHIBITS.filter((e) => e.artworkId === '')) {
    const cur = exhibits.get(want.id)
    const stamp = stamps[`exhibits/${want.id}`]
    if (!cur) {
      left(want.id, 'not in the museum')
      continue
    }
    if (!cur.artworkId) {
      upToDate(cur)
      continue
    }
    if (!SOURCED_SLOTS.has(cur.artworkId) || cur.placeholder !== true || stamp?.updatedBy) {
      left(label(cur), `a curator has linked it to “${cur.artworkId}”; kept`)
      continue
    }
    await save('exhibits', { ...cur, artworkId: '' }, stamp.updatedAt, 'unlink')
  }

  // 5. the salon key panel
  console.log('the salon key panel:')
  {
    const want = INFOGRAPHICS.find((i) => i.id === 'info-salon')
    const cur = infographics.get('info-salon')
    const stamp = stamps['infographics/info-salon']
    if (!cur) left('info-salon', 'not in the museum')
    else if (holds(cur, want, want.placeholder ? [] : ['placeholder'])) upToDate(cur)
    // as seeded: an empty body, or the earlier "to be supplied" note
    else if (cur.placeholder !== true || !/^(|Curatorial text to be supplied by the workshop\..*)$/.test(cur.body ?? '') || stamp?.updatedBy) left(label(cur), 'a curator has written this panel; kept')
    else await save('infographics', { ...cur, ...want, placeholder: undefined }, stamp.updatedAt, 'write')
  }

  // 6. the team pieces' descriptions
  console.log('the workshop team’s 3D pieces:')
  for (const want of TEAM_PIECES.filter((o) => o.model)) {
    const cur = objects.get(want.id)
    const stamp = stamps[`objects/${want.id}`]
    if (!cur) {
      left(want.id, 'not in the museum')
      continue
    }
    const next = {
      ...cur,
      description: want.description,
      i18n: { ...cur.i18n, hi: { ...cur.i18n?.hi, description: want.i18n.hi.description }, bn: { ...cur.i18n?.bn, description: want.i18n.bn.description } },
    }
    if (holds(cur, { description: next.description, i18n: next.i18n })) {
      upToDate(cur)
      continue
    }
    if (cur.description !== previousTeamDescription(want.id)) {
      left(label(cur), 'its description was rewritten by a curator; kept')
      continue
    }
    await save('objects', next, stamp?.updatedAt ?? 'new', 'describe')
  }

  // 7. a saved tour override keeps its own captions
  const pub = await call('GET', `/api/content${q}`)
  if (pub.res.ok && Array.isArray(pub.json?.tour) && pub.json.tour.length) {
    console.log(`note: this exhibition has a saved tour (${pub.json.tour.length} stops); its captions are kept — update them in the admin to name the new textiles`)
  }
} catch (e) {
  counts.failed++
  console.error(String(e?.message ?? e))
} finally {
  await call('POST', '/api/auth/logout').catch(() => {})
  cookie = ''
}

// 8. what visitors get
const pub = await call('GET', `/api/content${q}`)
if (pub.res.ok) {
  const arts = new Map((pub.json.artworks ?? []).map((a) => [a.id, a]))
  const hung = (list) => list.filter((t) => arts.get(t.slot)?.image === `/artworks/${t.slug}.jpg`).length
  const objs = new Map((pub.json.objects ?? []).map((o) => [o.id, o]))
  const pieces = TEAM_PIECES.filter((o) => o.model)
  const described = pieces.filter((o) => objs.get(o.id)?.description === o.description).length
  const salon = (pub.json.infographics ?? []).find((i) => i.id === 'info-salon')
  console.log(
    `visitors get ${hung(WORKSHOP_TEXTILES)}/${WORKSHOP_TEXTILES.length} workshop textiles, ${hung(SOURCED_TEXTILES)}/${SOURCED_TEXTILES.length} open-access textiles, ` +
      `the salon key panel ${salon?.body ? 'written' : 'empty'}, and ${described}/${pieces.length} new team descriptions`,
  )
}
console.log(`${dryRun ? 'dry run — nothing written; ' : `written ${counts.written}, `}up to date ${counts.upToDate}, left ${counts.left}, conflicts ${counts.conflicts}, failed ${counts.failed}`)
process.exit(counts.left || counts.conflicts || counts.failed ? 1 : 0)
