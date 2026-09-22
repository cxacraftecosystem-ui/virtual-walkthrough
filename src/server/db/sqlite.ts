/**
 * node:sqlite implementation (built into Node ≥ 22.5, no native modules) — the zero-config
 * local fallback used when DATABASE_URL is not set. Schema mirrors
 * supabase/migrations/*.sql in SQLite dialect; migrations tracked with PRAGMA user_version.
 */
import 'server-only'
import fs from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { Db, Param, Queryable, Row } from './types'

const MIGRATIONS: string[] = [
  `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE content_items (
    collection TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
    PRIMARY KEY (collection, id)
  );
  CREATE TABLE users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'visitor' CHECK (role IN ('visitor','admin')),
    password_hash TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE favorites (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_kind TEXT NOT NULL, item_id TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, item_kind, item_id)
  );
  CREATE TABLE comments (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_kind TEXT NOT NULL DEFAULT '', item_id TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  );
  CREATE INDEX comments_item ON comments(item_kind, item_id, created_at);
  CREATE TABLE media (
    id TEXT PRIMARY KEY, folder TEXT NOT NULL, stored_name TEXT NOT NULL, filename TEXT NOT NULL,
    mime TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE analytics_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, t INTEGER NOT NULL,
    type TEXT NOT NULL, zone TEXT, item_kind TEXT, item_id TEXT, seconds REAL, tier TEXT,
    meta TEXT, received_at INTEGER NOT NULL
  );
  CREATE INDEX analytics_t ON analytics_events(t);
  CREATE INDEX analytics_session ON analytics_events(session_id, t);
  `,
]

/** `$1` → `?1` (SQLite numbered parameters bind positionally). */
const toSqlite = (sql: string) => sql.replace(/\$(\d+)/g, '?$1')

export class SqliteDb implements Db {
  readonly dialect = 'sqlite' as const
  private readonly db: DatabaseSync
  /** Pending transaction: other statements wait so they never run inside someone else's tx. */
  private active: Promise<void> | null = null
  private readonly direct: Queryable

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
    // getBuiltinModule keeps bundlers (Next/Turbopack) from trying to resolve node:sqlite
    const { DatabaseSync: Sqlite } = process.getBuiltinModule('node:sqlite')
    this.db = new Sqlite(file)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
    this.migrate()
    const exec = this.exec.bind(this)
    this.direct = {
      query: async <T>(sql: string, params: Param[] = []) => exec(sql, params, 'all') as T[],
      one: async <T>(sql: string, params: Param[] = []) => (exec(sql, params, 'all') as T[])[0],
      run: async (sql: string, params: Param[] = []) => exec(sql, params, 'run') as number,
    }
  }

  private exec(sql: string, params: Param[], mode: 'all' | 'run'): Row[] | number {
    const stmt = this.db.prepare(toSqlite(sql))
    if (mode === 'run') return Number(stmt.run(...params).changes)
    return stmt.all(...params) as Row[]
  }

  private migrate() {
    let v = (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    while (v < MIGRATIONS.length) {
      this.db.exec('BEGIN')
      try {
        this.db.exec(MIGRATIONS[v])
        this.db.exec(`PRAGMA user_version = ${v + 1}`)
        this.db.exec('COMMIT')
      } catch (err) {
        this.db.exec('ROLLBACK')
        throw err
      }
      v++
    }
  }

  private async idle() {
    while (this.active) await this.active
  }

  async query<T = Row>(sql: string, params: Param[] = []) {
    await this.idle()
    return this.direct.query<T>(sql, params)
  }
  async one<T = Row>(sql: string, params: Param[] = []) {
    await this.idle()
    return this.direct.one<T>(sql, params)
  }
  async run(sql: string, params: Param[] = []) {
    await this.idle()
    return this.direct.run(sql, params)
  }

  async tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    // check-and-set without an intervening await
    while (this.active) await this.active
    let release!: () => void
    this.active = new Promise<void>((r) => (release = r))
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const out = await fn(this.direct)
      this.db.exec('COMMIT')
      return out
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    } finally {
      this.active = null
      release()
    }
  }

  async close() {
    this.db.close()
  }
}
