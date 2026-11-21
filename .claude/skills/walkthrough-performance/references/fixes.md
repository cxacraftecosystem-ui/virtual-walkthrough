# Fix catalogue

Each fix: the symptom, how it was measured, the cause, the fix with the essential code, and the traps. Paths name
the reference implementations: **HB** = `virtual-walkthrough` (hand-block printing museum), **Clay** =
`virtual-walkthrough-clay` (clay pavilion). Both are Next.js 16, React 19, R3F, three r186.

Contents

1. [Shader programs at start-up](#1-shader-programs-at-start-up)
2. [Light counts](#2-light-counts)
3. [Render targets and their own programs](#3-render-targets-and-their-own-programs)
4. [Planar mirrors](#4-planar-mirrors)
5. [Adaptive quality without mid-visit tier changes](#5-adaptive-quality-without-mid-visit-tier-changes)
6. [Main-thread readbacks](#6-main-thread-readbacks)
7. [Draw calls from extrusions and arrays](#7-draw-calls-from-extrusions-and-arrays)
8. [Pooled lights that swap](#8-pooled-lights-that-swap)
9. [A sky that sparkles](#9-a-sky-that-sparkles)
10. [Dark exhibits: a key light per piece](#10-dark-exhibits-a-key-light-per-piece)
11. [Streamed models and shadow refreshes](#11-streamed-models-and-shadow-refreshes)

---

## 1. Shader programs at start-up

**Symptom.** White or loading screen for minutes, "Applying graphics settings…", the page unresponsive; worst on
laptop GPUs under Chrome on Windows.

**Measure.** `diag.mjs` (programs climbing, phase stuck), `progs.mjs` (count by material type), `view.mjs` (what
the first view actually draws).

**Cause.** On ANGLE / Direct3D 11 every program costs a compile *and* a finalize on its first real draw (about a
second each on a laptop GPU). Three builds a program per material *configuration*: light counts, defines,
textures present, skinning, instancing, and the bound render target's colour space and tone mapping. Compiling
and first-drawing the whole museum behind the loading screen was 356 programs.

**Fix** (Clay `src/museum/effects/Precompile.tsx`):

- Compile only what the first view needs: `withZonesVisible(here, () => gl.compileAsync(scene, camera))` — with a
  stand-in half-float target bound when post-processing is on, so the programs are the ones the frames will use.
- First-draw one representative per distinct *program set*, not per material: key a drawable by
  `gl.properties.get(material).currentProgram.id`, its shadow-depth variant (alpha test, alpha / displacement map,
  side), object type, shadow flags and vertex layout (ANGLE builds a variant per input layout).
  Keying by material drew hundreds of materials that share a few programs — minutes.
- Draw them in slices (three per task behind the loading screen, one per task with 200 ms pauses during the visit)
  so the page stays live; then one full `warmDraw` for anything missed and the shadow maps.
- After the door opens: the remaining zones one at a time, the visitor's nearest first, `compileAsync` (parallel,
  `KHR_parallel_shader_compile`) then sliced warm draws between frames.
- **LateCompile**: patch `Object3D.prototype.add` (guard with a `Symbol.for` flag) to record roots added after
  start-up; each frame, put their uncompiled meshes on a hold layer (31) and release them when
  `gl.compileAsync(root, camera, scene)` resolves. Late-mounted models then never compile on the main thread.
- A progress store (`done / total`) drives the loading bar; a safety timeout lets the visitor in regardless.

**Traps.** `compileAsync` traverses visible objects only. Hiding zones while compiling changes which *lights* are
counted (see §2). A program compiled for the canvas is not reused for a render target (see §3).

## 2. Light counts

**Symptom.** A freeze of seconds — once a minute — when a room comes into view, or a warm-up that never ends.

**Measure.** `walk.mjs`: programs rise at a stop; `stalls.mjs`: the NEW programs' cache keys differ only in
`NUM_*_LIGHTS`; `lightcombos.mjs` lists the light configurations baked in.

**Cause.** Three counts the lights it reaches when it draws and builds every lit program for those counts. A
light inside a culled zone group (a screen's spill, a theatre wash) changes the count when its zone shows —
every material in view recompiles.

**Fix.** Lights are never culled with a zone; their owner dims them (Clay `navigation/zoneCulling.tsx`):

```tsx
export function Unculled({ children }: { children: ReactNode }) {
  const scene = useThree((s) => s.scene)
  const anchor = useRef<THREE.Group>(null)
  const holder = useMemo(() => {
    const g = new THREE.Group()
    g.name = 'unculled'
    g.matrixAutoUpdate = false
    return g
  }, [])
  useLayoutEffect(() => {
    scene.add(holder)
    return () => {
      holder.removeFromParent()
    }
  }, [scene, holder])
  useFrame(() => {
    const a = anchor.current
    if (!a) return
    a.updateWorldMatrix(true, false)
    if (!holder.matrix.equals(a.matrixWorld)) {
      holder.matrix.copy(a.matrixWorld)
      holder.matrixWorldNeedsUpdate = true
    }
  })
  return (
    <>
      <group ref={anchor} />
      {createPortal(children, holder)}
    </>
  )
}
// <Unculled><rectAreaLight ... intensity={0} /></Unculled>
```

Also gate costly light *types* by tier rather than toggling them (Clay Medium: no area lights). Time of day,
weather and pools change intensities and uniforms only. Never toggle `light.visible`.

## 3. Render targets and their own programs

**Symptom.** A single 8–13 s freeze the first time a room with a projected film or a mirror is seen.

**Measure.** `stalls.mjs` — the NEW program's cache key shows `srgb-linear` output / no tone mapping.

**Cause.** A program's output colour space and tone mapping follow the target bound when it is built. Compiled
while the canvas was bound, the first draw into a render target builds it again — synchronously.

**Fix** (Clay `media/projection/projectionTarget.ts`): compile with the target bound, then draw once:

```ts
async compile(gl: THREE.WebGLRenderer) {
  const prev = gl.getRenderTarget()
  gl.setRenderTarget(this.target)
  let p: Promise<unknown>
  try {
    p = gl.compileAsync(this.scene, this.camera)
  } finally {
    gl.setRenderTarget(prev)
  }
  await p
  this.tick(gl, 0, 1, true) // one draw finishes it
}
```

When rendering an offscreen scene mid-frame: save and restore the target, and set `gl.xr.enabled = false` around
it (otherwise three swaps in the XR camera).

## 4. Planar mirrors

A reflector renders the scene again every frame *and* needs an `srgb-linear` variant of every program it
reflects (§3). On mid tiers use an analytic water / gloss shader instead (Clay Medium: `waterMirrorPx: 0`); keep
the mirror for High and up. This is a visible trade, so it is limited to a tier and documented.

## 5. Adaptive quality without mid-visit tier changes

**Symptom.** A freeze a few seconds after entering, or "Applying graphics settings…" mid-visit.

**Cause.** Changing tier remounts the canvas and recompiles every program. HB stepped a capable device *up* five
seconds after entry; Clay stepped down and up.

**Fix** (Clay and HB `src/App.tsx`, `config/quality.ts`):

- `PerformanceMonitor` drives resolution only (`setDpr`, down to a floor such as 0.75).
- A device with headroom is not stepped up; `rememberAutoTier(next)` (localStorage) makes the *next* visit start
  higher, never above the device class's ceiling.
- A device that cannot hold about 32 fps: Clay switches its costly extras off at once (shafts, motes, halos,
  mirror — geometry unchanged) and remembers a lower tier for the next visit; HB steps down once and remembers it.
- `detectInitialTier()` = remembered tier (within the ceiling) else device signals.

## 6. Main-thread readbacks

**Symptom.** Stutter in one room (a film playing), main thread busy.

**Measure.** `prof.mjs` at that pose: native `drawImage` 25 ms a frame (HB theatre); after a GPU-side attempt,
native `getBufferSubData` 5.5 ms a frame. `readback.mjs` times the options on the live page:

| Method (1080p video) | Main thread per sample |
|---|---|
| 2D canvas `drawImage` + `getImageData` (`willReadFrequently`) | 52 ms (max 199) |
| `VideoFrame` + `copyTo` | 64 ms |
| three `readRenderTargetPixelsAsync` (PBO + fence) | ~31 ms |
| `createImageBitmap(video, { resizeWidth: 16, resizeHeight: 9 })` | 0.4 ms |

**Cause.** Any read of GPU-held pixels on the main thread waits for the GPU process to finish the frame in flight.

**Fix** (HB / Clay `media/VideoScreen.tsx`, `media/screenColour.worker.ts`): scale on the main thread without
waiting, read in a worker.

```ts
// main thread
const w = new Worker(new URL('./screenColour.worker.ts', import.meta.url), { type: 'module' })
createImageBitmap(video, { resizeWidth: 16, resizeHeight: 9, resizeQuality: 'low' })
  .then((bmp) => w.postMessage({ id, bmp }, [bmp]))          // transfer, no copy
// worker
self.onmessage = (e) => {
  const { id, bmp } = e.data
  ctx.drawImage(bmp, 0, 0)                                    // the wait happens here, off the frame loop
  const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data
  // average → postMessage({ id, r, g, b }); finally bmp.close()
}
```

Fall back to a fixed neutral colour when `Worker`, `createImageBitmap` or `OffscreenCanvas` is missing — never to
the main-thread read. Values are sRGB: `color.setRGB(r, g, b, THREE.SRGBColorSpace)`.

## 7. Draw calls from extrusions and arrays

**Symptom.** 1,500–2,700 draw calls a frame in rooms with carved or extruded pieces.

**Measure.** `calls.mjs` — one object (`hand-block-placeholder`, `india-map-wall`) accounting for most calls.

**Cause.** `ExtrudeGeometry` adds a cap group and a side group *per shape*; with an array of materials three
issues a call per group. A motif of fifty shapes is a hundred calls; a map relief some six hundred.

**Fix** (HB / Clay `utils/geometryGroups.ts`) — same vertices, one group per material:

```ts
export function oneGroupPerMaterial(g: THREE.BufferGeometry) {
  if (g.index || g.groups.length <= 2) return g
  const byMaterial = new Map<number, number[]>()
  for (const group of g.groups) {
    const mi = group.materialIndex ?? 0
    const ids = byMaterial.get(mi) ?? []
    for (let i = group.start; i < group.start + group.count; i++) ids.push(i)
    byMaterial.set(mi, ids)
  }
  if (byMaterial.size === g.groups.length) return g
  const index: number[] = []
  g.clearGroups()
  for (const [mi, ids] of [...byMaterial].sort((x, y) => x[0] - y[0])) {
    g.addGroup(index.length, ids.length, mi)
    for (const i of ids) index.push(i)
  }
  g.setIndex(index)
  return g
}
```

Static meshes sharing a material merge with `mergeGeometries` (Clay's `batch:<material>` meshes); repeats become
`InstancedMesh`. Result in HB: Gallery A 2,526 → 493 calls, theatre 2,677 → 445, Gallery D 1,939 → 253;
pixel-identical.

**Trap.** Groups of *one* material are cheap on the main thread (no state change between them), so render CPU
barely moved; the win is in the GPU process and the shadow pass. Judge with frame time and `prof`, not call count
alone.

## 8. Pooled lights that swap

**Symptom.** Pieces at the edge of the view pulse or pop as the visitor turns; a still camera is clean.

**Cause.** A fixed pool of real lights (or analytic accent slots) is re-ranked a few times a second; a hard step
at "behind the visitor" and no memory make the ranking flip, and slots swap back and forth.

**Fix** (Clay `lighting/SpotPool.tsx`, `lighting/atmosphere/AccentField.tsx`):

```ts
const behind = d > BEHIND_NEAR ? BEHIND_M * smoothstep(BEHIND_COS + 0.25, BEHIND_COS - 0.25, dot(toPiece, facing) / d) : 0
const hold = heldNow.has(p) ? HOLD_M : 0          // 3–4 m: a lit slot stays unless clearly beaten
score = (d + (p.zone === here ? 0 : 6) + behind - hold) / Math.sqrt(p.weight)
```

Every reassignment fades out to zero before the slot takes its new piece, and fades in (`FADE_PER_S`). The pool
size stays fixed so light counts never change (§2).

## 9. A sky that sparkles

**Symptom.** The sky shimmers near the horizon and crawls as the view turns; stars twinkle when the camera moves.

**Measure.** `skytest.mjs` (sky only; "time frozen" isolates animation, "clouds off" the clouds) and
`skypixel.mjs`. Hide the HUD first: a CSS pulse once read as sky flicker.

**Cause.** three's `Sky` clouds are fbm noise projected onto a plane (`dir.xz / dir.y`): near the horizon a pixel
spans several cycles of the finer octaves. Procedural stars smaller than a pixel alias likewise.

**Fix** (HB / Clay `lighting/nightSky.ts` `patchSkyAntialias`, applied after the material is created):

```glsl
float museumFbmAA( vec2 p, float drift, float fw ) {
  float result = 0.0; float amplitude = 1.0;
  for ( int i = 0; i < 4; i ++ ) {
    result += amplitude * noise( p ) * clamp( 2.0 - fw * 2.0, 0.0, 1.0 ); // fade octaves finer than ~2 px a cycle
    amplitude *= 0.5; p = p * 2.0 + drift; fw *= 2.0;
  }
  return result;
}
// at the call site
vec2 cloudP = cloudUV * 1000.0;
float cloudFw = max( length( dFdx( cloudP ) ), length( dFdy( cloudP ) ) );
float cloudNoise = clamp( museumFbmAA( cloudP, evolve, cloudFw ) * 0.7 + 0.5, 0.0, 1.0 );
// stars: never smaller than about a pixel, energy kept
float px = length( fwidth( p ) ); float s2 = max( 1.0 / 28.0, px * px * 0.36 );
// exp( -d*d*14.0 )  →  exp( -d*d / ( 2.0*s2 ) ) * ( 1.0/28.0 ) / s2
```

Patch by string replacement against anchors, and leave the shader untouched (with a console warning) if an anchor
is missing — a three upgrade must not break the sky. HB: 1.08 % → 0.09 % flickering sky pixels at midday,
0.08 % → 0.03 % at night; Clay 0.13 % → 0.03 %. The clouds look the same in screenshots.

## 10. Dark exhibits: a key light per piece

**Symptom.** Exhibits read dark; raising pooled light intensity floods rooms; adding real lights per piece blows
up light counts and programs.

**Fix** (Clay `models/GLTFModel.tsx` `keyLight`, `lighting/atmosphere/inject.ts` `USE_ATMOS_KEY`,
`architecture/Pavilion.tsx` podium keys): a cone computed inside the piece's own material, so it lights only that
piece and no light count changes.

- Clone each part's material per placed piece (built-in materials upload uniforms only when the material changes
  between draws, so a shared material cannot carry per-piece values), add a define and three `vec4` uniforms in
  `onBeforeCompile`, and add the define to `customProgramCacheKey`.
- Aim from the piece's bounding box: in front (its local +z, flattened) and above, `pos = centre + front·(R + 0.6
  + 0.5H)`, `pos.y += 0.7H + 1`; half-angle `min(atan(max(H, 2R)·0.62 / d)·1.2, 0.75)`; intensity `E·d²` so the
  illuminance on the piece is `E` whatever the distance. Re-aim only when the matrix changes.
- In the shader, add a smooth cone with a range window to the diffuse irradiance (and the specular if the material
  has it) before `reflectedLight.directDiffuse` is formed.
- Dispose the clones on unmount.

## 11. Streamed models and shadow refreshes

- **Streaming** (Clay `models/sourcedModel.tsx`): a load queue — nearest first, two at a time, a ticket that
  gives up after 15 s — and each model is compiled (`compileAsync`) before it is shown; full detail only within a radius
  (5 m on Medium), the simplified LOD beyond.
- **Shadow maps** (`lighting/SkyAndSun.tsx`): `shadowMap.autoUpdate = false`, refresh on demand; throttle late
  refreshes (at most every 4 s, plus one trailing refresh) so streaming and sun moves do not redraw the shadow
  maps every frame.
- **Matrices**: a full `updateMatrixWorld` of a 3,200-node scene measured 1.45 ms; freezing static subtrees saves
  about a millisecond but breaks models that mount later under them. Not worth it below ~10k nodes.
