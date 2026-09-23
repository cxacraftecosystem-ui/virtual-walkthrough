import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { exhibitionForPage } from '@/server/pages'
import { MuseumClient } from '../../MuseumClient'
import '../../../src/museum/ui/standalone.css'

/**
 * /gallery/<slug> — the same building with another exhibition's content (multi-exhibition platform).
 * Unknown slug → 404. A draft is shown only to curators and above (preview); everyone else
 * gets a "not open yet" page.
 */
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const ex = await exhibitionForPage(slug)
  if (!ex || !ex.visible) return { title: 'Exhibition — Virtual Museum', robots: { index: false } }
  return {
    title: `${ex.title} — Virtual Exhibition`,
    description: ex.subtitle || undefined,
    ...(ex.status !== 'published' ? { robots: { index: false, follow: false } } : {}),
  }
}

export default async function ExhibitionPage({ params }: Props) {
  const { slug } = await params
  const ex = await exhibitionForPage(slug)
  if (!ex) notFound()
  if (!ex.visible) {
    return (
      <main className="sp-root">
        <div className="sp-wrap">
          <nav className="sp-nav" aria-label="Museum">
            <a href="/gallery">← Back to the museum</a>
          </nav>
          <div className="sp-kicker">Exhibition</div>
          <h1 className="sp-title">Not open yet</h1>
          <p className="sp-sub">This exhibition is still being prepared. Please visit the current exhibition in the meantime.</p>
          <a className="sp-btn sp-btn--primary" href="/gallery">Visit the current exhibition</a>
        </div>
      </main>
    )
  }
  return <MuseumClient exhibition={ex.slug} />
}
