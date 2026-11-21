// A strip of frames at one pose (camera still): to see whether something moves smoothly or jumps.
// usage: node frames.mjs <base> <out.png> '<pose json>' <x> <y> <w> <h> [n] [gapMs]
import { chromePath, galleryPath, gpuArgs, projectRequire } from './lib.mjs'
const require = projectRequire()
const puppeteer = require('puppeteer-core')
const sharp = require('sharp')
const [base, out, poseJson, x, y, w, h, n = '8', gap = '150'] = process.argv.slice(2)
const p = JSON.parse(poseJson)
const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: 'new',
  protocolTimeout: 1200000,
  args: [...gpuArgs(), '--window-size=960,540'],
  defaultViewport: { width: 960, height: 540 },
})
try {
  const page = await browser.newPage()
  await page.goto(`${base}${galleryPath()}?quality=medium&autostart&noarrival&shots`, { waitUntil: 'domcontentloaded', timeout: 300000 })
  await page.waitForFunction(() => !!window.__museum?.gl, { timeout: 300000, polling: 200 })
  await page.evaluate(() => {
    const gl = window.__museum.gl
    const orig = gl.render.bind(gl)
    gl.render = (scene, cam) => {
      if (scene?.isScene && !window.__sky) scene.traverse((o) => { if (o.material?.uniforms?.cloudCoverage) window.__sky = o })
      if (scene?.isScene && window.__skyOnly) scene.traverse((o) => { if ((o.isMesh || o.isPoints || o.isLine || o.isSprite) && o !== window.__sky) o.visible = false })
      return orig(scene, cam)
    }
  })
  await page.waitForFunction(() => window.__museum?.store.getState().phase === 'entered' && window.__museum.store.getState().sceneCompiled, { timeout: 1200000, polling: 1000 })
  await new Promise((r) => setTimeout(r, 6000))
  await page.evaluate((s) => {
    const st = window.__museum.store.getState()
    if (s.time) st.setTimeOfDay?.(s.time)
    window.__museum.teleport(s.pose[0], s.pose[1], s.pose[2], s.pose[3])
  }, p)
  // only the canvas counts: the HUD has pulsing dots and fading hints
  await page.addStyleTag({ content: "* { visibility: hidden !important } canvas { visibility: visible !important }" })
  if (p.skyOnly) await page.evaluate(() => (window.__skyOnly = true))
  await new Promise((r) => setTimeout(r, 6000))
  const crops = []
  const info = []
  for (let i = 0; i < Number(n); i++) {
    const t = await page.evaluate(() => performance.now())
    const buf = await page.screenshot({ type: 'png', clip: { x: Number(x), y: Number(y), width: Number(w), height: Number(h) } })
    crops.push(buf)
    info.push(Math.round(t))
    await new Promise((r) => setTimeout(r, Number(gap)))
  }
  const W = Number(w)
  const H = Number(h)
  await sharp({ create: { width: W * crops.length, height: H, channels: 3, background: '#000' } })
    .composite(crops.map((c, i) => ({ input: c, left: i * W, top: 0 })))
    .png()
    .toFile(out)
  console.log(`frames at ms: ${info.map((t) => t - info[0]).join(', ')}`)
} finally {
  await browser.close()
}
