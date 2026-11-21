// What the draw calls are: at each pose, wrap renderBufferDirect for one frame and group the calls by pass
// (canvas / shadow / other render targets) and by object (name, or the nearest named ancestor) + material type.
// usage: node calls.mjs <base> <query> '<[[name, [x, z, yaw, pitch]], ...]>' [top=25]
import { chromePath, galleryPath, gpuArgs, projectRequire } from './lib.mjs'
const require = projectRequire()
const puppeteer = require('puppeteer-core')
const [base, query = '', stopsJson, top = '25'] = process.argv.slice(2)
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
  const T0 = Date.now()
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)))
  await page.goto(`${base}${galleryPath()}${query}${query ? '&' : '?'}autostart&noarrival`, { waitUntil: 'domcontentloaded', timeout: 300000 })
  await page.waitForFunction(() => window.__museum?.store.getState().phase === 'entered' && window.__museum.store.getState().sceneCompiled, { timeout: 1200000, polling: 1000 })
  console.log(`entered at ${((Date.now() - T0) / 1000).toFixed(0)} s`)
  for (const [name, pose] of stops) {
    await page.evaluate((p) => window.__museum.teleport(p[0], p[1], p[2], p[3]), pose)
    await new Promise((r) => setTimeout(r, 5000))
    const res = await page.evaluate(async (topN) => {
      const gl = window.__museum.gl
      const orig = gl.renderBufferDirect
      const byPass = {}
      const byObj = {}
      const label = (o) => {
        let n = o
        while (n && !n.name) n = n.parent
        return n ? n.name : `(${o.type})`
      }
      let frames = 0
      await new Promise((resolve) => {
        gl.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
          const rt = gl.getRenderTarget()
          const pass = !rt ? 'canvas' : rt.isWebGLShadowMap || rt.texture?.name?.includes('Shadow') || material?.isMeshDepthMaterial || material?.isMeshDistanceMaterial ? 'shadow' : `rt ${rt.width}x${rt.height}`
          byPass[pass] = (byPass[pass] ?? 0) + 1
          if (pass === 'canvas') {
            const k = `${label(object)} · ${material?.type ?? '?'}${material?.name ? ':' + material.name : ''} · ${geometry?.type ?? '?'}${object.isInstancedMesh ? ' (instanced)' : ''}`
            byObj[k] = (byObj[k] ?? 0) + 1
          }
          return orig.call(this, camera, scene, geometry, material, object, group)
        }
        requestAnimationFrame(() => {
          frames = 1
          gl.renderBufferDirect = orig
          resolve()
        })
      })
      const objs = Object.entries(byObj).sort((a, b) => b[1] - a[1])
      return { byPass, total: objs.reduce((s, [, n]) => s + n, 0), top: objs.slice(0, topN), frames }
    }, Number(top))
    console.log(`\n== ${name}: canvas ${res.total} calls; passes ${JSON.stringify(res.byPass)}`)
    for (const [k, n] of res.top) console.log(`  ${String(n).padStart(5)}  ${k}`)
  }
} finally {
  await browser.close()
}
