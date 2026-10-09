/**
 * npm run db:tls-check — the database connection's TLS, proven against the real server
 * (infra/setup-supabase.md §3). USE_REMOTE=1 npm run db:tls-check checks production.
 *
 * Read-only: every connection runs `SELECT 1` and nothing else, and the app's bootstrap (migrations,
 * seeding) never starts. Only host:port is printed, never a connection string.
 *
 * For DATABASE_URL and, when set, DIRECT_DATABASE_URL (with USE_REMOTE=1 their REMOTE_* values, as in
 * scripts/db-migrate.ts), through the app's own PostgresDb and TLS decision (src/server/db/tls.ts):
 *  - the app's settings connect, and the server's certificate is verified;
 *  - DATABASE_SSL=require connects as well: encrypted, certificate not verified;
 *  - the verification is real. It refuses a root that did not sign the server's chain, and it refuses
 *    the right root presented under a name the certificate does not carry: the load balancer's DNS
 *    name (pg sends it as the TLS server name) and the bare IP address (pg sends none). DATABASE_SSL=
 *    require reaches the server both ways, so what refuses them is the name check, not the route.
 * Exits 1 when an expectation fails.
 */
import dns from 'node:dns/promises'
import fs from 'node:fs'
import { X509Certificate } from 'node:crypto'
import { rootCertificates, type TLSSocket } from 'node:tls'

for (const f of ['.env.local', '.env']) if (fs.existsSync(f)) process.loadEnvFile(f)

const env = process.env
const remote = env.USE_REMOTE === '1' || env.USE_REMOTE === 'true'
const { config } = await import('../src/server/config')
const { PostgresDb } = await import('../src/server/db/postgres')
const { databaseTls } = await import('../src/server/db/tls')
const { SUPABASE_ROOT_CA_2021 } = await import('../src/server/db/supabaseCa')

/** A real root that did not sign Supabase's chain. */
const WRONG_ROOT = rootCertificates.find((pem) => new X509Certificate(pem).subject.includes('CN=ISRG Root X1'))!
/** The roots the app trusts for a Supabase host, to present under other names. */
const RIGHT_ROOTS = [SUPABASE_ROOT_CA_2021, config.databaseCaCert ?? ''].join('\n')

let failed = 0
const report = (ok: boolean, what: string, detail: string) => {
  if (!ok) failed++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}\n        ${detail}`)
}

interface Outcome {
  connected: boolean
  detail: string
  code?: string
  authorized?: boolean
}

/** `SELECT 1` through a PostgresDb, then what the pooled client's TLS socket says about the server. */
async function attempt(db: InstanceType<typeof PostgresDb>): Promise<Outcome> {
  try {
    const row = await db.one<{ ok: number }>('SELECT 1 AS ok')
    const client = await db.pool.connect()
    try {
      const socket = client.connection.stream as TLSSocket
      if (!socket.encrypted) return { connected: row?.ok === 1, detail: 'connected WITHOUT TLS' }
      const cn = socket.getPeerCertificate().subject?.CN
      const verified = socket.authorized ? `certificate verified (CN=${cn})` : `certificate NOT verified (${socket.authorizationError})`
      return { connected: row?.ok === 1, authorized: socket.authorized, detail: `SELECT 1 → ${row?.ok}, ${socket.getProtocol()}, ${verified}` }
    } finally {
      client.release()
    }
  } catch (err) {
    const e = err as { code?: string; message?: string }
    return { connected: false, code: e.code, detail: `refused: ${e.code ?? ''} ${String(e.message ?? '').split('\n')[0]}`.trim() }
  } finally {
    await db.close()
  }
}

/** The URL with its host swapped for another name or address of the same server. */
const withHost = (url: string, host: string) => {
  const u = new URL(url)
  u.hostname = host
  return u.toString()
}

const targets = [
  ['DATABASE_URL', config.databaseUrl],
  ['DIRECT_DATABASE_URL', env.DIRECT_DATABASE_URL || (remote ? env.REMOTE_DIRECT_DATABASE_URL : '') || ''],
].filter(([, url]) => url)
if (!targets.length) {
  console.error('[db:tls-check] DATABASE_URL is not set, so there is nothing to check (USE_REMOTE=1 for the REMOTE_* values)')
  process.exit(1)
}

for (const [name, url] of targets) {
  const u = new URL(url)
  console.log(`[db:tls-check] ${name}: ${u.hostname}:${u.port || 5432}`)
  const app = databaseTls(url, { ssl: config.databaseSsl, caCert: config.databaseCaCert })

  const own = await attempt(new PostgresDb({ connectionString: url, ssl: config.databaseSsl, caCert: config.databaseCaCert, max: 1 }))
  report(own.connected && (app.mode !== 'verify-full' || own.authorized === true), `the app's settings (${app.mode})`, own.detail)
  if (app.mode !== 'verify-full') report(false, 'the app verifies the certificate', `no: DATABASE_SSL=${config.databaseSsl ?? '(unset)'}, host ${u.hostname}`)

  const plain = await attempt(new PostgresDb({ connectionString: url, ssl: 'require', max: 1 }))
  report(plain.connected, 'DATABASE_SSL=require (encryption only)', plain.detail)

  // Only for a server whose certificate the bundled root signs: the "right root" below is that one.
  if (!/\.supabase\.(com|co)$/.test(u.hostname)) continue

  const wrong = new PostgresDb({ connectionString: url, max: 1 })
  // The pool's TLS options as the app would build them, with a root that did not sign the chain.
  wrong.pool.options.ssl = databaseTls(url, { roots: [WRONG_ROOT] }).ssl
  const wrongRoot = await attempt(wrong)
  report(!wrongRoot.connected && /CERT|ISSUER|SIGNATURE/.test(wrongRoot.code ?? ''), 'a wrong root (ISRG Root X1) is refused', wrongRoot.detail)

  const aliases: Array<[string, string]> = []
  const cname = await dns.resolveCname(u.hostname).catch(() => [] as string[])
  if (cname[0]) aliases.push([`the load balancer's name ${cname[0]}`, cname[0]])
  const ip = await dns.lookup(u.hostname, { family: 4 }).catch(() => null)
  if (ip) aliases.push([`the IP address ${ip.address}`, ip.address])
  for (const [label, host] of aliases) {
    const other = withHost(url, host)
    const named = await attempt(new PostgresDb({ connectionString: other, ssl: 'verify-full', caCert: RIGHT_ROOTS, max: 1 }))
    const reached = await attempt(new PostgresDb({ connectionString: other, ssl: 'require', max: 1 }))
    report(!named.connected && named.code === 'ERR_TLS_CERT_ALTNAME_INVALID', `the right root under another name, ${label}, is refused`, named.detail)
    report(reached.connected, `…while DATABASE_SSL=require reaches the server that way`, reached.detail)
  }
}

console.log(failed ? `[db:tls-check] ${failed} check(s) FAILED` : '[db:tls-check] all checks passed')
process.exit(failed ? 1 : 0)
