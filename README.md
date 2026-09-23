# Hand Block Printing — Virtual Museum

A web-based, real-time 3D museum built with **Next.js 16**, React 19, TypeScript, Three.js (r186),
React Three Fiber and drei, with a Postgres/S3-ready backend and admin (Next.js Route Handlers).

The core is the **Main Gallery Space (drawing GA-101)** from *"3D Virtual Walkthrough — Design Concept
Note, Rev 03"* — reception → narrow central passage → **reveal wall** → Galleries A / B / C → craft product
wall, under a central glass skylight. v2 widens the gallery to 36' (client request) and wraps it in new
wings: **Grand Atrium** (arrival), **Immersive Theatre** (curved screen, 5.1/7.1 surround),
**Craft Workshop Hall** and the open-air **Dye Garden Courtyard**.

---

## How to run

```bash
npm install
npm run dev          # http://localhost:3000   (museum at /, admin at /admin)
```

Locally there is nothing to configure: SQLite (`.data/museum.sqlite`) and disk media (`.data/media`) are used
automatically. Dev admin login: `admin@museum.local` / `admin12345` (set `ADMIN_EMAIL`/`ADMIN_PASSWORD` to change).

Useful URL parameters:

| Parameter | Effect |
|---|---|
| `?quality=low\|medium\|high\|ultra\|auto` | force a graphics tier (also selectable in the UI) |
| `?autostart` | skip the "Enter Exhibition" button once loading completes (`&tour` starts the guided tour) |
| `?static` | ignore the backend (bundled content, social features hidden) |
| `?debug` | **dev only** — FPS/GPU stats, collision boxes, coordinates |
| `?quality=high&fx=0&shadows=0&area=0&ao=0&dpr=1` | **dev only** — profiling overrides |
| `?renderer=webgpu` | **experimental** — three's WebGPURenderer when `navigator.gpu` exists (falls back to WebGL); see *Graphics features* |
| `?probes` | **experimental** — per-zone irradiance probes (Medium and up) |
| `?noarrival` | skip the cinematic arrival flight (also skipped with `?autostart`, reduced motion, or after the first visit of the session) |

Controls: drag to look (or **L** for mouse-look with a crosshair), **WASD**/arrows to walk, click the floor to
walk there, click artworks/objects for details, **E** for the nearby item, **M** map, **H** help.

## How to build

```bash
npm run build        # next build (type-checks)
npm run start        # production server on http://localhost:3000
npm run typecheck
npm run lint
```

## How to deploy

Vercel (native Next.js). Production uses Supabase Postgres (`DATABASE_URL`) and an S3 bucket (`S3_BUCKET`,
`AWS_REGION`, optional CloudFront `S3_PUBLIC_BASE_URL`). See `infra/deploy-vercel.md`, `infra/setup-supabase.md`,
`infra/setup-s3.sh` and `.env.example`. Without those env vars the app still runs (SQLite + local disk), which
is fine for demos on a single machine but not on Vercel (ephemeral filesystem).

**Error monitoring:** browser errors, unhandled rejections, contained React errors and WebGL context loss are reported
(sampled, PII-scrubbed) to `POST /api/errors` and grouped on the admin **Errors** page (`/admin#/errors`, admin+), where they
can be resolved (a recurrence reopens them). Set `NEXT_PUBLIC_SENTRY_DSN` to also forward them to Sentry (no SDK) — see
`docs/API.md` → *Errors / monitoring*.

## Validation scripts (optional, need Chrome installed)

```bash
node scripts/screenshots.mjs http://localhost:3000 auto   # demo-path + wing screenshots + fps → scripts/out/
node scripts/interaction-test.mjs http://localhost:3000    # walking, collision, click → panel, 3D inspect
node scripts/load-profile.mjs http://localhost:3000 medium --json=scripts/out/load.json  # load time, long tasks, transfer MB by type
npm run optimize:assets                                     # meshopt+WebP GLBs → public/models/opt, artwork WebP variants (+ render check)
npm run test:visual -- http://localhost:3000                # visual regression vs tests/visual/baseline (see tests/visual/README.md)
node scripts/live-presence-test.mjs http://localhost:3000  # presence + live docent tour (two browsers)
```

