/**
 * Team models: the workshop team's binary STL models → small museum GLBs.
 *   node scripts/import-team-models.mjs <stl dir> [--verify] [--target <triangles>]
 *
 * Each STL in <stl dir> whose name matches a row of PIECES (Z-up, any unit, no colour/UVs) goes through:
 *   parse → weld (shared corners → one indexed vertex, degenerate triangles dropped) → Z-up to Y-up
 *   (STL front −Y faces glTF +Z) → scaled to its nominal height in metres, centred on x/z, base at y = 0 →
 *   meshopt simplify to ~--target triangles only when asked (error capped at 0.5 % of the piece's size; default: full detail) → crease-aware
 *   smooth normals (faces meeting at more than CREASE_DEG keep a hard edge) → one PBR material (no
 *   textures) → reorder + KHR_mesh_quantization (16-bit positions, 12-bit normals) + EXT_meshopt_compression (@gltf-transform meshopt 'medium').
 * GLTFModel.tsx loads them with drei useGLTF (meshopt decoder on), de-quantises and fits them by `height`.
 *
 * Every GLB is read back with NodeIO (one primitive with normals, one material). --verify renders every
 * source STL and its GLB (through GLTFModel's de-quantise → bake path) from the front, the side and above
 * in headless Chrome, and fails when the silhouettes differ by more than MAX_SILHOUETTE_DIFF % of the
 * piece's pixels.
 *
 * Outputs: public/models/team/<slug>.glb; with --verify, before | after | diff sheets in
 * scripts/out/team-models/<slug>.png. Prints triangles and bytes before → after for each piece.
 * public/models/team/ is already optimised: scripts/optimize-assets.mjs skips it.
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { Document, Logger, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { meshopt } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'public/models/team')
const SHEETS = path.join(ROOT, 'scripts/out/team-models')
const args = process.argv.slice(2)
const stlDir = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a))
const verify = args.includes('--verify')
const targetIdx = args.indexOf('--target')
/** Full detail unless --target asks for fewer triangles: the scans are small enough to ship whole. */
const TARGET_TRIS = targetIdx >= 0 ? Number(args[targetIdx + 1]) : Infinity
/** Simplifier error cap, relative to the piece's extent: 0.5 % ≈ 1.5 mm on a 0.3 m piece. */
const MAX_ERROR = 0.005
/** Faces meeting at more than this keep a hard edge (cut bamboo ends, plinth edges); gentler folds of the scan stay smooth. Env CREASE_DEG overrides. */
const CREASE_DEG = Number(process.env.CREASE_DEG ?? 70)
const MAX_SILHOUETTE_DIFF = 1.5

/** sRGB hex → linear RGBA (glTF baseColorFactor is linear). */
function linear(hex) {
  const n = parseInt(hex.slice(1), 16)
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return [...c, 1]
}

/**
 * Stand-in finishes (the STLs carry no colour; the museum text says so), chosen to read true under the
 * gallery's daylight + track lighting: pale golden bamboo, warm dark wood, fired clay, polished brass.
 */
const MATERIALS = {
  bamboo: { name: 'bamboo', color: '#c9a46a', roughness: 0.6, metalness: 0 },
  wood: { name: 'wood', color: '#7a4a2a', roughness: 0.55, metalness: 0 },
  terracotta: { name: 'terracotta', color: '#c47048', roughness: 0.7, metalness: 0 },
  brass: { name: 'brass', color: '#c9a050', roughness: 0.34, metalness: 1 },
}

/** slug, file-name pattern, nominal height (m, = the display height in src/museum/config/objects.ts), material. */
const PIECES = [
  { slug: 'bamboo-sentinel', match: /^bamboo_sentinel/i, height: 0.42, material: MATERIALS.bamboo },
  { slug: 'bamboo-stand', match: /^bamboo_stand/i, height: 0.38, material: MATERIALS.bamboo },
  { slug: 'bamboo-frame-on-table', match: /^bamboo_frame_on_table/i, height: 0.27, material: MATERIALS.bamboo },
  { slug: 'wooden-spoon', match: /^wooden_spoon/i, height: 0.28, material: MATERIALS.wood },
  { slug: 'ganesha-statue', match: /^ganesha_statue/i, height: 0.36, material: MATERIALS.brass },
  { slug: 'ganesha', match: /^ganesha_texture/i, height: 0.32, material: MATERIALS.terracotta },
]

