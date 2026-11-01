/**
 * npm run db:migrate
 *  - DATABASE_URL set   → applies supabase/migrations/*.sql to Postgres (idempotent; tracked in
 *                         _museum_migrations), then seeds content + admin when the DB is empty.
 *  - DATABASE_URL unset → creates/migrates the local SQLite database (.data/museum.sqlite).
 *  - DIRECT_DATABASE_URL (or REMOTE_DIRECT_DATABASE_URL with USE_REMOTE=1) wins when set: use the
 *    Supabase session pooler / direct connection for DDL instead of the transaction pooler.
 *  - USE_REMOTE=1        → the REMOTE_* settings from .env.local (see src/server/config.ts).
 *  - --schema-only       → only apply migrations (no content/admin seeding, no role re-sync) — used by
 *                          CI, which has no ADMIN_* / MASTER_ADMIN_EMAILS (the app seeds on its first request).
 *  - The migration runner refuses to start when an applied migration's file has changed (sha256), and warns
 *    when the database has migrations this build lacks — the clay pavilion app shares the database and its
 *    supabase/migrations must stay byte-identical to this repo's (README → "Two apps, one database").
 *  - Seeding (without --schema-only) only ever touches this build's site (src/site.ts).
 * Reads .env / .env.local like Next.js does (real environment variables win).
 * Run with the react-server condition so `server-only` imports resolve outside Next.
 */
import fs from 'node:fs'

for (const f of ['.env.local', '.env']) if (fs.existsSync(f)) process.loadEnvFile(f)

const env = process.env
const remote = env.USE_REMOTE === '1' || env.USE_REMOTE === 'true'
const direct = env.DIRECT_DATABASE_URL || (remote ? env.REMOTE_DIRECT_DATABASE_URL : undefined)
if (direct) {
  env.DATABASE_URL = direct
  if (remote) env.REMOTE_DATABASE_URL = direct
}

const { getDb, migratePostgres } = await import('../src/server/db')
const { services } = await import('../src/server/services')
const { SITE } = await import('../src/site')

const schemaOnly = process.argv.includes('--schema-only')
const db = getDb()
await migratePostgres(db) // explicit (bootstrap skips it on Vercel)
if (!schemaOnly) await services() // seed content + admin if needed, re-sync staff roles
const row = await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM content_items ci JOIN exhibitions e ON e.id = ci.exhibition_id WHERE e.site = $1', [SITE.id])
const staff = await db.one<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE role <> 'visitor'")
console.log(`[db:migrate] ${db.dialect} ready (site ${SITE.id}): ${Number(row?.n ?? 0)} content items, ${Number(staff?.n ?? 0)} staff account(s)`)
await db.close()
