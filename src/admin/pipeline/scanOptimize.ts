/**
 * 3D scan import — browser-side glTF optimisation with glTF-Transform + meshoptimizer.
 * Runs inside scanOptimize.worker.ts (falls back to the main thread).
 *
 * Input: a .glb, or a .gltf with its .bin and texture files (Polycam / RealityScan / Luma exports).
 * Steps:
 *   1. dedup + prune                (duplicate accessors / materials / textures, orphans)
 *   2. weld                         (merge identical vertices so the mesh can be simplified)
 *   3. meshopt simplify             to a triangle budget (default 40k), with an error cap
 *   4. smooth normals if missing    (scans sometimes ship without NORMAL)
 *   5. textures ≤ maxTexture px, re-encoded as WebP (EXT_texture_webp; JPEG/PNG where the
 *      browser cannot encode WebP)
 *   6. re-orient (Z-up scans) + scale to a real height in metres + centre on the footprint,
 *      bottom at y = 0 — via one wrapper node
 *   7. EXT_meshopt_compression + KHR_mesh_quantization, written as a single .glb
 * The museum loaders (drei useGLTF with the meshopt decoder) read the result directly.
 */
import { Document, ImageUtils, type Primitive, WebIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions'
import { dedup, getBounds, meshopt, prune, simplify, weld } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'

export interface ScanFile {
  name: string
  data: Uint8Array<ArrayBuffer>
}

export interface ScanOptions {
  /** Triangle budget for the whole model. */
  targetTriangles: number
  /** Longest texture side (px). */
  maxTexture: number
  /** WebP quality 0..1. */
  textureQuality: number
  /** Real height in metres (0 / undefined = keep the file's own units). */
  height?: number
  /** Scans exported Z-up need a −90° turn about X. */
  upAxis: 'y' | 'z'
}

export interface ScanStats {
  triangles: number
  vertices: number
  meshes: number
  materials: number
  textures: number
  maxTextureSize: [number, number] | null
  textureBytes: number
  bytes: number
  /** Bounding box size [x, y, z] in file units (metres after optimisation). */
  size: [number, number, number]
}

export interface ScanResult {
  glb: Uint8Array
  before: ScanStats
  after: ScanStats
  warnings: string[]
}

export const SCAN_DEFAULTS: ScanOptions = { targetTriangles: 40_000, maxTexture: 2048, textureQuality: 0.85, height: 0, upAxis: 'y' }

type IO = WebIO

async function createIO(): Promise<IO> {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready])
  // WebIO needs `fetch` only for external URIs (not used here); works in workers.
  return new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  })
}

const base = (p: string) => decodeURIComponent(p.split(/[\\/]/).pop() ?? p).toLowerCase()

async function readInput(io: IO, files: ScanFile[]): Promise<{ doc: Document; bytes: number }> {
  const bytes = files.reduce((n, f) => n + f.data.byteLength, 0)
  const glb = files.find((f) => /\.glb$/i.test(f.name))
  if (glb) return { doc: await io.readBinary(glb.data), bytes }
  const gltf = files.find((f) => /\.gltf$/i.test(f.name))
  if (!gltf) throw new Error('Choose a .glb file, or a .gltf together with its .bin and texture files')
  const json = JSON.parse(new TextDecoder().decode(gltf.data)) as {
    buffers?: { uri?: string }[]
    images?: { uri?: string }[]
  }
  const byName = new Map(files.map((f) => [base(f.name), f.data]))
  const resources: Record<string, Uint8Array<ArrayBuffer>> = {}
  const missing: string[] = []
  for (const r of [...(json.buffers ?? []), ...(json.images ?? [])]) {
    if (!r.uri || r.uri.startsWith('data:')) continue
    const data = byName.get(base(r.uri))
    if (data) resources[r.uri] = data
    else missing.push(r.uri)
  }
  if (missing.length) throw new Error(`Missing file(s) referenced by the .gltf: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`)
  return { doc: await io.readJSON({ json: json as never, resources }), bytes }
}

