# Museum Backend API (v1)

Base: same origin. Implemented as Next.js Route Handlers (`app/api/**/route.ts`, logic in `src/server/**`); `next dev` serves the API and the app on one port.
All bodies are JSON unless noted. Errors: `{ "error": string }` with a 4xx/5xx status.
Auth: HTTP-only cookie `museum_session` (set by login/register/Google; SameSite=Lax, Secure in production, 30 days). `role` is `'visitor' | 'curator' | 'admin' | 'master'` (see **Roles**).
Admin routes answer **401** when signed out and **403** `{ error: "<Role> role required" }` when the role is too low.
CSRF: state-changing requests (POST/PUT/PATCH/DELETE) carrying an `Origin` header that is not the API's own host (or listed in `ALLOWED_ORIGINS`) are rejected with 403 (except `/api/analytics/events`). Unknown `/api/*` paths return a JSON 404.

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
| GET | `/api/content` | `MuseumContent` (see `src/museum/content/types.ts`) |
| GET | `/api/health` | `{ ok: true, version: string, contentVersion: number, db: 'postgres' | 'sqlite' }` |

## Content admin (role ≥ curator)
| Method | Path | Body / Response |
|---|---|---|
| GET | `/api/admin/content/:collection` | list of items (`collection` ∈ artworks, exhibits, infographics, videos, objects) |
| PUT | `/api/admin/content/:collection/:id` | full item → saved item (create or replace) |
| DELETE | `/api/admin/content/:collection/:id` | `{ ok: true }` |
| PUT | `/api/admin/content/exhibition` | `ExhibitionText` |
| PUT | `/api/admin/content/welcome` | `{ title, body }` |
| POST | `/api/admin/content/reset` | **admin**; re-seed from bundled config → `{ ok: true }` |

Every content write increments `MuseumContent.version`.

## Media (role ≥ curator)
| Method | Path | Notes |
|---|---|---|
| GET | `/api/admin/media/config` | `{ driver: 'local' | 's3', directUpload: boolean, maxBytes, folders, extensions }` — which upload flow to use |
| POST | `/api/admin/media` | `multipart/form-data`, field `file` (+ optional `folder`: artworks, models, videos, audio, textures — send it **before** `file`, or as `?folder=`). **201** → `MediaRecord`. Streams to storage. Use for local disk; on Vercel bodies are capped at ~4.5 MB, so use presign/complete. |
| POST | `/api/admin/media/presign` | `{ filename, size, folder? }` → `{ uploadUrl, method: 'PUT', headers, expiresIn, key, publicUrl, mime }`. S3 driver only (**501** with local disk). The client then `PUT`s the file body to `uploadUrl` sending exactly `headers` (Content-Type, Cache-Control). |
| POST | `/api/admin/media/complete` | `{ key, filename }` after the PUT succeeded → verifies the object (HEAD, size ≤ 500 MB) → **201** `MediaRecord` |
| GET | `/api/admin/media` | list of media records |
| DELETE | `/api/admin/media/:id` | removes file + record |
| GET | `/media/<folder>/<file>` | local-disk files (`.data/media`) with Range/ETag support. In S3 mode it 308-redirects to the bucket/CDN URL. |

`MediaRecord = { id, url, filename, folder, mime, size, createdAt }`. `url` is `/media/<folder>/<file>` for local disk and an **absolute** S3/CloudFront URL (`S3_PUBLIC_BASE_URL`) for S3 — store it as-is in content (`image`, `src`, `model`, …). The bucket CORS config (`infra/s3-cors.json`) allows GET/HEAD from any origin so WebGL textures/video load with `crossOrigin`.

Allowed types: images (jpg, png, webp), models (glb, gltf), video (mp4, webm), audio (mp3, ogg, wav, m4a). Max 500 MB.

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

`itemKind` ∈ artwork, exhibit, infographic, video, object.

## Guestbook & comments
| Method | Path | Notes |
|---|---|---|
| GET | `/api/comments?itemKind=&itemId=` | approved comments for an item; omit both for the museum guestbook (guestbook entries have `itemKind: null, itemId: null`). `{ id, itemKind, itemId, body, displayName, createdAt }[]` newest first (max 200) |
| POST | `/api/comments` | logged in; `{ itemKind?, itemId?, body }` (1–1000 chars) → **201** comment. Rate-limited (5/min/user → 429). |
| GET | `/api/admin/comments` | admin; all incl. hidden: comment + `{ hidden, userId, userEmail }` (curators: 403) |
| PATCH | `/api/admin/comments/:id` | admin; `{ hidden: boolean }` |
| DELETE | `/api/admin/comments/:id` | admin |

## Analytics
| Method | Path | Notes |
|---|---|---|
| POST | `/api/analytics/events` | public, batched: `{ sessionId, events: AnalyticsEvent[] }` (max 200/batch). `navigator.sendBeacon` compatible (text/plain JSON accepted). → **202** `{ ok: true, accepted }` (unknown event types are skipped). |
| GET | `/api/admin/analytics/summary?days=7` | admin → `{ days, sessions, avgSessionSec, zoneDwell: {zone, seconds}[], topItems: {itemKind, itemId, views, dwellSec}[], quality: {tier, count}[], daily: {date, sessions}[] }` (`days` 1–365; `daily` has one entry per UTC day, zero-filled) |

`AnalyticsEvent = { t: number (epoch ms), type: 'session_start' | 'zone_enter' | 'zone_dwell' | 'item_view' | 'item_dwell' | 'panel_open' | 'inspect_open' | 'video_play' | 'tour_start' | 'tour_complete', zone?, itemKind?, itemId?, seconds?, tier?, meta? }`.
No personal data is stored for anonymous visitors (random session id only).

## Users (role ≥ admin)
| Method | Path | Notes |
|---|---|---|
| GET | `/api/admin/users?q=` | staff first, then by last sign-in (max 1000): `AdminUser[]` |
| PATCH | `/api/admin/users/:id` | `{ role: 'visitor' \| 'curator' \| 'admin' }` sets the **manual** role → `AdminUser`. Effective role = max(manual, access list), so demoting below an access-list role requires editing the access list. 400 for your own account, 403 for the master admin. |

`AdminUser = { id, email, displayName, role, manualRole: ManualRole | null, accessRole: 'curator' | 'admin' | null, emailVerified, google: boolean, hasPassword: boolean, isMaster, createdAt, lastLoginAt: string | null }`

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

