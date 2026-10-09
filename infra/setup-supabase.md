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

The connection is encrypted **and the server is verified**. Supabase signs its server certificates with
its own root, *Supabase Root 2021 CA*, which is not in Node's trust store, so the app carries it
(`src/server/db/supabaseCa.ts`). Against a Supabase host (`*.supabase.com`, `*.supabase.co`) the
certificate must chain to that root and carry the host's name; the poolers present
`*.pooler.supabase.com`. This holds although the dashboard's connection strings say `sslmode=require`:
libpq also verifies a `require` connection once it has a root certificate. Migrations
(`npm run db:migrate`, CI's included) connect the same way. The rules, in `src/server/db/tls.ts`:

| Setting | Effect |
|---|---|
| `DATABASE_SSL` unset | Supabase host: verified. localhost: no TLS. Any other host: verified when `DATABASE_CA_CERT` is set, otherwise encrypted only |
| `DATABASE_SSL=require` | encrypted, certificate **not** verified: the way out if verification ever fails |
| `DATABASE_SSL=verify-full` | verified on any host; elsewhere than Supabase, without `DATABASE_CA_CERT`, against Node's public roots |
| `DATABASE_SSL=disable` | no TLS |
| `sslmode` in the URL | `disable`: no TLS; `verify-full` or `verify-ca`: verified, host name included; any other value turns TLS on for localhost and changes nothing elsewhere. `DATABASE_SSL` wins over it |

`DATABASE_CA_CERT` (PEM text; one or more certificates; on one line with `\n` for line breaks is fine)
is trusted next to the bundled root. When Supabase announces a new root, put it there and the switch
needs no release; then replace the bundled one as the comment in `supabaseCa.ts` describes. A unit test
fails six months before the current root expires on 26 April 2031, as a reminder.

To see it against the real database (read-only: each connection runs `SELECT 1`, nothing else):

```bash
USE_REMOTE=1 npm run db:tls-check    # the REMOTE_* URLs from .env.local; without USE_REMOTE, DATABASE_URL
```

It connects to both poolers with the app's settings (certificate verified) and with
`DATABASE_SSL=require` (encrypted, not verified), and shows that verification refuses a root that did
not sign the chain and the right root under a name the certificate does not carry: the pooler's load
balancer name and its IP address, both of which `DATABASE_SSL=require` still reaches.

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
