/**
 * databaseTls(): when the Postgres pool encrypts, and when it also verifies the server's certificate,
 * against which roots. Every rule in src/server/db/tls.ts is pinned here, along with the bundled
 * Supabase root itself (fingerprint, and a deliberate failure six months before it expires).
 *
 * No network: scripts/db-tls-check.ts makes the same decisions against the real poolers.
 *
 * npm test
 */
import assert from 'node:assert/strict'
import { X509Certificate } from 'node:crypto'
import { rootCertificates } from 'node:tls'
import { describe, it } from 'node:test'
import pg from 'pg'
import { PostgresDb } from '../../src/server/db/postgres'
import { SUPABASE_ROOT_CA_2021 } from '../../src/server/db/supabaseCa'
import { databaseTls } from '../../src/server/db/tls'

const POOLER = 'postgres://postgres.ref:secret@aws-0-ap-south-1.pooler.supabase.com:6543/postgres'
const DIRECT = 'postgres://postgres:secret@db.ref.supabase.co:5432/postgres'
const OTHER = 'postgres://app:secret@db.example.org:5432/museum'
const LOCAL = 'postgres://postgres:postgres@localhost:5432/museum'

/** A real root that did not sign Supabase's chain, standing in for DATABASE_CA_CERT. */
const OTHER_ROOT = rootCertificates.find((pem) => new X509Certificate(pem).subject.includes('CN=ISRG Root X1'))!

const OFF = false
const ENCRYPTED = { rejectUnauthorized: false }
/** Verified against the bundled root (plus DATABASE_CA_CERT's). */
const PINNED = (...extra: string[]) => ({ rejectUnauthorized: true, ca: [SUPABASE_ROOT_CA_2021, ...extra] })
/** Verified against Node's public roots (no `ca`, which would replace them). */
const PUBLIC = { rejectUnauthorized: true }

const tls = (url: string, settings?: Parameters<typeof databaseTls>[1]) => databaseTls(url, settings)

describe('the bundled Supabase root', () => {
  const root = new X509Certificate(SUPABASE_ROOT_CA_2021)

  it('is Supabase Root 2021 CA, byte for byte the certificate Supabase publishes', () => {
    assert.equal(root.fingerprint256, '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA')
    assert.match(root.subject, /CN=Supabase Root 2021 CA/)
    assert.equal(root.ca, true)
    assert.ok(root.checkIssued(root), 'a self-signed root')
  })

  it('is refreshed at least six months before it expires (26 April 2031)', () => {
    const left = root.validToDate.getTime() - Date.now()
    assert.ok(
      left > 182 * 86_400_000,
      `the bundled Supabase root expires on ${root.validToDate.toISOString().slice(0, 10)}: replace it (src/server/db/supabaseCa.ts says how)`,
    )
  })
})

describe('databaseTls: DATABASE_SSL wins', () => {
  it('disable, require and verify-full override the URL and the host', () => {
    assert.equal(tls(`${POOLER}?sslmode=verify-full`, { ssl: 'disable' }).ssl, OFF)
    assert.deepEqual(tls(POOLER, { ssl: 'require' }).ssl, ENCRYPTED)
    assert.deepEqual(tls(`${LOCAL}?sslmode=disable`, { ssl: 'verify-full' }).ssl, PUBLIC)
    assert.deepEqual(tls(POOLER, { ssl: 'verify-full' }).ssl, PINNED())
    assert.deepEqual(tls(OTHER, { ssl: 'verify-full', caCert: OTHER_ROOT }).ssl, PINNED(OTHER_ROOT))
  })

  it('reports the mode it chose', () => {
    assert.equal(tls(POOLER, { ssl: 'disable' }).mode, 'disable')
    assert.equal(tls(POOLER, { ssl: 'require' }).mode, 'require')
    assert.equal(tls(POOLER).mode, 'verify-full')
  })

  it('ignores case and surrounding blanks, and treats an empty value as unset', () => {
    assert.deepEqual(tls(OTHER, { ssl: ' Verify-Full ' }).ssl, PUBLIC)
    assert.deepEqual(tls(POOLER, { ssl: '' }).ssl, PINNED())
    assert.deepEqual(tls(POOLER, { ssl: '  ' }).ssl, PINNED())
  })

  it('rejects any other value rather than guessing', () => {
    for (const ssl of ['true', 'verify-ca', 'no-verify', 'prefer']) {
      assert.throws(() => tls(POOLER, { ssl }), /DATABASE_SSL must be disable, require or verify-full/, ssl)
    }
  })
})

