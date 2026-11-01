// Direct imports of the single-worker BVH builder's parts (see PathTracer.tsx for why not 'three-mesh-bvh/worker').
declare module 'three-mesh-bvh/src/workers/GenerateMeshBVHWorker.js' {
  export { GenerateMeshBVHWorker } from 'three-mesh-bvh/worker'
}

declare module 'three-mesh-bvh/src/workers/utils/WorkerBase.js' {
  export class WorkerBase {
    constructor(worker: Worker)
    name: string
    running: boolean
    worker: Worker | null
    runTask(worker: Worker, ...args: unknown[]): Promise<unknown>
    generate(...args: unknown[]): Promise<unknown>
    dispose(): void
  }
}
