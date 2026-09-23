/**
 * Asset optimiser (models + artwork images).  node scripts/optimize-assets.mjs [--models] [--artworks] [--force]
 *
 * MODELS — every .glb/.gltf under public/models (incl. cc0/<id>/) except public/models/opt/ is written to
 *   public/models/opt/<same relative dir>/<basename>.glb  (e.g. cc0/brass_pot_01/brass_pot_01_1k.gltf →
 *   opt/cc0/brass_pot_01.glb): dedup → prune → weld → textures (≤ 1024 px, re-encoded to WebP with
 *   EXT_texture_webp when smaller) → meshopt (reorder + KHR_mesh_quantization + EXT_meshopt_compression).
 *   The runtime decodes it with MeshoptDecoder (drei useGLTF enables it by default) and GLTFModel
 *   de-quantises attributes before merging.
 *
 * ARTWORKS — every public/artworks/*.jpg|png gets <name>.2048.webp and <name>.1024.webp (long edge,
 *   never upscaled). exhibits/artworkTexture.ts uses .1024.webp on Low/Medium and .2048.webp on
 *   High/Ultra, falling back to the original file.
 *
 * Image encoding: sharp is not installed, so images are decoded/resized/encoded in headless Chrome
 * (createImageBitmap → OffscreenCanvas → convertToBlob('image/webp')) through puppeteer-core.
 * Chrome: CHROME_PATH, else the usual Windows / Linux locations.
 *
 * Outputs are skipped when newer than their source (use --force). A size report is written to
 * public/models/opt/manifest.json and printed.
 */
import fs from 'node:fs'
import path from 'node:path'
import { Logger, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions'
import { dedup, meshopt, prune, weld } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import puppeteer from 'puppeteer-core'

const ROOT = path.resolve(import.meta.dirname, '..')
const MODELS = path.join(ROOT, 'public/models')
const OPT = path.join(MODELS, 'opt')
const ARTWORKS = path.join(ROOT, 'public/artworks')
const args = process.argv.slice(2)
const force = args.includes('--force')
const only = { models: args.includes('--models'), artworks: args.includes('--artworks') }
const doModels = only.models || !only.artworks
const doArtworks = only.artworks || !only.models

const MAX_TEXTURE = 1024
const WEBP_QUALITY = { color: 0.86, data: 0.92 } // normal/ORM maps get a higher quality
const ARTWORK_SIZES = [2048, 1024]
const ARTWORK_QUALITY = 0.85

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean)

/* ------------------------------------------------------------------ browser image codec */

let browser, page
async function codec() {
  if (page) return page
  const executablePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p))
  if (!executablePath) throw new Error('Chrome not found — set CHROME_PATH')
  browser = await puppeteer.launch({ executablePath, headless: 'new', args: ['--no-sandbox'] })
  page = await browser.newPage()
  await page.goto('about:blank')
  await page.evaluate(() => {
    const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const bytesToB64 = (bytes) => {
      let s = ''
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      return btoa(s)
    }
    /** Decode → fit within `max` (long edge, no upscale) → encode. Colour values are kept as stored. */
    window.__encode = async (b64, mime, max, type, quality) => {
      const blob = new Blob([b64ToBytes(b64)], { type: mime })
      const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
      const s = Math.min(1, max / Math.max(bmp.width, bmp.height))
      const w = Math.max(1, Math.round(bmp.width * s))
      const h = Math.max(1, Math.round(bmp.height * s))
      const canvas = new OffscreenCanvas(w, h)
      const g = canvas.getContext('2d', { alpha: true })
      g.imageSmoothingEnabled = true
      g.imageSmoothingQuality = 'high'
      g.drawImage(bmp, 0, 0, w, h)
      // alpha present? (WebP keeps it; we only need to know for reporting)
      const out = await canvas.convertToBlob({ type, quality })
      return { b64: bytesToB64(new Uint8Array(await out.arrayBuffer())), width: w, height: h, srcWidth: bmp.width, srcHeight: bmp.height, type: out.type }
    }
  })
  return page
}

