/**
 * Auto-follow for joined tour visitors, driven through the existing walking controller:
 * nearby → `visitor.walkTarget` (collision-resolved glide, facing the docent);
 * far / other room / no line of sight → a faded teleport to a free spot behind the docent.
 */
import { zoneAt } from '../config/layout'
import { MUSEUM } from '../config/museum'
import { resolveCircle, segmentBlocked } from '../navigation/collision'
import { useMuseum } from '../state/store'
import { teleport, visitor } from '../state/visitor'
import { travel } from '../ui/Minimap'

const R = MUSEUM.visitor.collisionRadius
const KEEP = 1.8 // preferred distance from the docent (m)
const WALK_BEYOND = 2.6
const TELEPORT_BEYOND = 14
const ignoreLow = (c: { id: string }) => c.id.startsWith('table-') || c.id.startsWith('bench')
const tmp = { x: 0, z: 0 }

const last = { x: NaN, z: NaN, t: 0, teleportT: 0 }

export function resetFollow() {
  last.x = NaN
  last.z = NaN
  last.t = 0
}

function facingYaw(fromX: number, fromZ: number, toX: number, toZ: number) {
  // forward = (-sin y, -cos y)
  return Math.atan2(-(toX - fromX), -(toZ - fromZ))
}

/** A free spot ~KEEP m from the docent with line of sight to them. */
function spotNear(dx: number, dz: number, dyaw: number) {
  const angles = [0, 0.7, -0.7, 1.4, -1.4, Math.PI / 2 + 0.9, -(Math.PI / 2 + 0.9), Math.PI]
  for (const a of angles) {
    // behind the docent = +(sin, cos) of their yaw, rotated by `a`
    const y = dyaw + a
    const x = dx + Math.sin(y) * KEEP
    const z = dz + Math.cos(y) * KEEP
    resolveCircle(x, z, R + 0.05, tmp)
    if (!segmentBlocked(tmp.x, tmp.z, dx, dz, ignoreLow)) return { x: tmp.x, z: tmp.z }
  }
  resolveCircle(dx + 0.8, dz + 0.8, R + 0.05, tmp)
  return { x: tmp.x, z: tmp.z }
}

const MOVE_KEYS = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'])

/**
 * Walking yourself (keys / joystick) pauses auto-follow; the tour panel offers "Resume".
 * `isFollowing`/`pause` are passed in to keep this module free of the live store.
 */
export function installFollowOverride(isFollowing: () => boolean, pause: () => void) {
  const onKey = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
    if (MOVE_KEYS.has(e.key.toLowerCase()) && isFollowing()) pause()
  }
  window.addEventListener('keydown', onKey)
  const id = window.setInterval(() => {
    if ((Math.abs(visitor.joystick.x) > 0.2 || Math.abs(visitor.joystick.y) > 0.2) && isFollowing()) pause()
  }, 200)
  return () => {
    window.removeEventListener('keydown', onKey)
    window.clearInterval(id)
  }
}

export function followDocent(dx: number, dz: number, dyaw: number) {
  const st = useMuseum.getState()
  if (visitor.frozen || st.inspecting || st.phase !== 'entered') return
  const now = performance.now()
  const vx = visitor.x
  const vz = visitor.z
  const d = Math.hypot(dx - vx, dz - vz)
  const blocked = segmentBlocked(vx, vz, dx, dz, ignoreLow)
  const otherRoom = zoneAt(vx, vz)?.id !== zoneAt(dx, dz)?.id

  if (d > TELEPORT_BEYOND || (blocked && (otherRoom || d > 6))) {
    if (now - last.teleportT < 4000) return
    last.teleportT = now
    const s = spotNear(dx, dz, dyaw)
    const yaw = facingYaw(s.x, s.z, dx, dz)
    travel(() => teleport(s.x, s.z, (-yaw * 180) / Math.PI, 0))
    last.x = s.x
    last.z = s.z
    return
  }
  if (d <= WALK_BEYOND) return
  // Stand KEEP m short of the docent, on our side of them.
  const ux = (vx - dx) / d
  const uz = (vz - dz) / d
  resolveCircle(dx + ux * KEEP, dz + uz * KEEP, R + 0.05, tmp)
  const moved = Math.hypot(tmp.x - last.x, tmp.z - last.z)
  if (visitor.walkTarget && (moved < 0.6 || now - last.t < 500)) return
  last.x = tmp.x
  last.z = tmp.z
  last.t = now
  visitor.walkTarget = { x: tmp.x, z: tmp.z, yaw: facingYaw(tmp.x, tmp.z, dx, dz) }
}