---

## Project structure

```
src/museum/
  config/          ← ALL content and constants (edit these, not the rendering code)
    museum.ts        dimensions (ft → m), wall heights, passage, reveal wall, skylight, visitor
    layout.ts        derived walls, display surfaces, zones, benches, reception desk
    artworks.ts      artworks (images, placement, frames, spotlights, metadata)
    exhibits.ts      hand-block display tables + 3D models
    infographics.ts  product-wall craft panels, reveal-wall title, reception welcome
    frames.ts        frame style presets
    lighting.ts      sun, sky, 3000K track, cove, fill intensities
    quality.ts       Low / Medium / High / Ultra presets and auto-detection
  architecture/    Wall, Floor, CeilingAndSkylight (slat ceiling, coves, lantern), Reception
  exhibits/        Artwork (+frame math), Exhibit (tables), Artifact3D, hand-block placeholder, wall graphics
  lighting/        Lighting rig, SkyAndSun, TrackLight fixtures, SpotPool, environment
  materials/       procedural PBR textures (oak, plaster, timber, stone, linen), canvas typography
  navigation/      VisitorController (walk/look), collision, focus/click-to-walk
  effects/         PostFX (AO, bloom, SMAA, tone mapping), async shader Precompile
  ui/              entry screen, HUD, info panel, minimap, help, joystick, 3D inspection modal, social UI
  media/           video screens, speakers, spatial/surround audio engine
  models/          procedural craft models + SceneObjects (GLB / CC0 with procedural fallback)
  tour/            guided tour engine + pathing        api/ analytics/  backend client + tracker
  content/         content types + runtime loader (API → bundled config fallback)
app/               Next.js: page (museum), admin/, api/**/route.ts, media/[...path]
src/server/        backend logic (Postgres/SQLite, S3/disk storage, auth, analytics)
public/
  artworks/  models/ (cc0/)  videos/  textures/  audio/
```

Scale: **1 unit = 1 metre**. Axes: +x east, +y up, **−z north** (entrance is at +z).

---

## How to add an artwork

1. Put the image in `public/artworks/` (JPG/PNG/WebP, any aspect ratio; ~2048 px long edge is plenty).
2. Add an entry to `ARTWORKS` in `src/museum/config/artworks.ts`:

```ts
{
  id: 'hero-06',
  title: 'Title',
  tradition: 'Hand Block Printing',
  artisan: 'Name',            // optional — only shown if present
  region: '…', material: '…', technique: '…', description: '…', context: '…',
  image: '/artworks/my-textile.jpg',
  placement: { surface: 'gallery-a-outer', at: -3.4 },  // see "positions" below
  maxWidth: 1.4, maxHeight: 1.7,                          // outer framed size limit (m)
  // physicalWidth: 1.12,     // optional: true 1:1 width in metres (overrides fitting)
  frame: 'natural-wood',      // or { style: 'natural-wood', matWidth: 0.12 }
  exhibitId: 'block-06',      // optional hand-block table beside it
}
```

No geometry needs editing. The info panel shows only the fields you provide.

## How to replace an artwork (e.g. the five hero works)

The five hero works are `hero-01 … hero-05` in `config/artworks.ts` (PDF §4: exactly 5 per tradition).
Either overwrite `public/artworks/hero-0N.jpg` with the final photograph, **or** change `image:`.
Then fill in the real metadata and set `placeholder: false` (this removes the "Placeholder" badges/labels).

> ⚠ `scripts/generate-placeholders.mjs` regenerates the placeholder JPGs and would overwrite files with the same names.

## How automatic frames work

`exhibits/Artwork.tsx` + `exhibits/frameMath.ts`:

1. the image loads and its **intrinsic pixel width/height** are read;
2. aspect = w / h; the image is fitted inside `maxWidth × maxHeight` **minus the frame and mat borders**
   (or sized from `physicalWidth` for 1:1 accuracy) — the aspect ratio is never changed;
