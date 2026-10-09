/**
 * PostgreSQL implementation (production — Supabase). Uses `pg` with a small pool; works with
 * Supabase's pooled (PgBouncer transaction mode, port 6543) connection string because only
 * unnamed statements are used.
 */
import 'server-only'
// The subpath, not the package root, which also loads Vercel's cache, purge and WebSocket helpers.
import { attachDatabasePool } from '@vercel/functions/db-connections'
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

const STALE_RE = /Connection terminated unexpectedly|ECONNRESET|Client has encountered a connection error/i

/**
 * Errors after which a client must never be lent again: STALE_RE's, the state pg leaves a broken
 * client in ("not queryable"), socket failures, and SQLSTATE class 08 (connection exception) or
 * 57P01–57P03 (the server or the pooler ending the session).
 */
const BROKEN_RE = /not queryable|EPIPE|ETIMEDOUT/i
const BROKEN_CODE_RE = /^(08...|57P0[1-3])$/

function isConnectionError(err: unknown): boolean {
  const e = err as { message?: unknown; code?: unknown } | null | undefined
  const message = String(e?.message ?? '')
  return STALE_RE.test(message) || BROKEN_RE.test(message) || BROKEN_CODE_RE.test(String(e?.code ?? ''))
}

/**
 * Whether a statement may be sent again after its connection dropped. pg cannot tell a socket that
 * died before the server read the statement from one that died after the server ran it — and, outside
 * a transaction, committed it — so only a statement that changes nothing qualifies: one SELECT, SHOW
 * or WITH … SELECT. A write keyword anywhere in it (a data-modifying WITH, SELECT … INTO, FOR UPDATE)
 * or a second statement after a `;` rules it out; a wrong "no" costs only the retry. A SELECT that
 * writes through a function it calls would pass for a read, so run such a thing in tx().
 */
const READ_RE = /^\s*(select|show|with)\b/i
const WRITE_RE = /\b(insert|update|delete|merge|into)\b|;\s*\S/i

const safeToRepeat = (sql: string) => READ_RE.test(sql) && !WRITE_RE.test(sql)

function wrap(client: pg.Pool | pg.PoolClient): Queryable {
  // No params → simple query protocol (allows multi-statement migration files).
  const once = (sql: string, params: Param[]) => (params.length ? client.query(sql, params) : client.query(sql))
  // A serverless function thawed after a freeze can hand out a pooled socket the server already
  // closed: a read is retried once on a fresh connection (pool only — never inside a transaction). A
  // write is not: the same error also arrives when the server ran it and only the reply was lost.
  const exec = async (sql: string, params: Param[] = []) => {
    try {
      return await once(sql, params)
    } catch (err) {
      if (!(client instanceof pg.Pool) || !STALE_RE.test((err as Error).message ?? '') || !safeToRepeat(sql)) throw err
      return once(sql, params)
    }
  }
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
    // pg-connection-string maps `sslmode=require` to full certificate verification (which fails on
    // Supabase's chain), so the URL's sslmode is taken out and applied by us instead.
    let connectionString = opts.connectionString
    let urlSslMode: string | undefined
    try {
      const u = new URL(connectionString)
      urlSslMode = u.searchParams.get('sslmode') ?? undefined
      for (const k of ['sslmode', 'uselibpqcompat']) u.searchParams.delete(k)
      connectionString = u.toString()
    } catch {
      /* not a URL (key=value DSN) → leave as is */
    }
    const sslMode = opts.ssl || (urlSslMode && ['disable', 'verify-full'].includes(urlSslMode) ? urlSslMode : undefined) || (local && !urlSslMode ? 'disable' : 'require')
    this.pool = new pg.Pool({
      connectionString,
      // Supabase presents a certificate chain not in Node's default store; encryption is still enforced.
      ssl: sslMode === 'disable' ? false : { rejectUnauthorized: sslMode === 'verify-full' },
      max: opts.max ?? 5,
      // Short, because Fluid compute suspends an idle instance with whatever sockets it holds, and the
      // pooler or a NAT drops them meanwhile. 5 s is Vercel's figure for Fluid.
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 10_000,
    })
    // On every release, keeps the invocation alive (waitUntil) for idleTimeoutMillis, so the pool
    // closes its idle clients itself before the instance is suspended rather than waking up holding
    // dead ones. Vercel only: elsewhere there is no request context to extend.
    if (process.env.VERCEL) attachDatabasePool(this.pool)
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
    const client = await this.begin()
    // Set when the client must not go back to the pool: release(err) makes pg destroy the socket
    // instead of lending it to the next caller.
    let broken: Error | undefined
    try {
      const out = await fn(wrap(client))
      await client.query('COMMIT')
      return out
    } catch (err) {
      // A dropped connection has already lost the transaction on the server, and a ROLLBACK sent down
      // it can only fail or hang. Anything else is rolled back, and a failed ROLLBACK breaks the client.
      if (isConnectionError(err)) {
        broken = err as Error
      } else {
        await client.query('ROLLBACK').catch((rollbackErr: unknown) => {
          broken = rollbackErr instanceof Error ? rollbackErr : new Error(String(rollbackErr))
        })
      }
      throw err
    } finally {
      client.release(broken)
    }
  }

  /**
   * A pooled client with a transaction open on it. A pool thawed after a freeze can lend a socket the
   * server already closed (see `wrap`), and BEGIN is where tx() finds out. Nothing has run yet, so a
   * stale socket is retried once with another client; any other failure is the caller's.
   */
  private async begin(): Promise<pg.PoolClient> {
    for (let attempt = 1; ; attempt++) {
      let client: pg.PoolClient | undefined
      try {
        client = await this.pool.connect()
        await client.query('BEGIN')
        return client
      } catch (err) {
        // A client whose BEGIN failed is never lent again, whatever the reason.
        client?.release(err instanceof Error ? err : true)
        if (attempt > 1 || !STALE_RE.test((err as Error | undefined)?.message ?? '')) throw err
      }
    }
  }

  async close() {
    await this.pool.end()
  }
}
