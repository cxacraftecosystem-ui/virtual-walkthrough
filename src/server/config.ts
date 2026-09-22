/** Server configuration (environment variables with dev-friendly defaults). See .env.example. */
import 'server-only'
import path from 'node:path'

const env = process.env
const flag = (v: string | undefined) => v === '1' || v === 'true'
const ROOT = process.cwd()

/**
 * USE_REMOTE=1 (local dev only): read REMOTE_<NAME> first for the settings below, so the
 * production Supabase/S3 credentials can live in .env.local without switching the (shared)
 * dev server away from SQLite + local disk by default. On Vercel the plain names are used.
 */
const useRemote = flag(env.USE_REMOTE)
const pick = (name: string): string | undefined => (useRemote ? env[`REMOTE_${name}`] : undefined) || env[name] || undefined
const adminEmailEnv = pick('ADMIN_EMAIL')
const adminPasswordEnv = pick('ADMIN_PASSWORD')

export const config = {
  isProduction: env.NODE_ENV === 'production',
  isVercel: Boolean(env.VERCEL),
  useRemote,

  /* ---- database: Postgres when DATABASE_URL is set, else local SQLite ---- */
  databaseUrl: pick('DATABASE_URL') ?? '',
  /** 'require' (default for remote hosts) | 'verify-full' | 'disable' */
  databaseSsl: env.DATABASE_SSL,
  databasePoolMax: Number(env.DATABASE_POOL_MAX ?? (env.VERCEL ? 2 : 5)),
  dbPath: path.resolve(/* turbopackIgnore: true */ ROOT, env.DB_PATH ?? '.data/museum.sqlite'),

  /* ---- media: S3 when S3_BUCKET is set, else local disk ---- */
  s3Bucket: pick('S3_BUCKET') ?? '',
  s3Region: env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? 'us-east-1',
  /** Optional S3-compatible endpoint (Supabase Storage, R2, MinIO…). */
  s3Endpoint: env.S3_ENDPOINT ?? '',
  /** Public base URL for objects, e.g. https://dxxxx.cloudfront.net (default: the bucket's S3 URL). */
  s3PublicBaseUrl: pick('S3_PUBLIC_BASE_URL') ?? '',
  /** Optional key prefix inside the bucket, e.g. "museum/". */
  s3Prefix: env.S3_PREFIX ?? '',
  mediaDir: path.resolve(/* turbopackIgnore: true */ ROOT, env.MEDIA_DIR ?? '.data/media'),

  /** Session cookie `Secure` flag. Default: on in production (HTTPS), off in dev. */
  cookieSecure: env.COOKIE_SECURE !== undefined ? flag(env.COOKIE_SECURE) : env.NODE_ENV === 'production',
  /** Extra origins allowed to make state-changing API calls (comma-separated URLs); same-origin is always allowed. */
  extraOrigins: (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((o) => {
      try {
        return new URL(o).host
      } catch {
        return o
      }
    }),

  adminEmail: (adminEmailEnv ?? 'admin@museum.local').trim().toLowerCase(),
  adminPassword: adminPasswordEnv ?? 'admin12345',
  adminFromEnv: Boolean(adminEmailEnv && adminPasswordEnv),
  /**
   * Master admins (manage the access list): MASTER_ADMIN_EMAILS (comma-separated), else
   * MASTER_ADMIN_EMAIL, else ADMIN_EMAIL (or the dev default admin@museum.local).
   */
  masterAdminEmails: (pick('MASTER_ADMIN_EMAILS') ?? pick('MASTER_ADMIN_EMAIL') ?? adminEmailEnv ?? (env.NODE_ENV === 'production' ? '' : 'admin@museum.local'))
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes('@')),

  /** Google Identity Services web client id (public). Empty → Google sign-in disabled. */
  googleClientId: (env.GOOGLE_CLIENT_ID ?? '').trim(),

  maxUploadBytes: 500 * 1024 * 1024,
  sessionDays: 30,
}

export const API_VERSION = '1'
