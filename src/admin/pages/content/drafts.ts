/**
 * Local draft autosave for the item editor: unsaved edits are kept in this browser
 * (localStorage `museum.admin.draft:<exhibition id>:<collection>:<id>`) so a reload, a crash or a closed
 * tab does not lose them. Offered back when the item is opened again; cleared on save, revert and
 * delete. Never shared with other curators.
 *
 * Keyed by the exhibition's id, never by the selection '' ("the default"): the default can move to another
 * exhibition (often a duplicate with the same item ids), and its drafts must not follow it there. Without a
 * known id (`null`, the exhibition list could not be read) nothing is kept or offered.
 */
import type { ContentCollection } from '../../../museum/content/types'

const PREFIX = 'museum.admin.draft:'
/** Drafts older than this are dropped when read. */
const MAX_AGE_MS = 30 * 86_400_000

export interface LocalDraft {
  draft: Record<string, unknown>
  /** The item had never been saved. */
  isNew: boolean
  /** The item's stamp when editing began (null for a new item). */
  baseUpdatedAt: string | null
  savedAt: string
}

export const draftKey = (exhibitionId: string, c: ContentCollection, id: string) => `${PREFIX}${exhibitionId}:${c}:${id}`

function parse(raw: string | null): LocalDraft | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as LocalDraft
    if (!v || typeof v !== 'object' || !v.draft || typeof v.draft !== 'object' || typeof v.savedAt !== 'string') return null
    if (Date.now() - new Date(v.savedAt).getTime() > MAX_AGE_MS) return null
    return v
  } catch {
    return null
  }
}

export function readDraft(exhibitionId: string | null, c: ContentCollection, id: string): LocalDraft | null {
  if (!exhibitionId) return null
  try {
    return parse(window.localStorage.getItem(draftKey(exhibitionId, c, id)))
  } catch {
    return null
  }
}

export function writeDraft(exhibitionId: string | null, c: ContentCollection, id: string, d: Omit<LocalDraft, 'savedAt'>) {
  if (!exhibitionId) return
  try {
    window.localStorage.setItem(draftKey(exhibitionId, c, id), JSON.stringify({ ...d, savedAt: new Date().toISOString() }))
  } catch {
    /* storage full or blocked: the in-memory draft still works */
  }
}

export function clearDraft(exhibitionId: string | null, c: ContentCollection, id: string) {
  if (!exhibitionId) return
  try {
    window.localStorage.removeItem(draftKey(exhibitionId, c, id))
  } catch {
    /* ignore */
  }
}

/** Never-saved items with a local draft in this collection (so a new item survives a reload). */
export function newDrafts(exhibitionId: string | null, c: ContentCollection): { id: string; draft: LocalDraft }[] {
  const out: { id: string; draft: LocalDraft }[] = []
  if (!exhibitionId) return out
  const pre = draftKey(exhibitionId, c, '')
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      if (!k || !k.startsWith(pre)) continue
      const d = parse(window.localStorage.getItem(k))
      if (d?.isNew) out.push({ id: k.slice(pre.length), draft: d })
    }
  } catch {
    /* ignore */
  }
  return out
}
