/** Load-time profile: phase timings + long main-thread tasks.  node scripts/load-profile.mjs [baseUrl] */
import puppeteer from 'puppeteer-core'

const base = process.argv[2] ?? 'http://localhost:3000'
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 1600, height: 900 },
})
const page = await browser.newPage()
await page.evaluateOnNewDocument(() => {
  window.__long = []
  new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ type: 'longtask', buffered: true })
})
const t0 = Date.now()
await page.goto(`${base}/?quality=${process.argv[3] ?? 'medium'}`)
let last = ''
for (;;) {
  const ph = await page.evaluate(() => {
    const s = window.__museum?.store.getState()
    return s ? `${s.phase} compiled=${s.sceneCompiled}` : 'boot'
  })
  if (ph !== last) {
    console.log(`${((Date.now() - t0) / 1000).toFixed(1)} s  phase=${ph}`)
    last = ph
  }
  if (ph.startsWith('ready') || Date.now() - t0 > 90000) break
  await new Promise((r) => setTimeout(r, 100))
}
const long = await page.evaluate(() => window.__long)
console.log('long tasks [start ms, duration ms]:', JSON.stringify(long.filter((l) => l[1] > 200)))
console.log('total long-task ms:', long.reduce((a, l) => a + l[1], 0))
await browser.close()
