/**
 * Load-time profile: phase timings, long main-thread tasks and TRANSFER SIZE by asset type.
 *
 *   node scripts/load-profile.mjs [baseUrl] [quality] [--json=out.json] [--swiftshader]
 *   e.g. node scripts/load-profile.mjs https://hand-block-museum.vercel.app medium --json=scripts/out/load-after.json
 *
 * Transfer = bytes on the wire (CDP Network.loadingFinished encodedDataLength, cache disabled) until the
 * scene reports ready, grouped into models / artworks / video / textures / js / css / fonts / other.
 * "firstLoad" = navigation → phase 'ready' (entry screen can be dismissed) and → sceneCompiled.
 * Compare runs before/after scripts/optimize-assets.mjs to measure the asset optimisation.
 */
import fs from 'node:fs'
import puppeteer from 'puppeteer-core'

const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const flag = (k) => process.argv.find((a) => a.startsWith(`--${k}`))
const base = (pos[0] ?? 'http://localhost:3000').replace(/\/$/, '')
const quality = pos[1] ?? 'medium'
const jsonOut = flag('json=')?.slice(7)
const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].find((p) => p && fs.existsSync(p))

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: flag('swiftshader') ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 1600, height: 900 },
})
const page = await browser.newPage()
await page.setCacheEnabled(false)
const cdp = await page.createCDPSession()
await cdp.send('Network.enable')
const reqs = new Map()
const bytes = {}
const count = {}
const kindOf = (url, type) => {
  const p = new URL(url).pathname
  if (/\.(glb|gltf|bin)$/i.test(p) || p.startsWith('/models/')) return 'models'
  if (p.startsWith('/artworks/') || /\/artworks\//.test(p)) return 'artworks'
  if (/\.(mp4|webm|m3u8|ts)$/i.test(p) || type === 'Media') return 'video'
  if (/\.(jpe?g|png|webp|avif|ktx2|hdr|exr)$/i.test(p)) return 'textures'
  if (type === 'Script' || /\.m?js$/.test(p)) return 'js'
  if (type === 'Stylesheet') return 'css'
  if (type === 'Font') return 'fonts'
  return 'other'
}
cdp.on('Network.responseReceived', (e) => reqs.set(e.requestId, kindOf(e.response.url, e.type)))
cdp.on('Network.loadingFinished', (e) => {
  const k = reqs.get(e.requestId) ?? 'other'
  bytes[k] = (bytes[k] ?? 0) + e.encodedDataLength
  count[k] = (count[k] ?? 0) + 1
})
await page.evaluateOnNewDocument(() => {
  window.__long = []
  new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ type: 'longtask', buffered: true })
})
const t0 = Date.now()
await page.goto(`${base}/gallery?quality=${quality}`)
let last = ''
const marks = {}
for (;;) {
  const ph = await page.evaluate(() => {
    const s = window.__museum?.store.getState()
    return s ? `${s.phase} compiled=${s.sceneCompiled}` : 'boot'
  })
  if (ph !== last) {
    const t = (Date.now() - t0) / 1000
    console.log(`${t.toFixed(1)} s  phase=${ph}`)
    if (ph.startsWith('ready') && marks.ready === undefined) marks.ready = t
    if (ph.includes('compiled=true') && marks.compiled === undefined) marks.compiled = t
    last = ph
  }
  const since = (Date.now() - t0) / 1000
  if ((marks.ready !== undefined && (marks.compiled !== undefined || since - marks.ready > 20)) || since > 120) break
  await new Promise((r) => setTimeout(r, 100))
}
await page.waitForNetworkIdle({ idleTime: 1000, timeout: 30000 }).catch(() => undefined)
const long = await page.evaluate(() => window.__long)
console.log('long tasks [start ms, duration ms]:', JSON.stringify(long.filter((l) => l[1] > 200)))
console.log('total long-task ms:', long.reduce((a, l) => a + l[1], 0))
const total = Object.values(bytes).reduce((a, b) => a + b, 0)
console.log('transfer by type (until ready + network idle):')
for (const [k, v] of Object.entries(bytes).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(9)} ${(v / 1048576).toFixed(2).padStart(7)} MB  (${count[k]} requests)`)
console.log(`  total     ${(total / 1048576).toFixed(2).padStart(7)} MB`)
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ base, quality, at: new Date().toISOString(), firstLoadSec: marks, longTaskMs: long.reduce((a, l) => a + l[1], 0), bytes, count, total }, null, 2) + '\n')
await browser.close()
