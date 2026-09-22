/** Picks the database driver: Postgres when DATABASE_URL is set, otherwise local SQLite. */
import 'server-only'
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config'
import { PostgresDb } from './postgres'
import { SQLITE_SCHEMA_VERSION, SqliteDb } from './sqlite'
import type { Db } from './types'

export type { Db, Queryable, Param, Row } from './types'
export { nowIso, parseJson } from './types'

const g = globalThis as { __museumDb?: Db }

/** Process-wide singleton (survives Next dev hot reloads and warm serverless invocations). */
export function getDb(): Db {
  // Next dev keeps globalThis across hot reloads: a SQLite handle opened by older code (older
  // schema) is replaced so the new migrations run without restarting the dev server.
  const cur = g.__museumDb as (Db & { schemaVersion?: number }) | undefined
  if (cur && cur.dialect === 'sqlite' && cur.schemaVersion !== SQLITE_SCHEMA_VERSION) {
    void cur.close().catch(() => undefined)
    g.__museumDb = undefined
  }
  g.__museumDb ??= config.databaseUrl
    ? new PostgresDb({ connectionString: config.databaseUrl, ssl: config.databaseSsl, max: config.databasePoolMax })
    : new SqliteDb(config.dbPath) // migrates itself on open
  return g.__museumDb
}

export const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase/migrations')

/**
 * Apply supabase/migrations/*.sql not yet recorded in `_museum_migrations`.
 * The files are idempotent, so it is harmless if `supabase db push` already applied them.
 */
export async function migratePostgres(db: Db, log: (msg: string) => void = console.log): Promise<string[]> {
  if (db.dialect !== 'postgres') return []
  if (!fs.existsSync(MIGRATIONS_DIR)) return []
  await db.run(`create table if not exists _museum_migrations (name text primary key, applied_at timestamptz not null default now())`)
  await db.run('alter table _museum_migrations enable row level security')
  const done = new Set((await db.query<{ name: string }>('select name from _museum_migrations')).map((r) => r.name))
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  const applied: string[] = []
  for (const f of files) {
    if (done.has(f)) continue
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')
    await db.tx(async (q) => {
      await q.run(sql)
      await q.run('insert into _museum_migrations (name) values ($1) on conflict do nothing', [f])
    })
    log(`[db] applied migration ${f}`)
    applied.push(f)
  }
  return applied
}
