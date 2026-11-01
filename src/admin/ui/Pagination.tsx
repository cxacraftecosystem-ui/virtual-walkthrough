/**
 * Pagination: "Page 2 of 7 · 164 records" with Previous / Next, inside `<nav aria-label="Pagination">`.
 * "Page 0 of 0" when there is nothing is deliberate. Pages are 1-based. For cursor lists (no total),
 * use `CursorPager`: a count of what is shown and a "Load more" button while there is more.
 */
import type { ReactNode } from 'react'
import { Button } from './Button'

export function Pagination({ page, pageSize, total, onPage, noun = 'records' }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; noun?: string }) {
  const pages = Math.max(0, Math.ceil(total / Math.max(1, pageSize)))
  const p = pages ? Math.min(Math.max(1, page), pages) : 0
  return (
    <nav className="ui-pagination" aria-label="Pagination">
      <span>
        Page <span className="num">{p}</span> of <span className="num">{pages}</span> · <span className="num">{total.toLocaleString()}</span> {noun}
      </span>
      <div className="btn-row">
        <Button size="sm" icon="chevronLeft" disabled={p <= 1} onClick={() => onPage(p - 1)}>Previous</Button>
        <Button size="sm" iconEnd="chevronRight" disabled={p >= pages} onClick={() => onPage(p + 1)}>Next</Button>
      </div>
    </nav>
  )
}

export function CursorPager({ shown, hasMore, loading, onMore, noun = 'records', note }: { shown: number; hasMore: boolean; loading?: boolean; onMore: () => void; noun?: string; note?: ReactNode }) {
  return (
    <nav className="ui-pagination" aria-label="Pagination">
      <span>
        Showing <span className="num">{shown.toLocaleString()}</span> {noun}
        {hasMore ? ' — more available' : ''}
        {note ? <> · {note}</> : null}
      </span>
      {hasMore ? (
        <Button size="sm" loading={loading} loadingLabel="Loading…" onClick={onMore}>Load more</Button>
      ) : null}
    </nav>
  )
}

/** Slice helper for client-side paging. */
export function pageSlice<T>(rows: T[], page: number, pageSize: number): T[] {
  const start = (Math.max(1, page) - 1) * pageSize
  return rows.slice(start, start + pageSize)
}
