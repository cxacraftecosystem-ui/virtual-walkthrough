# Supabase (Postgres) setup

The API needs one Postgres database, and the museum's live features use Supabase **Realtime**.
Nothing else: no Supabase Auth, no Storage (media is in S3; the last section is an untaken
alternative), no PostgREST access — Row Level Security is enabled with
**no policies** on every table, so the public `anon`/`authenticated` keys cannot read anything; the
server connects as the database owner.

> The production project exists: `hand-block-museum`, ap-south-1 (README → Deploy). The commands
> below are for setting one up from scratch, and each creates or changes cloud resources — review first.

## What `@supabase/supabase-js` is used for

Only Realtime, and only in the browser. `src/museum/live/session.ts` creates the client from
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (with session persistence and token
refresh turned off) and joins one channel, `live:<room>`, for **presence** (who is in the museum) and
**broadcast** (visitor positions, tour chat, and the docent's signed messages). Presence and broadcast
need no table. There are no `.from()`, Storage or Auth calls, and server code never imports the
package: everything on the server goes through `pg` (`src/server/db/postgres.ts`). Without the two
variables, or with `?static` / `?nolive` in the address, the live features hide themselves
(`src/museum/live/config.ts`).

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

# b) or the app's own migrator (also seeds content + the admin account), over the SESSION pooler
DIRECT_DATABASE_URL='postgres://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres' \
ADMIN_EMAIL=you@example.org ADMIN_PASSWORD='<strong-password>' \
npm run db:migrate
```

Migrations go through the **session** pooler (port 5432), as CI's do (`.github/workflows/deploy.yml`):
DDL wants one continuous session, which the transaction pooler (6543) only lends per transaction.
`npm run db:migrate` prefers `DIRECT_DATABASE_URL` over `DATABASE_URL` whenever it is set
(`scripts/db-migrate.ts`). The direct host `db.<ref>.supabase.co` would do too from a machine with
IPv6, but without Supabase's IPv4 add-on it is IPv6-only, which Vercel and many networks cannot reach.

Running both is harmless (`create table if not exists …`; the app records applied files in
`_museum_migrations`). Content is seeded from the bundled config on the first API request if
the database is empty, and the admin account from `ADMIN_EMAIL`/`ADMIN_PASSWORD`.

## 3. Connection string for the app

Supabase dashboard → **Connect** → **Transaction pooler** (port **6543**) — use this for Vercel
(serverless functions open many short-lived connections). Put it in `DATABASE_URL`.
SSL is on by default (`DATABASE_SSL=require`): the connection is encrypted, but the server certificate
is not verified, because Supabase signs it with its own CA, which is not in Node's trust store.
`DATABASE_SSL=verify-full` turns verification on without supplying a CA — the app has no setting for
one — so against Supabase it fails every connection unless Node already trusts that CA (the
`NODE_EXTRA_CA_CERTS` file, read once at process start). Leave it at `require` until the pool can be
given the CA (Dashboard → Database Settings → SSL Configuration) directly.

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
