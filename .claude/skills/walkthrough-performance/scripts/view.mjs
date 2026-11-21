// What the first view draws: once compiled, the frustum-visible meshes from the spawn camera, their triangles by
// owner, and how many distinct programs they need (vs everything shown for the zone).
// usage: node view.mjs <base> <query>
import { chromePath, galleryPath, gpuArgs, projectRequire } from './lib.mjs'
const require = projectRequire()
const puppeteer = require('puppeteer-core')
const [base, query = ''] = process.argv.slice(2)
const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: 'new',
  protocolTimeout: 1200000,
  args: [...gpuArgs(), '--window-size=1920,967'],
  defaultViewport: { width: 1920, height: 967 },
})
try {
  const page = await browser.newPage()
  await page.goto(`${base}${galleryPath()}${query}`, { waitUntil: 'domcontentloaded', timeout: 300000 })
  await page.waitForFunction(() => !!window.__museum?.gl, { timeout: 300000, polling: 200 })
  await page.evaluate(() => {
    const gl = window.__museum.gl
    const size = (sc) => {
      let n = 0
      sc.traverse(() => n++)
      return n
    }
    const keep = (scene, cam) => {
      if (scene?.isScene) {
        const n = size(scene)
        if (!window.__scene || n > window.__sceneSize) {
          window.__scene = scene
          window.__sceneSize = n
        }
        if (scene === window.__scene && cam?.isPerspectiveCamera) window.__cam = cam
      }
    }
    const orig = gl.render.bind(gl)
    gl.render = (scene, cam) => {
      keep(scene, cam)
      return orig(scene, cam)
    }
  })
  await page.waitForFunction(() => window.__museum?.store.getState().sceneCompiled === true && window.__cam, { timeout: 1200000, polling: 2000 })
  await new Promise((r) => setTimeout(r, 3000))
  const out = await page.evaluate(() => {
    const r = window.__museum.gl
    const scene = window.__scene
    const cam = window.__cam
    cam.updateMatrixWorld()
    const THREEFrustum = cam.constructor // not available directly: build the frustum test by hand from projection
    const m = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse)
    const e = m.elements
    const planes = [
      [e[3] - e[0], e[7] - e[4], e[11] - e[8], e[15] - e[12]],
      [e[3] + e[0], e[7] + e[4], e[11] + e[8], e[15] + e[12]],
      [e[3] + e[1], e[7] + e[5], e[11] + e[9], e[15] + e[13]],
      [e[3] - e[1], e[7] - e[5], e[11] - e[9], e[15] - e[13]],
      [e[3] - e[2], e[7] - e[6], e[11] - e[10], e[15] - e[14]],
      [e[3] + e[2], e[7] + e[6], e[11] + e[10], e[15] + e[14]],
    ].map(([a, b, c, d]) => {
      const l = Math.hypot(a, b, c)
      return [a / l, b / l, c / l, d / l]
    })
    const inFrustum = (o) => {
      const g = o.geometry
      if (!g) return false
      if (!o.frustumCulled) return true
      if (o.isInstancedMesh) {
        if (!o.boundingSphere) o.computeBoundingSphere?.()
      } else if (!g.boundingSphere) g.computeBoundingSphere()
      const s = (o.isInstancedMesh ? o.boundingSphere : g.boundingSphere)?.clone()
      if (!s) return true
      s.applyMatrix4(o.matrixWorld)
      return planes.every((p) => p[0] * s.center.x + p[1] * s.center.y + p[2] * s.center.z + p[3] > -s.radius)
    }
    const tri = (o) => {
      const g = o.geometry
      const n = g.index ? g.index.count : g.attributes.position?.count ?? 0
      return (o.isPoints ? n : o.isLine ? n / 2 : n / 3) * (o.isInstancedMesh ? o.count : 1)
    }
    const owner = (o) => {
      let p = o
      while (p) {
        if (p.name?.startsWith('object-')) return p.name.slice(7)
        p = p.parent
      }
      const names = []
      let q = o
      while (q && names.length < 3) {
        if (q.name) names.push(q.name)
        q = q.parent
      }
      return `(building) ${names.join(' < ') || o.type}`
    }
    const prog = (o) =>
      (Array.isArray(o.material) ? o.material : [o.material])
        .map((m) => (m ? (r.properties.get(m).currentProgram?.id ?? m.uuid) : ''))
        .join('+') + `|${o.castShadow ? 1 : 0}${o.isInstancedMesh ? 'i' : ''}`
    const by = new Map()
    const keysView = new Set()
    const keysAll = new Set()
    let tris = 0
    let draws = 0
    scene.traverseVisible((o) => {
      if (!o.isMesh && !o.isPoints && !o.isLine && !o.isSprite) return
      keysAll.add(prog(o))
      if (!inFrustum(o)) return
      keysView.add(prog(o))
      const t = tri(o)
      tris += t
      draws++
      const k = owner(o)
      const e2 = by.get(k) ?? { t: 0, n: 0 }
      e2.t += t
      e2.n++
      by.set(k, e2)
    })
    return {
      cam: [cam.position.x, cam.position.y, cam.position.z].map((v) => +v.toFixed(1)),
      tris,
      draws,
      programsInView: keysView.size,
      programsInZones: keysAll.size,
      top: [...by.entries()].sort((a, b) => b[1].t - a[1].t).slice(0, 30),
    }
  })
  console.log(`camera ${out.cam}; in view ${(out.tris / 1e6).toFixed(2)}M tris, ${out.draws} draws; programs in view ${out.programsInView}, in the visible zones ${out.programsInZones}`)
  for (const [k, e] of out.top) console.log(`${(e.t / 1e3).toFixed(0).padStart(7)}k ${String(e.n).padStart(4)}  ${k}`)
} finally {
  await browser.close()
}
