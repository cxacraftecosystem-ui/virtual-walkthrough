/**
 * Must be the first import of bvh.worker.ts.
 *
 * Turbopack compiles `typeof window` as always defined in client code, and a Worker reuses the
 * client chunks. three's module-level `window.__THREE__` check therefore throws
 * "window is not defined" inside a worker. Pointing `window` at the worker's global scope before
 * three is evaluated lets that check run, and it touches nothing else.
 */
const scope = globalThis as { window?: unknown }
if (scope.window === undefined) scope.window = globalThis

export {}
