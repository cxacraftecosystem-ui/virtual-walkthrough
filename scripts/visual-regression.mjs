/**
 * Visual regression test.  Builds nothing: point it at a running app.
 *
 *   node scripts/visual-regression.mjs [baseUrl] [--update] [--only=name,…] [--quality=medium]
 *   npm run test:visual            (compare against tests/visual/baseline/*.png)
 *   npm run test:visual:update     (re-capture the baselines)
 *
 * - Opens `/gallery?autostart&static&vr=1&quality=…` — `static` = bundled content (no DB differences),
 *   `vr=1` freezes sky/cloud time, banner/foliage sway, the centrepiece spin and video playback
 *   (src/museum/utils/vr.ts).
 * - Renders with SwiftShader (CPU WebGL) so local runs and CI produce the same pixels; 1280×720, DPR 1.
 * - Teleports to each viewpoint, waits for the network to go idle and a few frames, hides every DOM
 *   overlay (HUD, labels, Next dev indicator) and screenshots the canvas.
 * - Compares with pixelmatch (per-pixel threshold VR_THRESHOLD, default 0.1) and fails when more than
 *   VR_MAX_DIFF % (default 0.5) of the pixels differ. Diffs (baseline | actual | diff) → tests/visual/diff/.
 *
 * Baselines come from the PRODUCTION deployment (a prod build; the deployment must include ?vr=1 support):
 *   npm run test:visual:update -- https://hand-block-museum.vercel.app
 * CI (.github/workflows/ci.yml) compares a PR's own `next build && next start` against them. Do not
 * generate baselines from `next dev` (dev overlays, slower streaming, HMR reloads). See tests/visual/README.md.
 * Env: CHROME_PATH (Chrome/Chromium binary), VR_MAX_DIFF, VR_THRESHOLD, VR_TIMEOUT_MS, VR_BASELINE_DIR, VR_DIFF_DIR,
 * VR_GPU=1 (hardware GPU instead of SwiftShader — quick local A/B comparisons only), VR_WRITE_ALL_DIFFS=1.
 */
import fs from 'node:fs'
import path from 'node:path'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import puppeteer from 'puppeteer-core'

const ROOT = path.resolve(import.meta.dirname, '..')
const BASELINE = path.resolve(ROOT, process.env.VR_BASELINE_DIR ?? 'tests/visual/baseline')
const DIFF = path.resolve(ROOT, process.env.VR_DIFF_DIR ?? 'tests/visual/diff')
const argv = process.argv.slice(2)
const opt = (k, d) => argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d
const base = (argv.find((a) => !a.startsWith('--')) ?? process.env.VR_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const update = argv.includes('--update')
const only = opt('only', '').split(',').filter(Boolean)
const quality = opt('quality', 'medium')
const MAX_DIFF = Number(process.env.VR_MAX_DIFF ?? 0.5)
const THRESHOLD = Number(process.env.VR_THRESHOLD ?? 0.1)
const TIMEOUT = Number(process.env.VR_TIMEOUT_MS ?? 480_000)
const W = 1280
const H = 720

/** name, x, z, compass heading (0 = north), pitch (deg) — see scripts/screenshots.mjs for more. */
const VIEWS = [
  ['atrium-arrival', 0, 19.4, 0, 7],
  ['reception', 0, 6.8, 0, 2],
  ['reveal-wall', 0.4, -15.4, 0, 6],
  ['court-centrepiece', 0.6, -23.65, 350, -8],
  ['gallery-a-hero', -7.2, -4.5, 270, 2],
  ['gallery-b', 3.9, -17, 180, 2],
  ['gallery-d-map', -25.8, -16.2, 270, 4],
  ['theatre', -12.5, 9.1, 270, 4],
  ['workshop', 11.6, 14.3, 95, -4],
  ['courtyard', 20.6, -4.5, 0, 4],
  // close-ups of GLB props (optimised models: scripts/optimize-assets.mjs)
  ['props-reception-desk', 5.8, 12.9, 0, -28],
  ['props-workshop-bucket', 27.1, 5.2, 0, -30],
  ['props-courtyard-planter', 14.6, -3.4, 270, -12],
  ['props-courtyard-basket', 18.2, -9.2, 270, -30],
]

const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => p && fs.existsSync(p))
if (!CHROME) {
  console.error('Chrome not found — set CHROME_PATH')
  process.exit(2)
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    // VR_GPU=1: hardware WebGL — much faster for local A/B checks, but NOT comparable with the baselines
    ...(process.env.VR_GPU ? ['--use-angle=' + (process.platform === 'win32' ? 'd3d11' : 'default'), '--enable-gpu'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    '--no-sandbox',
    '--force-color-profile=srgb',
    '--hide-scrollbars',
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    `--window-size=${W},${H}`,
  ],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
  protocolTimeout: TIMEOUT,
})

const errors = []
const frames = (page, n) =>
  page.evaluate((n) => new Promise((res) => {
    let i = 0
    const f = () => (++i >= n ? res() : requestAnimationFrame(f))
    requestAnimationFrame(f)
  }), n)

