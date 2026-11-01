/**
 * DataTable: the list screen's table, in a panel.
 * - `rows === null` means loading (skeleton rows); `[]` shows `empty` (never the empty state while
 *   fetching).
 * - Columns: `{ id, header, cell(row), sortValue?(row), align?, width?, className? }`. A column with
 *   `sortValue` gets a sort button; the <th> carries aria-sort. Sorting is client-side, stable, and
 *   can be controlled (`sort` + `onSortChange`) or internal (`defaultSort`).
 * - `selectable`: a checkbox column (shift-click ticks a range) and a sticky bulk-action bar
 *   (`bulkActions(ids, clear)`) while anything is ticked. Selection is controlled (`selected`,
 *   `onSelectedChange`) so a page can keep failed rows ticked after a bulk run.
 * - `rowActions(row)`: right-aligned RowActions cell. `onRowClick(row)` opens the record read-only;
 *   the title cell should still be a real link/button so the keyboard reaches it.
 * - `density` comfortable | compact; `caption` names the table for screen readers.
 * - `minWidth` holds the columns apart on wide screens; below 640px it is dropped (the phone-hidden
 *   columns are gone by then) and the panel scrolls sideways only if the rest still does not fit.
 */
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Checkbox } from './Field'
import { Icon } from './icons'

export interface Column<R> {
  id: string
  header: ReactNode
  cell: (row: R) => ReactNode
  sortValue?: (row: R) => string | number | null | undefined
  align?: 'left' | 'right'
  width?: number | string
  className?: string
  /** Hidden below 640px. */
  hidePhone?: boolean
}

