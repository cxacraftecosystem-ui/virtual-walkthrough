#!/usr/bin/env node
/**
 * Downloads a curated set of CC0 glTF models from Poly Haven (https://polyhaven.com)
 * at 1k texture resolution into public/models/cc0/<id>/ and records attribution in
 * public/models/cc0/CREDITS.json.
 *
 *   node scripts/download-cc0-models.mjs            # download missing models
 *   node scripts/download-cc0-models.mjs --force    # re-download everything
 *   node scripts/download-cc0-models.mjs wooden_stool_01 jug_01   # only these ids
 *
 * Each model lands as public/models/cc0/<id>/<id>_1k.gltf with its .bin and textures/
 * folder beside it; every relative URI inside the .gltf is checked (and rewritten to the
 * local layout if Poly Haven ever changes its structure). Files are md5-verified.
 *
 * All Poly Haven assets are CC0 (public domain) — attribution is not required but is
 * recorded anyway, and shown in CREDITS.json / scene object `credit` fields.
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'models', 'cc0')
const API = 'https://api.polyhaven.com'
const RES = '1k'
const UA = 'hand-block-printing-virtual-museum/1.0 (CC0 asset fetch)'
/** Hard ceiling for the whole set (bytes). */
const BUDGET = 80e6

/** Curated set — craft/museum props that suit a hand-block-printing workshop & garden. */
export const CURATED = [
  { id: 'potted_plant_01', use: 'atrium planters (large terracotta pedestal pot)' },
  { id: 'potted_plant_02', use: 'courtyard planter' },
  { id: 'potted_plant_04', use: 'courtyard planter (succulent)' },
  { id: 'planter_pot_clay', use: 'courtyard clay pot' },
  { id: 'wooden_stool_01', use: 'workshop stools' },
  { id: 'wicker_basket_01', use: 'workshop cloth baskets' },
  { id: 'wicker_basket_02', use: 'courtyard harvest basket' },
  { id: 'ceramic_vase_01', use: 'atrium desk / plinth vessel' },
  { id: 'ceramic_vase_03', use: 'atrium vessel' },
  { id: 'antique_ceramic_vase_01', use: 'atrium vessel' },
  { id: 'wooden_crate_01', use: 'workshop storage crate' },
  { id: 'brass_pot_01', use: 'workshop / dye area vessel' },
  { id: 'wooden_bucket_01', use: 'wash tank / courtyard bucket' },
  { id: 'brass_diya_lantern', use: 'information desk decorative lamp' },
]

const args = process.argv.slice(2)
const force = args.includes('--force')
const only = args.filter((a) => !a.startsWith('--'))

async function getJSON(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} — ${url}`)
  return r.json()
}

async function getBuffer(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } })
      if (!r.ok) throw new Error(`${r.status} ${r.statusText} — ${url}`)
      return Buffer.from(await r.arrayBuffer())
    } catch (e) {
      if (i >= tries) throw e
      await new Promise((res) => setTimeout(res, 800 * i))
    }
  }
}

const md5 = (buf) => createHash('md5').update(buf).digest('hex')

async function fetchFile(url, dest, expectMd5) {
  if (!force && existsSync(dest) && expectMd5) {
    const have = md5(await readFile(dest))
    if (have === expectMd5) return { bytes: 0, cached: true }
  }
  const buf = await getBuffer(url)
  if (expectMd5 && md5(buf) !== expectMd5) throw new Error(`md5 mismatch for ${url}`)
  await mkdir(dirname(dest), { recursive: true })
  await writeFile(dest, buf)
  return { bytes: buf.length, cached: false }
}

/** Ensure every relative uri in the gltf points to a file we downloaded; rewrite if not. */
function fixUris(gltf, localFiles) {
  const byBase = new Map(localFiles.map((p) => [posix.basename(p), p]))
  let changed = false
  for (const list of [gltf.buffers ?? [], gltf.images ?? []]) {
    for (const item of list) {
      if (!item.uri || item.uri.startsWith('data:')) continue
      const uri = decodeURI(item.uri)
      if (localFiles.includes(uri)) continue
      const alt = byBase.get(posix.basename(uri))
      if (!alt) throw new Error(`gltf references missing file: ${uri}`)
      item.uri = encodeURI(alt)
      changed = true
    }
  }
  return changed
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const creditsPath = join(OUT, 'CREDITS.json')
  let credits = []
  if (existsSync(creditsPath)) {
    try {
      credits = JSON.parse(await readFile(creditsPath, 'utf8')).models ?? []
    } catch {
      credits = []
    }
  }
  const list = only.length ? CURATED.filter((c) => only.includes(c.id)) : CURATED
  let total = 0
  let downloaded = 0
  const failed = []

  for (const { id, use } of list) {
    try {
      const [info, files] = await Promise.all([getJSON(`${API}/info/${id}`), getJSON(`${API}/files/${id}`)])
      const entry = files?.gltf?.[RES]?.gltf
      if (!entry) throw new Error(`no ${RES} glTF available`)
      const size = entry.size + Object.values(entry.include ?? {}).reduce((s, f) => s + f.size, 0)
      if (total + size > BUDGET) {
        console.warn(`skip ${id}: would exceed the ${(BUDGET / 1e6).toFixed(0)} MB budget`)
        continue
      }
      total += size
      const dir = join(OUT, id)
      const gltfName = `${id}_${RES}.gltf`
      const includes = Object.entries(entry.include ?? {})
      for (const [rel, f] of includes) {
        const r = await fetchFile(f.url, join(dir, ...rel.split('/')), f.md5)
        downloaded += r.bytes
      }
      // the .gltf itself (re-written only if its URIs need fixing)
      const gltfBuf = await getBuffer(entry.url)
      const gltf = JSON.parse(gltfBuf.toString('utf8'))
      const changed = fixUris(
        gltf,
        includes.map(([rel]) => rel),
      )
      await writeFile(join(dir, gltfName), changed ? JSON.stringify(gltf) : gltfBuf)
      downloaded += gltfBuf.length

      const record = {
        id,
        name: info.name,
        authors: Object.keys(info.authors ?? {}),
        license: 'CC0',
        url: `https://polyhaven.com/a/${id}`,
        file: `/models/cc0/${id}/${gltfName}`,
        dimensionsMm: info.dimensions,
        polycount: info.polycount,
        use,
      }
      credits = credits.filter((c) => c.id !== id).concat(record)
      console.log(`ok  ${id.padEnd(26)} ${(size / 1e6).toFixed(1).padStart(5)} MB  ${record.authors.join(', ')}`)
    } catch (e) {
      failed.push(id)
      console.error(`ERR ${id}: ${e.message}`)
    }
  }

  credits.sort((a, b) => a.id.localeCompare(b.id))
  await writeFile(
    creditsPath,
    JSON.stringify(
      {
        source: 'Poly Haven — https://polyhaven.com',
        license: 'CC0 1.0 Universal (public domain dedication) — https://creativecommons.org/publicdomain/zero/1.0/',
        note: 'Attribution is not required for CC0 assets; recorded here as good practice.',
        resolution: RES,
        models: credits,
      },
      null,
      2,
    ) + '\n',
  )
  console.log(`\n${list.length - failed.length}/${list.length} models, set size ${(total / 1e6).toFixed(1)} MB, fetched ${(downloaded / 1e6).toFixed(1)} MB`)
  console.log(`credits → ${creditsPath}`)
  if (failed.length) {
    console.error(`failed: ${failed.join(', ')} (procedural fallbacks will be used)`)
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
