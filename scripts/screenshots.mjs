/**
 * Visual validation harness: opens the museum in Chrome (GPU), walks the demo path
 * by teleporting to key viewpoints, saves screenshots and reports console errors.
 *
 *   node scripts/screenshots.mjs [baseUrl] [quality] [only=name1,name2]
 *   (default baseUrl http://localhost:3000, quality high) → scripts/out/*.png
 */
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const base = process.argv[2] ?? 'http://localhost:3000'
const quality = process.argv[3] ?? 'high'
const only = (process.argv.find((a) => a.startsWith('only=')) ?? '').slice(5).split(',').filter(Boolean)
const width = Number(process.env.W ?? 1600)
const height = Number(process.env.H ?? 900)
const outDir = path.resolve('scripts/out')
fs.mkdirSync(outDir, { recursive: true })

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'

// name, x, z, compass heading (0 = north), pitch (deg)
const SHOTS = [
  // v3 layout (62 × 53 m compound)
  ['01-atrium-arrival', 0, 19.4, 0, 7],
  ['02-atrium-west-textile', -2.6, 13.2, 279, 12],
  ['03-atrium-look-back', 0, 9.6, 180, 8],
  ['04-reception', 0, 6.8, 0, 2],
  ['05-passage-mid', 0, -5.5, 0, 2],
  ['06-reveal-wall', 0.4, -15.4, 0, 6],
  ['07-around-reveal', -5.2, -19.4, 150, 3],
  ['08-court-centrepiece', 0.6, -23.65, 350, -8],
  ['09-court-product-wall', 0, -29.4, 0, 3],
  ['10-court-runner', 6.9, -26.85, 90, 2],
  ['11-court-west', 4, -27, 270, 4],
  ['12-gallery-a-south', -7.4, -9.5, 180, 3],
  ['13-salon-hang', -4.5, -4.5, 90, 3],
  ['14-hero-01', -7.2, -4.5, 270, 2],
  ['15-gallery-a-north', -3.9, -17, 180, 2],
  ['16-gallery-b', 3.9, -17, 180, 2],
  ['17-gallery-c', 7.4, -8.6, 160, 2],
  ['18-skylight', 0, -8, 0, 50],
  ['20-gallery-d-map-avenue', -12, -16.2, 270, 4],
  ['21-gallery-d-map', -25.8, -16.2, 270, 4],
  ['22-gallery-d-centrepiece', -20.2, -19, 0, 2],
  ['23-gallery-d-south', -20.6, -12, 180, 2],
  ['30-theatre', -12.5, 9.1, 270, 4],
  ['31-workshop', 11.6, 14.3, 95, -4],
  ['32-workshop-vats', 20.5, 6, 60, -8],
  ['33-courtyard', 20.6, -4.5, 0, 4],
  ['34-courtyard-back', 20.6, -30, 180, 6],
]

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', `--window-size=${width},${height}`],
  defaultViewport: { width, height, deviceScaleFactor: 1 },
})
const page = await browser.newPage()
const logs = []
page.on('console', (m) => {
  if (['error', 'warning', 'warn'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`)
})
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))
page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`))

const t0 = Date.now()
await page.goto(`${base}/?autostart&quality=${quality}`, { waitUntil: 'networkidle0', timeout: 120000 })
await page.waitForFunction(() => window.__museum?.store.getState().phase === 'entered', { timeout: 120000 })
console.log(`entered after ${((Date.now() - t0) / 1000).toFixed(1)} s`)
const renderer = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2')
  const ext = gl?.getExtension('WEBGL_debug_renderer_info')
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown'
})
console.log('GPU:', renderer)
await new Promise((r) => setTimeout(r, 3500))

for (const [name, x, z, yaw, pitch] of SHOTS) {
  if (only.length && !only.some((o) => name.includes(o))) continue
  await page.evaluate((a) => window.__museum.teleport(a[0], a[1], a[2], a[3]), [x, z, yaw, pitch])
  await new Promise((r) => setTimeout(r, 1600))
  const fps = await page.evaluate(
    () =>
      new Promise((res) => {
        let n = 0
        const s = performance.now()
        const f = () => (++n < 30 ? requestAnimationFrame(f) : res(Math.round((30 * 1000) / (performance.now() - s))))
        requestAnimationFrame(f)
      }),
  )
  await page.screenshot({ path: path.join(outDir, `${name}.png`) })
  console.log(`${name}  ~${fps} fps`)
}

fs.writeFileSync(path.join(outDir, 'console.log'), logs.join('\n'))
console.log(`console issues: ${logs.length} (see scripts/out/console.log)`)
for (const l of logs.slice(0, 25)) console.log('  ', l.slice(0, 300))
await browser.close()
