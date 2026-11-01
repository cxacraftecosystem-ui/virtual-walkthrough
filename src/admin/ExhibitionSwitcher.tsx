/**
 * Sidebar switcher: which exhibition the content pages edit. Every content call carries
 * `?exhibition=<id>` (exhibitionsApi.ts → exQuery). Refreshes when the list changes (window event
 * 'museum-admin:exhibitions'). Switching while a form has unsaved edits asks first; on Cancel the
 * selection stays where it was (the Select is controlled, so nothing needs reverting).
 */
import { useEffect, useState } from 'react'
import { type AdminExhibition, exApi, getSelectedExhibition, setSelectedExhibition, useSelectedExhibition } from './exhibitionsApi'
import { Icon, Select, StatusBadge, useConfirmLeave } from './ui'
import './exhibitions.css'

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

/** The exhibition the content pages currently edit (the selection, else the default). */
export function currentExhibition(list: AdminExhibition[] | null, selected: string) {
  if (!list || !list.length) return null
  return list.find((e) => e.id === selected) ?? list.find((e) => e.isDefault) ?? list[0]
}

/** Switch exhibition after the unsaved-changes check; resolves false when the user stayed. */
export function useSwitchExhibition() {
  const leave = useConfirmLeave()
  return async (id: string, list: AdminExhibition[] | null) => {
    const def = list?.find((e) => e.isDefault)
    const next = id === def?.id ? '' : id
    if (next === getSelectedExhibition()) return true
    if (!(await leave('Switching exhibition discards the edits you have not saved.'))) return false
    setSelectedExhibition(next)
    return true
  }
}

export function ExhibitionSwitcher() {
  const list = useExhibitionList()
  const selected = useSelectedExhibition()
  const switchTo = useSwitchExhibition()

  // a stale selection (deleted exhibition) falls back to the default one
  useEffect(() => {
    if (list && list.length && selected && !list.some((e) => e.id === selected)) setSelectedExhibition('')
  }, [list, selected])

  if (!list) return <span className="skel input" aria-hidden="true" style={{ height: 88, borderRadius: 16 }} />
  if (list.length === 0) return null
  const current = currentExhibition(list, selected)!
  return (
    <div className="ex-switch" role="group" aria-labelledby="ex-switch-label">
      <span className="ex-switch-label" id="ex-switch-label">Editing exhibition</span>
      <Select
        size="sm"
        value={current.id}
        aria-labelledby="ex-switch-label"
        onChange={(v) => void switchTo(v, list)}
        options={list.map((e) => ({
          value: e.id,
          label: e.title,
          description: [e.isDefault ? 'Default' : '', e.status === 'draft' ? 'Draft' : 'Published', `${e.items} items`].filter(Boolean).join(' · '),
        }))}
      />
      <span className="ex-switch-meta">
        <StatusBadge status={current.status} />
        {current.isDefault ? <StatusBadge status="default" /> : null}
        <span className="spacer" />
        <a href={current.path} target="_blank" rel="noreferrer">
          Preview <Icon name="external" width={12} height={12} style={{ verticalAlign: '-1px' }} />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </span>
    </div>
  )
}
