/** Version history of one item (newest first): who changed what, a field diff, and restore. */
import { useEffect, useState } from 'react'
import type { ContentCollection } from '../../../museum/content/types'
import { api, type Item, type Revision, type RevisionOp } from '../../api'
import { Badge, Button, Drawer, EmptyState, Skeleton, errMsg, formatDate, formatRelative, useConfirm, useToast, type BadgeTone } from '../../ui'
import { restoreRevision } from './actions'
import { DiffTable } from './DiffTable'
import { changedPaths, summarizeChanges } from './diff'

const OP: Record<RevisionOp, { label: string; tone: BadgeTone }> = {
  create: { label: 'Created', tone: 'ok' },
  update: { label: 'Edited', tone: 'neutral' },
  delete: { label: 'Deleted', tone: 'danger' },
  restore: { label: 'Restored', tone: 'info' },
}

export function HistoryDrawer({
  collection,
  id,
  current,
  dirty,
  expected,
  onRestored,
  onClose,
}: {
  collection: ContentCollection
  id: string
  /** The item as the editor shows it (what a version is compared with). */
  current: Record<string, unknown>
  dirty: boolean
  /** The item's current stamp: a restore is refused (409) when someone saved after it, as a save would be. */
  expected: () => Promise<string>
  onRestored: (item: Item, updatedAt: string) => void
  onClose: () => void
}) {
  const [revs, setRevs] = useState<Revision[] | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<number | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const confirm = useConfirm()
  const toast = useToast()

  useEffect(() => {
    let alive = true
    api
      .contentHistory(collection, id)
      .then((r) => alive && setRevs(r.revisions))
      .catch((e) => alive && setError(errMsg(e)))
    return () => {
      alive = false
    }
  }, [collection, id])

  async function restore(r: Revision) {
    const ok = await confirm({
      title: 'Restore this version?',
      body: dirty ? `The item goes back to how it was ${formatRelative(r.at)}. Your unsaved edits are discarded.` : `The item goes back to how it was ${formatRelative(r.at)}. The current version stays in the history.`,
      confirmLabel: 'Restore version',
      tone: dirty ? 'warning' : 'neutral',
    })
    if (!ok) return
    setBusy(r.rev)
    try {
      const res = await restoreRevision(collection, id, r.rev, await expected())
      toast('Version restored')
      onRestored(res.item, res.updatedAt)
      onClose()
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Drawer title="History" description={<span className="mono">{collection}/{id}</span>} onClose={onClose} wide>
      {error ? (
        <div className="alert">{error}</div>
      ) : revs === null ? (
        <Skeleton kind="list" rows={6} />
      ) : revs.length === 0 ? (
        <EmptyState title="No history yet" icon="clock" as="h3">Changes are recorded from the next save on.</EmptyState>
      ) : (
        <>
          <ol className="hist-list">
            {revs.map((r, i) => {
              const older = revs[i + 1]
              const paths = r.op === 'delete' ? [] : changedPaths(older?.item ?? null, r.item)
              const isLatest = i === 0
              const differsFromCurrent = !!r.item && changedPaths(r.item, current).length > 0
              return (
                <li key={r.rev}>
                  <div className="hist-row">
                    <Badge tone={OP[r.op].tone}>{OP[r.op].label}</Badge>
                    <div className="hist-text">
                      <span title={formatDate(r.at)}>
                        {formatRelative(r.at)} · {r.actorEmail ?? 'someone'}
                      </span>
                      <span className="muted small">
                        {r.op === 'delete' ? 'Moved to the trash' : r.op === 'create' || !older ? 'First version' : summarizeChanges(collection, paths)}
                      </span>
                    </div>
                    <div className="row">
                      {r.item && differsFromCurrent ? (
                        <Button size="sm" variant="ghost" aria-expanded={open === r.rev} onClick={() => setOpen(open === r.rev ? null : r.rev)}>
                          {open === r.rev ? 'Hide changes' : 'Compare'}
                        </Button>
                      ) : null}
                      {r.item && (!isLatest || differsFromCurrent) ? (
                        <Button size="sm" icon="undo" loading={busy === r.rev} loadingLabel="Restoring…" disabled={busy !== null} onClick={() => void restore(r)}>
                          Restore
                        </Button>
                      ) : isLatest ? (
                        <span className="muted small">Current</span>
                      ) : null}
                    </div>
                  </div>
                  {open === r.rev && r.item ? <DiffTable collection={collection} left={r.item} right={current} leftLabel="This version" rightLabel={dirty ? 'In the editor' : 'Current'} /> : null}
                </li>
              )
            })}
          </ol>
          {revs.length >= 100 ? <p className="muted small">Showing the latest 100 versions.</p> : null}
        </>
      )}
    </Drawer>
  )
}
