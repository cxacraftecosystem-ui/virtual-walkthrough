/**
 * Open-access museum photographs → public/artworks/<slug>.jpg (src/museum/config/sourcedTextiles.ts).
 *
 *   node scripts/import-sourced-textiles.mjs [--from <dir with <slot>.jpg>] [--only slot,slot] [--verify]
 *
 * Each image is the museum's own file (`source.image`: the Art Institute's IIIF 3000 px, Cleveland's "print" JPEG,
 * Smithsonian IDS) — downloaded, or read from --from (files named by slot, as fetched from those addresses) —
 * cut to `crop` (the cloth inside the photographer's backdrop) where the config gives one, converted from its
 * embedded colour profile (often Adobe RGB / eciRGB) to sRGB, never upscaled, long edge ≤ 2600 px, JPEG q88.
 * Then run `node scripts/optimize-assets.mjs --artworks` for the .1024/.2048.webp variants.
 * --verify writes nothing: it checks each file is there at the size the crop and cap give.
 */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { tsImport } from 'tsx/esm/api'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'public/artworks')
const LONG_EDGE = 2600
const UA = 'hand-block-printing-virtual-museum/1.0 (open-access image fetch)'
const args = process.argv.slice(2)
const opt = (n) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined)
const from = opt('from')
const only = opt('only')?.split(',')
const verify = args.includes('--verify')

const { SOURCED_TEXTILES } = await tsImport('../src/museum/config/sourcedTextiles.ts', import.meta.url)

async function original(t) {
  if (from) return fs.readFileSync(path.join(from, `${t.slot}.jpg`))
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(t.source.image, { headers: { 'user-agent': UA } })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      return Buffer.from(await res.arrayBuffer())
    } catch (e) {
      if (attempt >= 2) throw new Error(`${t.slot}: ${t.source.image}: ${e.message}`)
      await new Promise((ok) => setTimeout(ok, 2000 * (attempt + 1)))
    }
  }
}
const expectedSize = (w, h) => {
  const s = Math.min(1, LONG_EDGE / Math.max(w, h))
  return { w: Math.round(w * s), h: Math.round(h * s) }
}

let bad = 0
for (const t of SOURCED_TEXTILES.filter((x) => !only || only.includes(x.slot))) {
  const file = path.join(OUT, `${t.slug}.jpg`)
  if (verify) {
    const have = fs.existsSync(file) ? await sharp(file).metadata() : null
    const want = t.crop ? expectedSize(t.crop.width, t.crop.height) : null
    const ok = have && (!want || (Math.abs(have.width - want.w) <= 1 && Math.abs(have.height - want.h) <= 1)) && Math.max(have.width, have.height) <= LONG_EDGE
    if (!ok) bad++
    console.log(`${ok ? 'ok  ' : 'BAD '} ${t.slot.padEnd(10)} ${t.slug}.jpg ${have ? `${have.width}×${have.height}` : 'missing'}${want ? ` (expected ${want.w}×${want.h})` : ''}`)
    continue
  }
  const src = await original(t)
  const meta = await sharp(src).metadata()
  let img = sharp(src)
  if (t.crop) {
    const c = t.crop
    if (c.left < 0 || c.top < 0 || c.left + c.width > meta.width || c.top + c.height > meta.height) throw new Error(`${t.slot}: crop outside the ${meta.width}×${meta.height} image`)
    img = img.extract(c)
  }
  await img
    .resize({ width: LONG_EDGE, height: LONG_EDGE, fit: 'inside', withoutEnlargement: true })
    .toColourspace('srgb')
    .jpeg({ quality: 88, chromaSubsampling: '4:2:0', mozjpeg: true })
    .toFile(file)
  const out = await sharp(file).metadata()
  console.log(`${t.slot.padEnd(10)} ${t.source.museum} ${t.source.accession.padEnd(12)} ${meta.width}×${meta.height}${meta.icc ? ' (profile converted)' : ''}${t.crop ? ' cropped' : ''} → ${t.slug}.jpg ${out.width}×${out.height} ${(fs.statSync(file).size / 1024).toFixed(0)} KB`)
}
if (verify) {
  console.log(bad ? `${bad} problem(s)` : 'all present at their expected size')
  process.exit(bad ? 1 : 0)
}
console.log('\nnow: node scripts/optimize-assets.mjs --artworks')
