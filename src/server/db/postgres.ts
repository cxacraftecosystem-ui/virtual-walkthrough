/**
 * PostgreSQL implementation (production — Supabase). Uses `pg` with a small pool; works with
 * Supabase's pooled (PgBouncer transaction mode, port 6543) connection string because only
 * unnamed statements are used.
 */
import 'server-only'
import pg from 'pg'
import type { Db, Param, Queryable, Row } from './types'

// bigint / numeric → number (all our values are well inside 2^53).
pg.types.setTypeParser(20, (v) => Number(v))
pg.types.setTypeParser(1700, (v) => Number(v))
// timestamptz / timestamp → ISO string (matches the SQLite driver).
for (const oid of [1184, 1114]) {
  const parseDate = pg.types.getTypeParser(oid) as (v: string) => Date
  pg.types.setTypeParser(oid, (v) => {
    const d = parseDate(v)
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString() : v
  })
}

export interface PgOptions {
  connectionString: string
  /** 'disable' | 'require' (default: require unless the host is localhost). */
  ssl?: string
  max?: number
}

function wrap(client: pg.Pool | pg.PoolClient): Queryable {
  // No params → simple query protocol (allows multi-statement migration files).
  const exec = (sql: string, params: Param[] = []) => (params.length ? client.query(sql, params) : client.query(sql))
  return {
    query: async <T = Row>(sql: string, params?: Param[]) => (await exec(sql, params)).rows as T[],
    one: async <T = Row>(sql: string, params?: Param[]) => (await exec(sql, params)).rows[0] as T | undefined,
    run: async (sql: string, params?: Param[]) => (await exec(sql, params)).rowCount ?? 0,
  }
}

export class PostgresDb implements Db {
  readonly dialect = 'postgres' as const
  readonly pool: pg.Pool
  private readonly q: Queryable

  constructor(opts: PgOptions) {
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(opts.connectionString)
    const sslMode = opts.ssl ?? (local ? 'disable' : 'require')
    this.pool = new pg.Pool({
      connectionString: opts.connectionString,
      // Supabase presents a certificate chain not in Node's default store; encryption is still enforced.
      ssl: sslMode === 'disable' ? false : { rejectUnauthorized: sslMode === 'verify-full' },
      max: opts.max ?? 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    })
    this.pool.on('error', (err) => console.error('[db] idle client error', err.message))
    this.q = wrap(this.pool)
  }

  query<T = Row>(sql: string, params?: Param[]) {
    return this.q.query<T>(sql, params)
  }
  one<T = Row>(sql: string, params?: Param[]) {
    return this.q.one<T>(sql, params)
  }
  run(sql: string, params?: Param[]) {
    return this.q.run(sql, params)
  }

  async tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const out = await fn(wrap(client))
      await client.query('COMMIT')
      return out
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw err
    } finally {
      client.release()
    }
  }

  async close() {
    await this.pool.end()
  }
}