function triCount(p: Primitive) {
  if (p.getMode() !== 4) return 0 // TRIANGLES only
  const idx = p.getIndices()
  return Math.floor((idx ? idx.getCount() : (p.getAttribute('POSITION')?.getCount() ?? 0)) / 3)
}

function stats(doc: Document, bytes: number): ScanStats {
  const root = doc.getRoot()
  let triangles = 0
  let vertices = 0
  for (const m of root.listMeshes()) {
    for (const p of m.listPrimitives()) {
      triangles += triCount(p)
      vertices += p.getAttribute('POSITION')?.getCount() ?? 0
    }
  }
  let maxTextureSize: [number, number] | null = null
  let textureBytes = 0
  for (const t of root.listTextures()) {
    const img = t.getImage()
    if (!img) continue
    textureBytes += img.byteLength
    const s = ImageUtils.getSize(img, t.getMimeType())
    if (s && (!maxTextureSize || s[0] * s[1] > maxTextureSize[0] * maxTextureSize[1])) maxTextureSize = [s[0], s[1]]
  }
  const scene = root.getDefaultScene() ?? root.listScenes()[0]
  let size: [number, number, number] = [0, 0, 0]
  if (scene) {
    const b = getBounds(scene)
    if (Number.isFinite(b.min[0])) size = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]]
  }
  return {
    triangles,
    vertices,
    meshes: root.listMeshes().length,
    materials: root.listMaterials().length,
    textures: root.listTextures().length,
    maxTextureSize,
    textureBytes,
    bytes,
    size,
  }
}

/** Smooth per-vertex normals for primitives that have none (index-aware, area-weighted). */
function ensureNormals(doc: Document, warnings: string[]) {
  let fixed = 0
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const p of mesh.listPrimitives()) {
      if (p.getMode() !== 4 || p.getAttribute('NORMAL')) continue
      const pos = p.getAttribute('POSITION')
      if (!pos) continue
      const n = pos.getCount()
      const P = new Float32Array(n * 3)
      const v: number[] = [0, 0, 0]
      for (let i = 0; i < n; i++) {
        pos.getElement(i, v)
        P.set(v, i * 3)
      }
      const idx = p.getIndices()
      const count = idx ? idx.getCount() : n
      const N = new Float32Array(n * 3)
      const at = (k: number) => (idx ? idx.getScalar(k) : k)
      for (let k = 0; k + 2 < count; k += 3) {
        const a = at(k) * 3
        const b = at(k + 1) * 3
        const c = at(k + 2) * 3
        const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2]
        const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2]
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
        for (const o of [a, b, c]) {
          N[o] += nx
          N[o + 1] += ny
          N[o + 2] += nz
        }
      }
      for (let i = 0; i < n * 3; i += 3) {
        const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1
        N[i] /= l
        N[i + 1] /= l
        N[i + 2] /= l
      }
      const acc = doc.createAccessor().setType('VEC3').setArray(N)
      const buffer = pos.getBuffer()
      if (buffer) acc.setBuffer(buffer)
      p.setAttribute('NORMAL', acc)
      fixed++
    }
  }
  if (fixed) warnings.push(`Generated smooth normals for ${fixed} primitive(s) that had none.`)
}

async function recodeTextures(doc: Document, maxSide: number, quality: number, warnings: string[]) {
  const textures = doc.getRoot().listTextures()
  let webpOk: boolean | null = null
  for (const t of textures) {
    const img = t.getImage()
    const mime = t.getMimeType()
    if (!img || !/^image\/(png|jpeg|webp)$/.test(mime)) {
      if (img) warnings.push(`Texture "${t.getName() || t.getURI() || '?'}" (${mime}) left as-is.`)
      continue
    }
    const bmp = await createImageBitmap(new Blob([img as BlobPart], { type: mime }))
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
    const w = Math.max(1, Math.round(bmp.width * k))
    const h = Math.max(1, Math.round(bmp.height * k))
    const cv = new OffscreenCanvas(w, h)
    const ctx = cv.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close()
    let blob = await cv.convertToBlob({ type: 'image/webp', quality })
    if (blob.type !== 'image/webp') {
      // browser without a WebP encoder (Safari): JPEG for opaque colour maps, PNG otherwise
      if (webpOk === null) warnings.push('This browser cannot encode WebP — textures were kept as JPEG/PNG (use Chrome or Edge for smaller files).')
      webpOk = false
      blob = await cv.convertToBlob({ type: mime === 'image/png' ? 'image/png' : 'image/jpeg', quality })
    } else webpOk = true
    const out = new Uint8Array(await blob.arrayBuffer())
    // keep the original when re-encoding does not help and no resize happened
    if (k === 1 && out.byteLength >= img.byteLength && blob.type === mime) continue
    const ext = blob.type.split('/')[1].replace('jpeg', 'jpg')
    const uri = t.getURI()
    t.setImage(out).setMimeType(blob.type)
    if (uri) t.setURI(uri.replace(/\.[a-z0-9]+$/i, `.${ext}`))
  }
  if (textures.some((t) => t.getMimeType() === 'image/webp')) doc.createExtension(EXTTextureWebP).setRequired(true)
}

