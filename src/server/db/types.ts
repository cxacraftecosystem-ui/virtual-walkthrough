/**
 * Thin async database interface implemented by Postgres (production / Supabase) and
 * node:sqlite (zero-config local fallback). SQL is written once with `$1, $2…` placeholders
 * in the common subset of both dialects; `dialect` lets the few differing queries branch.
 *
 * Normalisation guaranteed by both drivers:
 *  - integers / bigints / numerics come back as JS numbers
 *  - timestamps come back as ISO-8601 strings
 *  - `json` columns may come back parsed (pg jsonb) or as a string (sqlite) — use `parseJson`.
 */
export type Param = string | number | null
export type Row = Record<string, unknown>

export interface Queryable {
  query<T = Row>(sql: string, params?: Param[]): Promise<T[]>
  one<T = Row>(sql: string, params?: Param[]): Promise<T | undefined>
  /** Execute a statement; returns the number of affected rows. */
  run(sql: string, params?: Param[]): Promise<number>
}

export interface Db extends Queryable {
  readonly dialect: 'postgres' | 'sqlite'
  /** Run `fn` in a transaction (committed when it resolves, rolled back when it throws). */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>
  close(): Promise<void>
}

export const parseJson = <T>(v: unknown): T => (typeof v === 'string' ? (JSON.parse(v) as T) : (v as T))

export const nowIso = () => new Date().toISOString()
