// Diagnose the start-up as a visitor sees it: open the 3D route, click Enter when it appears, and log the store, the
// renderer counts, any loading overlay and the requests every 2 s (Content-Length totals overstate videos: see weight.mjs).
// usage: node diag.mjs <base> <seconds> [query]
import { chromePath, galleryPath, gpuArgs, projectRequire } from './lib.mjs'
const require = projectRequire()
const puppeteer = require('puppeteer-core')
const [base, secs = '120', query = ''] = process.argv.slice(2)
const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: 'new',
  protocolTimeout: 900000,
  args: [...gpuArgs(), '--window-size=1920,967'],
  defaultViewport: { width: 1920, height: 967 },
})
const t0 = Date.now()
const ts = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`
try {
  const page = await browser.newPage()
  page.on('console', (m) => {
    const t = m.text()
    if (m.type() === 'error' || m.type() === 'warning' || /museum|WebGL|context|shader/i.test(t)) console.log(`${ts()} [${m.type()}] ${t.slice(0, 260)}`)
  })
  page.on('pageerror', (e) => console.log(`${ts()} [pageerror] ${e.message.slice(0, 300)}`))
  let reqs = 0
  let bytes = 0
  page.on('response', async (r) => {
    reqs++
    const l = Number(r.headers()['content-length'] ?? 0)
    if (l) bytes += l
  })
  await page.goto(`${base}${galleryPath()}${query}`, { waitUntil: 'domcontentloaded', timeout: 300000 })
  const end = Date.now() + Number(secs) * 1000
  let clicked = false
  let last = ''
  while (Date.now() < end) {
    const s = await page
      .evaluate(() => {
        const m = window.__museum
        const st = m?.store?.getState?.()
        const enter = [...document.querySelectorAll('button')].find((b) => /^\s*(enter|skip|begin|start)/i.test(b.textContent ?? ''))
        const overlay = [...document.querySelectorAll('body *')].find((e) => e.children.length === 0 && /Applying graphics|Loading/i.test(e.textContent ?? ''))
        return {
          phase: st?.phase,
          tier: st?.tier,
          quality: st?.quality,
          compiled: st?.sceneCompiled,
          enter: enter ? enter.textContent.trim().slice(0, 30) : null,
          overlay: overlay ? overlay.textContent.trim().slice(0, 60) : null,
          programs: m?.gl?.info?.programs?.length,
          calls: m?.gl?.info?.render?.calls,
          tris: m?.gl?.info?.render?.triangles,
          geoms: m?.gl?.info?.memory?.geometries,
          tex: m?.gl?.info?.memory?.textures,
          heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : undefined,
        }
      })
      .catch((e) => ({ err: String(e).slice(0, 120) }))
    const line = JSON.stringify(s)
    if (line !== last) console.log(`${ts()} ${line} reqs ${reqs} ${(bytes / 1e6).toFixed(1)}MB`)
    last = line
    if (!clicked && s.enter) {
      await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^\s*(enter|skip|begin|start)/i.test(b.textContent ?? ''))?.click())
      console.log(`${ts()} clicked "${s.enter}"`)
      clicked = true
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  await page.screenshot({ path: 'C:/Users/anujk/AppData/Local/Temp/claude/f3daeb0ce4a3c898/e0114da7-a983-4e19-9a07-2cecf243c37c/scratchpad/diag-end.png' })
} finally {
  await browser.close()
}
