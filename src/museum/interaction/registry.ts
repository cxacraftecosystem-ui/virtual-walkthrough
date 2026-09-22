/**
 * Registry of interactive items with their world placement. Components register on
 * mount (artworks after their frame size is known) so navigation can compute
 * viewing positions and proximity prompts without knowing about rendering.
 */
import type { Vec3 } from '../config/museum'
import type { SelectionKind } from '../state/store'

export interface InteractiveItem {
  id: string
  kind: SelectionKind
  title: string
  /** Visual centre of the item. */
  center: Vec3
  /** Outward normal (XZ) of the wall/table face the visitor looks at. */
  normal: Vec3
  /** Visible width/height (m). */
  size: [number, number]
  /** Preferred viewing distance override (m). */
  viewDistance?: number
}

export const interactiveItems = new Map<string, InteractiveItem>()

export function registerItem(item: InteractiveItem) {
  const key = `${item.kind}:${item.id}`
  interactiveItems.set(key, item)
  return () => {
    if (interactiveItems.get(key) === item) interactiveItems.delete(key)
  }
}

export function getItem(kind: SelectionKind, id: string) {
  return interactiveItems.get(`${kind}:${id}`)
}
