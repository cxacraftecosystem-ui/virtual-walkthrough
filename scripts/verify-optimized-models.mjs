/**
 * Renders every original model and its optimised counterpart (public/models/opt/manifest.json,
 * written by scripts/optimize-assets.mjs) with identical camera + lights in headless Chrome and
 * compares the images with pixelmatch.  node scripts/verify-optimized-models.mjs [--max-diff 1.0]
 *
 * Self-contained (serves three + public/models itself; the Next dev server is not needed).
 * The original's bounding box frames BOTH renders, so geometry drift/scale errors show up as diff.
 * Diff/side-by-side images → scripts/out/model-verify/. Exits 1 when any model exceeds --max-diff %.
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import puppeteer from 'puppeteer-core'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'scripts/out/model-verify')
const maxIdx = process.argv.indexOf('--max-diff')
const MAX_DIFF = maxIdx > 0 ? Number(process.argv[maxIdx + 1]) : 1.0
const SIZE = 512
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/models/opt/manifest.json'), 'utf8'))

const MIME = { '.js': 'text/javascript', '.gltf': 'model/gltf+json', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.html': 'text/html', '.wasm': 'application/wasm' }
const PAGE = `<!doctype html><html><body style="margin:0;background:#888">
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
// Mirrors src/museum/models/GLTFModel.tsx (dequantize → bake node transforms → merge per material)
function dequantize(g) {
  for (const [name, a] of Object.entries(g.attributes)) {
    if (a.isBufferAttribute && a.array instanceof Float32Array) continue
    const out = new Float32Array(a.count * a.itemSize)
    for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.getComponent(i, k)
    g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize))
  }
  return g
}
function bake(scene) {
  scene.updateMatrixWorld(true)
  const groups = new Map()
  scene.traverse((o) => {
    if (!o.isMesh || Array.isArray(o.material)) return
    const g = dequantize(o.geometry.clone())
    g.applyMatrix4(o.matrixWorld)
    if (!groups.has(o.material)) groups.set(o.material, [])
    groups.get(o.material).push(g)
  })
  const root = new THREE.Group()
  for (const [material, list] of groups) {
    const common = Object.keys(list[0].attributes).filter((k) => list.every((g) => !!g.attributes[k]))
    const indexed = list.every((g) => !!g.index)
    const geos = list.map((g) => { for (const k of Object.keys(g.attributes)) if (!common.includes(k)) g.deleteAttribute(k); g.morphAttributes = {}; return indexed ? g : g.index ? g.toNonIndexed() : g })
    const m = geos.length === 1 ? geos[0] : mergeGeometries(geos, false)
    for (const g of m ? [m] : geos) root.add(new THREE.Mesh(g, material))
  }
  return root
}
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
renderer.setSize(${SIZE}, ${SIZE}, false)
renderer.setPixelRatio(1)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
document.body.appendChild(renderer.domElement)
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
window.__render = async (origUrl, optUrl) => {
  const [a, b] = await Promise.all([loader.loadAsync(origUrl), loader.loadAsync(optUrl)])
  const box = new THREE.Box3().setFromObject(a.scene)
  const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3())
  const r = size.length() / 2
  const cam = new THREE.PerspectiveCamera(35, 1, r / 100, r * 100)
  cam.position.copy(c).add(new THREE.Vector3(0.9, 0.55, 1.2).normalize().multiplyScalar(r / Math.sin(THREE.MathUtils.degToRad(17))))
  cam.lookAt(c)
  const shots = []
  for (const object of [a.scene, b.scene, bake(b.scene.clone(true))]) {
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x888888)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444433, 1.2))
    const sun = new THREE.DirectionalLight(0xffffff, 2.5); sun.position.set(2, 4, 3); scene.add(sun)
    scene.add(object)
    renderer.render(scene, cam)
    shots.push(renderer.domElement.toDataURL('image/png'))
  }
  let tris = [0, 0]
  ;[a, b].forEach((g, i) => g.scene.traverse((o) => { if (o.isMesh) tris[i] += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3 }))
  return { shots, tris, size: size.toArray() }
}
window.__ready = true
</script></body></html>`

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  let file
  if (url === '/') return res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE)
  if (url.startsWith('/three/')) file = path.join(ROOT, 'node_modules/three', url.slice(7))
  else if (url.startsWith('/models/')) file = path.join(ROOT, 'public/models', url.slice(8))
  if (!file || !fs.existsSync(file)) return res.writeHead(404).end()
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

const chrome = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].find((p) => p && fs.existsSync(p))
const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
fs.mkdirSync(OUT, { recursive: true })
let failed = 0
try {
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.error('page error:', e.message))
  await page.goto(base)
  await page.waitForFunction('window.__ready === true')
  for (const m of manifest.models) {
    const orig = '/' + m.source.replace(/^public\//, '')
    const opt = '/' + m.output.replace(/^public\//, '')
    const r = await page.evaluate((a, b) => window.__render(a, b), orig, opt)
    const [pa, pb, pc] = r.shots.map((d) => PNG.sync.read(Buffer.from(d.split(',')[1], 'base64')))
    const diff = new PNG({ width: SIZE, height: SIZE })
    const n = pixelmatch(pa.data, pb.data, diff.data, SIZE, SIZE, { threshold: 0.1 })
    const pct = (100 * n) / (SIZE * SIZE)
    // the optimised file through the app's bake/merge path (GLTFModel.tsx)
    const pctBaked = (100 * pixelmatch(pa.data, pc.data, null, SIZE, SIZE, { threshold: 0.1 })) / (SIZE * SIZE)
    const name = path.basename(m.output, '.glb')
    const side = new PNG({ width: SIZE * 3, height: SIZE })
    ;[pa, pb, diff].forEach((img, i) => PNG.bitblt(img, side, 0, 0, SIZE, SIZE, i * SIZE, 0))
    fs.writeFileSync(path.join(OUT, `${name}.png`), PNG.sync.write(side))
    const ok = pct <= MAX_DIFF && pctBaked <= MAX_DIFF && r.tris[0] === r.tris[1]
    if (!ok) failed++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(26)} diff ${pct.toFixed(3)}% (baked ${pctBaked.toFixed(3)}%)  tris ${r.tris[0]} → ${r.tris[1]}  bytes ${(m.before / 1024).toFixed(0)} → ${(m.after / 1024).toFixed(0)} KB`)
  }
} finally {
  await browser.close()
  server.close()
}
console.log(failed ? `${failed} model(s) differ by more than ${MAX_DIFF}% (see ${path.relative(ROOT, OUT)})` : `all ${manifest.models.length} models match (≤ ${MAX_DIFF}% pixels differ)`)
process.exit(failed ? 1 : 0)
