/**
 * Links section of the info panel for scene objects with `links` (config/objects.ts):
 * shop products ("Visit the maker / Buy"), the library Resources board, the shop counter.
 *
 * Only links that lead somewhere are shown: an entry without an href (or pointing at a maker
 * profile visitors cannot see) is left out until it has one. For "Visit the maker" / "Buy", the
 * object's maker profile (artisanId) supplies the URL when the workshop has provided one.
 */
import { SCENE_OBJECTS } from '../config/objects'
import { resolveHref } from '../content/artisans'
import type { Selection } from '../state/store'

export function ItemLinks({ selection, tabIndex }: { selection: Selection | null; tabIndex?: number }) {
  if (selection?.kind !== 'object') return null
  const o = SCENE_OBJECTS.find((x) => x.id === selection.id)
  const links = (o?.links ?? []).map((l) => ({ ...l, href: resolveHref(l.label, l.href, o?.artisanId) })).filter((l): l is typeof l & { href: string } => !!l.href)
  if (!o || !links.length) return null
  return (
    <section className="ui-links" aria-label="Links">
      <div className="ui-kicker ui-info__section">{o.kind === 'resource-board' ? 'Resources' : 'Links'}</div>
      <ul className="ui-links__list">
        {links.map((l) => {
          const external = /^https?:/i.test(l.href)
          return (
            <li key={l.label} className="ui-links__item">
              <a className="ui-btn ui-btn--ghost ui-links__btn" href={l.href} target="_blank" rel={external ? 'noopener noreferrer' : 'noopener'} tabIndex={tabIndex}>
                {l.label} {external ? '↗' : '→'}
              </a>
              {l.note && <span className="ui-links__note">{l.note}</span>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
