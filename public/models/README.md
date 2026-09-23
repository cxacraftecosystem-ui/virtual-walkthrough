# 3D models

All models are metres, **+Y up**, glTF 2.0 (`.glb`, or `.gltf` + `.bin` + textures).

## 1. Hand-block exhibits

Put the workshop's scanned/modelled blocks here and reference them from
`src/museum/config/exhibits.ts` via `model: "/models/<file>.glb"` (optional `modelScale`).
Until a model exists, a clearly labelled procedural placeholder block is shown.

## 2. Scene objects (installations, furniture, props)

Every entry in `src/museum/config/objects.ts` (`SCENE_OBJECTS`) has a procedural
`kind` and an optional `model`:

```ts
{ id: 'workshop-stool-1', kind: 'stool',
  model: '/models/cc0/wooden_stool_01/wooden_stool_01_1k.gltf',
  modelScale: 1,            // omit → scaled so its height = `height`
  position: [22.6, 0, 14.8], rotationDeg: 15,
  footprint: [0.45, 0.45],  // collision + procedural sizing (m, before rotation)
  height: 0.44, zone: 'workshop',
  credit: { author: 'Kuutti Siitonen', source: 'https://polyhaven.com/a/wooden_stool_01', license: 'CC0' } }
```

To add a GLB: drop it under `public/models/` (e.g. `public/models/production/printing-table.glb`)
and set `model` on the entry. The loader (`src/museum/models/GLTFModel.tsx`):

- bakes node transforms and merges primitives that share a material (one draw call per
  material), shared by every placement of the same file;
- centres it on the footprint with its bottom at y = 0 (the object's `position`); a GLB's
  own "front" should face **+Z** — use `rotationDeg` otherwise;
- scales by `modelScale`, else to `height`, else 1;
- turns on cast/receive shadows. Keep textures ≤ 1k–2k and use `alphaMode: MASK` for foliage.

### Procedural fallbacks

`src/museum/models/` contains a procedural model for every `kind`
(`PROCEDURAL_MODELS` in `models/index.ts`): printing table, dye vat, drying line, block shelf,
pigment station, wash tank, cloth rolls, carving bench, textile banner, plant bed, tree,
water channel, information desk, planter, theatre seating, garden bench, column, and small
`vessel` / `stool` / `crate` fallbacks for props. The procedural model is shown **while a GLB
loads and whenever it is missing or fails** (ErrorBoundary + Suspense), so the museum never
shows a hole. Procedural models are built to the entry's `footprint` / `height` / `props`.

## 3. CC0 library (`cc0/`)

`cc0/<id>/` holds CC0 models from [Poly Haven](https://polyhaven.com) at 1k textures, downloaded by

```sh
node scripts/download-cc0-models.mjs            # fetch any missing (md5-verified)
node scripts/download-cc0-models.mjs --force    # re-download all
node scripts/download-cc0-models.mjs jug_01     # fetch specific ids (add them to CURATED first)
```

Attribution (id, name, authors, licence, source URL, real-world dimensions) is recorded in
**`cc0/CREDITS.json`** and mirrored in each scene object's `credit` field (shown in the 3D
viewer). CC0 requires no attribution; it is kept as good practice. To add another model,
append its Poly Haven id to `CURATED` in the script, run it, then add a `SCENE_OBJECTS` entry
pointing at `/models/cc0/<id>/<id>_1k.gltf`.

## 4. Optimised copies (`opt/`) — what the museum actually loads

`npm run optimize:assets` (= `node scripts/optimize-assets.mjs && node scripts/verify-optimized-models.mjs`)
writes a single-file GLB for every model under `public/models/` to `opt/` (e.g.
`cc0/brass_pot_01/brass_pot_01_1k.gltf` → `opt/cc0/brass_pot_01.glb`). Each file goes through
dedup → prune → weld → textures ≤ 1024 px re-encoded to WebP (`EXT_texture_webp`, in headless Chrome since
sharp isn't installed) → meshopt (`KHR_mesh_quantization` + `EXT_meshopt_compression`).
The verifier renders each original/optimised pair, plus the optimised file through the app's
bake/merge path, and fails if more than 1 % of the pixels differ. Sizes are recorded in `opt/manifest.json`.

`SCENE_OBJECTS` points at `opt/cc0/<id>.glb`. `GLTFModel` also maps legacy `cc0/<id>/<id>_1k.gltf` paths
(content already stored in the database) to the optimised GLB. drei's `useGLTF` decodes meshopt, and
`GLTFModel` converts quantised attributes to float before baking transforms. After adding or changing a
model, re-run `npm run optimize:assets`. It skips outputs that are up to date; use `--force` to rebuild all.
The same script writes `public/artworks/<name>.1024.webp` / `.2048.webp`. Low/Medium tiers use the 1024
variant, High/Ultra the 2048 one, and the original file is the fallback (`exhibits/artworkTexture.ts`).
