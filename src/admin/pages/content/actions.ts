/** Content writes shared by the list (bulk) and the editor: undo of a delete, copy across exhibitions, sequential runs. */
import type { ContentCollection } from '../../../museum/content/types'
import { isConflict, request, type Item, type Revision, type SavedItem } from '../../api'
import { exQuery } from '../../exhibitionsApi'
import { errMsg } from '../../ui'
import { stripInternal } from './model'

export { stampKey, type Stamps } from './stamps'

/** `?exhibition=<id>`: an explicit exhibition, else the selection now ('' = the default). */
const exParam = (exhibition: string | undefined) => (exhibition === undefined ? exQuery() : exhibition ? `?exhibition=${encodeURIComponent(exhibition)}` : '')
const itemUrl = (c: ContentCollection, id: string, rest: string, exhibition: string | undefined) => `/api/admin/content/${c}/${encodeURIComponent(id)}${rest}${exParam(exhibition)}`

/**
 * Puts an item back as it was at revision `rev`, guarded like a save: `expected` is 'new' when bringing a
 * deleted item back (409 if someone has made the id again since) or the current stamp when replacing a version.
 */
export function restoreRevision(c: ContentCollection, id: string, rev: number, expected: string, exhibition?: string) {
  return request<{ item: Item; updatedAt: string }>('POST', itemUrl(c, id, '/restore', exhibition), { rev }, { 'x-expected-updated-at': expected })
}

/**
 * Brings a deleted item back from its delete revision, in the exhibition the delete ran in (`exhibition`,
 * captured when deleting: the toast outlives a switch of exhibition). Refuses when the item has been made
 * again since, instead of replacing that newer item.
 */
export async function undoDelete(c: ContentCollection, id: string, exhibition: string): Promise<SavedItem> {
  const { revisions } = await request<{ revisions: Revision[] }>('GET', itemUrl(c, id, '/history', exhibition))
  const last = revisions[0]
  if (!last || last.op !== 'delete') {
    if (revisions.some((r) => r.op === 'delete')) throw new Error('An item with this id has been saved since, so it was left as it is.')
    throw new Error('This item can’t be brought back any more.')
  }
  const r = await restoreRevision(c, id, last.rev, 'new', exhibition)
  return { ...r.item, updatedAt: r.updatedAt }
}

/**
 * Saves a copy of `item` into another exhibition. Without `overwrite` an item with the same id
 * already there is left alone (reported as skipped).
 */
export async function copyToExhibition(c: ContentCollection, item: Item, exhibitionId: string, overwrite: boolean): Promise<'copied' | 'skipped'> {
  const body = stripInternal(item) as Item
  try {
    await request<SavedItem>('PUT', `/api/admin/content/${c}/${encodeURIComponent(item.id)}?exhibition=${encodeURIComponent(exhibitionId)}`, body, overwrite ? undefined : { 'x-expected-updated-at': 'new' })
    return 'copied'
  } catch (e) {
    if (!overwrite && isConflict(e)) return 'skipped'
    throw e
  }
}

export interface RunResult<T> {
  done: { id: string; value: T }[]
  failed: { id: string; message: string }[]
}

/** Runs `fn` for each id one after another (never in parallel), collecting failures instead of stopping. */
export async function runSequential<T>(ids: readonly string[], fn: (id: string) => Promise<T>, onProgress?: (n: number) => void): Promise<RunResult<T>> {
  const out: RunResult<T> = { done: [], failed: [] }
  for (const [i, id] of ids.entries()) {
    try {
      out.done.push({ id, value: await fn(id) })
    } catch (e) {
      out.failed.push({ id, message: errMsg(e) })
    }
    onProgress?.(i + 1)
  }
  return out
}

/** "3 items couldn’t be deleted: a (reason), b (reason)…" */
export function failureText(verb: string, failed: RunResult<unknown>['failed']) {
  const head = failed.length === 1 ? `1 item couldn’t be ${verb}` : `${failed.length} items couldn’t be ${verb}`
  const list = failed
    .slice(0, 3)
    .map((f) => `${f.id} (${f.message})`)
    .join(', ')
  return `${head}: ${list}${failed.length > 3 ? ` and ${failed.length - 3} more` : ''}. They stay selected.`
}
