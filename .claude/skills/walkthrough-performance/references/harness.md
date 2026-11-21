# The test-hook contract

The diagnostics drive the app through one global and four URL switches. Add them to a new walkthrough before
measuring; they cost nothing in production.

## `window.__museum`

```ts
// src/App.tsx (module scope)
declare global {
  interface Window {
    __museum?: { teleport: typeof teleport; visitor: typeof visitor; store: typeof useMuseum; gl?: THREE.WebGLRenderer }
  }
}
window.__museum = { teleport, visitor, store: useMuseum }

// inside <Canvas onCreated={({ gl }) => { ... }}>
if (window.__museum) window.__museum.gl = gl
```

What the scripts read and call:

| Member | Used for |
|---|---|
| `gl` | `gl.info.programs` (programs built), `gl.info.render` (calls, triangles, frame), `gl.render` / `gl.renderBufferDirect` (wrapped to count and time draws) |
| `store.getState().phase` | `'entered'` once the visitor is in (scripts wait for it) |
| `store.getState().sceneCompiled` | `true` once the first view's shaders are ready |
| `store.getState().tier` | the quality tier in use |
| `store.getState().setTimeOfDay?.(id)` | optional; sky tests set `midday` / `night` |
| `teleport(x, z, yawDeg, pitchDeg)` | moves the visitor; compass yaw: 0 faces −z (north), 90 faces +x (east) |

## URL switches

| Switch | Effect |
|---|---|
| `autostart` | skip the entry screen and enter as soon as the first view is ready |
| `noarrival` | skip the arrival fly-through |
| `quality=low\|medium\|high\|ultra` | fix the tier (no adaptive changes) so runs compare |
| `shots` | screenshot mode: hide transient UI and hints (optional) |

`diag.mjs` deliberately does not use `autostart`: it waits for an Enter / Skip / Begin / Start button as a visitor
would, so it also times the entry screen.

## Zones (optional, but most fixes assume them)

Rooms as zones (`zoneAt(x, z)`), a visibility table (`ZONE_VISIBILITY[zone]` → zones seen from it), groups shown
or hidden per zone, and `withZonesVisible(zone, fn)` to compile or capture a zone offscreen. Zone-scoped
precompile, the walk's stops and the lights' `Unculled` portal all build on this.
