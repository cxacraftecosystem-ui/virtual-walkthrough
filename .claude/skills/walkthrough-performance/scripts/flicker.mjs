// Flicker finder: at each pose, with the camera still, capture a burst of frames and map the pixels that change between
// them (anything that changes while nothing moves is flicker, or an animation). Writes <out>/<id>-heat.png (changed
// pixels in red over the frame) and prints the share of flickering pixels and their bounding boxes.
// usage: node flicker.mjs <base> <out> '<poses json>' [query]
import fs from 'node:fs'
import path from 'node:path'
import { chromePath, galleryPath, gpuArgs, projectRequire } from './lib.mjs'
const require = projectRequire()
const puppeteer = require('puppeteer-core')
const sharp = require('sharp')
const [base, out, posesJson, query = '?quality=medium'] = process.argv.slice(2)
const poses = JSON.parse(posesJson)
fs.mkdirSync(out, { recursive: true })
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
  await page.goto(`${base}${galleryPath()}${query}${query ? '&' : '?'}autostart&noarrival&shots`, { waitUntil: 'domcontentloaded', timeout: 300000 })
  await page.waitForFunction(() => window.__museum?.store.getState().phase === 'entered' && window.__museum.store.getState().sceneCompiled, { timeout: 1200000, polling: 1000 })
  await new Promise((r) => setTimeout(r, 8000))
  for (const p of poses) {
    await page.evaluate((s) => {
      const st = window.__museum.store.getState()
      st.select?.(null)
      if (s.time) st.setTimeOfDay?.(s.time)
      window.__museum.teleport(s.pose[0], s.pose[1], s.pose[2], s.pose[3])
    }, p)
    await new Promise((r) => setTimeout(r, p.settle ?? 7000))
    const frames = []
    for (let i = 0; i < (p.n ?? 24); i++) {
      const buf = await page.screenshot({ type: 'png' })
      frames.push(await sharp(buf).removeAlpha().raw().toBuffer())
      await new Promise((r) => setTimeout(r, p.gap ?? 60))
    }
    // per pixel: how many frame-to-frame luminance jumps above a threshold (flicker toggles), and the range
    const n = frames.length
    const lum = (f, i) => 0.2126 * f[i * 3] + 0.7152 * f[i * 3 + 1] + 0.0722 * f[i * 3 + 2]
    const heat = Buffer.alloc(W * H * 3)
    let flick = 0
    const boxes = []
    const grid = new Map()
    for (let i = 0; i < W * H; i++) {
      let jumps = 0
      let lo = 255
      let hi = 0
      let prev = lum(frames[0], i)
      for (let k = 0; k < n; k++) {
        const l = lum(frames[k], i)
        if (l < lo) lo = l
        if (l > hi) hi = l
        if (k && Math.abs(l - prev) > 14) jumps++
        prev = l
      }
      const base0 = frames[n - 1]
      const g = lum(base0, i) * 0.5
      const isFlick = jumps >= 3 && hi - lo > 20
      if (isFlick) {
        flick++
        const cell = `${Math.floor((i % W) / 40)},${Math.floor(Math.floor(i / W) / 40)}`
        grid.set(cell, (grid.get(cell) ?? 0) + 1)
      }
      heat[i * 3] = isFlick ? 255 : g
      heat[i * 3 + 1] = isFlick ? 30 : g
      heat[i * 3 + 2] = isFlick ? 30 : g
    }
    await sharp(heat, { raw: { width: W, height: H, channels: 3 } }).png().toFile(path.join(out, `${p.id}-heat.png`))
    await sharp(frames[n - 1], { raw: { width: W, height: H, channels: 3 } }).png().toFile(path.join(out, `${p.id}-frame.png`))
    const hot = [...grid.entries()].filter(([, c]) => c > 40).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, c]) => `${k}:${c}`)
    console.log(`${p.id.padEnd(16)} flickering pixels ${(100 * flick / (W * H)).toFixed(2)}%  hot 40px cells (x,y:count): ${hot.join(' ')}`)
  }
} finally {
  await browser.close()
}