3. mat = image + 2 × matWidth, outer = mat + 2 × frameWidth;
4. four moulding bars, the mat/backing board and the image plane are generated at those sizes; the image sits
   at the recessed mat plane with polygon offset (no z-fighting);
5. the accent spotlight cone is computed to cover the framed size; the wall label goes to the right.

Portrait, landscape, square, runner (1:2.4) and panoramic (2.5:1) placeholders are included to exercise this.
A missing or broken image renders an intentional "Image unavailable" card instead of breaking the scene.

Frame styles (`config/frames.ts`): `frameless`, `textile-panel`, `thin-black`, `white`, `natural-wood`,
`dark-wood` — each with frameWidth, frameDepth, matWidth, recess, material, colour, mat colour.

## How to change an artwork position

`placement.surface` is a display-surface id (from `config/layout.ts → SURFACES`):

| surface | wall |
|---|---|
| `gallery-a-outer`, `gallery-a-partition` | Gallery A perimeter / passage partition (west side) |
| `gallery-b-outer`, `gallery-b-partition` | Gallery B (east, north bay) |
| `gallery-c-outer`, `gallery-c-partition` | Gallery C (east, south bay) |
| `reveal-south`, `reveal-north` | reveal wall faces |
| `product-wall` | north wall (craft infographics) |
| `reception-west`, `reception-east`, `passage-west`, `passage-east` | … |

`placement.at` is the world coordinate **along** that wall (z for side walls, x for the reveal/product walls).
Bay centres are available as `BAY.southZ` (−3.43) and `BAY.northZ` (−10.29).
`placement.centerHeight` defaults to **1.6 m** (PDF mounting height).
The accent light snaps to the nearest ceiling track automatically.

## Real content: deep zoom & 3D scans

Field guide for photographing textiles, scanning blocks and writing text: **`docs/CONTENT_CAPTURE.md`**.
Admin → **Capture tools**: *Deep zoom* tiles a large photo into a DZI pyramid in the browser and assigns it
to an artwork's `deepZoom` (visitors: **Examine closely** in the info panel, or double-click the artwork —
OpenSeadragon viewer with zoom/pan/fullscreen/keyboard and a cm scale bar when `physicalWidth` is set);
*3D scan import* optimises a Polycam/RealityScan glTF (weld, meshopt simplify, WebP textures ≤ 2048, metres)
and assigns it to an exhibit or object `model`. Demo pyramids for the hero placeholders:
`node scripts/generate-deepzoom.mjs` → `public/deepzoom/`.

## How to add / replace a hand-block 3D model

1. Export the block as **GLB** (metres, Y-up; Draco not required) into `public/models/`, e.g. `block-01.glb`.
2. In `config/exhibits.ts` set `model: '/models/block-01.glb'` (and `modelScale` if not authored in metres).
3. Fill in `title`, `material`, `technique`, `artisan`, `region`, `description`; set `placeholder: false`.

The model is centred and placed on the table automatically, casts shadows, and is inspectable (rotate / zoom /
reset) in the 3D viewer. If the file is missing or fails to parse, the procedural placeholder block is shown.
Tables are positioned with `placement: { surface, at }` exactly like artworks.

## How to change the reveal wall

`src/museum/config/museum.ts → MUSEUM.revealWall`:

```ts
revealWall: { width: 4.2, height: 3.7, thickness: 0.4, gapFromPassage: 1.3, offsetX: 0 }
```

Collision, minimap, surfaces (`reveal-south`/`reveal-north`), title placement and its wash lights all derive
from these values. The title / intro text lives in `config/infographics.ts → EXHIBITION_TITLE`.
Keep `width` ≤ ~5 m so ≥ 2 m clear circulation remains on both sides of the 30' gallery.

## How to change the skylight

`MUSEUM.skylight` in `config/museum.ts`: `width` (opening), `startZ` / `endZ` (extent), `wellHeight`
(plaster light-well), `ridgeRise` (glazed gable), `mullionSpacing`, `beamSpacing`, `glassTint`, `glassOpacity`.
Sky and sun: `config/lighting.ts → LIGHTING.sun` (elevation / azimuth / intensity / colour temperature) and
`LIGHTING.sky` (turbidity, Rayleigh, Mie, exposure, clouds on/off, coverage, speed).
Direct sun enters only through the glass (the roof and lantern cast shadows).

