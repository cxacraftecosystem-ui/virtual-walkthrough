/**
 * PLACEHOLDER TEXTILE GENERATOR
 *
 *   run:  node scripts/generate-placeholders.mjs
 *
 * Starts a Vite dev server on port 5199 (or reuses one already running there),
 * opens scripts/placeholder-gen.html in headless Chrome via puppeteer-core, renders
 * each procedurally generated placeholder textile on a canvas and writes it as a
 * JPG to public/artworks/.
 *
 * Options (env):  CHROME_PATH=<path to chrome.exe>   ONLY=hero-01.jpg,study-02.jpg
 *
 * These images are generic stand-ins for layout / lighting calibration only; they make
 * no cultural or historical claim and are to be replaced by the workshop's textiles.
 */
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'public', 'artworks')
const PORT = 5199
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PAGE = `http://localhost:${PORT}/scripts/placeholder-gen.html`

async function serverAlreadyUp() {
  try {
    const r = await fetch(PAGE)
    return r.ok
  } catch {
    return false
  }
}

let server = null
if (!(await serverAlreadyUp())) {
  server = await createServer({
    root: ROOT,
    configFile: path.join(ROOT, 'vite.config.ts'),
    server: { port: PORT, strictPort: true, host: 'localhost', open: false },
    logLevel: 'warn',
  })
  await server.listen()
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu-sandbox'],
  protocolTimeout: 600_000,
})

try {
  const page = await browser.newPage()
  page.on('console', (m) => m.type() === 'error' && console.error('[page]', m.text()))
  page.on('pageerror', (e) => console.error('[page error]', e.message))
  await page.goto(PAGE, { waitUntil: 'load', timeout: 120_000 })
  await page.waitForFunction('window.placeholderReady === true', { timeout: 120_000 })

  await mkdir(OUT, { recursive: true })
  let files = await page.evaluate(() => window.PLACEHOLDER_SPECS)
  if (process.env.ONLY) {
    const only = process.env.ONLY.split(',').map((s) => s.trim())
    files = files.filter((f) => only.includes(f))
  }
  for (const file of files) {
    const t0 = Date.now()
    const dataUrl = await page.evaluate((f) => window.renderPlaceholder(f, 0.9), file)
    const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
    await writeFile(path.join(OUT, file), buf)
    console.log(`  ${file}  ${(buf.length / 1024).toFixed(0)} KB  (${Date.now() - t0} ms)`)
  }
  console.log(`Wrote ${files.length} placeholder textiles to ${path.relative(ROOT, OUT)}`)
} finally {
  await browser.close()
  if (server) await server.close()
}
