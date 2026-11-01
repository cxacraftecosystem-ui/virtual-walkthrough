/** Pieces shared by the analytics pages: item links (content editor + museum) and single-series bars. */
import { collectionOfKind, contentHref, museumHref } from '../content/model'

/** An item's title linking to its content editor, plus a small link to the museum at the item. */
export function ItemLinks({ kind, id, title, museumBase }: { kind: string; id: string; title?: string; museumBase: string }) {
  const col = collectionOfKind(kind)
  return (
    <span className="an-item">
      {col ? (
        <a className="cell-title" href={contentHref(col, id)}>
          {title ?? id}
        </a>
      ) : (
        <span className="cell-title">{title ?? id}</span>
      )}
      <span className="cell-sub">
        <span className="mono">{id}</span>
        {col ? (
          <>
            {' · '}
            <a href={museumHref(museumBase, col, id)} target="_blank" rel="noreferrer" aria-label={`Open ${title ?? id} in the museum`}>
              In museum
            </a>
          </>
        ) : null}
      </span>
    </span>
  )
}

/** Horizontal bars: single series, values in text ink, hover shows the exact value. */
export function HBars({ rows, empty }: { rows: { label: string; value: number; text: string }[]; empty: string }) {
  if (!rows.length) return <div className="empty">{empty}</div>
  const max = Math.max(...rows.map((r) => r.value), 1)
  return (
    <div className="bars">
      {rows.map((r) => (
        <div className="bar-row" key={r.label} title={`${r.label}: ${r.text}`}>
          <span>{r.label}</span>
          <div className="track">
            <div className="fill" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
          <span className="v">{r.text}</span>
        </div>
      ))}
    </div>
  )
}

