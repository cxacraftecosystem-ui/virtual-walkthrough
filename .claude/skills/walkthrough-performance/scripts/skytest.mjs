// Isolate the sky flicker: at one pose, measure flickering pixels with the sky as is, with its time frozen, and with
// its clouds off. usage: node skytest.mjs <base> '<pose json>'
import { chromePath, galleryPath, gpuArgs, projectRequire } from './lib.mjs'
const require = projectRequire()
const puppeteer = require('puppeteer-core')
const sharp = require('sharp')
const [base, poseJson] = process.argv.slice(2)
const p = JSON.parse(poseJson)
const W = 960
const H = 540
const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: 'new',
  protocolTimeout: 1200000,
  args: [...gpuArgs(), `--window-size=${W},${H}`],
  defaultViewport: { width: W, height: H },
})
async function measure(page, label) {
  const frames = []
  for (let i = 0; i < 20; i++) {
    frames.push(await sharp(await page.screenshot({ type: 'png' })).removeAlpha().raw().toBuffer())
    await new Promise((r) => setTimeout(r, 60))
  }
  const lum = (f, i) => 0.2126 * f[i * 3] + 0.7152 * f[i * 3 + 1] + 0.0722 * f[i * 3 + 2]
  let flick = 0
  for (let i = 0; i < W * H; i++) {
    let jumps = 0
    let prev = lum(frames[0], i)
    for (let k = 1; k < frames.length; k++) {
      const l = lum(frames[k], i)
      if (Math.abs(l - prev) > 14) jumps++
      prev = l
    }
    if (jumps >= 3) flick++
  }
  console.log(`${label.padEnd(22)} flickering pixels ${((100 * flick) / (W * H)).toFixed(2)}%`)
}
try {
  const page = await browser.newPage()
  page.on('console', (m) => {
    const t = m.text()
    if ((m.type() === 'error' || m.type() === 'warning') && /shader|program|sky|THREE/i.test(t) && !/X4122|cannot be represented/.test(t)) console.log(`[${m.type()}]`, t.slice(0, 400))
  })
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 400)))
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
  console.log('sky found:', await page.evaluate(() => !!window.__sky), 'dpr:', await page.evaluate(() => window.__museum.gl.getPixelRatio()))
  await measure(page, 'as is')
  await page.evaluate(() => {
    const u = window.__sky.material.uniforms
    const t = u.time.value
    window.__freeze = setInterval(() => (u.time.value = t), 1)
    const tick = () => {
      u.time.value = t
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await measure(page, 'time frozen')
  await page.evaluate(() => (window.__sky.material.uniforms.cloudCoverage.value = 0))
  await measure(page, 'clouds off, frozen')
} finally {
  await browser.close()
}
