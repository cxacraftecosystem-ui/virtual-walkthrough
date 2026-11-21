// Main-thread cost of ways to read a playing video's colour (the theatre film), 12 tries each.
// usage: node readback.mjs <base> '<pose>'
import { chromePath, galleryPath, gpuArgs, projectRequire } from './lib.mjs'
const require = projectRequire()
const puppeteer = require('puppeteer-core')
const [base, poseJson] = process.argv.slice(2)
const pose = JSON.parse(poseJson)
const browser = await puppeteer.launch({ executablePath: chromePath(), headless: 'new', protocolTimeout: 1200000, args: [...gpuArgs(), '--autoplay-policy=no-user-gesture-required', '--window-size=1920,967'], defaultViewport: { width: 1920, height: 967 } })
try {
  const page = await browser.newPage()
  await page.goto(`${base}${galleryPath()}?quality=medium&autostart&noarrival`, { waitUntil: 'domcontentloaded', timeout: 300000 })
  await page.waitForFunction(() => window.__museum?.store.getState().phase === 'entered' && window.__museum.store.getState().sceneCompiled, { timeout: 1200000, polling: 1000 })
  await page.evaluate((p) => window.__museum.teleport(p[0], p[1], p[2], p[3]), pose)
  await new Promise((r) => setTimeout(r, 8000))
  const out = await page.evaluate(async () => {
    const gl = window.__museum.gl
    let video = null
    await new Promise((res) => {
      const orig = gl.render.bind(gl)
      gl.render = (s, c) => {
        if (s.isScene && !video) s.traverse((o) => { const m = o.material; if (!video && m?.map?.isVideoTexture && !m.map.image.paused) video = m.map.image })
        gl.render = orig
        res()
        return orig(s, c)
      }
    })
    if (!video) return 'no playing video found'
    const res = { video: `${video.videoWidth}x${video.videoHeight} paused=${video.paused}` }
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()))
    const stat = (a) => { const s = [...a].sort((x, y) => x - y); return `median ${s[s.length >> 1].toFixed(2)} ms, max ${s[s.length - 1].toFixed(2)} ms` }
    // A: 2D canvas, willReadFrequently (the old way)
    {
      const c = document.createElement('canvas'); c.width = 16; c.height = 9
      const g = c.getContext('2d', { willReadFrequently: true })
      const t = []
      for (let i = 0; i < 12; i++) { await frame(); const t0 = performance.now(); g.drawImage(video, 0, 0, 16, 9); g.getImageData(0, 0, 16, 9); t.push(performance.now() - t0) }
      res.canvasCPU = stat(t)
    }
    // B: createImageBitmap with resize (async), then read in the main thread
    {
      const t = []; const lat = []
      const c = new OffscreenCanvas(16, 9); const g = c.getContext('2d', { willReadFrequently: true })
      for (let i = 0; i < 12; i++) {
        await frame()
        const t0 = performance.now()
        const p = createImageBitmap(video, { resizeWidth: 16, resizeHeight: 9, resizeQuality: 'low' })
        const t1 = performance.now()
        const bmp = await p
        const t2 = performance.now()
        g.drawImage(bmp, 0, 0); g.getImageData(0, 0, 16, 9); bmp.close()
        const t3 = performance.now()
        t.push((t1 - t0) + (t3 - t2)); lat.push(t3 - t0)
      }
      res.bitmapMain = `${stat(t)} (main thread); latency ${stat(lat)}`
    }
    // C: createImageBitmap with resize only (the main-thread part if a worker does the read)
    {
      const t = []
      for (let i = 0; i < 12; i++) { await frame(); const t0 = performance.now(); const p = createImageBitmap(video, { resizeWidth: 16, resizeHeight: 9, resizeQuality: 'low' }); t.push(performance.now() - t0); (await p).close() }
      res.bitmapCreateOnly = stat(t)
    }
    // D: VideoFrame + copyTo (async)
    if (typeof VideoFrame !== 'undefined') {
      const t = []; const lat = []
      for (let i = 0; i < 12; i++) {
        await frame()
        const t0 = performance.now()
        const vf = new VideoFrame(video)
        const size = vf.allocationSize()
        const buf = new Uint8Array(size)
        const p = vf.copyTo(buf)
        const t1 = performance.now()
        await p
        const t2 = performance.now()
        vf.close()
        t.push(t1 - t0); lat.push(t2 - t0)
        if (i === 0) res.videoFrameFormat = `${vf.format} ${size} bytes`
      }
      res.videoFrameCopy = `${stat(t)} (main thread); latency ${stat(lat)}`
    }
    return res
  })
  console.log(JSON.stringify(out, null, 1))
} finally { await browser.close() }