/* ------------------------------------------------------------------ geometry */

/** Binary STL → { positions (3 corners per triangle), triangles }. */
function parseStl(buf) {
  const n = buf.readUInt32LE(80)
  if (buf.length !== 84 + n * 50) throw new Error('not a binary STL (size does not match its triangle count)')
  const positions = new Float32Array(n * 9)
  for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) positions[i * 9 + k] = buf.readFloatLE(84 + i * 50 + 12 + k * 4)
  return { positions, triangles: n }
}

/** Shared corners → one vertex (exact match); triangles that collapse to a line or point are dropped. */
function weldStl(corners) {
  const key = new Map()
  const verts = []
  const remap = new Uint32Array(corners.length / 3)
  const bits = new Uint32Array(corners.buffer, corners.byteOffset, corners.length)
  for (let c = 0; c < remap.length; c++) {
    const k = `${bits[c * 3]},${bits[c * 3 + 1]},${bits[c * 3 + 2]}`
    let v = key.get(k)
    if (v === undefined) {
      v = verts.length / 3
      key.set(k, v)
      verts.push(corners[c * 3], corners[c * 3 + 1], corners[c * 3 + 2])
    }
    remap[c] = v
  }
  const idx = []
  for (let t = 0; t < remap.length; t += 3) {
    const [a, b, c] = [remap[t], remap[t + 1], remap[t + 2]]
    if (a !== b && b !== c && a !== c) idx.push(a, b, c)
  }
  return { positions: new Float32Array(verts), indices: new Uint32Array(idx) }
}

/** Z-up (STL) → Y-up (glTF): (x, y, z) → (x, z, −y); then scale to `height` m, centre x/z, base at 0. */
function toYUp(pos, height) {
  const out = new Float32Array(pos.length)
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < pos.length; i += 3) {
    out[i] = pos[i]
    out[i + 1] = pos[i + 2]
    out[i + 2] = -pos[i + 1]
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], out[i + k])
      max[k] = Math.max(max[k], out[i + k])
    }
  }
  const s = height / (max[1] - min[1])
  const off = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2]
  for (let i = 0; i < out.length; i += 3) for (let k = 0; k < 3; k++) out[i + k] = (out[i + k] - off[k]) * s
  return out
}

/** Drop vertices no triangle uses (after simplification). */
function compact(positions, indices) {
  const [remap, unique] = MeshoptSimplifier.compactMesh(indices.slice())
  const pos = new Float32Array(unique * 3)
  for (let v = 0; v < remap.length; v++) if (remap[v] !== 0xffffffff) pos.set(positions.subarray(v * 3, v * 3 + 3), remap[v] * 3)
  const idx = new Uint32Array(indices.length)
  for (let i = 0; i < indices.length; i++) idx[i] = remap[indices[i]]
  return { positions: pos, indices: idx }
}

/**
 * Crease-aware smooth normals: each corner averages (area-weighted) the faces around its vertex that
 * lie within CREASE_DEG of its own face; corners with the same position + normal share one vertex.
 */
