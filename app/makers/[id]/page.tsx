import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { makerForPage } from '@/server/pages'
import '../../../src/museum/ui/standalone.css'

/**
 * /makers/<id> — accessible, server-rendered "Meet the maker" page (works without WebGL).
 * Shows only what the workshop supplied; placeholder profiles are labelled as such.
 */
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

const safeUrl = (u: string) => (/^https?:\/\//i.test(u.trim()) ? u.trim() : '')
const safeImg = (u: string) => (/^(https?:\/\/|\/)[^\s]*$/i.test(u.trim()) ? u.trim() : '')

async function load(id: string) {
  try {
    return await makerForPage(decodeURIComponent(id))
  } catch {
    return null
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await load((await params).id)
  if (!data) return { title: 'Maker not found — Virtual Museum' }
  const m = data.maker
  return {
    title: `${m.name} — Meet the maker`,
    description: m.bio.slice(0, 160) || undefined,
    ...(m.placeholder ? { robots: { index: false, follow: false } } : {}),
  }
}

export default async function MakerPage({ params }: Props) {
  const data = await load((await params).id)
  if (!data) notFound()
  const { maker: m, works } = data
  const portrait = safeImg(m.portrait)
  const links = [
    { label: 'Visit the maker', href: safeUrl(m.website), primary: true },
    { label: 'Commission a piece', href: safeUrl(m.commissionUrl), primary: false },
    { label: 'Buy (fair trade)', href: safeUrl(m.shopUrl), primary: false },
  ].filter((l) => l.href)
  const facts: [string, string][] = [
    ['Craft', m.craft],
    ['Cluster / region', m.cluster],
    ['Contact', m.contact],
  ].filter((f): f is [string, string] => !!f[1])

  return (
    <main className="sp-root">
      <article className="sp-wrap" aria-labelledby="maker-name">
        <nav className="sp-nav" aria-label="Museum">
          <a href="/gallery">← Back to the museum</a>
        </nav>

        <div className="sp-head">
          {portrait ? (
            // Plain <img>: portraits come from the media library / S3 (any origin).
            <img className="sp-portrait" src={portrait} alt={`Portrait of ${m.name}`} width={144} height={144} />
          ) : (
            <div className="sp-portrait sp-portrait--empty" aria-hidden="true">?</div>
          )}
          <div>
            <div className="sp-kicker">Meet the maker</div>
            <h1 className="sp-title" id="maker-name">{m.name}</h1>
            {m.placeholder ? (
              <span className="sp-badge">Placeholder profile — details to be supplied by the workshop</span>
            ) : m.verified ? (
              <span className="sp-badge sp-badge--ok">Verified by the workshop</span>
            ) : null}
          </div>
        </div>

        {facts.length > 0 && (
          <dl className="sp-facts">
            {facts.map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        )}

        {m.bio && <p className="sp-bio">{m.bio}</p>}

        {links.length > 0 && (
          <div className="sp-actions">
            {links.map((l) => (
              <a key={l.label} className={`sp-btn${l.primary ? ' sp-btn--primary' : ''}`} href={l.href} target="_blank" rel="noopener noreferrer">
                {l.label}
                <span className="visually-hidden"> (opens in a new tab)</span> ↗
              </a>
            ))}
          </div>
        )}

        {works.length > 0 && (
          <section aria-labelledby="maker-works">
            <h2 id="maker-works" className="sp-kicker" style={{ marginTop: 32 }}>In the museum</h2>
            <ul className="sp-list">
              {works.map((w) => (
                <li key={`${w.exhibition.slug}/${w.collection}/${w.id}`}>
                  {w.title}{' '}
                  <span style={{ color: 'var(--muted)' }}>
                    — {w.collection === 'exhibits' ? 'hand block' : 'textile'} in{' '}
                    <a className="sp-link" href={w.exhibition.isDefault ? '/gallery' : `/gallery/${encodeURIComponent(w.exhibition.slug)}`}>{w.exhibition.title}</a>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="sp-note">
          Purchases and commissions happen directly with the maker or their cooperative; the museum takes no commission.
          Profiles are supplied and approved by the workshop.
        </p>
      </article>
    </main>
  )
}
