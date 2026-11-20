/**
 * The workshop's textile photographs → public/artworks/<slug>.jpg (src/museum/config/workshopTextiles.ts).
 *
 *   node scripts/import-workshop-textiles.mjs "<…>/HAND BLOCK  IMAGES.pptx" [--verify]
 *
 * The deck has one photograph per slide (PNG, ~2048 px). Each slide crops its picture (<a:srcRect>, in
 * thousandths of a percent of each side); that crop is the team's framing, so the image is cut exactly as the
 * slide shows it. The photos went through an editor that stamps a small mark ~50–140 px in from the
 * bottom-right corner; every slide's crop already leaves it out but one (slide 2 keeps a sliver), so a crop
 * that would still reach the mark's square is extended past it, on whichever side costs fewer pixels.
 *
 * Output: JPEG (quality 90, 4:2:0, mozjpeg), sRGB, no metadata, never upscaled. Then run
 * `node scripts/optimize-assets.mjs --artworks` for the .1024/.2048.webp variants the walkthrough loads.
 * --verify writes nothing: it re-derives every crop and checks each file is there at that size, mark-free.
 */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { tsImport } from 'tsx/esm/api'
import { unzipSync, strFromU8 } from 'three/examples/jsm/libs/fflate.module.js'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'public/artworks')
const args = process.argv.slice(2)
const deck = args.find((a) => !a.startsWith('--'))
const verify = args.includes('--verify')
if (!deck) {
  console.error('usage: node scripts/import-workshop-textiles.mjs <deck.pptx> [--verify]')
  process.exit(2)
}

/** The editor's mark: a square this many px in from the right and bottom edges of the original photo. */
const MARK = { near: 50, far: 140 }
/** A crop edge closer to the corner than this (px) is moved past the mark. */
const MARK_CLEAR = 144

const { WORKSHOP_TEXTILES } = await tsImport('../src/museum/config/workshopTextiles.ts', import.meta.url)

const zip = unzipSync(new Uint8Array(fs.readFileSync(deck)))
const text = (name) => {
  if (!zip[name]) throw new Error(`${name} is not in the deck`)
  return strFromU8(zip[name])
}
const attr = (xml, tag, name) => new RegExp(`<${tag}\\b[^>]*\\b${name}="([^"]*)"`).exec(xml)?.[1]

// slide order = presentation order (ppt/presentation.xml sldIdLst → rels)
const presRels = Object.fromEntries([...text('ppt/_rels/presentation.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], 'Relationship', 'Id'), attr(m[0], 'Relationship', 'Target')]))
const slides = [...text('ppt/presentation.xml').matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)].map((m) => `ppt/${presRels[m[1]]}`)

let bad = 0
for (const t of WORKSHOP_TEXTILES) {
  const slidePath = slides[t.slide - 1]
  if (!slidePath) throw new Error(`the deck has no slide ${t.slide}`)
  const xml = text(slidePath)
  const pics = [...xml.matchAll(/<p:pic>[\s\S]*?<\/p:pic>/g)].map((m) => m[0])
  if (pics.length !== 1) throw new Error(`slide ${t.slide}: expected one picture, found ${pics.length}`)
  const rid = attr(pics[0], 'a:blip', 'r:embed')
  const rect = /<a:srcRect\b[^>]*\/?>/.exec(pics[0])?.[0] ?? ''
  const pct = (k) => Math.max(0, Number(attr(rect, 'a:srcRect', k) ?? 0)) / 100000
  const relsPath = slidePath.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels')
  const rel = [...text(relsPath).matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => attr(r, 'Relationship', 'Id') === rid)
  const media = path.posix.normalize(path.posix.join(path.posix.dirname(slidePath), attr(rel, 'Relationship', 'Target')))
  const src = Buffer.from(zip[media])
  const { width: W, height: H } = await sharp(src).metadata()

  // the slide's crop, in pixels of the original
  let x0 = Math.round(W * pct('l'))
  let y0 = Math.round(H * pct('t'))
  let x1 = W - Math.round(W * pct('r'))
  let y1 = H - Math.round(H * pct('b'))
  let note = ''
  // still reaching the mark's square (right edge past W − far and bottom edge past H − far)?
  if (x1 > W - MARK.far && y1 > H - MARK.far) {
    const costBottom = (y1 - (H - MARK_CLEAR)) * (x1 - x0)
    const costRight = (x1 - (W - MARK_CLEAR)) * (y1 - y0)
    if (costBottom <= costRight) {
      note = ` (bottom edge moved ${y1 - (H - MARK_CLEAR)} px up, past the mark)`
      y1 = H - MARK_CLEAR
    } else {
      note = ` (right edge moved ${x1 - (W - MARK_CLEAR)} px in, past the mark)`
      x1 = W - MARK_CLEAR
    }
  }
  const box = { left: x0, top: y0, width: x1 - x0, height: y1 - y0 }
  const markFree = x1 <= W - MARK.far || y1 <= H - MARK.far
  const file = path.join(OUT, `${t.slug}.jpg`)
  const label = `slide ${String(t.slide).padStart(2)} ${media.split('/').pop()} ${W}×${H} → ${t.slug}.jpg ${box.width}×${box.height} [${box.left},${box.top}]${note}`

  if (verify) {
    const have = fs.existsSync(file) ? await sharp(file).metadata() : null
    const ok = have && have.width === box.width && have.height === box.height && markFree
    if (!ok) bad++
    console.log(`${ok ? 'ok  ' : 'BAD '} ${label}${have ? '' : ' — missing'}${have && (have.width !== box.width || have.height !== box.height) ? ` — file is ${have.width}×${have.height}` : ''}`)
    continue
  }
  if (!markFree) throw new Error(`slide ${t.slide}: crop still reaches the mark`)
  await sharp(src)
    .extract(box)
    .flatten({ background: '#ffffff' })
    .toColorspace('srgb')
    .jpeg({ quality: 90, chromaSubsampling: '4:2:0', mozjpeg: true })
    .toFile(file)
  console.log(`${label}  ${(fs.statSync(file).size / 1024).toFixed(0)} KB`)
}
if (verify) {
  console.log(bad ? `${bad} problem(s)` : `all ${WORKSHOP_TEXTILES.length} textiles present, cropped as their slides, mark-free`)
  process.exit(bad ? 1 : 0)
}
console.log(`\n${WORKSHOP_TEXTILES.length} textiles written to public/artworks — now: node scripts/optimize-assets.mjs --artworks`)
