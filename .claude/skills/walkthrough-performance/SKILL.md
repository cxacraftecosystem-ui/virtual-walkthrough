---
name: walkthrough-performance
description: Measure and fix the performance, start-up, stutter, flicker and lighting of three.js / React Three Fiber virtual walkthroughs (3D museums, galleries, pavilions, showrooms; Next.js apps on WebGL). Use it whenever a walkthrough is stuck on a white or loading screen, takes long to start, freezes when entering a room or changing settings, stutters, drops frames, flickers (sky, objects, lights), or looks too dark — and whenever someone asks to optimise, profile or speed up a 3D walkthrough or museum, even if they never say "performance". Bundles headless-Chrome diagnostics (start-up timeline, per-room frame times, draw calls by object, CPU profiles, shader programs and light counts, flicker heat maps, download weight) and a catalogue of fixes measured on two production museums.
---

# Walkthrough performance

The method that took a museum from minutes on a white screen to entering in seconds, and cut another's draw calls
by five to eight times: **measure, find the one cause, fix it, measure again — then write the numbers down.** The
causes were almost never the obvious ones (a 25 ms-a-frame `drawImage`, `ExtrudeGeometry` groups, a light inside a
culled group, a render target's colour space), so guessing wastes days and a profile takes minutes.

Every fix must leave the picture as it was, or say plainly what it trades and on which tier only. "Faster" that
looks worse is a regression; check with before/after screenshots at the same pose (`frames.mjs`).

## Setup

- The scripts are in `scripts/` beside this file. Run them **from the walkthrough's project root** (they take
  `puppeteer-core` and `sharp` from its `node_modules`), or set `PERF_PROJECT`. `CHROME_PATH` overrides Chrome,
  `PERF_PATH` the 3D route (default `/gallery`).
- They drive the app through a small test-hook contract: `window.__museum = { gl, store, teleport }` and the URL
  switches `autostart`, `noarrival`, `quality=<tier>`, `shots`. A new walkthrough needs these first —
  see `references/harness.md` (about 20 lines of app code).
- Measure a **production build** (`next build && next start -p 3100`), never `next dev`. Compare with the
  deployed site for "before". Never point a local run at a production database.
- Headless caveats: frame intervals snap to vsync (17 / 33 / 50 ms), so read *render CPU* and profiles for
  main-thread cost; GPU-bound cost is under-represented. A killed run can leave headless Chrome behind (it skews
  GPU timings — kill processes whose command line holds `puppeteer_dev_chrome_profile`), and stopping
  `npx next start` can leave the `next-server` child holding the port.

## Workflow

1. **Start-up** — `diag.mjs <base> 200` logs phase, programs, draw calls and any loading overlay every 2 s and
   clicks Enter when it appears. If start-up is slow, it is nearly always shader programs: `progs.mjs` (how many,
   by material), `lightcombos.mjs` (light-count variants baked into programs), `view.mjs` (what the first view
   really needs).
2. **Walk** — `walk.mjs <base> '?quality=medium' stops.json` teleports through the rooms (`stops-example.json`
   shows the format: `[name, [x, z, yaw°, pitch°]]`, compass yaw: 0 faces −z, 90 faces +x). Per stop: programs built on arrival (any
   rise is a compile stall), median / p95 / worst frame, render CPU, draw calls, triangles.
3. **A slow room** — `calls.mjs` (draw calls by object, material and geometry, and by pass: canvas, shadow,
   render targets), `prof.mjs` (main-thread self time by function; look for native calls such as `drawImage`,
   `getImageData`, `readPixels`, `getBufferSubData`, `texImage2D`), `stalls.mjs <base> <q> '[x,z,yaw,pitch]'`
   (long frames after arriving, and every program built then, with its cache key), `nodes.mjs` (scene-graph size,
   cost of `updateMatrixWorld`).
4. **Flicker** — `flicker.mjs` (still camera: heat map of pixels that change), `skytest.mjs` (sky only, then
   with its time frozen, then clouds off — tells animation from aliasing), `skypixel.mjs` (one pixel over time:
   a sawtooth is an animation, alternation is aliasing), `frames.mjs` (a strip of crops to look at). The scripts
   hide the DOM overlay — HUD pulse animations otherwise read as flicker.
5. **Weight** — `weight.mjs` counts bytes actually received. `Content-Length` totals overstate videos (range
   requests).
