/**
 * DEEP ZOOM PYRAMIDS FOR THE FIVE HERO PLACEHOLDERS
 *
 *   run:  node scripts/generate-deepzoom.mjs
 *
 * Renders each hero placeholder textile at very high resolution in headless Chrome
 * (scripts/placeholder-gen.html in its "high-res" mode: thread-scale plain weave, slubs,
 * loose fibres, ink sitting in the weave) and slices it in the page into a Deep Zoom Image
 * pyramid (JPEG, 254 px tiles + 1 px overlap) written to public/deepzoom/<id>/image.dzi +
 * image_files/. Uses the same browser tiler as the admin "Deep zoom" tool
 * (src/admin/pipeline/dziTiler.ts).
 *
 * Options (env):
 *   LONG=9000        long side in px (default 9000 — keeps the five pyramids ≈ 45 MB)
 *   QUALITY=0.74     JPEG quality
 *   THREAD=3.2       thread pitch in px at full resolution
 *   ONLY=hero-01,hero-03
 *   CHROME_PATH=<chrome.exe>
 *
 * PLACEHOLDERS ONLY: generic stand-ins that make no cultural or historical claim; replace
 * them with photographs of the workshop's textiles (admin → Capture tools → Deep zoom).
 */
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'
import { mkdir, rm, writeFile, readdir, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'public', 'deepzoom')
const PORT = 5199
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PAGE = `http://localhost:${PORT}/scripts/placeholder-gen.html`
const LONG = Number(process.env.LONG ?? 9000)
const QUALITY = Number(process.env.QUALITY ?? 0.74)
const THREAD = Number(process.env.THREAD ?? 3.2)
const HEROES = ['hero-01', 'hero-02', 'hero-03', 'hero-04', 'hero-05']
const ids = process.env.ONLY ? process.env.ONLY.split(',').map((s) => s.trim()) : HEROES

async function serverAlreadyUp() {
  try {
    return (await fetch(PAGE)).ok
  } catch {
    return false
  }
}

async function dirSize(dir) {
  let total = 0
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    total += e.isDirectory() ? await dirSize(p) : (await stat(p)).size
  }
  return total
}

let server = null
if (!(await serverAlreadyUp())) {
  server = await createServer({
    root: ROOT,
    configFile: path.join(ROOT, 'vite.config.ts'),
    // no file watcher: this script writes thousands of tiles under public/ (the watcher would crash)
    server: { port: PORT, strictPort: true, host: 'localhost', open: false, watch: null, hmr: false },
    logLevel: 'warn',
  })
  await server.listen()
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  // software canvas: GPU readback of 80+ MP canvases fails on memory-constrained GPUs
  args: ['--no-sandbox', '--disable-gpu', '--js-flags=--max-old-space-size=4096'],
  protocolTimeout: 4 * 3_600_000, // a 9k×9k render can take a while on a busy machine
})

try {
  const page = await browser.newPage()
  page.on('console', (m) => m.type() === 'error' && console.error('[page]', m.text()))
  page.on('pageerror', (e) => console.error('[page error]', e.message))

  let target = ''
  const madeDirs = new Set()
  await page.exposeFunction('saveDeepZoomTiles', async (batch) => {
    for (const [rel, b64] of batch) {
      const file = path.join(target, rel)
      const dir = path.dirname(file)
      if (!madeDirs.has(dir)) {
        await mkdir(dir, { recursive: true })
        madeDirs.add(dir)
      }
      await writeFile(file, Buffer.from(b64, 'base64'))
    }
  })

  await page.goto(PAGE, { waitUntil: 'load', timeout: 900_000 })
  await page.waitForFunction('window.placeholderReady === true', { timeout: 900_000 })

  for (const id of ids) {
    target = path.join(OUT, id)
    await rm(target, { recursive: true, force: true })
    await mkdir(target, { recursive: true })
    const t0 = Date.now()
    const r = await page.evaluate(
      (file, o) => window.renderDeepZoom(file, o),
      `${id}.jpg`,
      { longSide: LONG, threadPx: THREAD, quality: QUALITY },
    )
    if (r.tiles !== r.expected) throw new Error(`${id}: wrote ${r.tiles} tiles, expected ${r.expected}`)
    await writeFile(path.join(target, 'image.dzi'), r.xml)
    console.log(
      `  ${id}  ${r.width}×${r.height}  ${r.tiles} tiles  ${(r.bytes / 1048576).toFixed(1)} MB  (render ${(r.renderMs / 1000).toFixed(1)} s, total ${((Date.now() - t0) / 1000).toFixed(1)} s)`,
    )
  }
  const total = await dirSize(OUT)
  console.log(`public/deepzoom: ${(total / 1048576).toFixed(1)} MB total`)
  if (total > 60 * 1048576) console.warn('  ⚠ over the 60 MB budget — lower LONG or QUALITY')
} finally {
  await browser.close()
  if (server) await server.close()
}
