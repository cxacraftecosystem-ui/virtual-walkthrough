# Deploying to Vercel

The app is a standard Next.js (App Router) project: the museum and `/admin` are pages, every
`/api/*` endpoint and `/media/*` are Route Handlers running as Vercel Node.js functions.
No `vercel.json` is required (function limits are set per route with `export const maxDuration`).

> Nothing here has been run. `vercel link`, `vercel env add` and `vercel deploy` change cloud state — confirm first.

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
| `S3_BUCKET` | yes | `hbp-museum-media` |
| `AWS_REGION` | yes | `ap-south-1` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | yes | least-privilege IAM user from `setup-s3.sh` |
| `S3_PUBLIC_BASE_URL` | no | CloudFront / custom domain for media |
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