6. **Fix one cause**, rebuild, rerun the same stops locally and against the deployed site, and compare.
7. **Ship** — typecheck, lint, tests; screenshots before/after; commit with before → after numbers; add a row to
   the project guide's performance section.

## Causes and fixes (measured)

Details, code and traps for each are in `references/fixes.md`; the reference implementations are in the two
museums' repositories (`virtual-walkthrough`, hand-block printing; `virtual-walkthrough-clay`, clay pavilion).

| Symptom | Measure | Cause | Fix |
|---|---|---|---|
| White screen for minutes; "Applying graphics settings" | `diag`, `progs` | every shader program costs a compile plus a first-draw finalize on ANGLE / Direct3D; hundreds of programs | precompile only the first view's zones, one warm draw per distinct *program* (not material), the rest zone by zone between frames; hold late arrivals off-frame until `compileAsync` resolves |
| Freeze on entering a room | `walk` programs column, `stalls` NEW lines | a light inside a culled zone group changes the light count → every lit material recompiles | lights never culled (`Unculled` portal to the scene root); dim, never hide |
| Long freeze when a room comes into view the first time | `stalls` cache key shows a render target | a program's colour space / tone mapping follows the bound target; compiled for the canvas, a render-target draw builds it again synchronously (13 s) | compile render-target scenes with their own target bound |
| Freeze a few seconds after entering | tier in `diag` | adaptive quality changed tier: remounts the canvas, recompiles everything | never change tier mid-visit; scale resolution, remember the tier for the next visit |
| Stutter in one room, main thread busy | `prof`: native `drawImage` / `getBufferSubData` | reading a playing video's pixels on the main thread waits for the GPU (30–60 ms) | `createImageBitmap` (16 × 9 resize, 0.4 ms) + a worker reads it |
| Thousands of draw calls | `calls` | `ExtrudeGeometry` makes a cap and a side group *per shape*, and each group is a call when the material is an array | gather groups per material through an index (`oneGroupPerMaterial`); merge static meshes per material |
| Pieces pulse or pop while turning | `flicker` (still is clean) + motion | pooled lights swap slots as ranking flips (a step at "behind", no hold) | smooth penalties, a hold bonus for lit slots, cross-fades |
| Sky sparkles, crawls near the horizon | `skytest` | procedural cloud octaves and stars finer than a pixel alias | fade octaves by screen-space derivative; stars never below a pixel, energy kept |
| Exhibits too dark | screenshots | pooled lights can't cover every piece | a key light per piece computed in its own material (clone + uniforms): no light count changes |
| Big frame every sun move | `prof` | shadow maps redrawn on every small change | throttle refreshes, trailing refresh |
| Streamed models hitch | `diag`, `walk` | many models decoding and compiling at once | queue: nearest first, two at a time, compile before reveal |

Reference numbers: hand-block museum draw calls 2,526 → 493 (Gallery A), theatre main-thread 37 → 17 ms a frame,
flickering sky pixels 1.08 % → 0.09 %; clay pavilion start 220–300 s → 43 s (headless Chrome, the same Windows
machine), programs 356 → about 150, worst frame on a full walk ≤ 0.25 s.

## Traps worth knowing before touching code

- `renderer.compile` / `compileAsync` traverse **visible** objects only and take lights from what is visible;
  culling at compile time changes the programs you get.
- Uniforms of a built-in material upload only when the material changes between draws — per-object values
  (a key light's position) need a material clone per object, not one shared material.
- Toggling `visible` on a light, or adding one, recompiles every lit material. Changing intensity is free.
- Many draw calls of *one* material are cheap on the main thread (it skips state changes) but still cost the GPU
  process and the shadow pass. Judge by `prof` and frame time, not call count alone.
- `readRenderTargetPixelsAsync` is not free in Chrome: `getBufferSubData` still waits for the GPU process. Only a
  worker keeps the wait off the main thread.
- A planar mirror is a whole extra scene render *and* a second program variant for everything it reflects.
- The profiler inflates many small JS calls (`updateMatrixWorld` read 3.8 ms profiled, 1.45 ms timed directly).
  Time suspects directly before optimising them.

## When done

Report each change with its before → after numbers, say what (if anything) it trades and on which tier, and add a
row to the project's performance documentation. Keep the diagnostics' outputs out of the repository.