## How to change lighting

`config/lighting.ts`:

- `track.colorK` (3000K), `track.chromaticAdaptation`, `track.artworkIntensity`, `track.tableIntensity`,
  `track.penumbra`, `track.aimAngleDeg`
- per artwork: `spotlight: { enabled, intensity, spread }` in `artworks.ts`
- `cove` (perimeter cove wash + LED strip emissive), `skylightFill` (diffuse daylight), `ambient` (hemisphere +
  environment fill), `exposure`

Real `SpotLight`s come from a shared pool (`lighting/SpotPool.tsx`, size per quality tier) that assigns them to
the fixtures nearest the visitor with soft cross-fades; every fixture keeps its visible track head.

## Graphics features (time of day, probes, ray tracing, arrival, WebGPU)

- **Time of day** (HUD sun icon, **T** cycles): Morning · Midday · Golden hour · **Dusk** · **Night**
  (`LIGHTING.timeOfDay` + `LIGHTING.ambience`). Dusk/night extend the Preetham sky with a blue-hour gradient,
  moon disc and a procedural starfield (`lighting/nightSky.ts`); the sun becomes a faint sky light / moonlight
  (same directional light), daylight fills fade, exposure adapts, courtyard wall lanterns light up
  (`lighting/NightLights.tsx` — their downlights are SpotPool *requests*, so no light is ever added) and the
  glazing glows warm when seen from outside. Only intensities/uniforms change — no shader recompiles.