async function encodeImage(bytes, mime, max, type, quality) {
  const p = await codec()
  const r = await p.evaluate((b64, mime, max, type, quality) => window.__encode(b64, mime, max, type, quality), Buffer.from(bytes).toString('base64'), mime, max, type, quality)
  if (r.type !== type) throw new Error(`browser could not encode ${type} (got ${r.type})`)
  return { ...r, bytes: new Uint8Array(Buffer.from(r.b64, 'base64')) }
}

/* ------------------------------------------------------------------ helpers */

const kb = (n) => `${(n / 1024).toFixed(0)} KB`
const newer = (out, ...srcs) => !force && fs.existsSync(out) && srcs.every((s) => fs.statSync(out).mtimeMs >= fs.statSync(s).mtimeMs)

function walk(dir, filter, skip = []) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (!skip.includes(p)) out.push(...walk(p, filter, skip))
    } else if (filter(e.name)) out.push(p)
  }
  return out
}

/** Total bytes a model costs to download: the .gltf/.glb plus its external .bin + images. */
function modelSourceBytes(file) {
  if (file.endsWith('.glb')) return fs.statSync(file).size
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  const dir = path.dirname(file)
  const uris = [...(json.buffers ?? []), ...(json.images ?? [])].map((x) => x.uri).filter((u) => u && !u.startsWith('data:'))
  return fs.statSync(file).size + uris.reduce((a, u) => a + fs.statSync(path.join(dir, decodeURI(u))).size, 0)
}
function modelSources(file) {
  if (file.endsWith('.glb')) return [file]
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  const dir = path.dirname(file)
  return [file, ...[...(json.buffers ?? []), ...(json.images ?? [])].map((x) => x.uri).filter((u) => u && !u.startsWith('data:')).map((u) => path.join(dir, decodeURI(u)))]
}

/** cc0/<id>/<id>_1k.gltf → opt/cc0/<id>.glb; anything else keeps its relative dir + basename. */
export function optimisedPathFor(file) {
  const rel = path.relative(MODELS, file).split(path.sep)
  const base = path.basename(file).replace(/\.(gltf|glb)$/i, '').replace(/_1k$/, '')
  if (rel[0] === 'cc0' && rel.length === 3) return path.join(OPT, 'cc0', `${base}.glb`)
  return path.join(OPT, ...rel.slice(0, -1), `${base}.glb`)
}

/* ------------------------------------------------------------------ models */

async function optimiseModel(io, file) {
  const out = optimisedPathFor(file)
  const before = modelSourceBytes(file)
  if (newer(out, ...modelSources(file))) return { file, out, before, after: fs.statSync(out).size, skipped: true }

  const doc = await io.read(file)
  await doc.transform(dedup(), prune(), weld())

  // textures: resize ≤ MAX_TEXTURE, WebP when it is smaller than the (resized) original
  const root = doc.getRoot()
  let webp = 0
  const texNotes = []
  for (const tex of root.listTextures()) {
    const img = tex.getImage()
    const mime = tex.getMimeType()
    if (!img || !['image/jpeg', 'image/png', 'image/webp'].includes(mime)) continue
    const slots = doc
      .getGraph()
      .listParentEdges(tex)
      .map((e) => e.getName())
    const isColor = slots.some((s) => /baseColor|emissive|diffuse|specularGlossiness/i.test(s))
    const q = isColor ? WEBP_QUALITY.color : WEBP_QUALITY.data
    const enc = await encodeImage(img, mime, MAX_TEXTURE, 'image/webp', q)
    const resized = enc.width !== enc.srcWidth
    if (enc.bytes.length < img.byteLength || resized) {
      tex.setImage(enc.bytes).setMimeType('image/webp')
      if (tex.getURI()) tex.setURI(tex.getURI().replace(/\.(jpe?g|png|webp)$/i, '.webp'))
      webp++
      texNotes.push(`${tex.getName() || tex.getURI()}: ${kb(img.byteLength)} → ${kb(enc.bytes.length)}${resized ? ` (${enc.srcWidth}→${enc.width}px)` : ''}`)
    }
  }
  if (webp) doc.createExtension(EXTTextureWebP).setRequired(true)

  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
  // single self-contained GLB (one request per model): point every accessor at one buffer
  const [buffer, ...extra] = root.listBuffers()
  if (extra.length) {
    for (const a of root.listAccessors()) a.setBuffer(buffer)
    for (const b of extra) b.dispose()
  }
  fs.mkdirSync(path.dirname(out), { recursive: true })
  await io.write(out, doc)
  return { file, out, before, after: fs.statSync(out).size, textures: texNotes }
}