function creaseNormals(positions, indices) {
  const nt = indices.length / 3
  const fn = new Float32Array(nt * 3) // area-weighted
  const fu = new Float32Array(nt * 3) // unit
  for (let t = 0; t < nt; t++) {
    const [a, b, c] = [indices[t * 3] * 3, indices[t * 3 + 1] * 3, indices[t * 3 + 2] * 3]
    const e1 = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]]
    const e2 = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]]
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
    const l = Math.hypot(...n) || 1
    for (let k = 0; k < 3; k++) {
      fn[t * 3 + k] = n[k] / 2
      fu[t * 3 + k] = n[k] / l
    }
  }
  const nv = positions.length / 3
  const start = new Uint32Array(nv + 1)
  for (const v of indices) start[v + 1]++
  for (let v = 0; v < nv; v++) start[v + 1] += start[v]
  const fill = start.slice(0, nv)
  const around = new Uint32Array(indices.length)
  for (let i = 0; i < indices.length; i++) around[fill[indices[i]]++] = (i / 3) | 0
  const cos = Math.cos((CREASE_DEG * Math.PI) / 180)
  const outPos = []
  const outNor = []
  const outIdx = new Uint32Array(indices.length)
  const seen = new Map()
  let splits = 0
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i]
    const t = (i / 3) | 0
    const n = [0, 0, 0]
    let excluded = false
    for (let j = start[v]; j < start[v + 1]; j++) {
      const g = around[j]
      if (fu[g * 3] * fu[t * 3] + fu[g * 3 + 1] * fu[t * 3 + 1] + fu[g * 3 + 2] * fu[t * 3 + 2] < cos) {
        excluded = true
        continue
      }
      for (let k = 0; k < 3; k++) n[k] += fn[g * 3 + k]
    }
    const l = Math.hypot(...n) || 1
    const q = n.map((x) => Math.round((x / l) * 1024))
    const key = excluded ? `${v}:${q.join(',')}` : `${v}`
    let o = seen.get(key)
    if (o === undefined) {
      o = outPos.length / 3
      seen.set(key, o)
      outPos.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2])
      outNor.push(n[0] / l, n[1] / l, n[2] / l)
      if (excluded) splits++
    }
    outIdx[i] = o
  }
  return { positions: new Float32Array(outPos), normals: new Float32Array(outNor), indices: outIdx, splits }
}

/* ------------------------------------------------------------------ glTF */

function buildDocument(piece, mesh) {
  const doc = new Document().setLogger(new Logger(Logger.Verbosity.WARN))
  doc.getRoot().getAsset().generator = 'virtual-walkthrough scripts/import-team-models.mjs'
  const buffer = doc.createBuffer()
  const m = piece.material
  const material = doc
    .createMaterial(m.name)
    .setBaseColorFactor(linear(m.color))
    .setRoughnessFactor(m.roughness)
    .setMetallicFactor(m.metalness)
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(mesh.positions).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(mesh.normals).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(mesh.indices).setBuffer(buffer))
    .setMaterial(material)
  const node = doc.createNode(piece.slug).setMesh(doc.createMesh(piece.slug).addPrimitive(prim))
  doc.createScene(piece.slug).addChild(node)
  return doc
}

/* ------------------------------------------------------------------ main */

