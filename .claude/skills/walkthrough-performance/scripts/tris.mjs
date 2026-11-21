// Triangle and draw breakdown of the scene once it is ready: by scene object, by kind of owner.
// usage: node tris.mjs <base> [query]
import { chromePath, galleryPath, gpuArgs, projectRequire } from './lib.mjs'
const require = projectRequire()
const puppeteer = require('puppeteer-core')
const [base, query = '?quality=medium'] = process.argv.slice(2)
const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: 'new',
  protocolTimeout: 900000,
  args: [...gpuArgs(), '--window-size=1600,900'],
  defaultViewport: { width: 1600, height: 900 },
})
try {
  const page = await browser.newPage()
  await page.goto(`${base}${galleryPath()}${query}`, { waitUntil: 'domcontentloaded', timeout: 300000 })
  await page.waitForFunction(() => !!window.__museum?.gl, { timeout: 300000, polling: 200 })
  await page.evaluate(() => {
    const gl = window.__museum.gl
    const size = (sc) => { let n = 0; sc.traverse(() => n++); return n }
    const keep = (scene) => { if (scene?.isScene) { const n = size(scene); if (!window.__scene || n > window.__sceneSize) { window.__scene = scene; window.__sceneSize = n } } }
    const orig = gl.render.bind(gl)
    gl.render = (scene, cam) => { keep(scene); return orig(scene, cam) }
    const origC = gl.compileAsync.bind(gl)
    gl.compileAsync = (scene, cam, t) => { keep(scene); return origC(scene, cam, t) }
  })
  await page.waitForFunction(() => window.__museum?.store.getState().phase === 'ready' && window.__scene, { timeout: 600000, polling: 1000 })
  const out = await page.evaluate(() => {
    const gl = window.__museum.gl
    // find the scene through any mesh's root: the renderer keeps no scene reference, so walk from __museum if exposed
    const scene = window.__scene
    if (!scene) return { err: 'no scene on window.__museum', keys: Object.keys(window.__museum) }
    const tri = (o) => {
      const g = o.geometry
      if (!g) return 0
      const n = g.index ? g.index.count : g.attributes.position?.count ?? 0
      const per = o.isPoints ? n : o.isLine ? n / 2 : n / 3
      return per * (o.isInstancedMesh ? o.count : 1)
    }
    const owner = (o) => {
      let p = o
      while (p) {
        if (p.name?.startsWith('object-')) return p.name.slice(7)
        p = p.parent
      }
      let q = o
      const names = []
      while (q && names.length < 3) {
        if (q.name) names.push(q.name)
        q = q.parent
      }
      return `(building) ${names.join(' < ') || o.type}`
    }
    const by = new Map()
    const mats = new Set()
    let total = 0
    let meshes = 0
    scene.traverse((o) => {
      if (!o.isMesh && !o.isPoints && !o.isLine) return
      meshes++
      const t = tri(o)
      total += t
      const k = owner(o)
      const e = by.get(k) ?? { t: 0, n: 0 }
      e.t += t
      e.n++
      by.set(k, e)
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m) mats.add(m.uuid)
    })
    const top = [...by.entries()].sort((a, b) => b[1].t - a[1].t).slice(0, 45)
    return { total, meshes, materials: mats.size, programs: gl.info.programs?.length, top }
  })
  if (out.err) console.log(out)
  else {
    console.log(`total ${(out.total / 1e6).toFixed(2)}M tris in ${out.meshes} meshes, ${out.materials} materials, ${out.programs} programs`)
    for (const [k, e] of out.top) console.log(`${(e.t / 1e3).toFixed(0).padStart(7)}k  ${String(e.n).padStart(4)} meshes  ${k}`)
  }
} finally {
  await browser.close()
}
