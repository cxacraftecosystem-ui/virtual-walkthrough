// The screen spill light at the theatre: intensity and colour over a few seconds (is it following the film?).
import { chromePath, galleryPath, gpuArgs, projectRequire } from './lib.mjs'
const require = projectRequire()
const puppeteer = require('puppeteer-core')
const [base, poseJson] = process.argv.slice(2)
const pose = JSON.parse(poseJson)
const browser = await puppeteer.launch({ executablePath: chromePath(), headless: 'new', protocolTimeout: 1200000, args: [...gpuArgs(), '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } })
try {
  const page = await browser.newPage()
  page.on('console', (m) => { if (m.type() === 'error') console.log('[error]', m.text().slice(0, 200)) })
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)))
  await page.goto(`${base}${galleryPath()}?quality=medium&autostart&noarrival`, { waitUntil: 'domcontentloaded', timeout: 300000 })
  await page.waitForFunction(() => window.__museum?.store.getState().phase === 'entered' && window.__museum.store.getState().sceneCompiled, { timeout: 1200000, polling: 1000 })
  await page.evaluate((p) => window.__museum.teleport(p[0], p[1], p[2], p[3]), pose)
  await new Promise((r) => setTimeout(r, 6000))
  for (let i = 0; i < 8; i++) {
    console.log(await page.evaluate(() => new Promise((res) => {
      const gl = window.__museum.gl
      const orig = gl.render.bind(gl)
      gl.render = (s, c) => {
        gl.render = orig
        const out = []
        s.traverse((o) => { if (o.isRectAreaLight && o.width > 3) out.push(`I ${o.intensity.toFixed(2)} rgb ${o.color.r.toFixed(2)},${o.color.g.toFixed(2)},${o.color.b.toFixed(2)}`) })
        res(out.join(' | ') || 'no spill light')
        return orig(s, c)
      }
    })))
    await new Promise((r) => setTimeout(r, 700))
  }
} finally { await browser.close() }
