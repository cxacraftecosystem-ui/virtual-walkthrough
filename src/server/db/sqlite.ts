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
  // #2 RBAC + access list + Google sign-in (supabase/migrations/20260923010000_rbac_access_list.sql).
  // SQLite cannot alter a CHECK constraint, so users is rebuilt (foreign keys are off during migrations).
  `
  CREATE TABLE users_new (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'visitor' CHECK (role IN ('visitor','curator','admin','master')),
    password_hash TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
    manual_role TEXT CHECK (manual_role IS NULL OR manual_role IN ('visitor','curator','admin')),
    email_verified INTEGER NOT NULL DEFAULT 0, google_sub TEXT, last_login_at TEXT
  );
  INSERT INTO users_new (id, email, display_name, role, password_hash, created_at, manual_role)
    SELECT id, email, display_name, role, password_hash, created_at, CASE WHEN role = 'admin' THEN 'admin' END FROM users;
  DROP TABLE users;
  ALTER TABLE users_new RENAME TO users;
  CREATE UNIQUE INDEX users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL;
  CREATE TABLE access_list (
    pattern TEXT PRIMARY KEY, role TEXT NOT NULL CHECK (role IN ('curator','admin')),
    note TEXT NOT NULL DEFAULT '', created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  `,
  // #3 several master admins mirrored into the access list (supabase/migrations/20260923020000_master_admins.sql)
  `
  CREATE TABLE access_list_new (
    pattern TEXT PRIMARY KEY, role TEXT NOT NULL CHECK (role IN ('curator','admin','master')),
    note TEXT NOT NULL DEFAULT '', created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  INSERT INTO access_list_new SELECT pattern, role, note, created_by, created_at, updated_at FROM access_list;
  DROP TABLE access_list;
  ALTER TABLE access_list_new RENAME TO access_list;
  `,
  // #4 client error reporting (supabase/migrations/20260923040000_client_errors.sql)
  `
  CREATE TABLE client_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT, fingerprint TEXT NOT NULL, kind TEXT NOT NULL, message TEXT NOT NULL,
    stack TEXT, url TEXT, ua TEXT, tier TEXT, gpu TEXT, release TEXT, created_at INTEGER NOT NULL
  );
  CREATE INDEX client_errors_fp ON client_errors(fingerprint, created_at);
  CREATE INDEX client_errors_created ON client_errors(created_at);
  CREATE TABLE client_error_groups (
    fingerprint TEXT PRIMARY KEY, kind TEXT NOT NULL, message TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
    first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, resolved_at INTEGER,
    last_stack TEXT, last_url TEXT, last_ua TEXT, last_tier TEXT, last_gpu TEXT, last_release TEXT
  );
  CREATE INDEX client_error_groups_last ON client_error_groups(last_seen);
  `,
  // visitor prints — "Print it yourself" studio → Visitors' Wall (supabase/migrations/20260923110000_visitor_prints.sql)
  `
  CREATE TABLE IF NOT EXISTS visitor_prints (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    display_name TEXT NOT NULL DEFAULT '', motif TEXT NOT NULL DEFAULT '', meta TEXT NOT NULL DEFAULT '{}',
    storage_key TEXT NOT NULL, url TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, size INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    created_at TEXT NOT NULL, reviewed_at TEXT, reviewed_by TEXT
  );
  CREATE INDEX IF NOT EXISTS visitor_prints_status ON visitor_prints(status, created_at);
  CREATE INDEX IF NOT EXISTS visitor_prints_session ON visitor_prints(session_id, created_at);
  `,
  // exhibitions (multi-exhibition), artisans ("Meet the maker"), analytics heatmap rollup
  // (supabase/migrations/20260923100000_exhibitions_makers_heatmap.sql). content_items is rebuilt
  // for the new primary key (exhibition_id, collection, id); existing rows → 'hand-block-printing'.
  `
  CREATE TABLE IF NOT EXISTS exhibitions (
    id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, subtitle TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
    is_default INTEGER NOT NULL DEFAULT 0, theme TEXT NOT NULL DEFAULT '{}',
    exhibition_text TEXT NOT NULL DEFAULT '{}', welcome TEXT NOT NULL DEFAULT '{"title":"","body":""}', tour TEXT,
    sort INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS exhibitions_one_default ON exhibitions(is_default) WHERE is_default = 1;
  INSERT INTO exhibitions (id, slug, title, subtitle, status, is_default, theme, exhibition_text, welcome, sort, created_at, updated_at)
    SELECT 'hand-block-printing', 'hand-block-printing', 'Hand Block Printing', 'Carved wood, natural dye and cloth', 'published', 1,
           '{"accent":"#8a5a3b"}',
           COALESCE((SELECT value FROM meta WHERE key = 'exhibition'), '{}'),
           COALESCE((SELECT value FROM meta WHERE key = 'welcome'), '{"title":"","body":""}'),
           0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE NOT EXISTS (SELECT 1 FROM exhibitions);
  CREATE TABLE content_items_new (
    exhibition_id TEXT NOT NULL DEFAULT 'hand-block-printing',
    collection TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
    PRIMARY KEY (exhibition_id, collection, id)
  );
  INSERT INTO content_items_new (exhibition_id, collection, id, json, sort, updated_at)
    SELECT 'hand-block-printing', collection, id, json, sort, updated_at FROM content_items;
  DROP TABLE content_items;
  ALTER TABLE content_items_new RENAME TO content_items;
  CREATE TABLE IF NOT EXISTS artisans (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, cluster TEXT NOT NULL DEFAULT '', craft TEXT NOT NULL DEFAULT '',
    bio TEXT NOT NULL DEFAULT '', portrait TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL DEFAULT '',
    website TEXT NOT NULL DEFAULT '', shop_url TEXT NOT NULL DEFAULT '', commission_url TEXT NOT NULL DEFAULT '',
    verified INTEGER NOT NULL DEFAULT 0, placeholder INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  ALTER TABLE analytics_events ADD COLUMN exhibition_id TEXT;
  UPDATE analytics_events SET exhibition_id = 'hand-block-printing' WHERE exhibition_id IS NULL;
  CREATE INDEX IF NOT EXISTS analytics_exhibition ON analytics_events(exhibition_id, t);
  CREATE INDEX IF NOT EXISTS analytics_type ON analytics_events(type, t);
  CREATE TABLE IF NOT EXISTS analytics_heat (
    exhibition_id TEXT NOT NULL, day TEXT NOT NULL, zone TEXT NOT NULL DEFAULT '',
    cx INTEGER NOT NULL, cz INTEGER NOT NULL, samples INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (exhibition_id, day, zone, cx, cz)
  );
  `,
]

