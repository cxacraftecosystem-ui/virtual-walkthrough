// Program statistics once compiled: how many, by material type, and their fragment shader sizes.
// usage: node progs.mjs <base> <query>
import { chromePath, galleryPath, gpuArgs, projectRequire } from './lib.mjs'
const require = projectRequire()
const puppeteer = require('puppeteer-core')
const [base, query = ''] = process.argv.slice(2)
const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: 'new',
  protocolTimeout: 1200000,
  args: [...gpuArgs(), '--window-size=1600,900'],
  defaultViewport: { width: 1600, height: 900 },
})
const t0 = Date.now()
try {
  const page = await browser.newPage()
  page.on('console', (m) => {
    if (/\[museum\]/.test(m.text())) console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s ${m.text().slice(0, 200)}`)
  })
  await page.goto(`${base}${galleryPath()}${query}`, { waitUntil: 'domcontentloaded', timeout: 300000 })
  await page.waitForFunction(() => window.__museum?.store.getState().sceneCompiled === true, { timeout: 1200000, polling: 2000 })
  console.log(`compiled at ${((Date.now() - t0) / 1000).toFixed(0)}s (before Enter)`)
  const out = await page.evaluate(() => {
    const r = window.__museum.gl
    const gl = r.getContext()
    const progs = r.info.programs ?? []
    const byName = new Map()
    let total = 0
    const sizes = []
    for (const p of progs) {
      const sh = gl.getAttachedShaders(p.program) ?? []
      let frag = 0
      for (const s of sh) if (gl.getShaderParameter(s, gl.SHADER_TYPE) === gl.FRAGMENT_SHADER) frag = (gl.getShaderSource(s) ?? '').length
      total += frag
      sizes.push(frag)
      const k = p.name || p.type || '?'
      const e = byName.get(k) ?? { n: 0, bytes: 0 }
      e.n++
      e.bytes += frag
      byName.set(k, e)
    }
    // the lights every lit program carries
    const lights = { spot: 0, point: 0, rect: 0, dir: 0, hemi: 0 }
    return { count: progs.length, total, max: Math.max(...sizes), median: sizes.sort((a, b) => a - b)[sizes.length >> 1], byName: [...byName.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 60), lights }
  })
  console.log(`${out.count} programs; fragment source total ${(out.total / 1e6).toFixed(1)} MB, median ${(out.median / 1e3).toFixed(0)} kB, max ${(out.max / 1e3).toFixed(0)} kB`)
  for (const [k, e] of out.byName) console.log(`  ${String(e.n).padStart(4)}  ${(e.bytes / e.n / 1e3).toFixed(0).padStart(4)} kB avg  ${k}`)
} finally {
  await browser.close()
}
