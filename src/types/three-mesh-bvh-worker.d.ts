// Direct import of the single-worker BVH builder (see PathTracer.tsx for why not 'three-mesh-bvh/worker').
declare module 'three-mesh-bvh/src/workers/GenerateMeshBVHWorker.js' {
  export { GenerateMeshBVHWorker } from 'three-mesh-bvh/worker'
}
