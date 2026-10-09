/**
 * TLS for the Postgres connections. `databaseTls()` decides once per pool whether connections are
 * plain, encrypted, or encrypted and verified. It is a pure function, so every rule below is pinned
 * by tests/unit/postgres-tls.test.ts.
 *
 * Verified means the server's certificate must chain to a trusted root AND name the host that was
 * dialled: rejectUnauthorized, plus the host-name check that tls.connect runs (checkServerIdentity)
 * against the `servername` pg passes it, which is the host (pg/lib/connection.js, upgradeToSSL). For
 * an IP address pg passes none and Node checks the name "localhost" instead, which fails as well.
 * The trusted roots are the bundled Supabase root and DATABASE_CA_CERT, so a rotated root can be
 * added without a code change.
 *
 * First match wins:
 *  1. DATABASE_SSL: disable | require | verify-full. Anything else is a configuration error.
 *  2. The URL's sslmode: disable → off; verify-full or verify-ca → verified. verify-ca checks the host
 *     name too: no server of ours may present a certificate issued for another name.
 *  3. A Supabase host (*.supabase.com, *.supabase.co) → verified against the bundled root, even when
 *     the URL says sslmode=require. libpq treats require as verify-ca once it has a root certificate,
 *     and the dashboard's connection strings carry require.
 *  4. localhost or a Unix socket → off, unless the URL's sslmode asks for TLS; then encrypted.
 *  5. Any other host → verified when DATABASE_CA_CERT is set, otherwise encrypted only.
 *
 * Rules 1 and 2 on a host that is not Supabase's, with no DATABASE_CA_CERT, verify against Node's
 * public roots, as verify-full always did: a publicly trusted server keeps verifying.
 */
import 'server-only'
import { X509Certificate } from 'node:crypto'
import type { ConnectionOptions } from 'node:tls'
import { SUPABASE_ROOT_CA_2021 } from './supabaseCa'

export type SslMode = 'disable' | 'require' | 'verify-full'

export interface DatabaseTls {
  /** The connection string pg gets: the caller's, without sslmode and uselibpqcompat. */
  connectionString: string
  mode: SslMode
  /** pg's `ssl` option. */
  ssl: false | ConnectionOptions
}

export interface TlsSettings {
  /** DATABASE_SSL. Empty counts as unset (.env.example lists it empty). */
  ssl?: string
  /** DATABASE_CA_CERT: one or more PEM certificates, trusted next to the bundled root. */
  caCert?: string
  /** The bundled roots. A parameter only so that scripts/db-tls-check.ts can trust a wrong one. */
  roots?: readonly string[]
}

const SUPABASE_HOST_RE = /\.supabase\.(com|co)$/
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const PEM_RE = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g

/**
 * DATABASE_CA_CERT as a list of PEM certificates. Each is parsed here because Node silently skips a
 * `ca` entry it cannot read (a paste that lost its line breaks, say); verification would then fail
 * at the first connection, or, worse, only on the day the bundled root stops being the right one.
 */
function extraRoots(pem: string | undefined): string[] {
  // Literal "\n" sequences: a value stored on one line (some dashboards, dotenv without quotes).
  const text = pem?.replace(/\\n/g, '\n').trim()
  if (!text) return []
  const blocks = text.match(PEM_RE) ?? []
  if (!blocks.length) throw new Error('DATABASE_CA_CERT holds no PEM certificate (-----BEGIN CERTIFICATE----- … -----END CERTIFICATE-----)')
  blocks.forEach((block, i) => {
    try {
      void new X509Certificate(block)
    } catch {
      throw new Error(`DATABASE_CA_CERT: certificate ${i + 1} of ${blocks.length} cannot be read`)
    }
  })
  return blocks
}

export function databaseTls(connectionString: string, settings: TlsSettings = {}): DatabaseTls {
  // pg-connection-string turns a URL's sslmode into an `ssl` object that replaces ours wholesale
  // (require becomes verification against Node's public roots, which Supabase's chain fails;
  // uselibpqcompat switches to libpq's meanings), so both are read here and taken out of the URL.
  let url = connectionString
  let sslmode = ''
  let host = ''
  try {
    const u = new URL(connectionString)
    sslmode = (u.searchParams.get('sslmode') ?? '').toLowerCase()
    // pg dials a `host` query parameter in preference to the URL's host.
    host = (u.searchParams.get('host') || u.hostname).toLowerCase().replace(/\.$/, '')
    for (const k of ['sslmode', 'uselibpqcompat']) u.searchParams.delete(k)
    url = u.toString()
  } catch {
    /* not a URL: pg gets it as is, and there is no host to go by */
  }
  const extra = extraRoots(settings.caCert)
  const supabase = SUPABASE_HOST_RE.test(host)

  const off: DatabaseTls = { connectionString: url, mode: 'disable', ssl: false }
  const encrypted: DatabaseTls = { connectionString: url, mode: 'require', ssl: { rejectUnauthorized: false } }
  const verified = (): DatabaseTls => ({
    connectionString: url,
    mode: 'verify-full',
    // A `ca` list replaces Node's public roots, so it is given only when there is a root of ours to trust.
    ssl: supabase || extra.length ? { rejectUnauthorized: true, ca: [...(settings.roots ?? [SUPABASE_ROOT_CA_2021]), ...extra] } : { rejectUnauthorized: true },
  })

  const explicit = settings.ssl?.trim().toLowerCase()
  if (explicit) {
    if (explicit === 'disable') return off
    if (explicit === 'require') return encrypted
    if (explicit === 'verify-full') return verified()
    throw new Error(`DATABASE_SSL must be disable, require or verify-full, not "${settings.ssl}"`)
  }
  if (sslmode === 'disable') return off
  if (sslmode === 'verify-full' || sslmode === 'verify-ca') return verified()
  if (supabase) return verified()
  if (LOCAL_HOSTS.has(host) || host.startsWith('/')) return sslmode ? encrypted : off
  return extra.length ? verified() : encrypted
}
