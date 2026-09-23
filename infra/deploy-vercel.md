# Deploying to Vercel

The app is a standard Next.js (App Router) project: the museum and `/admin` are pages, every
`/api/*` endpoint and `/media/*` are Route Handlers running as Vercel Node.js functions.
No `vercel.json` is required (function limits are set per route with `export const maxDuration`).

> `vercel link`, `vercel env add` and `vercel deploy` change cloud state — confirm first. The project
> `hand-block-museum` has been created and linked, and its env vars are set; CI deploys via
> `.github/workflows/deploy.yml` (prebuilt: `vercel pull` → `vercel build` → `vercel deploy --prebuilt`).
> A new CLI-created project defaults to framework "Other": `vercel.json` pins `framework: nextjs` and region `bom1`.

## Prerequisites

1. **Postgres** — see `infra/setup-supabase.md` (schema applied with `supabase db push` or `npm run db:migrate`).
2. **S3 bucket** — see `infra/setup-s3.sh` (CORS must allow `PUT` from your Vercel domain for admin uploads).
   Local-disk media does **not** work on Vercel (read-only, ephemeral filesystem); uploads return 501 without `S3_BUCKET`.

## Environment variables (Production + Preview)

| Variable | Required | Example / notes |
|---|---|---|
| `DATABASE_URL` | yes | Supabase *transaction pooler* URI (port 6543) |
| `ADMIN_EMAIL` | yes | first admin; created on first request |
| `ADMIN_PASSWORD` | yes | re-synced on cold start when both admin vars are set |
| `MASTER_ADMIN_EMAILS` | recommended | comma-separated master admins (manage the access list); fallback `MASTER_ADMIN_EMAIL`, then `ADMIN_EMAIL` |
| `GOOGLE_CLIENT_ID` | no | enables "Sign in with Google" (add the production origin to the OAuth client's *Authorised JavaScript origins*) |
| `GOOGLE_CLIENT_SECRET` | no | unused by the ID-token flow; kept for a future code flow |
| `S3_BUCKET` | yes | `hbp-museum-media` |
| `AWS_REGION` | yes | `ap-south-1` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | yes | least-privilege IAM user from `setup-s3.sh` |
| `S3_PUBLIC_BASE_URL` | recommended | `https://d3rtt6mxyznwx8.cloudfront.net`, the CloudFront CDN in front of the bucket (set for production, preview and development). Created by `infra/setup-cloudfront.sh`; see `infra/cloudfront.md` |
| `S3_ENDPOINT` | no | S3-compatible storage (Supabase Storage, R2) |
| `S3_PREFIX` | no | key prefix, e.g. `museum/` |
| `DATABASE_POOL_MAX` | no | default 2 on Vercel |
| `ALLOWED_ORIGINS` | no | extra origins allowed to POST/PUT (custom domains are same-origin already) |

`NODE_ENV=production` is set by Vercel, which turns on the `Secure` cookie flag.

## Commands

```bash
vercel whoami
vercel link                                   # once, creates .vercel/ (git-ignored)
vercel env add DATABASE_URL production        # repeat for each variable (and for "preview")
vercel deploy                                 # preview deployment
vercel deploy --prod                          # production
```

Build settings are auto-detected (framework **Next.js**, `npm run build`). Pick the function region
next to the database (Project → Settings → Functions → Region, e.g. `bom1` Mumbai for ap-south-1).

## After the first deploy

1. Open `https://<app>/api/health` → `{ ok: true, db: "postgres" }`.
2. Sign in at `https://<app>/admin` with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
3. Media → upload a file (goes straight to S3 through a presigned URL) → paste its URL into an artwork.

## Custom domain

There is no custom domain yet; the app is served from `*.vercel.app`. To add one, e.g. `museum.example.org`:

1. **Add the domain to the project**
   ```bash
   vercel domains add museum.example.org hand-block-museum   # or Project → Settings → Domains → Add
   vercel domains inspect museum.example.org                  # shows the DNS records Vercel expects
   ```
   DNS at your registrar:
   - subdomain: `CNAME museum → cname.vercel-dns.com`;
   - apex (`example.org`): `A @ → 76.76.21.21` (or move the nameservers to Vercel).

   Vercel issues the TLS certificate automatically once DNS resolves. In **Settings → Domains**, attach the domain
   to *Production* (the `main` branch) and optionally redirect `www` ↔ apex. Every production deployment is then
   served there. Preview deployments stay on `*.vercel.app`.
2. **Google sign-in.** In Google Cloud Console → APIs & Services → Credentials → the OAuth web client
   (`GOOGLE_CLIENT_ID`), add `https://museum.example.org` to **Authorised JavaScript origins**. The ID-token
   (Google Identity Services) flow uses no redirect URI. If a code flow is added later, also add
   `https://museum.example.org/api/auth/google/callback` (or whatever path it uses) to **Authorised redirect URIs**.
   Changes can take a few minutes to propagate.
3. **S3 CORS for admin uploads.** Presigned `PUT`s go straight from the browser to S3, so the new origin must be in
   the bucket CORS rules:
   ```bash
   BUCKET=hand-block-museum-media-626159998512 REGION=ap-south-1 CREATE_KEY=0 \
     APP_ORIGINS=https://museum.example.org,https://hand-block-museum.vercel.app,https://hand-block-museum-*.vercel.app \
     ./infra/setup-s3.sh
   ```
   GET/HEAD through CloudFront already allows any origin, so nothing needs changing there.
4. **`ALLOWED_ORIGINS`.** The API's CSRF check accepts same-origin requests, so a custom domain serving both app and API
   needs nothing. Set `ALLOWED_ORIGINS=https://other-site.example` only if **another** origin POSTs to this API.
5. **`NEXT_PUBLIC_SITE_URL=https://museum.example.org`** (production env). It is used as `metadataBase` in
   `app/layout.tsx`, which makes canonical and Open Graph/Twitter image URLs absolute. It falls back to
   `http://localhost:3000` when unset, so set it with the domain. It is a `NEXT_PUBLIC_` variable, inlined at build time, so it needs a rebuild.
6. **Optional media domain.** To serve media from e.g. `media.example.org` via CloudFront, follow the custom domain
   steps in `infra/cloudfront.md`: an ACM certificate in **us-east-1**, an alternate domain name on the distribution, and a DNS
   CNAME. Then set `S3_PUBLIC_BASE_URL=https://media.example.org`.
7. **Redeploy.** Env changes apply only to new deployments. Push to `main`, or run `vercel deploy --prod`. Then check
   `https://museum.example.org/api/health`, Google sign-in on `/admin`, and an admin upload.
