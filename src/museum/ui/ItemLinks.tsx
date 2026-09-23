/**
 * Links section of the info panel for scene objects with `links` (config/objects.ts):
 * shop products ("Visit the maker / Buy"), the library Resources board, the shop counter.
 *
 * A link without an href is a PLACEHOLDER and is shown as a disabled button with its note.
 * For "Visit the maker" / "Buy", the object's maker profile (artisanId) supplies the URL
 * when the workshop has provided one.
 */
import { SCENE_OBJECTS } from '../config/objects'
import { findArtisan, safeUrl } from '../content/artisans'
import type { Selection } from '../state/store'

function resolveHref(label: string, href: string | undefined, artisanId: string | undefined): string | undefined {
  const maker = findArtisan(artisanId)
  if (maker) {
    if (/visit the maker/i.test(label)) return safeUrl(maker.website) ?? href
    if (/^buy/i.test(label)) return safeUrl(maker.shopUrl) ?? href
  }
  if (!href) return undefined
  // only site-relative paths or http(s) URLs
  return href.startsWith('/') && !href.startsWith('//') ? href : safeUrl(href)
}

export function ItemLinks({ selection, tabIndex }: { selection: Selection | null; tabIndex?: number }) {
  if (selection?.kind !== 'object') return null
  const o = SCENE_OBJECTS.find((x) => x.id === selection.id)
  if (!o?.links?.length) return null
  return (
    <section className="ui-links" aria-label="Links">
      <div className="ui-kicker ui-info__section">{o.kind === 'resource-board' ? 'Resources' : 'Links'}</div>
      <ul className="ui-links__list">
        {o.links.map((l) => {
          const href = resolveHref(l.label, l.href, o.artisanId)
          const external = !!href && /^https?:/i.test(href)
          return (
            <li key={l.label} className="ui-links__item">
              {href ? (
                <a className="ui-btn ui-btn--ghost ui-links__btn" href={href} target="_blank" rel={external ? 'noopener noreferrer' : 'noopener'} tabIndex={tabIndex}>
                  {l.label} {external ? '↗' : '→'}
                </a>
              ) : (
                <span className="ui-btn ui-btn--ghost ui-links__btn is-disabled" aria-disabled="true" title={l.note}>
                  {l.label}
                </span>
              )}
              {l.note && <span className="ui-links__note">{l.note}</span>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