- **Per-zone irradiance probes** (*experimental*, Medium+ with `?probes`, `lighting/ZoneProbes.tsx`): after the shaders compile, each zone is
  captured once into a small cube map (one face per frame, only the zones visible from there), prefiltered
  with PMREM into the same CubeUV layout as the light-former environment, and `scene.environment` cross-fades
  per room (warm oak galleries, dark theatre, indigo Gallery D, sunlit courtyard). Re-captured after a
  time-of-day change and once per room after the visitor arrives (second bounce + the room's spots). Chosen over
  in-browser lightmap baking: no second UV set, no stale IndexedDB cache, no shader variants, ~0 ms per frame.
- **Ray-traced view** (photo mode, `effects/PathTracer.tsx`, three-gpu-pathtracer): hold still in photo mode and
  the view is progressively path-traced (sample counter in the photo bar; the raster frame cross-fades to the
  converging image; any movement cancels). The BVH is built lazily — on a worker when possible — from the zones
  zone-culling currently shows, and rebuilt only when that set changes. *Experimental*: off by default on
  every tier — the photo-bar **Ray-trace** toggle opts in (remembered); scene builds time out (25 s worker →
  main-thread retry, 60 s → disabled); Capture waits for convergence so
  the PNG is the path-traced image. Needs float render targets; any failure falls back to raster silently.
- **Cinematic arrival** (`navigation/ArrivalFlight.tsx`, `ui/ArrivalOverlay.tsx`): ~11 s drone flight over the
  lawns and roof lights, down to the facade and through the entrance, with letterbox + title card. First visit
  per session only; skipped on any key/click/Skip, with `?autostart`/`?tour`/`?noarrival` and reduced motion.
- **WebGPU** (`?renderer=webgpu`, `utils/renderer.ts`) — *experimental*. Uses `three/webgpu` WebGPURenderer
  with the TSL `SkyMesh` and WebGPU PMREM; the postprocessing composer, zone probes, path tracer and GLSL
  patches (dusk/night sky terms, foliage sway) are WebGL-only and are skipped. Falls back to WebGL on any error.

## Live tours, presence, VR & AR

- **Presence** (`live/`, Supabase Realtime — set `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`): other
  visitors appear as soft translucent silhouettes with a glowing head orb and name tag ("Visitor 12" or the signed-in
  name). Positions are sent at ~5 Hz while moving and smoothed; at most 40 are drawn (nearest, in zones visible from
  you); beyond 14 m only the orb, beyond 32 m nothing. Hidden entirely when Realtime isn't configured/reachable.
- **Live docent tours**: curators/admins get **Start live tour** (HUD). Visitors see "Live tour by *name* — Join";
  joined visitors auto-follow the docent (walk target nearby, faded teleport when far / in another room; walking
  yourself pauses it → "Rejoin docent"), see a pulsing ring on what the docent is showing, chat (rate-limited,
  filtered; the docent can mute) and can raise a hand. Docent messages are cryptographically verified — see
  `docs/API.md → Live guided tours` (`POST /api/live/token`, `GET /api/live/verify`, `LIVE_TOKEN_SECRET`).
- **VR** (HUD **Enter VR**, only when `navigator.xr` supports `immersive-vr`; `xr/`): the museum at 1:1. Thumbstick
  forward → teleport arc (walls block it, landing is collision-checked), left/right → 30° snap turn, trigger → select
  an artwork/object (world-space info card; trigger on the card or B/Y closes), comfort vignette on teleport/turn,
  zone culling follows the headset, post-processing is paused while presenting.
- **AR** (inspection viewer → **View in your space**): Android/Chrome WebXR `immersive-ar` with hit-test placement at
  real scale; iOS/iPadOS AR Quick Look with a USDZ generated at runtime (`USDZExporter`); otherwise the button is
  hidden and the 3D viewer is the experience.
- Test: `node scripts/live-presence-test.mjs http://localhost:3000` (two browser contexts: docent + visitor).

## How to change quality settings

`config/quality.ts → QUALITY_PRESETS` (dpr, shadows + map size, post-processing, AO quality, bloom, SMAA,
floor reflections, spot-pool size, area lights, texture size, MSAA). `detectInitialTier()` chooses the
"Auto" starting tier (integrated GPUs → Medium, phones → Low) and `AdaptiveQuality` in `App.tsx` steps down
if the frame rate stays below ~32 fps. The visitor can switch tiers from the HUD.

---

## Design assumptions (not specified in the PDF)

- Gallery clear height 4.6 m, reception 3.0 m (compression → release); partitions 3.7 m so daylight spills over.
- Interior dimensions are exact (30' × 60' gallery + 10' × 15' reception); the 0.2 m dividing wall is additional.
- Passage clear width 2.0 m (GA-101 shows ~6–7'), running 45' up the axis as drawn.
- The reveal wall is the intentional modification requested for this delivery (not in GA-101).
- Benches: 4 in the side bays (drawn as ovals in GA-101) + 1 in the craft court = 5.
- Hand-block tables are placed beside the five hero works.

---

## Backend & Admin

The museum works as a pure static experience (bundled content from `src/museum/config`), and the
same Next.js app also hosts a backend: editable content, a media library, visitor accounts
(favourites, guestbook/comments) and anonymous analytics. The API contract is `docs/API.md`.

### Run it

```bash
npm install
npm run dev            # http://localhost:3000        museum
                       # http://localhost:3000/admin  admin (content, media, analytics, comments, users/access)
```

No configuration is needed locally: on the first API request the server creates
`.data/museum.sqlite`, seeds it from the bundled config and creates the admin account.

**Admin credentials** come from `ADMIN_EMAIL` / `ADMIN_PASSWORD`. When they are not set (dev only)
the default `admin@museum.local` / `admin12345` is created and a warning is logged. When both are
set, the account is created on first start and its password is re-synchronised from the env var on
every (cold) start. In production (`NODE_ENV=production`) no default admin is ever created.

### Roles & access list

| Role | Admin sections | Can |
|---|---|---|
| visitor | — | favourites, guestbook/comments |
| curator | Content, Media | create/edit/delete artworks, exhibits, infographics, videos, objects, exhibition & welcome text; upload/delete images, video, GLB |
| admin | + Analytics, Comments, Users | + comment moderation, analytics, manual roles, reset content to bundled defaults |
| master | + Access | + the access list. The emails in `MASTER_ADMIN_EMAILS` (comma-separated; fallback `MASTER_ADMIN_EMAIL`, then `ADMIN_EMAIL`) |

Every admin Route Handler enforces the minimum role server-side (`c.requireCurator()` /
`requireAdmin()` / `requireMaster()` in `src/server/http.ts`; 401 signed out, 403 too low); the admin UI
only hides what the role cannot use.

**Access list** (admin → *Access*, master only): emails (`person@iitkgp.ac.in`) or whole domains
(`@iitkgp.ac.in`) with the role they grant (curator / admin). Unlisted people are visitors.
The effective role is recomputed on every sign-in and whenever the list changes:
`master` for a `MASTER_ADMIN_EMAILS` address, else **max(access-list role, manual role set on the Users page)**.
The master addresses are mirrored into the access list (role `master`, read-only in the UI) on every
start / `db:migrate`; removing an address from the env var removes its master row and rights.
Production masters: `ankits1802@gmail.com`, `priyadarshi1@yahoo.com`, `priyadarshi.p@gmail.com` — they get
master rights by signing in with Google (`ADMIN_EMAIL` = the first one also has a password login).
Access-list roles only apply to **verified** addresses — people who signed in with Google (or the
env-seeded admin) — because password sign-up does not verify email ownership. Staff should
therefore sign in with Google at least once; afterwards password sign-in keeps the role too.

### Google sign-in

"Sign in with Google" (Google Identity Services) appears on `/admin` and in the museum's sign-in
dialog when `GOOGLE_CLIENT_ID` is set (`GET /api/auth/providers`). The browser receives an ID token and
posts it to `POST /api/auth/google`; the server verifies it against Google's JWKS with `jose`
(signature, issuer, audience = client id, expiry, `email_verified`), finds or creates the user, sets
the session cookie and applies the access list.

Creating the OAuth client (manual — cannot be scripted without gcloud):
1. Google Cloud Console → *APIs & Services* → *OAuth consent screen*: app name, support email,
   audience *External* (or *Internal* for a Workspace org); scopes `openid`, `email`, `profile`.
2. *Credentials* → *Create credentials* → *OAuth client ID* → type **Web application**.
3. *Authorised JavaScript origins*: `http://localhost:3000` and every production origin, e.g.
   `https://hand-block-museum.vercel.app` (+ custom domains). Redirect URIs are not needed (popup flow).
4. Put the client id in `GOOGLE_CLIENT_ID` (`.env.local` and Vercel). Origins take a few minutes to apply.

### Two modes

| | Local (default) | Production |
|---|---|---|
| Database | SQLite via Node's built-in `node:sqlite` → `.data/museum.sqlite` (`DB_PATH`) | Postgres (Supabase) via `DATABASE_URL` |
| Media | disk → `.data/media/<folder>/…` (`MEDIA_DIR`), served at `/media/…` with Range support | AWS S3 / S3-compatible (`S3_BUCKET`, `AWS_REGION`, `S3_PUBLIC_BASE_URL`, `S3_ENDPOINT`) with presigned direct uploads |
| Hosting | `npm run dev` / `npm run build && npm start` (one Node process) | Vercel (pages + Route Handlers as Node functions) |

The mode is picked per concern: `DATABASE_URL` switches the database, `S3_BUCKET` switches storage.
All variables are documented in `.env.example` (copy to `.env.local`).

Production credentials can live in `.env.local` as `REMOTE_DATABASE_URL`, `REMOTE_S3_BUCKET`,
`REMOTE_ADMIN_PASSWORD`, … — they are ignored unless `USE_REMOTE=1`, so `npm run dev` keeps using
SQLite + local disk (important when several people share one dev server). Do **not** run
`vercel env pull .env.local`: it would overwrite the file with plain `DATABASE_URL` etc. and switch
local dev to the production database.

```bash
npm run db:migrate     # apply supabase/migrations/*.sql to DATABASE_URL (or create the SQLite DB),
                       # then seed content + admin if empty and re-sync staff roles
USE_REMOTE=1 npm run db:migrate          # same, against the REMOTE_* (production) settings
npm run db:migrate -- --schema-only      # migrations only (CI)
```

Setup guides (review before running — they create cloud resources):
`infra/setup-supabase.md`, `infra/setup-s3.sh` (+ `infra/s3-cors.json`), `infra/deploy-vercel.md`.

### Where things live

```
app/api/**/route.ts     thin Route Handlers (one per endpoint in docs/API.md)
app/media/[...path]     local media files (Range / ETag); redirects to S3 in S3 mode
app/admin/              admin page (client app in src/admin/)
src/server/
  db/                   Db interface + PostgresDb (pg) + SqliteDb (node:sqlite) + migrations runner
  storage.ts            StorageDriver: LocalDiskStorage, S3Storage (presigned PUT)
  auth.ts               scrypt passwords, DB-backed sessions (SHA-256 token hash), cookie helpers,
                        roles (visitor < curator < admin < master), access-list role resolution
  contentStore.ts       content rows (JSON/jsonb) + version, seeding from bundledContent()
  handlers/             content, auth (+ Google), favorites, comments, analytics, media, users (+ access list)
  http.ts               route() wrapper: JSON errors, same-origin check, auth helpers
supabase/migrations/    Postgres schema (used by `supabase db push` and `npm run db:migrate`)
.data/                  local SQLite DB + uploaded media (git-ignored)
```

Content editing: every save bumps `MuseumContent.version`; the museum loads `/api/content` at
start-up (falling back to bundled content when the API is unreachable). **Reset to bundled
defaults** in the admin re-seeds from `src/museum/config`.

### Deploy

- **Vercel** (recommended): set the env vars from `infra/deploy-vercel.md`, `vercel deploy --prod`.
  Uploads go browser → S3 via presigned URLs, so large videos never pass through a function.
- **GitHub Actions** (`.github/workflows/deploy.yml`): every push to `main` runs typecheck + lint,
  applies migrations (`npm run db:migrate -- --schema-only` with the `DATABASE_URL` secret) and deploys a
  prebuilt production build; pull requests get a preview deployment (note: previews use the same
  database). Repo secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `DATABASE_URL`.

Provisioned resources (no secrets here; values live in Vercel env vars and the git-ignored `.env.local`):
Supabase project `hand-block-museum` (ref `pnawtnmgvsvfxtkdbott`, ap-south-1), S3 bucket
`hand-block-museum-media-626159998512` (ap-south-1, public-read objects, CORS for uploads) with the
least-privilege IAM user `hand-block-museum-app`, Vercel project `hand-block-museum` (functions in `bom1`).
- **Single Node process** (VM / container): `npm run build && npm start` with `DATABASE_URL`
  (or leave it unset to keep SQLite on a persistent disk) and optionally `S3_BUCKET`. Put it behind
  HTTPS (the session cookie is `Secure` when `NODE_ENV=production`; set `COOKIE_SECURE=0` only for
  plain-HTTP testing).

### Exhibitions, makers & curator analytics

- **Multi-exhibition**: one building, several exhibitions (table `exhibitions`; `content_items.exhibition_id`).
  The default exhibition opens at `/gallery`, others at `/gallery/<slug>`; each has its own artworks, exhibits,
  panels, films, objects, reveal-wall / welcome text, optional tour-stop override and accent colour. Admin → header
  *Exhibition* switcher scopes every content page; admin → *Exhibitions* creates / duplicates / publishes / sets the
  default (admin role) and edits the tour (curators). The entry screen lists exhibitions when more than one is
  published. Demo: `textile-traditions` ("Textile Traditions — coming soon", draft) was made with *Duplicate*.
- **Meet the maker**: profiles in table `artisans` (admin → *Makers*, curators); artworks / exhibits reference one
  with `artisanId`. The info panel shows a maker card with *Visit the maker* / *Commission* / *Buy (fair trade)*
  when those URLs exist; `/makers/<id>` is the accessible profile page. Seed profiles are placeholders only
  ("Artisan profile — to be supplied by the workshop") — enter only what the workshop supplies.
- **Curator analytics** (admin → *Analytics*): the tracker samples the visitor position every 2 s (`pos`) and tour
  arrivals (`tour_step`). Positions are aggregated on arrival into `analytics_heat` (0.5 m cells per exhibition /
  day / zone) and never stored raw. Floor-plan heatmap (walls from `config/layout.ts`), zone filter, date range,
  tour funnel, attention ranking, CSV export.
- **Retention**: analytics older than the retention setting (default **180 days**, admin → Analytics → *Privacy &
  retention*) are deleted automatically at most once a day, and by `POST /api/admin/analytics/cleanup` (admin) or
  `GET|POST` with `Authorization: Bearer $CRON_SECRET` for a scheduled job, e.g. a Vercel Cron Job
  (`"crons": [{ "path": "/api/admin/analytics/cleanup", "schedule": "0 3 * * *" }]` + `CRON_SECRET` env var).

### Print it yourself, Visitors' Wall & artisan presence

- **Studio** (`src/museum/studio/`): the small printing table in front of the Craft Workshop's west wall
  (scene object kind `print-studio`) shows the visitor's current cloth live; selecting it opens a full-screen studio
  (blocks from the placeholder motif library + a border block with corner blocks, outline / filler / both faces,
  colour-named dyes, ground cloths, colourways, grid / half-drop guides with snapping, hold-to-press pressure, ink that
  runs dry and is re-inked, undo / redo / clear, PNG download). Designs are deterministic op lists (per-stamp seeds),
  kept in `localStorage`. The museum canvas pauses while the studio is open.
- **Visitors' Wall** (kind `visitors-wall`, props `cols`, `rows`, `width`, `bottom`): the 24 latest approved prints
  (`GET /api/prints`) as box-framed textiles (one atlas texture). *Hang it on the Visitors' Wall* posts to
  `POST /api/prints` (pending); curators approve / reject in admin → *Visitor prints*. Offline / `?static`: the
  studio still works (download only) and the wall shows empty frames. Table `visitor_prints`
  (`supabase/migrations/20260923110000_visitor_prints.sql`).
- **Meet the maker screens**: `VIDEOS` entries with `kind: 'portrait'`, `stand: { x, z, rotationDeg }` and
  `cropAspect` (default 9 / 16) render a small vertical screen on a free-standing stand with spatial audio. The two
  placeholders beside printing tables II and IV centre-crop the placeholder process films — replace `src` with the
  portrait films.
- **Artisan captures** (kind `splat`): set `model` to a Gaussian-splat `.splat` file (drei `<Splat>`; `.ksplat` /
  `.ply` must be converted first) with optional props `splatScale`, `splatY`, `splatRotDeg`. Without a capture a
  clearly labelled placeholder (translucent seated figure + "Artisan capture — coming soon" card) is shown.

### Security notes

- Passwords: scrypt (N=16384, r=8, p=1, 16-byte salt). Sessions: 32-byte random tokens; only
  their SHA-256 hash is stored; 30-day `HttpOnly; SameSite=Lax` cookie. Login is rate-limited
  (10/min/IP), comments 5/min/user (in-memory, per instance).
- State-changing API calls with a foreign `Origin` are rejected (CSRF defence on top of SameSite).
- Uploads: extension allow-list (jpg, png, webp, glb, gltf, mp4, webm, mp3, ogg, wav, m4a), 500 MB
  limit, random file names, `nosniff`; no HTML/SVG can be uploaded.
- Supabase: RLS is enabled with no policies on every table, so the public anon key cannot read
  users, sessions or analytics — only the server (database owner connection) can.
- Roles are enforced server-side on every admin route. Access-list elevation requires a verified
  email (Google); linking Google to an unverified password account with the same email clears that
  password and revokes its sessions (pre-registration takeover defence). Google ID tokens are
  verified locally against Google's rotating JWKS (`jose`), `aud` pinned to `GOOGLE_CLIENT_ID`.
- Analytics store a random session id only — no IPs, user agents or accounts.
- Always set `ADMIN_EMAIL` / `ADMIN_PASSWORD` for any shared deployment; never commit `.env*` files.
