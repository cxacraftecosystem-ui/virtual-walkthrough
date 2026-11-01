/**
 * The stamp a content write is guarded with (`X-Expected-Updated-At`). Every save, delete and bulk change
 * of a saved item sends one, so a colleague's newer save is never overwritten unseen: the stamps list is
 * used when it has the item, otherwise it is fetched again on demand (it may still be loading, may have
 * failed, or may predate the item). When the fresh list does not have the item either, it has been deleted
 * meanwhile, and the write fails as the server would (a 409 with `current: null`). Nothing is sent unguarded.
 */
import type { ConflictBody, ContentStamp } from '../../api'

export type Stamps = Record<string, ContentStamp>
export const stampKey = (c: string, id: string) => `${c}/${id}`
/** The guard for a write to a saved item: its current stamp, or a thrown error (nothing to send). */
export type ExpectedFor = (collection: string, id: string) => Promise<string>

export const DELETED_MESSAGE = 'This item was deleted after you opened it. Saving now would bring it back.'
export const UNCHECKED_MESSAGE = 'Couldn’t check whether someone else changed this item, so nothing was sent. Try again.'

/** The body of the server's 409 for an item that is no longer there. */
export const DELETED_CONFLICT: ConflictBody = { error: 'conflict', message: DELETED_MESSAGE, current: null, updatedAt: null, updatedBy: null }

/**
 * `current()` reads the stamps held now (null while loading or after a failure); `load()` fetches the list
 * again (shared between concurrent callers by the page); `conflict(body)` makes the error a 409 would
 * (the page passes `new ApiError(409, …)`, so `isConflict` and ConflictDialog handle it as the server's).
 */
export function makeExpectedFor(current: () => Stamps | null, load: () => Promise<Stamps>, conflict: (body: ConflictBody) => Error): ExpectedFor {
  return async (collection, id) => {
    const key = stampKey(collection, id)
    const held = current()?.[key]
    if (held) return held.updatedAt
    let fresh: Stamps
    try {
      fresh = await load()
    } catch {
      throw new Error(UNCHECKED_MESSAGE)
    }
    const s = fresh[key] ?? current()?.[key]
    if (!s) throw conflict(DELETED_CONFLICT)
    return s.updatedAt
  }
}

/**
 * A fetched stamps list merged into the one held: a key whose held stamp is newer (a save of ours that landed
 * while the list was on its way) keeps it, so our next save is not refused against our own earlier one.
 */
export function mergeStamps(held: Stamps | null, fetched: Stamps): Stamps {
  if (!held) return fetched
  const out: Stamps = { ...fetched }
  for (const [k, f] of Object.entries(fetched)) {
    const h = held[k]
    if (h && Date.parse(h.updatedAt) > Date.parse(f.updatedAt)) out[k] = h
  }
  return out
}