/** Wrap each scene's roots in one node that re-orients, scales to `height` m and grounds the model. */
function placeInMetres(doc: Document, opts: ScanOptions, warnings: string[]) {
  const root = doc.getRoot()
  for (const scene of root.listScenes()) {
    const wrap = doc.createNode('ScanRoot')
    for (const child of scene.listChildren()) {
      scene.removeChild(child)
      wrap.addChild(child)
    }
    scene.addChild(wrap)
    if (opts.upAxis === 'z') wrap.setRotation([-Math.SQRT1_2, 0, 0, Math.SQRT1_2])
    const b = getBounds(scene)
    if (!Number.isFinite(b.min[0])) continue
    const hy = b.max[1] - b.min[1]
    let s = 1
    if (opts.height && opts.height > 0 && hy > 1e-6) s = opts.height / hy
    else if (hy > 20) warnings.push(`The model is ${hy.toFixed(1)} units tall — enter its real height so it is scaled to metres.`)
    const cx = (b.min[0] + b.max[0]) / 2
    const cz = (b.min[2] + b.max[2]) / 2
    wrap.setScale([s, s, s]).setTranslation([-cx * s, -b.min[1] * s, -cz * s])
  }
}

export async function optimizeScan(files: ScanFile[], opts: ScanOptions, log: (msg: string) => void = () => undefined): Promise<ScanResult> {
  const warnings: string[] = []
  const io = await createIO()
  log('Reading model…')
  const { doc, bytes } = await readInput(io, files)
  const before = stats(doc, bytes)
  if (before.triangles === 0) throw new Error('No triangle meshes found in this file')

  log('Removing duplicates…')
  await doc.transform(dedup(), prune())
  log('Welding vertices…')
  await doc.transform(weld())

  const tris = stats(doc, 0).triangles
  if (tris > opts.targetTriangles) {
    log(`Simplifying ${tris.toLocaleString()} → ~${opts.targetTriangles.toLocaleString()} triangles…`)
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: Math.max(0.001, opts.targetTriangles / tris), error: 0.01 }))
    const after1 = stats(doc, 0).triangles
    if (after1 > opts.targetTriangles * 1.25) {
      // UV seams / thin parts resist simplification: allow a larger (still small) error
      await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: Math.max(0.001, opts.targetTriangles / after1), error: 0.04 }))
      const after2 = stats(doc, 0).triangles
      if (after2 > opts.targetTriangles * 1.25) warnings.push(`Could only simplify to ${after2.toLocaleString()} triangles without visible damage (UV seams).`)
    }
  }
  ensureNormals(doc, warnings)

  log('Resizing and re-encoding textures…')
  await recodeTextures(doc, opts.maxTexture, opts.textureQuality, warnings)

  log('Scaling to metres…')
  placeInMetres(doc, opts, warnings)
  await doc.transform(prune())

  log('Compressing geometry (meshopt)…')
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
  const glb = await io.writeBinary(doc)

  // re-read the output for honest "after" numbers (decoded geometry, real bounds)
  const check = await io.readBinary(glb)
  const after = stats(check, glb.byteLength)
  return { glb, before, after, warnings }
}