describe("databaseTls: the URL's sslmode", () => {
  it('disable turns TLS off, on any host', () => {
    assert.equal(tls(`${POOLER}?sslmode=disable`).ssl, OFF)
    assert.equal(tls(`${OTHER}?sslmode=disable`, { caCert: OTHER_ROOT }).ssl, OFF)
  })

  it('verify-full and verify-ca verify, host name included', () => {
    for (const mode of ['verify-full', 'verify-ca', 'VERIFY-CA']) {
      const { ssl } = tls(`${OTHER}?sslmode=${mode}`)
      assert.deepEqual(ssl, PUBLIC, mode)
      assert.equal(ssl && 'checkServerIdentity' in ssl, false, `${mode}: the host-name check is left on`)
    }
    assert.deepEqual(tls(`${OTHER}?sslmode=verify-ca`, { caCert: OTHER_ROOT }).ssl, PINNED(OTHER_ROOT))
  })
})

describe('databaseTls: a Supabase host is verified against the bundled root', () => {
  it('with no sslmode, and with the sslmode=require the dashboard hands out', () => {
    for (const query of ['', '?sslmode=require', '?sslmode=prefer', '?sslmode=no-verify', '?sslmode=require&uselibpqcompat=true']) {
      assert.deepEqual(tls(POOLER + query).ssl, PINNED(), query || '(none)')
    }
  })

  it('the poolers (*.supabase.com) and the direct host (db.<ref>.supabase.co)', () => {
    assert.deepEqual(tls(POOLER.replace(':6543', ':5432')).ssl, PINNED())
    assert.deepEqual(tls(DIRECT).ssl, PINNED())
    assert.deepEqual(tls(POOLER.replace('aws-0-ap-south-1.pooler.supabase.com', 'AWS-0-AP-SOUTH-1.Pooler.Supabase.COM.')).ssl, PINNED())
  })

  it('trusts DATABASE_CA_CERT as well, so a new root needs no release', () => {
    assert.deepEqual(tls(POOLER, { caCert: OTHER_ROOT }).ssl, PINNED(OTHER_ROOT))
  })

  it('is not fooled by names that merely contain supabase', () => {
    for (const host of ['supabase.com.evil.example', 'evilsupabase.com', 'pooler.supabase.co.uk', 'supabase.com']) {
      assert.deepEqual(tls(`postgres://u:p@${host}:6543/postgres`).ssl, ENCRYPTED, host)
    }
  })

  it('goes by the host pg dials: a `host` query parameter before the URL host', () => {
    assert.deepEqual(tls('postgres://u:p@localhost:6543/postgres?host=aws-0-ap-south-1.pooler.supabase.com').ssl, PINNED())
    assert.equal(tls('postgres://u:p@db.ref.supabase.co/postgres?host=/var/run/postgresql').ssl, OFF)
  })
})

describe('databaseTls: other hosts', () => {
  it('localhost, 127.0.0.1, ::1 and a Unix socket: off unless the URL asks for TLS', () => {
    for (const url of [LOCAL, 'postgres://localhost/museum', 'postgres://u:p@127.0.0.1:5432/museum', 'postgres://u:p@[::1]:5432/museum', 'postgres:///museum?host=/var/run/postgresql']) {
      assert.equal(tls(url).ssl, OFF, url)
    }
    assert.deepEqual(tls(`${LOCAL}?sslmode=require`).ssl, ENCRYPTED)
    assert.deepEqual(tls(`${LOCAL}?sslmode=require`, { caCert: OTHER_ROOT }).ssl, ENCRYPTED)
  })

  it('anywhere else: encrypted only, or verified once DATABASE_CA_CERT names a root', () => {
    assert.deepEqual(tls(OTHER).ssl, ENCRYPTED)
    assert.deepEqual(tls(`${OTHER}?sslmode=require`).ssl, ENCRYPTED)
    assert.deepEqual(tls(OTHER, { caCert: OTHER_ROOT }).ssl, PINNED(OTHER_ROOT))
  })

  it('a string that is not a URL is passed on untouched, encrypted', () => {
    const dsn = 'host=db.example.org user=app dbname=museum'
    assert.deepEqual(tls(dsn), { connectionString: dsn, mode: 'require', ssl: ENCRYPTED })
  })
})

