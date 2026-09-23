import { MUSEUM } from '../config/museum'
import { getItem } from '../interaction/registry'
import { visitor } from '../state/visitor'
import { useMuseum, type SelectionKind } from '../state/store'
import { resolveCircle } from './collision'

/** Walk the visitor to a comfortable viewing position in front of an item and turn to face it. */
export function focusOn(kind: SelectionKind, id: string, onArrive?: () => void) {
  const item = getItem(kind, id)
  if (!item) return false
  const [cx, cy, cz] = item.center
  const [nx, , nz] = item.normal
  const [w, h] = item.size
  const dist = item.viewDistance ?? Math.min(3.0, Math.max(1.7, Math.max(w, h) * 1.05 + 0.85))
  const p = resolveCircle(cx + nx * dist, cz + nz * dist, MUSEUM.visitor.collisionRadius + 0.02)
  const dx = cx - p.x
  const dz = cz - p.z
  const horiz = Math.max(0.3, Math.hypot(dx, dz))
  const yaw = Math.atan2(-dx, -dz)
  const pitch = Math.atan2(cy - MUSEUM.visitor.eyeHeight, horiz) * 0.85
  if (useMuseum.getState().reducedMotion) {
    // Reduced motion: no camera glide — cut straight to the viewing position.
    Object.assign(visitor, { x: p.x, z: p.z, yaw, pitch, vx: 0, vz: 0, walkTarget: null })
    if (onArrive) window.setTimeout(onArrive, 0)
    return true
  }
  visitor.walkTarget = { x: p.x, z: p.z, yaw, pitch, onArrive }
  return true
}

/** Walk to a floor point (click-to-walk). */
export function walkTo(x: number, z: number) {
  const p = resolveCircle(x, z, MUSEUM.visitor.collisionRadius + 0.02)
  visitor.walkTarget = { x: p.x, z: p.z }
}
