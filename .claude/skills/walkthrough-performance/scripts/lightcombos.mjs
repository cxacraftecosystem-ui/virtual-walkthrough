// The light configurations baked into the compiled programs (NUM_* defines), and the scene's lights by type and zone visibility.
// usage: node lightcombos.mjs <base> <query>
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
try {
  const page = await browser.newPage()
  await page.goto(`${base}${galleryPath()}${query}`, { waitUntil: 'domcontentloaded', timeout: 300000 })
  await page.waitForFunction(() => !!window.__museum?.gl, { timeout: 300000, polling: 200 })
  await page.evaluate(() => {
    const gl = window.__museum.gl
    const orig = gl.render.bind(gl)
    gl.render = (scene, cam) => {
      if (scene?.isScene && (!window.__scene || scene.children.length >= window.__scene.children.length)) window.__scene = scene
      return orig(scene, cam)
    }
  })
  await page.waitForFunction(() => window.__museum?.store.getState().sceneCompiled === true, { timeout: 1200000, polling: 2000 })
  const out = await page.evaluate(() => {
    const r = window.__museum.gl
    const gl = r.getContext()
    const combos = new Map()
    for (const p of r.info.programs ?? []) {
      const sh = (gl.getAttachedShaders(p.program) ?? []).find((s) => gl.getShaderParameter(s, gl.SHADER_TYPE) === gl.FRAGMENT_SHADER)
      const src = sh ? gl.getShaderSource(sh) ?? '' : ''
      const get = (n) => (src.match(new RegExp(`#define ${n} (\\d+)`)) ?? [])[1] ?? '-'
      const k = ['NUM_DIR_LIGHTS', 'NUM_SPOT_LIGHTS', 'NUM_POINT_LIGHTS', 'NUM_RECT_AREA_LIGHTS', 'NUM_HEMI_LIGHTS', 'NUM_DIR_LIGHT_SHADOWS', 'NUM_SPOT_LIGHT_SHADOWS', 'NUM_POINT_LIGHT_SHADOWS'].map((n) => `${n.replace('NUM_', '').replace('_LIGHTS', '').replace('_LIGHT', '')}=${get(n)}`).join(' ')
      combos.set(k, (combos.get(k) ?? 0) + 1)
    }
    // the scene's lights: type, visible in the world (all ancestors visible), and whether a zone group holds them
    const lights = new Map()
    const scene = window.__scene
    scene?.traverse((o) => {
      if (!o.isLight) return
      let vis = true
      for (let q = o; q; q = q.parent) if (!q.visible) vis = false
      const k = `${o.type} ${vis ? 'visible' : 'hidden'}`
      lights.set(k, (lights.get(k) ?? 0) + 1)
    })
    return { combos: [...combos.entries()].sort((a, b) => b[1] - a[1]), lights: [...lights.entries()] }
  })
  console.log('programs by light configuration:')
  for (const [k, n] of out.combos) console.log(`  ${String(n).padStart(4)}  ${k}`)
  console.log('lights in the scene:')
  for (const [k, n] of out.lights) console.log(`  ${String(n).padStart(4)}  ${k}`)
} finally {
  await browser.close()
}
