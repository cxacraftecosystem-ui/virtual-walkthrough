// The worst-flickering sky pixel's luminance over 24 frames, with the sky's time uniform at each frame.
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
  console.log(await page.evaluate(() => { const u = window.__sky.material.uniforms; return JSON.stringify({ speed: u.cloudSpeed.value, scale: u.cloudScale.value, cov: u.cloudCoverage.value, el: u.cloudElevation.value, night: u.nightMix?.value, tw: u.twilightMix?.value, exp: u.skyExposure?.value, aa: window.__sky.material.fragmentShader.includes("museumFbmAA") }) }))
  const frames = []
  const times = []
  for (let i = 0; i < 24; i++) {
    times.push(await page.evaluate(() => window.__sky.material.uniforms.time.value))
    frames.push(await sharp(await page.screenshot({ type: 'png' })).removeAlpha().raw().toBuffer())
    await new Promise((r) => setTimeout(r, 60))
  }
  const lum = (f, i) => Math.round(0.2126 * f[i * 3] + 0.7152 * f[i * 3 + 1] + 0.0722 * f[i * 3 + 2])
  let best = 0
  let bestJ = -1
  for (let i = 0; i < W * H; i++) {
    let j = 0
    for (let k = 1; k < frames.length; k++) if (Math.abs(lum(frames[k], i) - lum(frames[k - 1], i)) > 14) j++
    if (j > bestJ) {
      bestJ = j
      best = i
    }
  }
  console.log(`pixel (${best % W}, ${Math.floor(best / W)}), ${bestJ} jumps`)
  console.log('luminance:', frames.map((f) => lum(f, best)).join(' '))
  console.log('time     :', times.map((t) => t.toFixed(2)).join(' '))
  console.log('pixelRatio', await page.evaluate(() => window.__museum.gl.getPixelRatio()), 'size', await page.evaluate(() => [window.__museum.gl.domElement.width, window.__museum.gl.domElement.height].join('x')))
} finally {
  await browser.close()
}