if (!stlDir || !fs.existsSync(stlDir)) {
  console.error('usage: node scripts/import-team-models.mjs <stl dir> [--verify] [--target <triangles>]')
  process.exit(2)
}
await Promise.all([MeshoptSimplifier.ready, MeshoptEncoder.ready, MeshoptDecoder.ready])
const io = new NodeIO().setLogger(new Logger(Logger.Verbosity.WARN)).registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })
fs.mkdirSync(OUT, { recursive: true })
const files = fs.readdirSync(stlDir).filter((f) => /\.stl$/i.test(f))
const done = []
for (const piece of PIECES) {
  const file = files.find((f) => piece.match.test(f))
  if (!file) {
    console.warn(`  ${piece.slug}: no matching STL in ${stlDir} — skipped`)
    continue
  }
  const src = path.join(stlDir, file)
  const stl = parseStl(fs.readFileSync(src))
  const welded = weldStl(stl.positions)
  const positions = toYUp(welded.positions, piece.height)
  const target = Math.min(welded.indices.length, TARGET_TRIS * 3)
  const [simplified, relError] = target < welded.indices.length ? MeshoptSimplifier.simplify(welded.indices, positions, 3, target, MAX_ERROR) : [welded.indices, 0]
  const small = compact(positions, simplified)
  const mesh = creaseNormals(small.positions, small.indices)
  const doc = buildDocument(piece, mesh)
  // 'medium' keeps normals at 12 bits ('high' filters them to 8, which bands carved surfaces); positions at 16 bits ≈ 0.006 mm on a 0.42 m piece
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 16, quantizeNormal: 12 }))
  const out = path.join(OUT, `${piece.slug}.glb`)
  await io.write(out, doc)

  // read it back the way the museum will (decoder on) and check what came out
  const back = await io.read(out)
  const prims = back.getRoot().listMeshes().flatMap((m) => m.listPrimitives())
  const tris = prims.reduce((a, p) => a + p.getIndices().getCount() / 3, 0)
  if (prims.length !== 1 || back.getRoot().listMaterials().length !== 1 || !prims[0].getAttribute('NORMAL')) throw new Error(`${piece.slug}: expected one primitive with normals and one material`)
  const extent = MeshoptSimplifier.getScale(positions, 3)
  const r = { piece, file, src, out, trisBefore: stl.triangles, tris, bytesBefore: fs.statSync(src).size, bytes: fs.statSync(out).size, errorMm: relError * extent * 1000, splits: mesh.splits }
  done.push(r)
  console.log(
    `  ${piece.slug.padEnd(22)} ${r.trisBefore.toLocaleString('en')} → ${r.tris.toLocaleString('en')} tris   ${(r.bytesBefore / 1024).toFixed(0)} KB → ${(r.bytes / 1024).toFixed(0)} KB` +
      `   (${piece.height} m, ${piece.material.name}, max deviation ${r.errorMm.toFixed(2)} mm, ${r.splits} crease vertices)`,
  )
}
const sum = (k) => done.reduce((a, r) => a + r[k], 0)
console.log(`total: ${sum('trisBefore').toLocaleString('en')} → ${sum('tris').toLocaleString('en')} tris, ${(sum('bytesBefore') / 1048576).toFixed(1)} MB → ${(sum('bytes') / 1024).toFixed(0)} KB`)

if (verify) process.exit((await verifyRenders(done)) ? 0 : 1)

/* ------------------------------------------------------------------ --verify */

