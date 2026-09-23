/**
 * Admin header: which exhibition the content pages edit. Every content call carries
 * `?exhibition=<id>` (exhibitionsApi.ts → exQuery). Refreshes when the list changes
 * (window event 'museum-admin:exhibitions').
 */
import { useEffect, useState } from 'react'
import { type AdminExhibition, exApi, setSelectedExhibition, useSelectedExhibition } from './exhibitionsApi'

export const EXHIBITIONS_CHANGED = 'museum-admin:exhibitions'

export function useExhibitionList() {
  const [list, setList] = useState<AdminExhibition[] | null>(null)
  useEffect(() => {
    let alive = true
    const load = () => void exApi.list().then((l) => alive && setList(l)).catch(() => alive && setList([]))
    load()
    window.addEventListener(EXHIBITIONS_CHANGED, load)
    return () => {
      alive = false
      window.removeEventListener(EXHIBITIONS_CHANGED, load)
    }
  }, [])
  return list
}

export function ExhibitionSwitcher() {
  const list = useExhibitionList()
  const selected = useSelectedExhibition()

  // a stale selection (deleted exhibition) falls back to the default one
  useEffect(() => {
    if (list && list.length && selected && !list.some((e) => e.id === selected)) setSelectedExhibition('')
  }, [list, selected])

  if (!list || list.length === 0) return null
  const def = list.find((e) => e.isDefault)
  const current = list.find((e) => e.id === selected) ?? def ?? list[0]
  return (
    <label className="ex-switch" title="Content pages edit this exhibition">
      <span className="kicker">Exhibition</span>
      <select value={current.id} onChange={(e) => setSelectedExhibition(e.target.value === def?.id ? '' : e.target.value)} aria-label="Exhibition being edited">
        {list.map((e) => (
          <option key={e.id} value={e.id}>
            {e.title}
            {e.isDefault ? ' (default)' : ''}
            {e.status === 'draft' ? ' — draft' : ''}
          </option>
        ))}
      </select>
      <a className="small" href={current.path} target="_blank" rel="noreferrer">Preview ↗</a>
    </label>
  )
}