/** Schema version of this code (a dev-server singleton opened by older code is reopened). */
export const SQLITE_SCHEMA_VERSION = MIGRATIONS.length

/** `$1` → `?1` (SQLite numbered parameters bind positionally). */
const toSqlite = (sql: string) => sql.replace(/\$(\d+)/g, '?$1')

export class SqliteDb implements Db {
  readonly dialect = 'sqlite' as const
  readonly schemaVersion = SQLITE_SCHEMA_VERSION
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
    if (v >= MIGRATIONS.length) return
    // Table rebuilds must not cascade: foreign keys off (only effective outside a transaction),
    // then verified with foreign_key_check before committing each step.
    this.db.exec('PRAGMA foreign_keys = OFF')
    while (v < MIGRATIONS.length) {
      this.db.exec('BEGIN')
      try {
        this.db.exec(MIGRATIONS[v])
        const broken = this.db.prepare('PRAGMA foreign_key_check').all()
        if (broken.length) throw new Error(`sqlite migration ${v + 1} broke ${broken.length} foreign key(s)`)
        this.db.exec(`PRAGMA user_version = ${v + 1}`)
        this.db.exec('COMMIT')
      } catch (err) {
        this.db.exec('ROLLBACK')
        this.db.exec('PRAGMA foreign_keys = ON')
        throw err
      }
      v++
    }
    this.db.exec('PRAGMA foreign_keys = ON')
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
