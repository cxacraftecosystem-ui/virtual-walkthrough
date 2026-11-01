/**
 * BVH builder for the ray-traced view. It speaks the same messages as three-mesh-bvh's
 * generateMeshBVH.worker.js, so createBVHWorker() can reuse GenerateMeshBVHWorker's runTask.
 *
 * The library's own worker cannot be used: it crashes on load under Turbopack (see
 * bvhWorkerGlobals.ts), and the build then waited 25 s for it before retrying on the main thread.
 */
import './bvhWorkerGlobals'
import { BufferAttribute, BufferGeometry } from 'three'
import { MeshBVH, type MeshBVHOptions } from 'three-mesh-bvh'

type TypedIndex = Uint16Array | Uint32Array
interface Job {
  index: TypedIndex | null
  position: Float32Array
  options: MeshBVHOptions & {
    includedProgressCallback?: boolean
    groups?: { start: number; count: number; materialIndex?: number }[]
  }
}

const post = (message: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(message, transfer)

self.onmessage = ({ data }: MessageEvent<Job>) => {
  const { index, position, options } = data
  let prevTime = -1
  try {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(position, 3, false))
    if (index) geometry.setIndex(new BufferAttribute(index, 1, false))
    if (options.includedProgressCallback) {
      options.onProgress = (p: number) => {
        const progress = Math.min(p, 1)
        const now = performance.now()
        if (now - prevTime >= 10 && progress !== 1) {
          post({ error: null, serialized: null, position: null, progress })
          prevTime = now
        }
      }
    }
    for (const g of options.groups ?? []) geometry.addGroup(g.start, g.count, g.materialIndex)

    const bvh = new MeshBVH(geometry, options)
    const serialized = MeshBVH.serialize(bvh)
    const shared = (b: ArrayBufferLike) => typeof SharedArrayBuffer !== 'undefined' && b instanceof SharedArrayBuffer
    let transfer: ArrayBufferLike[] = [position.buffer, ...serialized.roots]
    if (serialized.index) transfer.push(serialized.index.buffer)
    transfer = transfer.filter((b) => !shared(b))
    const indirect = (serialized as { indirectBuffer?: ArrayBufferView }).indirectBuffer
    if ((bvh as unknown as { _indirectBuffer?: unknown })._indirectBuffer && indirect) transfer.push(indirect.buffer)
    post({ error: null, serialized, position, progress: 1 }, transfer as Transferable[])
  } catch (error) {
    post({ error, serialized: null, position: null, progress: 1 })
  }
}
