# Visual regression tests

`scripts/visual-regression.mjs` opens `/gallery?autostart&static&vr=1&quality=medium` in headless Chrome
with **SwiftShader** (CPU WebGL, the same renderer locally and on CI), teleports to a fixed list of
viewpoints (`VIEWS` in the script), hides the DOM overlays and screenshots the canvas at 1280×720, DPR 1.

- `static` uses bundled content, so database edits don't change the pixels.
- `vr=1` (`src/museum/utils/vr.ts`) freezes sky/cloud time, banner/foliage sway, the centrepiece spin and
  video playback (screens show their poster).
- Screenshots are compared with pixelmatch (per-pixel `VR_THRESHOLD`, default 0.1). A view fails when
  more than `VR_MAX_DIFF` % (default 0.5) of its pixels differ, and also when it has no baseline. The
  diff images (baseline | actual | diff) and `report.json` go to `tests/visual/diff/`, which is git-ignored.

```bash
npm run test:visual -- http://localhost:3000                              # compare
npm run test:visual:update -- https://hand-block-museum.vercel.app        # (re)create baselines
npm run test:visual -- https://… --only=reception,theatre                 # a subset
```

## Baselines

Baselines (`tests/visual/baseline/*.png`) are committed and should be captured **from the production
deployment**, once it includes `?vr=1` support. That is a production build, which is what CI tests. Do
not capture them from `next dev`: dev overlays, slower asset streaming and HMR reloads make the output
differ. Refresh them in the same commit as any intentional visual change, and look at every changed
PNG before committing it.

Local runs and CI both use SwiftShader, so the pixels agree up to small Chrome-version differences,
which the default thresholds absorb. For a quick local A/B check on a GPU, set `VR_GPU=1` and point
`VR_BASELINE_DIR` at a scratch folder. GPU output is not comparable with the committed baselines.

## CI

`.github/workflows/ci.yml` (job **visual regression**, on pull requests) runs `npm run build` and
`npm run start`, then `npm run test:visual -- http://localhost:3000` with the runner's preinstalled
Google Chrome, and uploads `tests/visual/diff/` as the `visual-diff` artifact. The job is skipped with
a warning while there are no baselines.