describe('databaseTls: DATABASE_CA_CERT', () => {
  const [a, b] = rootCertificates

  it('accepts several certificates, and a value stored on one line with \\n escapes', () => {
    assert.deepEqual(tls(OTHER, { caCert: `${a}\n${b}` }).ssl, PINNED(a.trim(), b.trim()))
    assert.deepEqual(tls(OTHER, { caCert: OTHER_ROOT.trim().replace(/\n/g, '\\n') }).ssl, PINNED(OTHER_ROOT.trim()))
  })

  it('refuses a value Node would silently skip', () => {
    assert.throws(() => tls(OTHER, { caCert: 'not a certificate' }), /DATABASE_CA_CERT holds no PEM certificate/)
    const broken = '-----BEGIN CERTIFICATE-----\nMIIBroken\n-----END CERTIFICATE-----'
    assert.throws(() => tls(OTHER, { caCert: `${a}\n${broken}` }), /DATABASE_CA_CERT: certificate 2 of 2 cannot be read/)
  })

  it('counts as unset when empty', () => {
    assert.deepEqual(tls(OTHER, { caCert: '' }).ssl, ENCRYPTED)
    assert.deepEqual(tls(OTHER, { caCert: '\n  ' }).ssl, ENCRYPTED)
  })
})

describe('databaseTls: the connection string pg gets', () => {
  it('loses sslmode and uselibpqcompat, which pg would otherwise act on, and keeps the rest', () => {
    const { connectionString } = tls(`${POOLER}?sslmode=require&uselibpqcompat=true&application_name=museum&pgbouncer=true`)
    const u = new URL(connectionString)
    assert.equal(u.searchParams.has('sslmode'), false)
    assert.equal(u.searchParams.has('uselibpqcompat'), false)
    assert.equal(u.searchParams.get('application_name'), 'museum')
    assert.equal(u.searchParams.get('pgbouncer'), 'true')
    assert.equal(`${u.username}:${u.password}@${u.host}${u.pathname}`, 'postgres.ref:secret@aws-0-ap-south-1.pooler.supabase.com:6543/postgres')
  })
})

describe('databaseTls: what pg uses is what was decided', () => {
  /** The TLS settings a pg client really takes from the pool's options, its connection string included. */
  const used = (d: ReturnType<typeof databaseTls>) =>
    (new pg.Client({ connectionString: d.connectionString, ssl: d.ssl }) as unknown as { connectionParameters: { ssl: unknown } }).connectionParameters.ssl

  it('the URL puts no TLS settings of its own in place of the decision', () => {
    const urls = [POOLER, `${POOLER}?sslmode=require`, `${POOLER}?sslmode=verify-ca&uselibpqcompat=true`, `${POOLER}?sslmode=no-verify`, `${POOLER}?sslnegotiation=postgres`, `${OTHER}?sslmode=disable`, `${LOCAL}?sslmode=require`]
    for (const url of urls) {
      for (const ssl of [undefined, 'disable', 'require', 'verify-full']) {
        const decided = tls(url, { ssl })
        assert.deepEqual(used(decided), decided.ssl, `${url} with DATABASE_SSL=${ssl}`)
      }
    }
  })

  it('refuses a URL whose ssl, sslrootcert, sslcert, sslkey or sslnegotiation=direct pg would use instead', () => {
    // ?ssl=0 would have connected a "verified" Supabase pool in plain text, whatever DATABASE_SSL said.
    for (const query of ['?ssl=0', '?ssl=no-verify', '?ssl=true', '?ssl=', '?sslmode=verify-full&sslrootcert=prod-ca-2021.crt', '?sslcert=client.crt&sslkey=client.key', '?sslnegotiation=direct']) {
      for (const ssl of [undefined, 'require', 'disable']) {
        assert.throws(() => tls(POOLER + query, { ssl }), /The database URL carries "(ssl|sslrootcert|sslcert|sslnegotiation=direct)", which pg would use in place/, `${query} with DATABASE_SSL=${ssl}`)
      }
    }
    assert.throws(() => tls(`${POOLER}?ssl=0`), (err: Error) => !err.message.includes('secret'), 'the message names the parameter, never the URL')
  })
})

describe('PostgresDb uses the decision', () => {
  it('a Supabase URL with sslmode=require: verified against the bundled root', () => {
    const db = new PostgresDb({ connectionString: `${POOLER}?sslmode=require` })
    assert.deepEqual(db.pool.options.ssl, PINNED())
    assert.equal(new URL(db.pool.options.connectionString!).searchParams.has('sslmode'), false)
  })

  it('DATABASE_SSL and DATABASE_CA_CERT reach it', () => {
    assert.deepEqual(new PostgresDb({ connectionString: POOLER, ssl: 'require' }).pool.options.ssl, ENCRYPTED)
    assert.deepEqual(new PostgresDb({ connectionString: OTHER, caCert: OTHER_ROOT }).pool.options.ssl, PINNED(OTHER_ROOT))
    assert.equal(new PostgresDb({ connectionString: LOCAL }).pool.options.ssl, OFF)
  })
})
