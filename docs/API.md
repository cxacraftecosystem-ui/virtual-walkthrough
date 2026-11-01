# Museum Backend API (v1)

Base: same origin. Implemented as Next.js Route Handlers (`app/api/**/route.ts`, logic in `src/server/**`); `next dev` serves the API and the app on one port.
All bodies are JSON unless noted. Errors: `{ "error": string }` with a 4xx/5xx status; a few add fields — a stale content
save answers **409** `{ error: 'conflict', message, current, updatedAt, updatedBy }`, an invalid tour **400** `{ error, field }`.
Auth: HTTP-only cookie `museum_session` (set by login/register/Google; SameSite=Lax, Secure in production, 30 days). `role` is `'visitor' | 'curator' | 'admin' | 'master'` (see **Roles**).
Admin routes answer **401** when signed out and **403** `{ error: "<Role> role required" }` when the role is too low.
CSRF: state-changing requests (POST/PUT/PATCH/DELETE) carrying an `Origin` header that is not the API's own host (or listed in `ALLOWED_ORIGINS`) are rejected with 403 (except `/api/analytics/events`). Unknown `/api/*` paths return a JSON 404.

**Sites.** Two apps share one database: this one (`site = 'hand-block'`) and the clay pavilion (`'clay'`), each a build
of its own repo (`src/site.ts`). Every endpoint below answers for **its own site only**: exhibitions, content, makers,
media, prints, comments, favourites, analytics, errors and the activity log of the other site are invisible to it
(by-id routes answer 404 for the other site's rows). Users, sessions and the access list are shared, so staff keep one
login and one role across both. Exhibition slugs and maker ids are still unique across both sites: one the other site
uses is refused with 409.

## Roles (RBAC)

| Role | Can |
|---|---|
| `visitor` | favourites, comments / guestbook (everyone who signs up) |
| `curator` | + create/edit/delete content (artworks, exhibits, infographics, videos, objects, exhibition & welcome text) and upload/delete media |
| `admin` | + reset content to bundled defaults, comment moderation, analytics, user list + manual roles |
| `master` | + the **access list**. Every (verified) account whose email is in `MASTER_ADMIN_EMAILS` (comma-separated; fallback `MASTER_ADMIN_EMAIL`, then `ADMIN_EMAIL`) |

The stored role is the *effective* role, recomputed on every sign-in, on access-list / role changes and when the server starts:
`master` for a master email, otherwise **max(access-list role, manual role)**. The access-list role (exact email, or the
email's `@domain`) only applies to **verified** addresses — accounts that signed in with Google (`email_verified`) or the
env-seeded admin — because password self-registration has no email check. When Google sign-in links to an existing
*unverified* password account with the same email, that account's password is cleared and its sessions revoked.

## Content (public)
| Method | Path | Response |
|---|---|---|
| GET | `/api/content[?exhibition=<slug>]` | `MuseumContent` (see `src/museum/content/types.ts`) of one exhibition — omitted = the **default** exhibition (backward compatible). Extra fields: `exhibitionMeta` (`Exhibition`), `artisans` (`Artisan[]`), `tour?` (`TourStop[]`, only when the exhibition overrides the bundled tour). Drafts: 404 unless signed in as curator+ (preview). |
| GET | `/api/exhibitions` | published exhibitions, default first: `{ id, slug, title, subtitle, isDefault, theme: { accent? }, path }[]` (`path` = `/gallery` or `/gallery/<slug>`) |
| GET | `/api/artisans` | `Artisan[]` ("Meet the maker" profiles, shared by all exhibitions) |
| GET | `/api/artisans/:id` | `Artisan` or 404 |
| GET | `/api/health` | `{ ok: true, version: string, contentVersion: number, db: 'postgres' | 'sqlite' }` |

## Content admin (role ≥ curator)
| Method | Path | Body / Response |
|---|---|---|
| GET | `/api/admin/content/:collection` | list of items (`collection` ∈ artworks, exhibits, infographics, videos, objects) |
| PUT | `/api/admin/content/:collection/:id` | full item → saved item (create or replace) **plus** `updatedAt`, `updatedBy` (never stored inside the item). Optional header `X-Expected-Updated-At` (see *Concurrency*). |
| DELETE | `/api/admin/content/:collection/:id` | `{ ok: true }`; the item goes to the trash. Optional `X-Expected-Updated-At`. |
| GET | `/api/admin/content/stamps` | `{ stamps: { "<collection>/<id>": { updatedAt, updatedBy } } }` — the last change of every item of the exhibition (`updatedBy` = email, null for seeded items) |
| GET | `/api/admin/content/:collection/:id/history` | `{ revisions: [{ rev, at, actorEmail, op: 'create' \| 'update' \| 'delete' \| 'restore', item }] }`, newest first (the last 100 are kept per item). `item` is the item after the change; for a delete, as it was just before. |
| POST | `/api/admin/content/:collection/:id/restore` | `{ rev }` → `{ item, updatedAt }` — puts the item back as it was at that revision, **deleted items too** (restore the `rev` of their delete). Recorded as a `restore` revision. 404 for an unknown revision. |
| GET | `/api/admin/content/trash` | `{ items: [{ collection, id, title, deletedAt, deletedBy, rev }] }` — items whose last revision is a delete and that were not made again, newest first (max 500). Restore with `rev`. |
| PUT | `/api/admin/content/exhibition` | `ExhibitionText` |
| PUT | `/api/admin/content/welcome` | `{ title, body }` |
| PUT | `/api/admin/content/tour` | `{ stops: TourStop[] \| null }` — per-exhibition tour override (null / [] = the bundled tour in `src/museum/config/tour.ts`). Stop: `{ id, place, title, text, view: { x, z, yawDeg, pitchDeg? }, item?: { kind, id }, dwellSec?, i18n?, narrationAudio? }` (max 80). Validated server-side: ids unique, `view` numbers (pitch ±90, x/z within ±200 m), `item.kind` ∈ artwork, exhibit, infographic, video, object, `dwellSec` 1–600; unknown keys are dropped. An invalid stop → **400** `{ error, field }` with the path, e.g. `field: "stops[2].view.x"`. |
| POST | `/api/admin/content/reset` | **admin**; re-seed the selected exhibition from bundled config → `{ ok: true }`. The replaced items are kept as revisions, so the ones the seed does not bring back are in the trash. |

All routes above take `?exhibition=<id|slug>` (omitted = the site's default exhibition). Curators may edit the content of **any** of the site's exhibitions, drafts included.

Every content write increments `MuseumContent.version` (one counter for both sites; it only goes up), and every write
above is recorded in the activity log.

**Concurrency.** An editor loads `GET /api/admin/content/stamps` and sends the item's `updatedAt` back as
`X-Expected-Updated-At` with its `PUT` or `DELETE` (or the literal `new` when creating an item that must not exist yet).
When the item changed (or was deleted, or created) in the meantime the write is refused:
**409** `{ error: 'conflict', message, current: Item | null, updatedAt: string | null, updatedBy: string | null }` —
`current` is the item as it is now, so the editor can show both versions. A value that is neither a timestamp nor
`new` → 400. Without the header the last write wins, as before. Every save moves `updatedAt`, even two saves in the
same millisecond. The check and the write are one step: two editors saving the same item at once are served one after
the other (on Postgres each write of an item takes a transaction lock on it), so the second gets the 409 — and a
create-only (`new`) save never replaces an item, even one created a moment earlier.

## Exhibitions (multi-exhibition platform)
The building is shared; each exhibition has its own content set (artworks, exhibits, infographics, videos, objects), reveal-wall text, welcome, tour stops and theme. The default exhibition is served at `/gallery`, the others at `/gallery/<slug>` (legacy `/e/<slug>` redirects). Existing content was migrated into `hand-block-printing`.

Exhibitions belong to a site: each site lists, edits and deletes only its own, and has its own default (making one the
default never touches the other site's). On first start each app creates its own default exhibition
(`SITE.defaultExhibitionId`: `hand-block-printing` here, `clay-traditions` in the clay app) and seeds its bundled content
into it — never into the other site's. A slug (or id) the other site already uses → **409** "…already used by the other
museum that shares this database". Create, duplicate, edit, publish, default and delete are recorded in the activity log.

Deleting an exhibition also deletes everything kept under its id: its items' history and trash, and its visitor
analytics (events and heatmap). A new exhibition at the same address starts empty. The site's own default exhibition
(`SITE.defaultExhibitionId`) can only be deleted with `?force`; that deletion is remembered (meta
`default_exhibition_deleted_at`, per site), and the app does not recreate it on its next start. Nor does it once the
site has seeded and still has exhibitions of its own: the default exhibition is created on the site's first start only.

**Deploy order (the sites migration).** `supabase/migrations/20261101000000_sites.sql` is additive for the schema, so
older code keeps running against it — but not for the data: hand-block code from before sites reads `is_default = 1`
with no site, lists every exhibition and cleans up every site's analytics, so it would serve the clay app's rows as its
own once they exist. (The file's header says the code deployed in either app "keeps working while the other deploys";
that holds for the schema only. The file is pinned by its sha256 in `_museum_migrations` and stays as applied.) The
order is enforced in code: each app's bootstrap records `sites_aware:<site>` in the shared `meta` table, and the clay
app refuses to start (it does not create its default exhibition) while hand-block has served the database (meta `seeded_at`) and
`sites_aware:hand-block` is missing. Deploy hand-block first; clay starts on its next request after that.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/admin/exhibitions` | curator+; all (incl. drafts): `Exhibition & { path, items, hasTour }[]` |
| POST | `/api/admin/exhibitions` | **admin**; `{ slug, title, subtitle?, theme?: { accent: '#rrggbb' }, duplicateFrom? }` → **201** draft (empty unless `duplicateFrom`) |
| POST | `/api/admin/exhibitions/:id/duplicate` | **admin**; `{ slug, title? }` → **201** draft copy of all content, texts, tour and theme |
| PATCH | `/api/admin/exhibitions/:id` | **admin**; `{ title?, subtitle?, slug?, theme?, status?: 'draft' \| 'published', sort? }` (publish / unpublish; the default cannot be unpublished → 409) |
| POST | `/api/admin/exhibitions/:id/default` | **admin**; must be published (409 otherwise) |
| DELETE | `/api/admin/exhibitions/:id` | **admin**; not the default (409); deletes its content items, their history and trash, and its visitor analytics |

`Exhibition = { id, slug, title, subtitle, status: 'draft' | 'published', isDefault, theme: { accent? }, sort, createdAt, updatedAt }`. `slug`: 2–60 of `a-z 0-9 -`; `id` is fixed at creation.

## Makers ("Meet the maker", role ≥ curator)
| Method | Path | Notes |
|---|---|---|
| GET | `/api/admin/artisans` | `Artisan[]` (this site's) |
| PUT | `/api/admin/artisans/:id` | full profile → saved `Artisan` (create or replace). URLs must be http(s). An id the other site's maker uses → **409**. |
| DELETE | `/api/admin/artisans/:id` | `{ ok: true }` |
| GET | `/api/admin/artisans/:id/usage` | `{ usage: [{ exhibitionId, collection, id, title }] }` — the items of this site's exhibitions whose `artisanId` names the maker (show it before deleting) |

`Artisan = { id, name, cluster, craft, bio, portrait, contact, website, shopUrl, commissionUrl, verified, placeholder, sort }`. Artworks / exhibits link a profile with `artisanId`; the info panel shows a "Meet the maker" card with *Visit the maker* / *Commission* / *Buy (fair trade)* buttons for the URLs present, and `/makers/<id>` is the accessible, server-rendered profile page. The seed profiles are empty stand-ins (`placeholder: true`); visitors never see a stand-in profile (no card, no link, `/makers/<id>` is a 404 except for curators). Never enter details that the workshop has not supplied.

## Media (role ≥ curator)
| Method | Path | Notes |
|---|---|---|
| GET | `/api/admin/media/config` | `{ driver: 'local' | 's3', directUpload: boolean, maxBytes, folders, extensions }` — which upload flow to use |
| POST | `/api/admin/media` | `multipart/form-data`, field `file` (+ optional `folder`: artworks, models, videos, audio, textures — send it **before** `file`, or as `?folder=`). **201** → `MediaRecord`. Streams to storage. Use for local disk; on Vercel bodies are capped at ~4.5 MB, so use presign/complete. |
| POST | `/api/admin/media/presign` | `{ filename, size, folder? }` → `{ uploadUrl, method: 'PUT', headers, expiresIn, key, publicUrl, mime }`. S3 driver only (**501** with local disk). The client then `PUT`s the file body to `uploadUrl` sending exactly `headers` (Content-Type, Cache-Control). |
| POST | `/api/admin/media/complete` | `{ key, filename }` after the PUT succeeded → verifies the object (HEAD, size ≤ 500 MB) → **201** `MediaRecord` |
| GET | `/api/admin/media` | this site's media records, newest first. Without `limit`: all of them, as an array (as before). With `?limit=` (1–200) and optionally `cursor`, `q` (file name contains, any case) and `kind` (`image` — incl. deep zoom — `model`, `video`, `audio`, `other`): `{ items: MediaRecord[], nextCursor: string \| null }`; pass `nextCursor` back as `cursor` for the next page (null = last page; an invalid cursor → 400). |
| GET | `/api/admin/media/:id/usage` | `{ usage: [{ exhibitionId, exhibitionTitle, collection, id, title, field }], artisans: [{ id, name }] }` — every item field (nested too, e.g. `gallery[2].src`) of this site's exhibitions and every maker portrait whose value contains the file's key, so local `/media/…` and S3 / CDN addresses both match |
| DELETE | `/api/admin/media/:id` | removes file + record |
| GET | `/media/<folder>/<file>` | local-disk files (`.data/media`) with Range/ETag support. In S3 mode it 308-redirects to the bucket/CDN URL. |

Uploads and deletes are recorded in the activity log.

`MediaRecord = { id, url, filename, folder, mime, size, createdAt }`. `url` is `/media/<folder>/<file>` for local disk and an **absolute** S3/CloudFront URL (`S3_PUBLIC_BASE_URL`) for S3 — store it as-is in content (`image`, `src`, `model`, …). The bucket CORS config (`infra/s3-cors.json`) allows GET/HEAD from any origin so WebGL textures/video load with `crossOrigin`.

Allowed types: images (jpg, png, webp), models (glb, gltf), video (mp4, webm), audio (mp3, ogg, wav, m4a). Max 500 MB.

### Deep Zoom pyramids (role ≥ curator) — `src/server/handlers/deepzoom.ts`
A DZI pyramid is many tiles under one prefix, so it has its own flow (used by admin → Capture tools → Deep zoom; guide: `docs/CONTENT_CAPTURE.md`).

| Method | Path | Notes |
|---|---|---|
| POST | `/api/admin/media/deepzoom` | `{ name, width, height, tileSize? (254), overlap? (1), format? ('jpg'\|'png'\|'webp') }` → **201** `{ set, base, tiles, maxLevel, directUpload, maxTileBytes }` (reserves a set id; ≤ 250 000 tiles) |
| POST | `/api/admin/media/deepzoom/tile?set=&path=image_files/<level>/<col>_<row>.<ext>` | raw tile body (≤ 8 MB), streamed to storage; retries overwrite → `{ ok, size }` |
| POST | `/api/admin/media/deepzoom/presign` | S3 only: `{ set, paths: string[] (≤ 500) }` → `{ uploads: [{ path, uploadUrl, method: 'PUT', headers }] }` |
| POST | `/api/admin/media/deepzoom/complete` | `{ set, filename, width, height, tileSize, overlap, format, bytes }` → checks the corner tiles, **writes `image.dzi` server-side**, records one media row (`folder: 'deepzoom'`, `mime: application/xml`) → **201** `MediaRecord` whose `url` is the `.dzi` (store it in an artwork's `deepZoom`) |

Keys: `deepzoom/<set>/image.dzi` + `deepzoom/<set>/image_files/<level>/<col>_<row>.<ext>`. `DELETE /api/admin/media/:id` on a `deepzoom` record removes the whole pyramid (local: the directory; S3: every tile key derived from the descriptor, no ListBucket needed). `GET /api/admin/media/config` reports `deepZoom: true`.

## Dashboard & activity log (role ≥ curator)
| Method | Path | Notes |
|---|---|---|
| GET | `/api/admin/overview[?exhibition=]` | `{ role, site, counts: { pendingPrints, comments7d, hiddenComments, openErrors, errors24h, users, placeholders, items }, exhibition: { id, title, status }, recent: AuditEntry[] }`. `openErrors`, `errors24h` and `users` are **null below admin**; `placeholders` / `items` count the items of the exhibition (`?exhibition=`, default the site's default) and how many are still `placeholder: true`; `recent` = the latest 12 activity entries the caller may read (below). |
| GET | `/api/admin/activity?limit=50&before=&target=&exhibition=` | `{ entries: AuditEntry[], nextBefore: number \| null }`, newest first. `limit` 1–200; `before` = the previous page's `nextBefore`; `target` = `<kind>:<id>` (one thing's history, e.g. `artworks:hero-01`, `exhibition:textile-traditions`, `print:<uuid>`) or `<kind>` alone; `exhibition` = id or slug. |

`AuditEntry = { id, at, actorEmail: string | null, actorRole: string | null, action, targetKind, targetId, exhibitionId: string | null, summary }`.
Every admin change writes one, inside the change's own transaction where it has one: `content.create | update | delete |
restore | reset | exhibitionText | welcome | tour`, `exhibition.create | duplicate | update | default | delete`,
`artisan.create | update | delete`, `media.upload | delete`, `prints.status | delete | bulk`, `comments.hide | unhide |
delete | bulk`, `errors.resolve | reopen | delete | bulk`, `users.role`, `access.put | update | delete`,
`analytics.retention | cleanup` (a scheduled cleanup has no actor). Content items use the collection as `targetKind`
and the item id as `targetId`. `summary` is one plain sentence (“Saved artwork “Ajrakh yardage””). Entries are per site,
except changes to what both sites share (`users.role`, `access.*`): those are kept once, under site `'shared'`, and
listed by both sites.

Each reader sees only the entries about areas their role can open: **curators** the changes to content, exhibitions,
makers, media and prints (`targetKind` one of the collections, `exhibition`, `artisan`, `media`, `print`);
**admins** everything except the access list; **master admins** everything. A `target` filter outside that returns no
entries. Comment moderation entries never quote the comment: they keep its length and a SHA-256 of its text, so the
words are gone from the database once the comment is deleted.

## Auth
| Method | Path | Body → Response |
|---|---|---|
| POST | `/api/auth/register` | `{ email, password (≥ 8), displayName (≤ 60) }` → **201** `User`; 409 if the email exists |
| POST | `/api/auth/login` | `{ email, password }` → `User`; 401 on bad credentials; 429 after 10 tries/min/IP |
| POST | `/api/auth/logout` | → `{ ok: true }` |
| GET | `/api/auth/me` | → `User` or `401` |
| GET | `/api/auth/session` | → `{ user: User \| null }` (always 200; used by the museum UI) |
| GET | `/api/auth/providers` | → `{ google: string \| null }` — the public Google OAuth client id, or null when `GOOGLE_CLIENT_ID` is unset (hide the button) |
| POST | `/api/auth/google` | `{ credential }` = the ID token (JWT) from Google Identity Services → `User` + session cookie. Verified with Google's JWKS (`jose`): RS256 signature, `iss` accounts.google.com, `aud` = `GOOGLE_CLIENT_ID`, `exp`/`iat`, `email_verified`. Finds the user by Google `sub`, else links the account with the same email, else creates a passwordless account. **503** when Google sign-in is not configured, **401** invalid/expired token, **403** unverified Google email, **409** email linked to another Google account, **429** 20/min/IP. |

`User = { id, email, displayName, role, createdAt }`. Passwords: scrypt. First admin from env `ADMIN_EMAIL` / `ADMIN_PASSWORD` (dev default `admin@museum.local` / `admin12345`, never created when `NODE_ENV=production`); that account is trusted (verified) and becomes `master` when it is also a master email. Every sign-in updates `lastLoginAt` and re-evaluates the role. `id` is a UUID string; `createdAt` ISO-8601.

## Favourites (logged in)
| Method | Path | Response |
|---|---|---|
| GET | `/api/me/favorites` | `{ itemKind, itemId, createdAt }[]` |
| PUT | `/api/me/favorites/:itemKind/:itemId` | `{ ok: true }` |
| DELETE | `/api/me/favorites/:itemKind/:itemId` | `{ ok: true }` |

`itemKind` ∈ artwork, exhibit, infographic, video, object. Favourites are kept per site (item ids of the two museums may coincide).

## Guestbook & comments
| Method | Path | Notes |
|---|---|---|
| GET | `/api/comments?itemKind=&itemId=` | approved comments for an item; omit both for the museum guestbook (guestbook entries have `itemKind: null, itemId: null`). `{ id, itemKind, itemId, body, displayName, createdAt }[]` newest first (max 200) |
| POST | `/api/comments` | logged in; `{ itemKind?, itemId?, body }` (1–1000 chars) → **201** comment. Rate-limited (5/min/user → 429). |
| GET | `/api/admin/comments` | admin; all incl. hidden: comment + `{ hidden, userId, userEmail }` (curators: 403) |
| PATCH | `/api/admin/comments/:id` | admin; `{ hidden: boolean }` |
| DELETE | `/api/admin/comments/:id` | admin |
| POST | `/api/admin/comments/bulk` | admin; `{ ids: string[] (1–200), action: 'hide' \| 'unhide' \| 'delete' }` → `{ updated }` (ids of the other site are ignored) |

## Visitor prints ("Print it yourself" → Visitors' Wall)
| Method | Path | Notes |
|---|---|---|
| POST | `/api/prints` | public (anonymous allowed); JSON `{ image: 'data:image/png;base64,…', sessionId, displayName?, motif?, meta?: { blocks[], dyes[], ground, stamps } }`. PNG only (signature + IHDR checked), ≤ **2 MB**, 64–2400 px a side; `sessionId` = the museum's random analytics session id (required). Stored via the storage driver as `prints/<uuid>.png`; signed-in visitors are linked by `userId`. → **201** `{ id, status: 'pending', createdAt }`. Rate-limited 3 / 10 min / session and 10 / 10 min / IP (429); 429 with ≥ 6 of the session's prints pending; 503 while ≥ 400 prints await review. |
| GET | `/api/prints?status=approved&limit=24` | public; the latest approved prints (max 24) → `PublicPrint[]` (`{ id, url, displayName, motif, meta, width, height, createdAt }`). Any other `status` → 403. Cached 30 s. |
| GET | `/api/admin/prints?status=pending|approved|rejected|all` | curator+; moderation queue (max 1000, newest first): `PublicPrint` + `{ status, size, sessionId, userId, reviewedAt, reviewedBy }` |
| PATCH | `/api/admin/prints/:id` | curator+; `{ status: 'approved' | 'rejected' | 'pending' }` → the admin print |
| DELETE | `/api/admin/prints/:id` | curator+; removes the stored image and the row |
| POST | `/api/admin/prints/bulk` | curator+; `{ ids: string[] (1–200), action: 'approve' \| 'reject' \| 'pending' \| 'delete' }` → `{ updated }` (ids of the other site are ignored; delete also removes the images) |

Every moderation change (single or bulk) is recorded in the activity log.

## Analytics
| Method | Path | Notes |
|---|---|---|
| POST | `/api/analytics/events` | public, batched: `{ sessionId, batchId, events: AnalyticsEvent[] }` (max 200/batch). `navigator.sendBeacon` compatible (text/plain JSON accepted). → **202** `{ ok: true, accepted, duplicate: false }` (unknown event types are skipped). `batchId` (8–64 of `A–Z a–z 0–9 _ -`, made by the client) stays the same on every attempt to send a batch: each `(sessionId, batchId)` is stored once, so a batch sent again after a lost reply stores nothing and answers **202** `{ ok: true, accepted: 0, duplicate: true }`. A batch without `batchId` (older clients) is stored without that check; a malformed one is a 400. |
| GET | `/api/admin/analytics/summary?days=7` | admin → `{ days, sessions, avgSessionSec, zoneDwell: {zone, seconds}[], topItems: {itemKind, itemId, views, dwellSec}[], quality: {tier, count}[], daily: {date, sessions}[] }` (`days` 1–365; `daily` has one entry per UTC day, zero-filled) |

`AnalyticsEvent = { t: number (epoch ms), type: 'session_start' | 'zone_enter' | 'zone_dwell' | 'item_view' | 'item_dwell' | 'panel_open' | 'inspect_open' | 'video_play' | 'tour_start' | 'tour_complete' | 'tour_step' | 'pos', zone?, itemKind?, itemId?, seconds?, tier?, meta?, x?, z? }`. The batch body may carry `exhibition` (slug; default when absent/unknown).
`tour_step`: `itemId` = stop id, `meta.index` = stop index. `pos` (sampled every 2 s by the tracker, `x`/`z` in metres): **never stored raw** — aggregated on insert into `analytics_heat` (0.5 m cells per exhibition / UTC day / zone).
No personal data is stored for anonymous visitors (random session id only).

Curator analytics (role ≥ admin; all take `exhibition` (id|slug, default when absent), `from` / `to` (YYYY-MM-DD, UTC, default the last 30 days, max 400 days)):

| Method | Path | Notes |
|---|---|---|
| GET | `/api/admin/analytics/summary?days=7&exhibition=` | (above) + optional exhibition filter (omitted = all of this site's exhibitions) |
| GET | `/api/admin/analytics/heatmap?zone=` | `{ cellSize: 0.5, sampleSec: 2, cells: [cx, cz, samples][], totalSamples, maxSamples, zones: { zone, samples, seconds }[] }` — cell covers x ∈ [cx·0.5, cx·0.5+0.5) |
| GET | `/api/admin/analytics/curator?kind=` | `{ funnel: { starts, completes, steps: { stopId, index, sessions }[] }, attention: { itemKind, itemId, views, viewers, dwellSec, avgDwellSec }[] }` |
| GET | `/api/admin/analytics/export?dataset=heatmap\|zones\|attention\|funnel` | `text/csv` download (UTF-8 BOM; formula-injection safe) |
| GET / PUT | `/api/admin/analytics/retention` | `{ days, defaultDays: 180, lastCleanup }` / PUT `{ days: 7–1825 }` — per site |
| POST | `/api/admin/analytics/cleanup` | deletes **this site's** events / heatmap rows older than its retention (the other site follows its own), and batch markers (`analytics_batches`) older than 31 days → `{ retentionDays, cutoff, deletedEvents, deletedHeatRows, deletedBatchMarkers, ranAt }`. Admin session, **or** `Authorization: Bearer $CRON_SECRET` (GET accepted too, for a Vercel Cron Job). Also runs automatically at most once a day from event ingestion. |

## Errors / monitoring
Built-in client error reporting (no SDK). The browser side (`src/museum/utils/errorReporter.ts`, installed by `app/MuseumClient.tsx`)
reports `window` errors, unhandled promise rejections, errors contained by `ErrorBoundary` and unrecovered WebGL context loss.
It samples (`NEXT_PUBLIC_ERROR_SAMPLE_RATE`, 0–1, default 1), dedupes (same kind+message at most once per 30 s), sends at most
20 reports per page load, and scrubs PII (query strings/hashes, emails, UUIDs, JWTs and ≥ 32-char tokens) before sending.

| Method | Path | Notes |
|---|---|---|
| POST | `/api/errors` | public, cross-origin allowed, `sendBeacon` compatible (text/plain JSON), body ≤ 16 KB, **429** above 30/min/IP. `{ kind: 'error' \| 'unhandledrejection' \| 'react' \| 'webgl' \| 'manual', message, stack?, url?, ua?, tier?, gpu?, release? }` → **202** `{ ok: true, fingerprint }`. Fields are truncated (message 500, stack 4000, url path 300 — query dropped, ua 300, gpu 200) and re-scrubbed server-side; **no IP or user id is stored**. Server sampling guard: `ERROR_SAMPLE_RATE` (default 1). |
| GET | `/api/admin/errors?status=open\|resolved\|all` | admin → `{ groups: ErrorGroup[], open, resolved }` (by `lastSeen` desc, max 500) |
| GET | `/api/admin/errors/:fingerprint` | admin → `{ group: ErrorGroup, occurrences: { id, url, ua, tier, gpu, release, stack, createdAt }[] }` (last 20) |
| PATCH | `/api/admin/errors/:fingerprint` | admin, `{ resolved: boolean }` → `{ ok: true }` |
| DELETE | `/api/admin/errors/:fingerprint` | admin; removes the group and its occurrences |
| POST | `/api/admin/errors/bulk` | admin; `{ fingerprints: string[] (1–200), action: 'resolve' \| 'reopen' \| 'delete' }` → `{ updated }` |

`ErrorGroup = { fingerprint, kind, message, count, last24h, firstSeen, lastSeen, resolvedAt: string | null, lastStack, lastUrl, lastUa, lastTier, lastGpu, lastRelease }`.
The fingerprint is `sha1(kind + message with digits normalised + first stack frame without query/line)`, with the site
in front for every site but hand-block (whose fingerprints stay as they were before sites existed) — so the same error in
both museums is two groups, each listed only by its own app. A resolved group that
receives a new report is **reopened** (regression). Tables: `client_error_groups` (one row per fingerprint) and `client_errors`
(raw occurrences, kept 30 days / last 50 per group) — `supabase/migrations/20260923040000_client_errors.sql`, SQLite migration #4.
Admin UI: **/admin#/errors** (admin+).

**Sentry (optional, no SDK):** set `NEXT_PUBLIC_SENTRY_DSN` (e.g. `https://<key>@o123.ingest.sentry.io/456`, build-time public var)
and every report is *also* POSTed from the browser to Sentry's envelope endpoint
`https://<host>/api/<projectId>/envelope/?sentry_key=<key>&sentry_version=7` (text/plain, `mode: no-cors`) as an `event`
item with `exception` + parsed stack frames, `request.url` (path only), tags `kind`/`tier`/`gpu`, `environment`
(`NEXT_PUBLIC_VERCEL_ENV`) and `release` (`NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA`). The built-in pipeline keeps working alongside it.
Sentry's own inbound filters / rate limits apply; add the site origin to the project's *Allowed Domains*.

## Users (role ≥ admin)
| Method | Path | Notes |
|---|---|---|
| GET | `/api/admin/users?q=` | staff first, then by last sign-in (max 1000): `AdminUser[]` |
| PATCH | `/api/admin/users/:id` | `{ role: 'visitor' \| 'curator' \| 'admin' }` sets the **manual** role → `AdminUser`. Effective role = max(manual, access list), so demoting below an access-list role requires editing the access list. 400 for your own account, 403 for the master admin. |

`AdminUser = { id, email, displayName, role, manualRole: ManualRole | null, accessRole: 'curator' | 'admin' | null, emailVerified, google: boolean, hasPassword: boolean, isMaster, createdAt, lastLoginAt: string | null }`

Users and the access list are shared by both sites; role and access-list changes are recorded once in the activity log,
as shared entries that both sites' admins see (access-list entries: master admins only).

## Access list (role = master)
Allowlist of emails / whole domains that receive an elevated role on sign-in; everyone else is a visitor.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/admin/access` | → `{ masters: string[], entries: AccessEntry[] }` — `masters` from `MASTER_ADMIN_EMAILS` (mirrored into the table as read-only `role: 'master'` rows at start-up; not part of `entries`) |
| POST | `/api/admin/access` | `{ pattern, role: 'curator' \| 'admin', note? }` — create or update (upsert) → **201** `AccessEntry`. `pattern` = `person@example.org` or `@example.org` (the whole domain, not sub-domains), stored lower-case. Master emails cannot be listed (they are managed by `MASTER_ADMIN_EMAILS`). |
| PATCH | `/api/admin/access/:pattern` | `{ role?, note? }` (URL-encode the pattern) → `AccessEntry` |
| DELETE | `/api/admin/access/:pattern` | → `{ ok: true }`; affected users fall back to their manual role / visitor |

`AccessEntry = { pattern, kind: 'email' | 'domain', role, note, createdBy, createdAt, updatedAt, users: number /* existing accounts it applies to */ }`.
Every change immediately re-evaluates the role of the matching accounts.


## Live guided tours & presence
Realtime transport is **Supabase Realtime** (public broadcast + presence channel `live:<room>`, room = `NEXT_PUBLIC_LIVE_ROOM`,
default the site's own `SITE.liveRoom` — `hand-block-printing` here, `clay-pavilion` in the clay app; no tables, no service key). Without `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
with `?static` / `?nolive`, or when the channel can't subscribe within ~15 s, every live feature hides itself.
Client: `src/museum/live/*`.

| Method | Path | Notes |
|---|---|---|
| POST | `/api/live/token` | **curator+** (session role, checked server-side). `{ room, pub }` — `pub` = the docent tab's ECDSA P-256 public key (raw uncompressed point, base64url, 65 bytes) → `{ token, claims }`. `token = base64url(claims) + "." + base64url(HMAC-SHA256(LIVE_TOKEN_SECRET))`, `claims = { v: 1, sub, name, role, room, pub, iat, exp }` (30 min; the docent refreshes with a new key pair before expiry). `room` must be this site's room (400 otherwise). 20/min/user; **503** when `LIVE_TOKEN_SECRET` (≥ 32 chars) is unset. |
| GET | `/api/live/verify?token=` | public → `{ ok: true, claims }` or `{ ok: false }` (bad MAC, expired, malformed). 240/min/IP. |

**Why this design (and not client roles or RLS broadcast):** anyone holding the public anon key can publish on a public
channel, so a docent message proves nothing by itself. The docent's private key is generated non-extractable in the tab and
never leaves it; the server binds its public key to the verified user in the HMAC token; followers verify the token through
`/api/live/verify` (the secret stays server-side) and then verify **every** docent envelope (`announce`, `at` position, `focus`
pointer, `mute`, `lower` hand, docent `chat`, `end`) with ECDSA against that key, with a strictly increasing `seq` (replay
protection) and the token's expiry. A copied token is useless without the key; a tour id can't be hijacked by another user
(`sub` must match). Visitor positions / chat are unauthenticated by nature (anonymous names), filtered and rate-limited on
the sender *and* every receiver (1.5 s min interval, 5 per 20 s sent; 8 per 20 s accepted per sender; 240 chars; profanity
mask). Supabase RLS-authorised private channels would need Supabase Auth sessions for every visitor, which this app does not use.

Channel protocol: presence meta `{ name, hand, joined, docent }` (key = per-tab id); broadcast `p` `{ id, x, z, y, t }` at 5 Hz while
moving (keep-alive every 4 s); `chat` `{ tour, mid, from, name, text, t }`; `d` = signed docent envelope `{ tour, from, seq, t, k, d, s }`
(`s` = ECDSA-SHA256 over `tour|seq|t|k|d`).
