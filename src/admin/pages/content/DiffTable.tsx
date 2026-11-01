/** Field-by-field comparison of two versions of an item (only the fields that differ). */
import type { ContentCollection } from '../../../museum/content/types'
import { changedPaths, fieldLabel, showValue, valueAt } from './diff'

export function DiffTable({
  collection,
  left,
  right,
  leftLabel,
  rightLabel,
}: {
  collection: ContentCollection
  left: Record<string, unknown> | null
  right: Record<string, unknown> | null
  leftLabel: string
  rightLabel: string
}) {
  const paths = changedPaths(left, right)
  if (!paths.length) return <p className="muted small diff-none">No differences.</p>
  return (
    <div className="table-wrap diff-wrap">
      <table className="ui-table compact diff-table">
        <caption className="sr-only">
          Differences: {leftLabel} and {rightLabel}
        </caption>
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">{leftLabel}</th>
            <th scope="col">{rightLabel}</th>
          </tr>
        </thead>
        <tbody>
          {paths.map((p) => (
            <tr key={p}>
              <th scope="row">
                {fieldLabel(collection, p)}
                {fieldLabel(collection, p).toLowerCase() !== p.toLowerCase() ? <span className="mono muted diff-path">{p}</span> : null}
              </th>
              <td>{showValue(left ? valueAt(left, p) : undefined)}</td>
              <td>{showValue(right ? valueAt(right, p) : undefined)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
