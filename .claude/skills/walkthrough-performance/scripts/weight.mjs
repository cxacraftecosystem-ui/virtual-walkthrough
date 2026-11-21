// What a visitor downloads before the museum is ready: every response's size, grouped by type, and the largest files.
// usage: node weight.mjs <base> [query] [top=30]
import { chromePath, galleryPath, gpuArgs, projectRequire } from './lib.mjs'
const require = projectRequire()
const puppeteer = require('puppeteer-core')
const [base, query = '', top = '30'] = process.argv.slice(2)
const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: 'new',
  protocolTimeout: 1200000,
  args: [...gpuArgs(), '--window-size=1920,967'],
  defaultViewport: { width: 1920, height: 967 },
})
try {
  const page = await browser.newPage()
  const cdp = await page.createCDPSession()
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  const reqs = new Map()
  // bytes actually received (dataReceived), not Content-Length: a video answers ranges, so its header overstates
  const got = new Map()
  cdp.on('Network.responseReceived', (e) => reqs.set(e.requestId, { url: e.response.url, type: e.response.mimeType, bytes: 0, declared: Number(e.response.headers['content-length'] ?? e.response.headers['Content-Length'] ?? 0), status: e.response.status }))
  cdp.on('Network.dataReceived', (e) => got.set(e.requestId, (got.get(e.requestId) ?? 0) + (e.encodedDataLength || e.dataLength)))
  cdp.on('Network.loadingFinished', (e) => {
    const r = reqs.get(e.requestId)
    if (r) r.bytes = Math.max(e.encodedDataLength, got.get(e.requestId) ?? 0)
  })
  const t0 = Date.now()
  await page.goto(`${base}${galleryPath()}${query}${query ? '&' : '?'}autostart&noarrival`, { waitUntil: 'domcontentloaded', timeout: 300000 })
  await page.waitForFunction(() => window.__museum?.store.getState().phase === 'entered' && window.__museum.store.getState().sceneCompiled, { timeout: 1200000, polling: 1000 })
  console.log(`entered after ${((Date.now() - t0) / 1000).toFixed(0)} s`)
  await new Promise((r) => setTimeout(r, 8000))
  const all = [...reqs.values()]
  const kind = (r) => {
    const u = r.url.split('?')[0].toLowerCase()
    const ext = u.match(/\.([a-z0-9]+)$/)?.[1]
    return ext ?? r.type
  }
  const byKind = {}
  for (const r of all) {
    const k = kind(r)
    byKind[k] ??= { n: 0, mb: 0 }
    byKind[k].n++
    byKind[k].mb += r.bytes / 1e6
  }
  const total = all.reduce((s, r) => s + r.bytes, 0) / 1e6
  const declared = all.reduce((s, r) => s + r.declared, 0) / 1e6
  console.log(`${all.length} responses, ${total.toFixed(1)} MB received (${declared.toFixed(1)} MB by Content-Length)`)
  for (const [k, v] of Object.entries(byKind).sort((a, b) => b[1].mb - a[1].mb)) console.log(`  ${k.padEnd(28)} ${String(v.n).padStart(4)} files ${v.mb.toFixed(1).padStart(7)} MB`)
  console.log('largest:')
  for (const r of all.sort((a, b) => b.bytes - a.bytes).slice(0, Number(top))) console.log(`  ${(r.bytes / 1e6).toFixed(2).padStart(6)} MB  ${r.url.replace(/^https?:\/\/[^/]+/, '').slice(0, 140)}`)
} finally {
  await browser.close()
}
