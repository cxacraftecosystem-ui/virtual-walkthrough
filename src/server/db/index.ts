/** Picks the database driver: Postgres when DATABASE_URL is set, otherwise local SQLite. */
import 'server-only'
import { createHash } from 'node:crypto'
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
  // Serverless file systems are ephemeral: a missing DATABASE_URL on Vercel would silently lose data.
  if (!config.databaseUrl && process.env.VERCEL && process.env.NEXT_PHASE !== 'phase-production-build') {
    throw new Error('DATABASE_URL is not set — refusing to use the SQLite fallback on Vercel')
  }
  g.__museumDb ??= config.databaseUrl
    ? new PostgresDb({ connectionString: config.databaseUrl, ssl: config.databaseSsl, caCert: config.databaseCaCert, max: config.databasePoolMax })
    : new SqliteDb(config.dbPath) // migrates itself on open
  return g.__museumDb
}

export const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase/migrations')

/** Transaction-scoped advisory lock serialising migration runners (both apps, every instance). The seed lock is 722601. */
export const MIGRATION_LOCK = 72_2602

/**
 * sha256 of a migration file. Line endings are normalised first, so a Windows checkout (CRLF) and CI (LF)
 * agree on the same file.
 */
export const migrationSha = (sql: string) => createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex')

export interface MigrationPlan {
  /** Files not recorded yet, in name order. */
  pending: string[]
  /** Recorded under the same name with a different sha256: never run, the runner refuses to start. */
  mismatched: { name: string; recorded: string; file: string }[]
  /** Recorded before hashes were kept: their hash is filled in from this build's file. */
  backfill: { name: string; sha256: string }[]
  /** Recorded in the database but missing from this build (the other app, or a newer deploy, applied them). */
  unknown: string[]
}

/** Compare this build's migration files with what `_museum_migrations` records. Pure, so it is unit-tested. */
export function planMigrations(files: { name: string; sha256: string }[], recorded: { name: string; sha256: string | null }[]): MigrationPlan {
  const done = new Map(recorded.map((r) => [r.name, r.sha256]))
  const names = new Set(files.map((f) => f.name))
  const plan: MigrationPlan = { pending: [], mismatched: [], backfill: [], unknown: [] }
  for (const f of [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (!done.has(f.name)) plan.pending.push(f.name)
    else if (done.get(f.name) == null) plan.backfill.push({ name: f.name, sha256: f.sha256 })
    else if (done.get(f.name) !== f.sha256) plan.mismatched.push({ name: f.name, recorded: done.get(f.name)!, file: f.sha256 })
  }
  plan.unknown = recorded.map((r) => r.name).filter((n) => !names.has(n)).sort()
  return plan
}

/** Throws when a recorded migration's file has changed; returns a warning (or null) for migrations this build lacks. */
export function checkMigrationPlan(plan: MigrationPlan): string | null {
  if (plan.mismatched.length) {
    const list = plan.mismatched.map((m) => `${m.name} (database ${m.recorded.slice(0, 12)}…, file ${m.file.slice(0, 12)}…)`).join(', ')
    throw new Error(
      `[db] refusing to start: migration file(s) changed after they were applied: ${list}. ` +
        'Both apps must ship byte-identical supabase/migrations; never edit an applied migration — add a new one.',
    )
  }
  if (!plan.unknown.length) return null
  return (
    `[db] WARNING: the database has migrations this build lacks: ${plan.unknown.join(', ')}. ` +
    'The other app (or a newer deploy) applied them; deploy this app with the same supabase/migrations soon — until then it runs against a schema it does not know.'
  )
}

function readMigrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8')
      return { name, sql, sha256: migrationSha(sql) }
    })
}

/**
 * Apply supabase/migrations/*.sql not yet recorded in `_museum_migrations`, which both apps share.
 *  - Each step runs in a transaction holding `pg_advisory_xact_lock(MIGRATION_LOCK)` and re-checks the ledger
 *    under it, so two runners (two apps, several instances) never apply the same file twice. A transaction
 *    lock, not a session lock: it also holds through a transaction-mode pooler (PgBouncer, Supavisor :6543),
 *    where a session lock could be taken on one server connection and released on another.
 *  - The sha256 of every applied file is recorded; a recorded file whose content differs refuses to start.
 *  - Recorded migrations this build lacks are reported loudly (`log` and console.warn) but do not stop it.
 * The files are idempotent, so it is harmless if `supabase db push` already applied them.
 */
export async function migratePostgres(db: Db, log: (msg: string) => void = console.log): Promise<string[]> {
  if (db.dialect !== 'postgres') return []
  if (!fs.existsSync(MIGRATIONS_DIR)) return []
  const files = readMigrationFiles()
  const recorded = await db.tx(async (q) => {
    await q.query('select pg_advisory_xact_lock($1)', [MIGRATION_LOCK])
    await q.run(`create table if not exists _museum_migrations (name text primary key, applied_at timestamptz not null default now())`)
    await q.run('alter table _museum_migrations add column if not exists sha256 text')
    await q.run('alter table _museum_migrations enable row level security')
    return q.query<{ name: string; sha256: string | null }>('select name, sha256 from _museum_migrations')
  })
  const plan = planMigrations(files, recorded)
  const warning = checkMigrationPlan(plan)
  if (warning) {
    log(warning)
    console.warn(warning)
  }
  for (const b of plan.backfill) await db.run('update _museum_migrations set sha256 = $1 where name = $2 and sha256 is null', [b.sha256, b.name])
  const applied: string[] = []
  for (const f of files) {
    if (!plan.pending.includes(f.name)) continue
    const ran = await db.tx(async (q) => {
      await q.query('select pg_advisory_xact_lock($1)', [MIGRATION_LOCK])
      const row = await q.one<{ sha256: string | null }>('select sha256 from _museum_migrations where name = $1', [f.name])
      if (row) {
        // another runner applied it while this one waited for the lock
        if (row.sha256 && row.sha256 !== f.sha256) checkMigrationPlan({ pending: [], backfill: [], unknown: [], mismatched: [{ name: f.name, recorded: row.sha256, file: f.sha256 }] })
        return false
      }
      await q.run(f.sql)
      await q.run('insert into _museum_migrations (name, sha256) values ($1, $2)', [f.name, f.sha256])
      return true
    })
    if (!ran) continue
    log(`[db] applied migration ${f.name}`)
    applied.push(f.name)
  }
  return applied
}
