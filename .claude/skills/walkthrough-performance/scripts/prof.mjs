// Where the main thread's time goes at a pose: a CPU profile over a few seconds, self time by function.
// usage: node prof.mjs <base> <query> '<[[name, [x, z, yaw, pitch]], ...]>' [seconds=4] [top=30]
import { chromePath, galleryPath, gpuArgs, projectRequire } from './lib.mjs'
const require = projectRequire()
const puppeteer = require('puppeteer-core')
const [base, query = '', stopsJson, secs = '4', top = '30'] = process.argv.slice(2)
const stops = JSON.parse(stopsJson)
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
  await page.goto(`${base}${galleryPath()}${query}${query ? '&' : '?'}autostart&noarrival`, { waitUntil: 'domcontentloaded', timeout: 300000 })
  await page.waitForFunction(() => window.__museum?.store.getState().phase === 'entered' && window.__museum.store.getState().sceneCompiled, { timeout: 1200000, polling: 1000 })
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 })
  for (const [name, pose] of stops) {
    await page.evaluate((p) => window.__museum.teleport(p[0], p[1], p[2], p[3]), pose)
    await new Promise((r) => setTimeout(r, 5000))
    const frames0 = await page.evaluate(() => window.__museum.gl.info.render.frame)
    await cdp.send('Profiler.start')
    await new Promise((r) => setTimeout(r, Number(secs) * 1000))
    const { profile } = await cdp.send('Profiler.stop')
    const frames = (await page.evaluate(() => window.__museum.gl.info.render.frame)) - frames0
    // self time per node, from the sample timeline
    const self = new Map()
    const byId = new Map(profile.nodes.map((n) => [n.id, n]))
    const dts = profile.timeDeltas
    for (let i = 0; i < profile.samples.length; i++) {
      const n = byId.get(profile.samples[i])
      const dt = (dts[i + 1] ?? 0) / 1000
      const cf = n.callFrame
      const file = cf.url.split('/').pop().split('?')[0] || '(native)'
      const k = `${cf.functionName || '(anonymous)'}  ${file}:${cf.lineNumber + 1}`
      self.set(k, (self.get(k) ?? 0) + dt)
    }
    const total = [...self.values()].reduce((s, v) => s + v, 0)
    const idle = (self.get('(idle)  (native):0') ?? 0) + (self.get('(program)  (native):0') ?? 0)
    console.log(`\n== ${name}: ${frames} frames in ${secs} s; busy ${(total - idle).toFixed(0)} ms of ${total.toFixed(0)} (per frame ${((total - (self.get('(idle)  (native):0') ?? 0)) / Math.max(frames, 1)).toFixed(1)} ms incl. program)`)
    for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, Number(top))) console.log(`  ${v.toFixed(0).padStart(6)} ms  ${(v / Math.max(frames, 1)).toFixed(2).padStart(6)} ms/frame  ${k}`)
  }
} finally {
  await browser.close()
}
