/** Server configuration (environment variables with dev-friendly defaults). See .env.example. */
import 'server-only'
import path from 'node:path'

const env = process.env
const flag = (v: string | undefined) => v === '1' || v === 'true'
const ROOT = process.cwd()

export const config = {
  isProduction: env.NODE_ENV === 'production',
  isVercel: Boolean(env.VERCEL),

  /* ---- database: Postgres when DATABASE_URL is set, else local SQLite ---- */
  databaseUrl: env.DATABASE_URL ?? '',
  /** 'require' (default for remote hosts) | 'verify-full' | 'disable' */
  databaseSsl: env.DATABASE_SSL,
  databasePoolMax: Number(env.DATABASE_POOL_MAX ?? (env.VERCEL ? 2 : 5)),
  dbPath: path.resolve(/* turbopackIgnore: true */ ROOT, env.DB_PATH ?? '.data/museum.sqlite'),

  /* ---- media: S3 when S3_BUCKET is set, else local disk ---- */
  s3Bucket: env.S3_BUCKET ?? '',
  s3Region: env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? 'us-east-1',
  /** Optional S3-compatible endpoint (Supabase Storage, R2, MinIO…). */
  s3Endpoint: env.S3_ENDPOINT ?? '',
  /** Public base URL for objects, e.g. https://dxxxx.cloudfront.net (default: the bucket's S3 URL). */
  s3PublicBaseUrl: env.S3_PUBLIC_BASE_URL ?? '',
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

  adminEmail: (env.ADMIN_EMAIL ?? 'admin@museum.local').trim().toLowerCase(),
  adminPassword: env.ADMIN_PASSWORD ?? 'admin12345',
  adminFromEnv: Boolean(env.ADMIN_EMAIL && env.ADMIN_PASSWORD),

  maxUploadBytes: 500 * 1024 * 1024,
  sessionDays: 30,
}

export const API_VERSION = '1'
