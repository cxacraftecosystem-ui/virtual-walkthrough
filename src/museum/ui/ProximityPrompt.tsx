import { useState } from 'react'
import { useMuseum, type Selection } from '../state/store'
import { IconInfo } from './icons'
import { isCoarsePointer } from './HelpOverlay'
import { useTour } from '../tour/engine'
import { rich, useLang, useT } from '../i18n'
import { itemTitle } from '../i18n/content'

/** Subtle bottom-centre pill for the item the visitor is standing near. */
export function ProximityPrompt() {
  const nearby = useMuseum((s) => s.nearby)
  const blocked = useMuseum((s) => s.phase !== 'entered' || !!s.selection || !!s.inspecting || s.helpOpen)
  const select = useMuseum((s) => s.select)
  const touring = useTour((s) => s.active)
  const t = useT()
  const lang = useLang()

  // Remember the last item so the pill can fade out with its text intact.
  const [last, setLast] = useState<(Selection & { title: string }) | null>(nearby)
  if (nearby && (nearby.id !== last?.id || nearby.kind !== last?.kind || nearby.title !== last?.title)) setLast(nearby)

  const visible = !!nearby && !blocked && !touring
  const coarse = isCoarsePointer()
  const item = nearby ?? last

  return (
    <button
      type="button"
      className={`ui-prompt ui-panel${visible ? ' is-visible' : ''}`}
      aria-hidden={!visible || undefined}
      tabIndex={visible ? 0 : -1}
      onClick={() => {
        if (item) select({ kind: item.kind, id: item.id })
      }}
    >
      <span className="ui-prompt__mark" aria-hidden="true">
        <IconInfo />
      </span>
      <span className="ui-prompt__title">{item ? itemTitle(item.kind, item.id, lang, item.title) : ''}</span>
      <span className="ui-prompt__sep" aria-hidden="true">
        ·
      </span>
      <span className="ui-prompt__action">
        {coarse ? t('prompt.tap') : rich(t('prompt.press'), { key: <kbd className="ui-kbd">E</kbd> })}
      </span>
    </button>
  )
}
