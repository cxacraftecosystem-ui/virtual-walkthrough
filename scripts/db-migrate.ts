/**
 * npm run db:migrate
 *  - DATABASE_URL set   → applies supabase/migrations/*.sql to Postgres (idempotent; tracked in
 *                         _museum_migrations), then seeds content + admin when the DB is empty.
 *  - DATABASE_URL unset → creates/migrates the local SQLite database (.data/museum.sqlite).
 * Reads .env / .env.local like Next.js does (real environment variables win).
 * Run with the react-server condition so `server-only` imports resolve outside Next.
 */
import fs from 'node:fs'

for (const f of ['.env.local', '.env']) if (fs.existsSync(f)) process.loadEnvFile(f)

const { getDb, migratePostgres } = await import('../src/server/db')
const { services } = await import('../src/server/services')

const db = getDb()
await migratePostgres(db) // explicit (bootstrap skips it on Vercel)
await services() // seed content + admin if needed
const row = await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM content_items')
console.log(`[db:migrate] ${db.dialect} ready: ${Number(row?.n ?? 0)} content items`)
await db.close()
