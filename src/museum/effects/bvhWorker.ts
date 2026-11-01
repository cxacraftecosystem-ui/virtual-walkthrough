/**
 * The BVH worker handed to the path tracer: three-mesh-bvh's GenerateMeshBVHWorker logic running
 * our own worker script (bvh.worker.ts), which loads under Turbopack where the library's does not.
 */
import { GenerateMeshBVHWorker } from 'three-mesh-bvh/src/workers/GenerateMeshBVHWorker.js'
import { WorkerBase } from 'three-mesh-bvh/src/workers/utils/WorkerBase.js'

export function createBVHWorker(): WorkerBase {
  const base = new WorkerBase(new Worker(new URL('./bvh.worker.ts', import.meta.url), { type: 'module' }))
  base.name = 'GenerateMeshBVHWorker'
  // Same message protocol as the library's worker, so its main-thread half is reused as is.
  base.runTask = (GenerateMeshBVHWorker.prototype as unknown as WorkerBase).runTask
  return base
}
