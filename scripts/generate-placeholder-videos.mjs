/**
 * PLACEHOLDER FILM GENERATOR
 *
 *   run:  node scripts/generate-placeholder-videos.mjs            (all films)
 *         ONLY=theatre-film node scripts/generate-placeholder-videos.mjs
 *         VERIFY_ONLY=1 node scripts/generate-placeholder-videos.mjs   (just re-check existing files)
 *
 * Starts a Vite dev server on port 5199 (or reuses one already running there), opens
 * scripts/placeholder-video-gen.html in headless Chrome (GPU) via puppeteer-core and
 * renders each film OFFLINE with WebCodecs (VP9 video, Opus audio — the theatre film as
 * true 5.1 Opus multistream), muxed to WebM in the page. Writes to public/videos/:
 *
 *   <id>.webm   the film            <id>.jpg   its poster frame
 *
 * Afterwards every file is loaded back in the browser and checked: duration, frame size,
 * decoded audio channel count, and (for the 5.1 film) which channel is loudest during each
 * speaker test — both in the decoded buffer and live through MediaElementSource → splitter,
 * which is exactly how the museum routes it.
 *
 * Options (env):  CHROME_PATH=<path to chrome.exe>
 */
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'public', 'videos')
const PORT = 5199
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const ORIGIN = `http://localhost:${PORT}`
const PAGE = `${ORIGIN}/scripts/placeholder-video-gen.html`

async function serverAlreadyUp() {
  try {
    return (await fetch(PAGE)).ok
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
  headless: 'new',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  protocolTimeout: 1_200_000,
})

// Speaker-test windows of theatre-film (see TESTS in the page) and the expected loudest
// WebAudio channel (0 L, 1 R, 2 C, 3 LFE, 4 SL, 5 SR).
const THEATRE_PROBES = [
  [[4.4, 6.1], 0, 'FL'],
  [[6.9, 8.6], 2, 'C'],
  [[9.4, 11.1], 1, 'FR'],
  [[11.9, 13.6], 5, 'SR'],
  [[14.4, 16.1], 4, 'SL'],
  [[16.9, 18.6], 3, 'LFE'],
]

let failed = false
try {
  const page = await browser.newPage()
  page.on('console', (m) => m.type() === 'error' && console.error('[page]', m.text()))
  page.on('pageerror', (e) => console.error('[page error]', e.message))
  await page.goto(PAGE, { waitUntil: 'load', timeout: 120_000 })
  await page.waitForFunction('window.filmGenReady === true', { timeout: 120_000 })
  await mkdir(OUT, { recursive: true })

  let ids = await page.evaluate(() => window.FILM_IDS)
  if (process.env.ONLY) {
    const only = process.env.ONLY.split(',').map((s) => s.trim())
    ids = ids.filter((f) => only.includes(f))
  }

  if (!process.env.VERIFY_ONLY) {
    for (const id of ids) {
      const t0 = Date.now()
      const r = await page.evaluate((i) => window.renderFilm(i), id)
      const parts = []
      const STEP = 4 * 1024 * 1024
      for (let o = 0; o < r.size; o += STEP) parts.push(Buffer.from(await page.evaluate((a, b) => window.readOut(a, b), o, STEP), 'base64'))
      const buf = Buffer.concat(parts)
      await writeFile(path.join(OUT, `${id}.webm`), buf)
      if (r.poster) await writeFile(path.join(OUT, `${id}.jpg`), Buffer.from(r.poster.slice(r.poster.indexOf(',') + 1), 'base64'))
      console.log(`  ${id}.webm  ${(buf.length / 1e6).toFixed(2)} MB  ${r.frames} frames, ${r.audioPackets} audio packets  (${((Date.now() - t0) / 1000).toFixed(1)} s)`)
    }
  }

  // ---- verify ----
  console.log('Verifying…')
  for (const id of ids) {
    const probes = id === 'theatre-film' ? THEATRE_PROBES.map((p) => p[0]) : [[2, 2.8]]
    const v = await page.evaluate((u, p) => window.verifyFilm(u, p), `/videos/${id}.webm`, probes)
    console.log(`  ${id}: ${v.width}×${v.height}, ${v.duration.toFixed(2)} s, audio ${v.audioChannels} ch / ${v.audioDuration} s, ${(v.bytes / 1e6).toFixed(2)} MB, played to ${v.playedTo}s`)
    if (!(v.width > 0 && v.duration > 5 && Number.isFinite(v.duration) && v.playedTo > 2.2)) failed = true
    if (v.bytes > 15e6) {
      console.warn(`    WARNING: ${id} exceeds 15 MB`)
      failed = true
    }
    if (id === 'theatre-film') {
      THEATRE_PROBES.forEach(([, want, name], i) => {
        const d = v.decoded[i]
        const l = v.live[i]
        const ok = d.loudest === want && l.loudest === want
        if (!ok) failed = true
        console.log(`    ${name.padEnd(3)} expected ch${want}: decoded ch${d.loudest} [${d.rel.join(' ')}]  live ch${l.loudest} [${l.rel.join(' ')}]  ${ok ? 'OK' : 'MISMATCH'}`)
      })
    }
  }
} catch (e) {
  failed = true
  console.error(e)
} finally {
  await browser.close()
  if (server) await server.close()
}
if (failed) {
  console.error('Some checks failed.')
  process.exitCode = 1
} else console.log(`Placeholder films written to ${path.relative(ROOT, OUT)} and verified.`)
