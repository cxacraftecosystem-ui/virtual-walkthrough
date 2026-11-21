// A stall at one place: enter, let the start-up warm-up settle, teleport there, and log long frames (> 150 ms),
// programs and renderer counts every 2 s for 24 s, then every shader program built after arriving (its cache key
// says which light count, define or render target asked for it).
// usage: node stalls.mjs <base> <query> '[x, z, yaw, pitch]' [settleSeconds=45]
import { chromePath, galleryPath, gpuArgs, projectRequire } from './lib.mjs'
const require = projectRequire()
const puppeteer = require('puppeteer-core')
const [base, query = '', poseJson, settle = '45'] = process.argv.slice(2)
if (!poseJson) {
  console.error("usage: node stalls.mjs <base> <query> '[x, z, yaw, pitch]' [settleSeconds=45]")
  process.exit(2)
}
const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: 'new',
  protocolTimeout: 1200000,
  args: [...gpuArgs(), '--window-size=1920,967'],
  defaultViewport: { width: 1920, height: 967 },
})
try {
  const page = await browser.newPage()
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}] ${m.text().slice(0, 200)}`)
  })
  await page.goto(`${base}${galleryPath()}${query}${query ? '&' : '?'}autostart&noarrival`, { waitUntil: 'domcontentloaded', timeout: 300000 })
  await page.waitForFunction(() => window.__museum?.store.getState().phase === 'entered' && window.__museum.store.getState().sceneCompiled, { timeout: 1200000, polling: 1000 })
  // let the background warm-up and first streaming settle
  await new Promise((r) => setTimeout(r, Number(settle) * 1000))
  await page.evaluate(() => {
    window.__long = []
    window.__n = 0
    let last = performance.now()
    const tick = (t) => {
      const dt = t - last
      last = t
      window.__n++
      if (dt > 150) window.__long.push([Math.round(t), Math.round(dt)])
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  const before = await page.evaluate(() => window.__museum.gl.info.programs.map((p) => p.id))
  const pose = JSON.parse(poseJson)
  const t0 = await page.evaluate((p) => {
    window.__museum.teleport(p[0], p[1], p[2], p[3])
    return performance.now()
  }, pose)
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const s = await page.evaluate((t0) => {
      const r = window.__museum.gl.info
      const long = window.__long.splice(0).map(([t, d]) => `${((t - t0) / 1000).toFixed(1)}s:${d}ms`)
      const n = window.__n
      window.__n = 0
      return { n, long, programs: r.programs.length, calls: r.render.calls, tris: r.render.triangles, geoms: r.memory.geometries, tex: r.memory.textures }
    }, t0)
    console.log(`${(i + 1) * 2}s: ${s.n} frames, programs ${s.programs}, ${s.calls} calls, ${(s.tris / 1e6).toFixed(2)}M tris, geoms ${s.geoms}, tex ${s.tex}; long: ${s.long.join(' ')}`)
  }
  const added = await page.evaluate((before) => window.__museum.gl.info.programs.filter((p) => !before.includes(p.id)).map((p) => `${p.name} | ${p.cacheKey.slice(0, 300)}`), before)
  for (const a of added) console.log("NEW " + a)
} finally {
  await browser.close()
}
