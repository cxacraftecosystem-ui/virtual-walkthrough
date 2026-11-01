/**
 * Process-wide services (db, storage) + one-time bootstrap (migrate when local, seed content
 * when the DB is empty, ensure the admin account). Memoised on globalThis so Next dev hot
 * reloads and warm serverless invocations reuse them.
 */
import 'server-only'
import { purgeExpiredSessions, seedAdmin, syncMasterEntries, syncStaffRoles } from './auth'
import { config } from './config'
import { ensureSiteExhibition, isSeeded, markSiteAware, readSeed, seedContent } from './contentStore'
import { ensureArtisanSeed } from './artisanSeed'
import { type Db, getDb, migratePostgres } from './db'
import { currentSite } from './site'
import { LocalDiskStorage, S3Storage, type StorageDriver } from './storage'

export interface Services {
  db: Db
  storage: StorageDriver
}

const g = globalThis as { __museumStorage?: StorageDriver; __museumReady?: Promise<void>; __museumReadyDb?: Db }

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

/**
 * This site's content on first start: its own default exhibition (never another site's), the bundled seed
 * into it when this site has not seeded yet (meta `seeded_at`, per site), and the placeholder makers.
 * Leaves the other site's exhibitions, items and makers alone. First records that this site's build is
 * site-aware (the migration-order guard in ensureSiteExhibition).
 */
export async function seedSite(db: Db, logFn: (msg: string) => void = log) {
  const site = currentSite()
  await markSiteAware(db)
  const present = await ensureSiteExhibition(db)
  if (present && !(await isSeeded(db))) {
    const v = await seedContent(db, readSeed(), true, site.defaultExhibitionId)
    if (v !== null) logFn(`seeded ${site.id} content into "${site.defaultExhibitionId}" from bundled config (version ${v})`)
  }
  await ensureArtisanSeed(db) // placeholder maker profiles + links (once per site)
}

async function bootstrap(db: Db) {
  try {
    // Local/self-hosted Postgres: apply migrations automatically. On Vercel run `npm run db:migrate`
    // (or `supabase db push`) as a deliberate step instead.
    if (!config.isVercel) await migratePostgres(db, log)
    await seedSite(db)
    await seedAdmin(db, log)
    await syncMasterEntries(db)
    await syncStaffRoles(db)
    await purgeExpiredSessions(db)
  } catch (err) {
    const msg = (err as Error).message
    if (db.dialect === 'postgres' && /(relation|column) .* does not exist/.test(msg)) {
      throw new Error(`database schema missing, run \`npm run db:migrate\` (or \`supabase db push\`): ${msg}`, { cause: err })
    }
    throw err
  }
}

/** Resolves once bootstrap has finished; a failed bootstrap is retried on the next call. */
export async function services(): Promise<Services> {
  const db = getDb()
  if (!g.__museumReady || g.__museumReadyDb !== db) {
    g.__museumReadyDb = db
    g.__museumReady = bootstrap(db)
    g.__museumReady.catch((err) => {
      console.error('[museum] bootstrap failed:', (err as Error).message)
      g.__museumReady = undefined
    })
  }
  await g.__museumReady
  return { db, storage: getStorage() }
}