async function verifyRenders(list) {
  const { default: puppeteer } = await import('puppeteer-core')
  const { PNG } = await import('pngjs')
  const SIZE = 384
  const BG = [136, 136, 136]
  const PAGE = `<!doctype html><html><body style="margin:0;background:#888">
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
// GLTFModel.tsx: de-quantise, then bake node transforms
function dequantize(g) {
  for (const [name, a] of Object.entries(g.attributes)) {
    if (a.isBufferAttribute && a.array instanceof Float32Array) continue
    const out = new Float32Array(a.count * a.itemSize)
    for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.getComponent(i, k)
    g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize))
  }
  return g
}
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true })
renderer.setSize(${SIZE}, ${SIZE}, false)
renderer.setPixelRatio(1)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
document.body.appendChild(renderer.domElement)
window.__render = async (stlUrl, glbUrl, height) => {
  const stl = await new STLLoader().loadAsync(stlUrl)
  stl.rotateX(-Math.PI / 2) // Z-up → Y-up, as the importer
  stl.computeBoundingBox()
  const b0 = stl.boundingBox, s = height / (b0.max.y - b0.min.y)
  stl.translate(-(b0.min.x + b0.max.x) / 2, -b0.min.y, -(b0.min.z + b0.max.z) / 2)
  stl.scale(s, s, s)
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(glbUrl)
  gltf.scene.updateMatrixWorld(true)
  const baked = new THREE.Group()
  let material = null
  gltf.scene.traverse((o) => { if (o.isMesh) { const g = dequantize(o.geometry.clone()); g.applyMatrix4(o.matrixWorld); material = o.material; baked.add(new THREE.Mesh(g, o.material)) } })
  const before = new THREE.Mesh(stl, material.clone())
  before.material.flatShading = true
  const box = new THREE.Box3().setFromObject(before), c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2
  const views = [[0, 0.12, 1], [1, 0.12, 0], [0.7, 0.9, 0.7]]
  const shots = []
  for (const v of views) {
    const cam = new THREE.PerspectiveCamera(30, 1, r / 100, r * 100)
    cam.position.copy(c).add(new THREE.Vector3(...v).normalize().multiplyScalar(r / Math.sin(THREE.MathUtils.degToRad(15))))
    cam.lookAt(c)
    for (const object of [before, baked]) {
      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0x888888)
      scene.add(new THREE.HemisphereLight(0xfff4e6, 0x3a3530, 1.4))
      const sun = new THREE.DirectionalLight(0xffffff, 2.6); sun.position.set(2, 4, 3); scene.add(sun)
      scene.add(object)
      renderer.render(scene, cam)
      shots.push(renderer.domElement.toDataURL('image/png'))
      scene.remove(object)
    }
  }
  return shots
}
window.__ready = true
</script></body></html>`
  const byUrl = new Map(list.map((r) => [`/stl/${r.piece.slug}.stl`, r.src]))
  const MIME = { '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.stl': 'model/stl' }
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    if (url === '/') return res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE)
    let file
    if (url.startsWith('/three/')) file = path.join(ROOT, 'node_modules/three', url.slice(7))
    else if (url.startsWith('/models/')) file = path.join(ROOT, 'public/models', url.slice(8))
    else file = byUrl.get(url)
    if (!file || !fs.existsSync(file)) return res.writeHead(404).end()
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const chrome = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'].find((p) => p && fs.existsSync(p))
  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  fs.mkdirSync(SHEETS, { recursive: true })
  let ok = true
  try {
    const page = await browser.newPage()
    page.on('pageerror', (e) => console.error('page error:', e.message))
    await page.goto(`http://127.0.0.1:${server.address().port}/`)
    await page.waitForFunction('window.__ready === true')
    console.log('verify (silhouettes, front / side / above):')
    for (const r of list) {
      const shots = await page.evaluate((a, b, h) => window.__render(a, b, h), `/stl/${r.piece.slug}.stl`, `/models/team/${r.piece.slug}.glb`, r.piece.height)
      const imgs = shots.map((d) => PNG.sync.read(Buffer.from(d.split(',')[1], 'base64')))
      const sheet = new PNG({ width: SIZE * 3, height: SIZE * 3 })
      const pct = []
      for (let v = 0; v < 3; v++) {
        const [a, b] = [imgs[v * 2], imgs[v * 2 + 1]]
        const diff = new PNG({ width: SIZE, height: SIZE })
        let inA = 0
        let xor = 0
        for (let i = 0; i < SIZE * SIZE; i++) {
          const fa = a.data[i * 4] !== BG[0] || a.data[i * 4 + 1] !== BG[1] || a.data[i * 4 + 2] !== BG[2]
          const fb = b.data[i * 4] !== BG[0] || b.data[i * 4 + 1] !== BG[1] || b.data[i * 4 + 2] !== BG[2]
          inA += fa
          xor += fa !== fb
          const col = fa && fb ? [70, 70, 70] : fa ? [230, 40, 40] : fb ? [40, 90, 230] : [235, 235, 235]
          diff.data.set([...col, 255], i * 4)
        }
        pct.push((100 * xor) / Math.max(1, inA))
        ;[a, b, diff].forEach((img, k) => PNG.bitblt(img, sheet, 0, 0, SIZE, SIZE, k * SIZE, v * SIZE))
      }
      fs.writeFileSync(path.join(SHEETS, `${r.piece.slug}.png`), PNG.sync.write(sheet))
      const worst = Math.max(...pct)
      const pass = worst <= MAX_SILHOUETTE_DIFF
      ok &&= pass
      console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${r.piece.slug.padEnd(22)} silhouette diff ${pct.map((p) => p.toFixed(2)).join(' / ')} %`)
    }
  } finally {
    await browser.close()
    server.close()
  }
  console.log(ok ? `all silhouettes within ${MAX_SILHOUETTE_DIFF} % (sheets: ${path.relative(ROOT, SHEETS)})` : `silhouettes differ by more than ${MAX_SILHOUETTE_DIFF} % (see ${path.relative(ROOT, SHEETS)})`)
  return ok
}
