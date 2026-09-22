/**
 * Process-wide services (db, storage) + one-time bootstrap (migrate when local, seed content
 * when the DB is empty, ensure the admin account). Memoised on globalThis so Next dev hot
 * reloads and warm serverless invocations reuse them.
 */
import 'server-only'
import { purgeExpiredSessions, seedAdmin } from './auth'
import { config } from './config'
import { isSeeded, readSeed, seedContent } from './contentStore'
import { type Db, getDb, migratePostgres } from './db'
import { LocalDiskStorage, S3Storage, type StorageDriver } from './storage'

export interface Services {
  db: Db
  storage: StorageDriver
}

const g = globalThis as { __museumStorage?: StorageDriver; __museumReady?: Promise<void> }

export function getStorage(): StorageDriver {
  g.__museumStorage ??= config.s3Bucket
    ? new S3Storage({
        bucket: config.s3Bucket,
        region: config.s3Region,
        endpoint: config.s3Endpoint || undefined,
        publicBaseUrl: config.s3PublicBaseUrl || undefined,
        prefix: config.s3Prefix || undefined,
      })
    : new LocalDiskStorage(config.mediaDir)
  return g.__museumStorage
}

const log = (m: string) => console.log(`[museum] ${m}`)

async function bootstrap(db: Db) {
  try {
    // Local/self-hosted Postgres: apply migrations automatically. On Vercel run `npm run db:migrate`
    // (or `supabase db push`) as a deliberate step instead.
    if (!config.isVercel) await migratePostgres(db, log)
    if (!(await isSeeded(db))) {
      const v = await seedContent(db, readSeed(), true)
      if (v !== null) log(`seeded content from bundled config (version ${v})`)
    }
    await seedAdmin(db, log)
    await purgeExpiredSessions(db)
  } catch (err) {
    const msg = (err as Error).message
    if (db.dialect === 'postgres' && /relation .* does not exist/.test(msg)) {
      throw new Error(`database schema missing, run \`npm run db:migrate\` (or \`supabase db push\`): ${msg}`, { cause: err })
    }
    throw err
  }
}

/** Resolves once bootstrap has finished; a failed bootstrap is retried on the next call. */
export async function services(): Promise<Services> {
  const db = getDb()
  if (!g.__museumReady) {
    g.__museumReady = bootstrap(db)
    g.__museumReady.catch((err) => {
      console.error('[museum] bootstrap failed:', (err as Error).message)
      g.__museumReady = undefined
    })
  }
  await g.__museumReady
  return { db, storage: getStorage() }
}