let failed = 0
const results = []
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(TIMEOUT)
  // next dev: block the HMR socket so edits elsewhere cannot hot-reload the page mid-run
  const cdp = await page.createCDPSession()
  await cdp.send('Network.enable')
  await cdp.send('Network.setBlockedURLs', { urls: ['*/_next/webpack-hmr*', '*/__nextjs_original-stack-frame*'] })
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && errors.push(`[console] ${m.text().slice(0, 300)}`))
  // no stored quality/a11y from a previous run; fixed clock-independent state
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.clear()
    } catch {
      /* ignore */
    }
  })
  const url = `${base}/gallery?autostart&static&vr=1&quality=${quality}`
  const t0 = Date.now()
  await page.goto(url, { waitUntil: 'networkidle2', timeout: TIMEOUT })
  await page.waitForFunction(() => window.__museum?.store.getState().phase === 'entered', { timeout: TIMEOUT, polling: 500 })
  // autostart can enter before the async shader precompile finishes
  await page.waitForFunction(() => window.__museum?.store.getState().sceneCompiled === true, { timeout: 120_000, polling: 500 }).catch(() => console.warn('warning: sceneCompiled not reported'))
  const gpu = await page.evaluate(() => {
    const gl = window.__museum?.gl?.getContext()
    const ext = gl?.getExtension('WEBGL_debug_renderer_info')
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown'
  })
  await page.evaluate(() => (window.__vrLoaded = true)) // gone after a reload
  console.log(`${url} entered in ${((Date.now() - t0) / 1000).toFixed(1)} s — ${gpu}`)
  if (!/swiftshader/i.test(gpu) && !process.env.VR_GPU) console.warn('warning: not rendering with SwiftShader — pixels will not match CI baselines')

  fs.mkdirSync(BASELINE, { recursive: true })
  fs.mkdirSync(DIFF, { recursive: true })
  for (const [name, x, z, yaw, pitch] of VIEWS) {
    if (only.length && !only.includes(name)) continue
    if (!(await page.evaluate(() => window.__vrLoaded === true))) throw new Error('the page reloaded during the run (dev-server hot reload?) — re-run')
    await page.evaluate((a) => window.__museum.teleport(a[0], a[1], a[2], a[3]), [x, z, yaw, pitch])
    await frames(page, 3)
    await page.waitForNetworkIdle({ idleTime: 800, timeout: TIMEOUT }).catch(() => undefined)
    await frames(page, 12) // textures uploaded, shadow + spot-pool refresh, easing settled
    await page.evaluate(() => {
      const canvas = document.querySelector('canvas')
      for (const el of document.body.querySelectorAll('*')) {
        if (el === canvas || el.contains(canvas) || el.tagName === 'SCRIPT') continue
        if (!el.hasAttribute('data-vr-hidden')) el.setAttribute('data-vr-hidden', el.style.visibility)
        el.style.visibility = 'hidden'
      }
    })
    const actual = PNG.sync.read(Buffer.from(await page.screenshot({ type: 'png' })))
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('[data-vr-hidden]')) {
        el.style.visibility = el.getAttribute('data-vr-hidden')
        el.removeAttribute('data-vr-hidden')
      }
    })
    const file = path.join(BASELINE, `${name}.png`)
    if (update) {
      fs.writeFileSync(file, PNG.sync.write(actual))
      console.log(`updated  ${name}`)
      results.push({ name, status: 'baseline' })
      continue
    }
    if (!fs.existsSync(file)) {
      // never silently create a baseline in compare mode (CI would always pass)
      failed++
      fs.writeFileSync(path.join(DIFF, `${name}.actual.png`), PNG.sync.write(actual))
      console.log(`FAIL  ${name}: no baseline (run npm run test:visual:update -- <baseUrl>)`)
      results.push({ name, status: 'missing-baseline' })
      continue
    }
    const expected = PNG.sync.read(fs.readFileSync(file))
    if (expected.width !== actual.width || expected.height !== actual.height) {
      failed++
      console.log(`FAIL  ${name}: size ${expected.width}×${expected.height} ≠ ${actual.width}×${actual.height}`)
      results.push({ name, status: 'size-mismatch' })
      continue
    }
    const diff = new PNG({ width: W, height: H })
    const n = pixelmatch(expected.data, actual.data, diff.data, W, H, { threshold: THRESHOLD, includeAA: false })
    const pct = (100 * n) / (W * H)
    const ok = pct <= MAX_DIFF
    if (!ok) failed++
    results.push({ name, status: ok ? 'pass' : 'fail', diffPercent: Number(pct.toFixed(3)) })
    console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(20)} ${pct.toFixed(3)}% of pixels differ`)
    if (!ok || process.env.VR_WRITE_ALL_DIFFS) {
      const side = new PNG({ width: W * 3, height: H })
      PNG.bitblt(expected, side, 0, 0, W, H, 0, 0)
      PNG.bitblt(actual, side, 0, 0, W, H, W, 0)
      PNG.bitblt(diff, side, 0, 0, W, H, 2 * W, 0)
      fs.writeFileSync(path.join(DIFF, `${name}.png`), PNG.sync.write(side))
    }
  }
} catch (err) {
  failed++
  console.error('visual regression run failed:', err)
} finally {
  await browser.close()
}

fs.mkdirSync(DIFF, { recursive: true })
fs.writeFileSync(path.join(DIFF, 'report.json'), JSON.stringify({ base, quality, maxDiffPercent: MAX_DIFF, threshold: THRESHOLD, results, errors }, null, 2) + '\n')
if (errors.length) console.log(`page errors (${errors.length}):\n  ${errors.slice(0, 10).join('\n  ')}`)
console.log(failed ? `${failed} visual regression(s) — see tests/visual/diff/` : update ? 'baselines written' : 'no visual regressions')
process.exit(failed ? 1 : 0)
