// How big the scene graph is, by subtree: node counts under each top-level child (and its largest children), and
// what a full updateMatrixWorld costs. usage: node nodes.mjs <base> [query]
import { chromePath, galleryPath, gpuArgs, projectRequire } from './lib.mjs'
const require = projectRequire()
const puppeteer = require('puppeteer-core')
const [base, query = '?quality=medium'] = process.argv.slice(2)
const browser = await puppeteer.launch({ executablePath: chromePath(), headless: 'new', protocolTimeout: 1200000, args: [...gpuArgs(), '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } })
try {
  const page = await browser.newPage()
  await page.goto(`${base}${galleryPath()}${query}&autostart&noarrival`, { waitUntil: 'domcontentloaded', timeout: 300000 })
  await page.waitForFunction(() => window.__museum?.store.getState().phase === 'entered' && window.__museum.store.getState().sceneCompiled, { timeout: 1200000, polling: 1000 })
  await new Promise((r) => setTimeout(r, 5000))
  console.log(await page.evaluate(() => new Promise((res) => {
    const gl = window.__museum.gl
    const orig = gl.render.bind(gl)
    gl.render = (s, c) => {
      if (s.isScene && s.children.length > 5) {
        gl.render = orig
        const count = (o) => { let n = 0; o.traverse(() => n++); return n }
        const auto = (o) => { let n = 0; o.traverse((x) => { if (x.matrixAutoUpdate) n++ }); return n }
        const total = count(s)
        const t0 = performance.now()
        for (let i = 0; i < 20; i++) s.updateMatrixWorld()
        const per = (performance.now() - t0) / 20
        const lines = [`${total} nodes, ${auto(s)} with matrixAutoUpdate; scene.updateMatrixWorld ${per.toFixed(2)} ms`]
        const label = (o) => o.name || o.type
        const kids = s.children.map((c) => [label(c), count(c), c]).sort((a, b) => b[1] - a[1])
        for (const [n, k, c] of kids.slice(0, 14)) {
          lines.push(`${String(k).padStart(6)}  ${n}`)
          const sub = c.children.map((x) => [label(x), count(x)]).sort((a, b) => b[1] - a[1]).slice(0, 6)
          for (const [sn, sk] of sub) if (sk > 150) lines.push(`        ${String(sk).padStart(6)}  ${sn}`)
        }
        res(lines.join('\n'))
      }
      return orig(s, c)
    }
  })))
} finally { await browser.close() }
