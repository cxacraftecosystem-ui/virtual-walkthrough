/** CPU profile of startup; prints top self-time functions.  node scripts/cpu-profile.mjs [baseUrl] */
import puppeteer from 'puppeteer-core'
const base = process.argv[2] ?? 'http://localhost:3000'
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'], defaultViewport: { width: 1600, height: 900 } })
const page = await browser.newPage()
const cdp = await page.createCDPSession()
await cdp.send('Profiler.enable')
await cdp.send('Profiler.setSamplingInterval', { interval: 1000 })
await cdp.send('Profiler.start')
await page.goto(`${base}/?quality=${process.argv[3] ?? 'medium'}&autostart`)
await page.waitForFunction(() => window.__museum?.store.getState().phase === 'entered', { timeout: 120000 })
await new Promise((r) => setTimeout(r, 9000))
const { profile } = await cdp.send('Profiler.stop')
const self = new Map()
const byId = new Map(profile.nodes.map((n) => [n.id, n]))
const dt = profile.timeDeltas
const counts = new Map()
profile.samples.forEach((id, i) => counts.set(id, (counts.get(id) ?? 0) + (dt[i] ?? 0)))
for (const [id, us] of counts) {
  const n = byId.get(id)
  const key = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`
  self.set(key, (self.get(key) ?? 0) + us)
}
;[...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([k, us]) => console.log(`${(us / 1000).toFixed(0).padStart(7)} ms  ${k}`))
await browser.close()
