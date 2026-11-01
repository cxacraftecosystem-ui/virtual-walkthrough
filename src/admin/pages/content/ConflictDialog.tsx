/**
 * Shown when a save finds the item changed since it was opened (409 from the server): keep my
 * version (overwrite), take theirs (drop my edits), or compare the two first.
 */
import { useState } from 'react'
import type { ContentCollection } from '../../../museum/content/types'
import type { ConflictBody } from '../../api'
import { Button, Modal, formatRelative } from '../../ui'
import { DiffTable } from './DiffTable'

export function ConflictDialog({
  collection,
  mine,
  conflict,
  busy,
  onKeepMine,
  onTakeTheirs,
  onClose,
}: {
  collection: ContentCollection
  mine: Record<string, unknown>
  conflict: ConflictBody
  busy: boolean
  onKeepMine: () => void
  onTakeTheirs: () => void
  onClose: () => void
}) {
  const [diff, setDiff] = useState(false)
  const who = conflict.updatedBy ?? 'Someone'
  const when = conflict.updatedAt ? formatRelative(conflict.updatedAt) : 'just now'
  const deleted = conflict.current === null
  return (
    <Modal
      title={deleted ? 'This item was deleted meanwhile' : 'This item changed while you were editing'}
      tone="warning"
      icon
      size={diff ? 'large' : 'medium'}
      busy={busy}
      onClose={onClose}
      description={deleted ? `${who} deleted it ${when}.` : `${who} saved it ${when}.`}
      footer={
        <>
          {!deleted ? (
            <Button variant="ghost" onClick={() => setDiff((d) => !d)} aria-expanded={diff}>
              {diff ? 'Hide differences' : 'View differences'}
            </Button>
          ) : null}
          <span className="spacer" />
          <Button onClick={onTakeTheirs} disabled={busy}>
            {deleted ? 'Discard my edits' : 'Take theirs'}
          </Button>
          <Button variant="primary" onClick={onKeepMine} loading={busy} loadingLabel="Saving…">
            {deleted ? 'Save mine again' : 'Keep mine'}
          </Button>
        </>
      }
    >
      <p className="confirm-body">
        {deleted
          ? 'Saving again brings it back with your version.'
          : '“Keep mine” replaces their version with yours. “Take theirs” discards your unsaved edits. Their version stays in the history either way.'}
      </p>
      {diff && !deleted ? <DiffTable collection={collection} left={mine} right={conflict.current} leftLabel="Mine" rightLabel="Theirs" /> : null}
    </Modal>
  )
}
