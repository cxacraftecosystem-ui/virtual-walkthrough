/**
 * "Meet the maker" card in the info panel: portrait, name, bio excerpt and commerce links
 * (Visit the maker / Commission / Buy — fair trade), each shown only when the profile has that URL.
 * Profiles: src/museum/content/artisans.ts (runtime list filled by the content API).
 */
import { useState } from 'react'
import { ARTWORKS } from '../config/artworks'
import { EXHIBITS } from '../config/exhibits'
import { SCENE_OBJECTS } from '../config/objects'
import { findArtisan, safeUrl } from '../content/artisans'
import type { Selection } from '../state/store'
import './MakerCard.css'

const EXCERPT = 180

function artisanIdFor(sel: Selection | null): string | undefined {
  if (!sel) return undefined
  if (sel.kind === 'artwork') {
    const a = ARTWORKS.find((x) => x.id === sel.id)
    // a textile without its own maker falls back to the maker of its hand block
    return a?.artisanId || (a?.exhibitId ? EXHIBITS.find((e) => e.id === a.exhibitId)?.artisanId : undefined)
  }
  if (sel.kind === 'exhibit') return EXHIBITS.find((x) => x.id === sel.id)?.artisanId
  if (sel.kind === 'object') return SCENE_OBJECTS.find((x) => x.id === sel.id)?.artisanId
  return undefined
}

export function MakerCard({ selection, tabIndex }: { selection: Selection | null; tabIndex?: number }) {
  const maker = findArtisan(artisanIdFor(selection))
  const [broken, setBroken] = useState<string | null>(null)
  if (!maker) return null
  const bio = maker.bio.length > EXCERPT ? `${maker.bio.slice(0, EXCERPT).replace(/\s+\S*$/, '')}…` : maker.bio
  const links = [
    { label: 'Visit the maker', href: safeUrl(maker.website) },
    { label: 'Commission', href: safeUrl(maker.commissionUrl) },
    { label: 'Buy (fair trade)', href: safeUrl(maker.shopUrl) },
  ].filter((l): l is { label: string; href: string } => !!l.href)
  const portrait = maker.portrait && broken !== maker.portrait ? maker.portrait : ''
  const initials = maker.placeholder ? '?' : maker.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()

  return (
    <section className="ui-maker" aria-labelledby={`ui-maker-${maker.id}`}>
      <div className="ui-kicker ui-info__section">Meet the maker</div>
      <div className="ui-maker__row">
        {portrait ? (
          <img className="ui-maker__portrait" src={portrait} alt={`Portrait of ${maker.name}`} loading="lazy" decoding="async" onError={() => setBroken(portrait)} />
        ) : (
          <div className="ui-maker__portrait ui-maker__portrait--empty" aria-hidden="true">{initials}</div>
        )}
        <div className="ui-maker__who">
          <div className="ui-maker__name" id={`ui-maker-${maker.id}`}>{maker.name}</div>
          {(maker.craft || maker.cluster) && <div className="ui-maker__meta">{[maker.craft, maker.cluster].filter(Boolean).join(' · ')}</div>}
          {maker.placeholder && <span className="ui-maker__badge">Placeholder profile</span>}
          {!maker.placeholder && maker.verified && <span className="ui-maker__badge ui-maker__badge--ok">Verified by the workshop</span>}
        </div>
      </div>
      {bio && <p className="ui-maker__bio">{bio}</p>}
      <div className="ui-maker__actions">
        {links.map((l) => (
          <a key={l.label} className="ui-btn ui-btn--ghost ui-maker__btn" href={l.href} target="_blank" rel="noopener noreferrer" tabIndex={tabIndex}>
            {l.label} ↗
          </a>
        ))}
        <a className="ui-maker__more" href={`/makers/${encodeURIComponent(maker.id)}`} target="_blank" rel="noopener" tabIndex={tabIndex}>
          Full profile →
        </a>
      </div>
    </section>
  )
}
