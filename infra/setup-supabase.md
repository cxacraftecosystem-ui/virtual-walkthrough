# Supabase (Postgres) setup

The API needs one Postgres database. Supabase is only used as managed Postgres (no Supabase Auth,
no PostgREST access — Row Level Security is enabled with **no policies** on every table, so the
public `anon`/`authenticated` keys cannot read anything; the server connects as the database owner).

> Nothing here has been run. Every command below creates or changes cloud resources — review first.

## 1. Pick or create a project

```bash
supabase projects list                       # existing projects (read-only)
# new project (choose the region closest to your Vercel region, e.g. ap-south-1 = Mumbai):
supabase projects create hand-block-museum --org-id <org-id> --region ap-south-1 --db-password '<strong-password>'
```

## 2. Apply the schema

Migrations live in `supabase/migrations/*.sql` (plain, idempotent SQL). Either:

```bash
# a) Supabase CLI
supabase link --project-ref <project-ref>
supabase db push

# b) or the app's own migrator (also seeds content + the admin account)
DATABASE_URL='postgres://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres' \
ADMIN_EMAIL=you@example.org ADMIN_PASSWORD='<strong-password>' \
npm run db:migrate
```

Running both is harmless (`create table if not exists …`; the app records applied files in
`_museum_migrations`). Content is seeded from the bundled config on the first API request if
the database is empty, and the admin account from `ADMIN_EMAIL`/`ADMIN_PASSWORD`.

## 3. Connection string for the app

Supabase dashboard → **Connect** → **Transaction pooler** (port **6543**) — use this for Vercel
(serverless functions open many short-lived connections). Put it in `DATABASE_URL`.
SSL is on by default (`DATABASE_SSL=require`); set `DATABASE_SSL=verify-full` if you install the
Supabase CA certificate.

## Optional: Supabase Storage instead of S3

Supabase Storage speaks the S3 protocol, so the same `S3Storage` driver works:

1. Storage → create a **public** bucket, e.g. `media`.
2. Storage → S3 Connection → create access keys.
3. Env:
   ```
   S3_BUCKET=media
   S3_ENDPOINT=https://<project-ref>.supabase.co/storage/v1/s3
   AWS_REGION=<project region, e.g. ap-south-1>
   AWS_ACCESS_KEY_ID=<key id>   AWS_SECRET_ACCESS_KEY=<secret>
   S3_PUBLIC_BASE_URL=https://<project-ref>.supabase.co/storage/v1/object/public/media
   ```
Presigned PUT uploads and HTTP Range requests are supported by Supabase Storage.
