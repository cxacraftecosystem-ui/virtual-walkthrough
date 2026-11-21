// Walk a museum after entering: at each stop, the programs built and the frame times (median, p95, worst).
// usage: node walk.mjs <base> <query> <stops.json>   (stops: [[name, [x, z, yaw, pitch]], ...]; see stops-example.json)
import { chromePath, galleryPath, gpuArgs, projectRequire } from './lib.mjs'
const require = projectRequire()
const puppeteer = require('puppeteer-core')
const [base, query = '', stopsFile] = process.argv.slice(2)
const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: 'new',
  protocolTimeout: 1200000,
  args: [...gpuArgs(), '--window-size=1920,967'],
  defaultViewport: { width: 1920, height: 967 },
})
const t0 = Date.now()
const ts = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`
if (!stopsFile) {
  console.error('usage: node walk.mjs <base> <query> <stops.json>   (stops: [[name, [x, z, yaw, pitch]], ...], see stops-example.json)')
  process.exit(2)
}
const STOPS = JSON.parse((await import('node:fs')).readFileSync(stopsFile, 'utf8'))
try {
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.log(`${ts()} [pageerror] ${e.message.slice(0, 200)}`))
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`${ts()} [error] ${m.text().slice(0, 200)}`)
  })
  await page.goto(`${base}${galleryPath()}${query}${query ? '&' : '?'}autostart&noarrival`, { waitUntil: 'domcontentloaded', timeout: 300000 })
  await page.waitForFunction(() => window.__museum?.store.getState().phase === 'entered' && window.__museum.store.getState().sceneCompiled, { timeout: 1200000, polling: 1000 })
  console.log(`${ts()} entered and compiled, ${await page.evaluate(() => window.__museum.gl.info.programs.length)} programs`)
  await page.evaluate(() => {
    // CPU time inside gl.render per frame: what draw calls and state changes cost on the main thread
    const gl = window.__museum.gl
    const orig = gl.render.bind(gl)
    window.__cpu = []
    let acc = 0
    gl.render = (s, c) => {
      const t = performance.now()
      const r = orig(s, c)
      acc += performance.now() - t
      return r
    }
    const flush = () => {
      window.__cpu.push(acc)
      acc = 0
      requestAnimationFrame(flush)
    }
    requestAnimationFrame(flush)
    window.__frames = []
    let last = performance.now()
    const tick = (t) => {
      window.__frames.push(t - last)
      last = t
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  for (const [name, pose] of STOPS) {
    const before = await page.evaluate(() => window.__museum.gl.info.programs.length)
    await page.evaluate((p) => {
      window.__frames = []
      window.__cpu = []
      window.__museum.teleport(p[0], p[1], p[2], p[3])
    }, pose)
    await new Promise((r) => setTimeout(r, 6000))
    const s = await page.evaluate(() => {
      const f = window.__frames.slice(2).sort((a, b) => a - b)
      const r = window.__museum.gl.info.render
      const c = window.__cpu.slice(2).sort((a, b) => a - b)
      return { cpu: c[c.length >> 1] ?? 0, cpu95: c[Math.floor(c.length * 0.95)] ?? 0, n: f.length, median: f[f.length >> 1] ?? 0, p95: f[Math.floor(f.length * 0.95)] ?? 0, worst: f[f.length - 1] ?? 0, programs: window.__museum.gl.info.programs.length, calls: r.calls, tris: r.triangles, zone: window.__museum.store.getState().tier }
    })
    console.log(`${ts()} ${name.padEnd(15)} programs ${before} → ${s.programs}; frames ${s.n} in 6 s: median ${s.median.toFixed(0)} ms, p95 ${s.p95.toFixed(0)} ms, worst ${s.worst.toFixed(0)} ms; render CPU ${s.cpu.toFixed(1)}/${s.cpu95.toFixed(1)} ms; ${s.calls} calls, ${(s.tris / 1e6).toFixed(2)}M tris`)
  }
} finally {
  await browser.close()
}