/* ------------------------------------------------------------------ artworks */

async function optimiseArtwork(file) {
  const name = path.basename(file).replace(/\.(jpe?g|png)$/i, '')
  const mime = /\.png$/i.test(file) ? 'image/png' : 'image/jpeg'
  const before = fs.statSync(file).size
  const res = { file, before, variants: {} }
  let bytes
  for (const size of ARTWORK_SIZES) {
    const out = path.join(path.dirname(file), `${name}.${size}.webp`)
    if (newer(out, file)) {
      res.variants[size] = fs.statSync(out).size
      continue
    }
    bytes ??= fs.readFileSync(file)
    const enc = await encodeImage(bytes, mime, size, 'image/webp', ARTWORK_QUALITY)
    fs.writeFileSync(out, enc.bytes)
    res.variants[size] = enc.bytes.length
  }
  return res
}

/* ------------------------------------------------------------------ main */

const report = { generatedAt: new Date().toISOString(), models: [], artworks: [] }
try {
  if (doModels) {
    await MeshoptEncoder.ready
    await MeshoptDecoder.ready
    const io = new NodeIO().setLogger(new Logger(Logger.Verbosity.WARN)).registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })
    const files = walk(MODELS, (n) => /\.(gltf|glb)$/i.test(n), [OPT])
    console.log(`models: ${files.length}`)
    for (const f of files) {
      const r = await optimiseModel(io, f)
      report.models.push({ source: path.relative(ROOT, f).replaceAll('\\', '/'), output: path.relative(ROOT, r.out).replaceAll('\\', '/'), before: r.before, after: r.after })
      console.log(`  ${path.relative(MODELS, f)} → ${path.relative(MODELS, r.out)}  ${kb(r.before)} → ${kb(r.after)} (${Math.round((100 * r.after) / r.before)}%)${r.skipped ? '  [up to date]' : ''}`)
      for (const t of r.textures ?? []) console.log(`      ${t}`)
    }
  }
  if (doArtworks) {
    const files = walk(ARTWORKS, (n) => /\.(jpe?g|png)$/i.test(n))
    console.log(`artworks: ${files.length}`)
    for (const f of files) {
      const r = await optimiseArtwork(f)
      report.artworks.push({ source: path.relative(ROOT, f).replaceAll('\\', '/'), before: r.before, ...Object.fromEntries(Object.entries(r.variants).map(([k, v]) => [`webp${k}`, v])) })
      console.log(`  ${path.basename(f)}  ${kb(r.before)} → 2048: ${kb(r.variants[2048])}, 1024: ${kb(r.variants[1024])}`)
    }
  }
} finally {
  await browser?.close()
}

const sum = (list, k) => list.reduce((a, x) => a + (x[k] ?? 0), 0)
if (report.models.length) console.log(`models total: ${kb(sum(report.models, 'before'))} → ${kb(sum(report.models, 'after'))}`)
if (report.artworks.length)
  console.log(`artworks total: ${kb(sum(report.artworks, 'before'))} → 2048 WebP ${kb(sum(report.artworks, 'webp2048'))}, 1024 WebP ${kb(sum(report.artworks, 'webp1024'))}`)
if (doModels && doArtworks) {
  fs.mkdirSync(OPT, { recursive: true })
  fs.writeFileSync(path.join(OPT, 'manifest.json'), JSON.stringify(report, null, 2) + '\n')
}