export type SortState = { id: string; dir: 'asc' | 'desc' } | null

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function DataTable<R>({
  rows,
  columns,
  getRowId,
  caption,
  empty,
  selectable = false,
  selected,
  onSelectedChange,
  bulkActions,
  rowActions,
  rowActionsLabel = 'Actions',
  onRowClick,
  rowClassName,
  sort: sortProp,
  onSortChange,
  defaultSort = null,
  density = 'comfortable',
  minWidth,
  footer,
  loadingRows = 6,
  flashId,
}: {
  rows: R[] | null
  columns: Column<R>[]
  getRowId: (row: R) => string
  caption: string
  empty?: ReactNode
  selectable?: boolean
  selected?: Set<string>
  onSelectedChange?: (next: Set<string>) => void
  bulkActions?: (ids: string[], clear: () => void) => ReactNode
  rowActions?: (row: R) => ReactNode
  rowActionsLabel?: string
  onRowClick?: (row: R) => void
  rowClassName?: (row: R) => string | undefined
  sort?: SortState
  onSortChange?: (s: SortState) => void
  defaultSort?: SortState
  density?: 'comfortable' | 'compact'
  minWidth?: number
  footer?: ReactNode
  loadingRows?: number
  /** Row to point at (outline + flash), e.g. after jumping here from elsewhere. */
  flashId?: string | null
}) {
  const [innerSort, setInnerSort] = useState<SortState>(defaultSort)
  const sort = sortProp !== undefined ? sortProp : innerSort
  const setSort = (s: SortState) => (onSortChange ? onSortChange(s) : setInnerSort(s))
  const [innerSel, setInnerSel] = useState<Set<string>>(() => new Set())
  const sel = selected ?? innerSel
  const setSel = (s: Set<string>) => (onSelectedChange ? onSelectedChange(s) : setInnerSel(s))
  const lastTicked = useRef<string | null>(null)
  const shiftDown = useRef(false)

  const sorted = useMemo(() => {
    if (!rows) return null
    if (!sort) return rows
    const col = columns.find((c) => c.id === sort.id)
    if (!col?.sortValue) return rows
    const sv = col.sortValue
    const dir = sort.dir === 'asc' ? 1 : -1
    return rows
      .map((r, i) => ({ r, i, v: sv(r) }))
      .sort((a, b) => {
        const av = a.v
        const bv = b.v
        if (av === bv) return a.i - b.i
        if (av === null || av === undefined || av === '') return 1 // blanks last either way
        if (bv === null || bv === undefined || bv === '') return -1
        const c = typeof av === 'number' && typeof bv === 'number' ? av - bv : collator.compare(String(av), String(bv))
        return c * dir || a.i - b.i
      })
      .map((x) => x.r)
  }, [rows, sort, columns])

  const ids = useMemo(() => (sorted ?? []).map(getRowId), [sorted, getRowId])
  const visibleSelected = ids.filter((id) => sel.has(id))
  const allChecked = ids.length > 0 && visibleSelected.length === ids.length
  const someChecked = visibleSelected.length > 0 && !allChecked
  const selectedIds = [...sel]

  const toggleRow = (id: string, checked: boolean, shift: boolean) => {
    const next = new Set(sel)
    if (shift && lastTicked.current && ids.includes(lastTicked.current)) {
      const a = ids.indexOf(lastTicked.current)
      const b = ids.indexOf(id)
      for (const x of ids.slice(Math.min(a, b), Math.max(a, b) + 1)) {
        if (checked) next.add(x)
        else next.delete(x)
      }
    } else if (checked) next.add(id)
    else next.delete(id)
    lastTicked.current = id
    setSel(next)
  }

  const colCount = columns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0)
  const headerCell = (c: Column<R>) => {
    const dir = sort?.id === c.id ? sort.dir : undefined
    const ariaSort = c.sortValue ? (dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none') : undefined
    return (
      <th
        key={c.id}
        scope="col"
        aria-sort={ariaSort}
        className={[c.align === 'right' && 'num', c.hidePhone && 'hide-phone', c.className].filter(Boolean).join(' ') || undefined}
        style={c.width !== undefined ? { width: c.width } : undefined}
      >
        {c.sortValue ? (
          <button
            type="button"
            className="ui-th-sort"
            data-dir={dir}
            onClick={() => setSort(dir === 'asc' ? { id: c.id, dir: 'desc' } : dir === 'desc' ? null : { id: c.id, dir: 'asc' })}
          >
            {c.header}
            <Icon name={dir === 'asc' ? 'sortUp' : dir === 'desc' ? 'sortDown' : 'sort'} />
          </button>
        ) : (
          c.header
        )}
      </th>
    )
  }

  return (
    <>
      <div className="card ui-table-panel">
        <div className="ui-table-scroll">
          <table className={`ui-table${density === 'compact' ? ' compact' : ''}`} style={minWidth ? ({ '--ui-table-min': `${minWidth}px` } as CSSProperties) : undefined} aria-busy={rows === null || undefined}>
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr>
                {selectable ? (
                  <th scope="col" className="ui-sel">
                    <Checkbox
                      checked={allChecked}
                      indeterminate={someChecked}
                      disabled={!ids.length}
                      label={allChecked ? 'Clear selection' : `Select all ${ids.length}`}
                      labelHidden
                      onChange={(c) => {
                        const next = new Set(sel)
                        for (const id of ids) {
                          if (c) next.add(id)
                          else next.delete(id)
                        }
                        setSel(next)
                      }}
                    />
                  </th>
                ) : null}
                {columns.map(headerCell)}
                {rowActions ? (
                  <th scope="col" className="ui-actions">
                    <span className="sr-only">{rowActionsLabel}</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {sorted === null ? (
                Array.from({ length: loadingRows }, (_, i) => (
                  <tr key={`sk${i}`} aria-hidden="true">
                    {Array.from({ length: colCount }, (_, j) => (
                      <td key={j}>
                        <span className="skel line" style={{ width: j === 0 && selectable ? 16 : `${50 + ((i * 7 + j * 13) % 40)}%` }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : sorted.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="empty-cell">
                    {empty ?? <div className="empty">Nothing here yet</div>}
                  </td>
                </tr>
              ) : (
                sorted.map((r) => {
                  const id = getRowId(r)
                  const isSel = sel.has(id)
                  return (
                    <tr
                      key={id}
                      aria-selected={selectable ? isSel : undefined}
                      data-flash={flashId === id || undefined}
                      className={[onRowClick && 'is-clickable', rowClassName?.(r)].filter(Boolean).join(' ') || undefined}
                      onClick={
                        onRowClick
                          ? (e) => {
                              const t = e.target as HTMLElement
                              if (t.closest('a, button, input, label, select, textarea, [role="menu"]')) return
                              onRowClick(r)
                            }
                          : undefined
                      }
                    >
                      {selectable ? (
                        <td className="ui-sel">
                          <span
                            onClickCapture={(e) => {
                              // change events carry no modifier keys: remember shift for range ticking
                              shiftDown.current = e.shiftKey
                            }}
                          >
                            <Checkbox checked={isSel} label={`Select ${id}`} labelHidden onChange={(c) => toggleRow(id, c, shiftDown.current)} />
                          </span>
                        </td>
                      ) : null}
                      {columns.map((c) => (
                        <td key={c.id} className={[c.align === 'right' && 'num', c.hidePhone && 'hide-phone', c.className].filter(Boolean).join(' ') || undefined}>
                          {c.cell(r)}
                        </td>
                      ))}
                      {rowActions ? <td className="ui-actions">{rowActions(r)}</td> : null}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        {footer}
      </div>
      {selectable && selectedIds.length > 0 && bulkActions ? (
        <div className="ui-bulkbar" role="region" aria-label="Bulk actions">
          <span className="count" aria-live="polite">
            {selectedIds.length} selected
          </span>
          {bulkActions(selectedIds, () => setSel(new Set()))}
          <button type="button" className="btn ghost small pill" onClick={() => setSel(new Set())}>
            Clear
          </button>
        </div>
      ) : null}
    </>
  )
}
