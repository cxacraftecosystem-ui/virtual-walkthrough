/**
 * Museum walking controller: eye-level camera, damped look, WASD/arrows,
 * touch joystick, click-to-walk and focus glides — all collision-resolved.
 */
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { MUSEUM } from '../config/museum'
import { interactiveItems } from '../interaction/registry'
import { useMuseum, type SelectionKind } from '../state/store'
import { visitor } from '../state/visitor'
import { resolveCircle, segmentBlocked } from './collision'

const V = MUSEUM.visitor
const PITCH_LIMIT = (V.pitchLimitDeg * Math.PI) / 180
const TURN_SPEED = 1.6 // rad/s for arrow-key turning
const MOVE_KEYS = ['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Shift']
const tmp = { x: 0, z: 0 }

function isTypingTarget(t: EventTarget | null) {
  const el = t as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

function normKey(e: KeyboardEvent) {
  return e.key.length === 1 ? e.key.toLowerCase() : e.key
}

export function VisitorController() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const gl = useThree((s) => s.gl)
  const size = useThree((s) => s.size)
  const keys = useRef(new Set<string>())
  const look = useRef({ yaw: visitor.yaw, pitch: visitor.pitch, lastYaw: visitor.yaw, lastPitch: visitor.pitch })
  const stuck = useRef({ t: 0, d: Infinity })
  const proximityTimer = useRef(0)

  // Architectural FOV; guarantee a minimum horizontal FOV on portrait screens.
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height)
    const minH = (V.minHorizontalFov * Math.PI) / 180
    const vFromH = (2 * Math.atan(Math.tan(minH / 2) / aspect) * 180) / Math.PI
    camera.fov = Math.min(80, Math.max(V.fov, vFromH))
    camera.near = 0.05
    camera.far = 3000
    camera.updateProjectionMatrix()
  }, [camera, size])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
      const k = normKey(e)
      if (MOVE_KEYS.includes(k)) {
        keys.current.add(k)
        if (k.startsWith('Arrow')) e.preventDefault()
      }
    }
    const up = (e: KeyboardEvent) => keys.current.delete(normKey(e))
    const clear = () => keys.current.clear()
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', clear)
    }
  }, [])

  // Drag-to-look (mouse, pen, touch). No pointer lock: the cursor stays free for clicking artworks.
  useEffect(() => {
    const el = gl.domElement
    let active: number | null = null
    let lx = 0
    let ly = 0
    const onDown = (e: PointerEvent) => {
      if (active !== null) return
      active = e.pointerId
      lx = e.clientX
      ly = e.clientY
    }
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== active) return
      const dx = e.clientX - lx
      const dy = e.clientY - ly
      lx = e.clientX
      ly = e.clientY
      if (dx === 0 && dy === 0) return
      const s = V.lookSensitivity * (e.pointerType === 'touch' ? 1.5 : 1)
      look.current.yaw += dx * s
      look.current.pitch = THREE.MathUtils.clamp(look.current.pitch + dy * s, -PITCH_LIMIT, PITCH_LIMIT)
      // Manual look overrides any automatic turn of an ongoing walk.
      const t = visitor.walkTarget
      if (t && t.yaw !== undefined) visitor.walkTarget = { ...t, yaw: undefined, pitch: undefined }
    }
    const onUp = (e: PointerEvent) => {
      if (e.pointerId === active) active = null
    }
    el.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [gl])

  // Mouse look (pointer lock): moving the mouse turns the view directly, FPS-style
  // but damped; clicks target the centre crosshair (see the events.compute override).
  const mouseLook = useMuseum((s) => s.mouseLook)
  const setEvents = useThree((s) => s.setEvents)
  useEffect(() => {
    const el = gl.domElement
    if (mouseLook && document.pointerLockElement !== el) {
      try {
        const p = el.requestPointerLock() as unknown as Promise<void> | undefined
        p?.catch?.(() => useMuseum.getState().setMouseLook(false))
      } catch {
        useMuseum.getState().setMouseLook(false)
      }
    }
    if (!mouseLook && document.pointerLockElement === el) document.exitPointerLock()

    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== el) return
      const s = V.lookSensitivity * 0.75
      look.current.yaw -= e.movementX * s
      look.current.pitch = THREE.MathUtils.clamp(look.current.pitch - e.movementY * s, -PITCH_LIMIT, PITCH_LIMIT)
      const t = visitor.walkTarget
      if (t && t.yaw !== undefined) visitor.walkTarget = { ...t, yaw: undefined, pitch: undefined }
    }
    const onLockChange = () => {
      if (document.pointerLockElement !== el && useMuseum.getState().mouseLook) useMuseum.getState().setMouseLook(false)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('pointerlockchange', onLockChange)
    // While locked the cursor position is frozen, so raycast from the screen centre instead.
    setEvents({
      // Occlusion: only the NEAREST surface under the pointer receives events, so walls
      // (which have no handlers) block clicks/hover on exhibits behind them.
      filter: (items) => {
        if (items.length <= 1) return items
        const sorted = [...items].sort((a, b) => a.distance - b.distance)
        return [sorted[0]]
      },
      compute: (event, state) => {
        if (document.pointerLockElement === el) state.pointer.set(0, 0)
        else state.pointer.set((event.offsetX / state.size.width) * 2 - 1, -(event.offsetY / state.size.height) * 2 + 1)
        state.raycaster.setFromCamera(state.pointer, state.camera)
      },
    })
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('pointerlockchange', onLockChange)
    }
  }, [mouseLook, gl, setEvents])

  // Suspend pointer lock while a panel/viewer needs the cursor.
  useEffect(
    () =>
      useMuseum.subscribe((s, prev) => {
        if ((s.inspecting && !prev.inspecting) || (s.selection && !prev.selection)) {
          if (document.pointerLockElement) document.exitPointerLock()
        }
      }),
    [],
  )

  useFrame((_, rawDt) => {
    // In WebXR the headset owns the camera; src/museum/xr/VRRig.tsx drives `visitor` instead.
    if (gl.xr.isPresenting) return
    const dt = Math.min(rawDt, 0.05)
    const st = useMuseum.getState()
    const L = look.current
    const frozen = visitor.frozen || st.inspecting !== null || st.phase !== 'entered'

    // External teleports (reset, minimap) write visitor.yaw directly: resync look targets.
    if (visitor.yaw !== L.lastYaw || visitor.pitch !== L.lastPitch) {
      L.yaw = visitor.yaw
      L.pitch = visitor.pitch
    }

    // ── Input ────────────────────────────────────────────────────────
    const k = keys.current
    let fwd = 0
    let strafe = 0
    let turn = 0
    if (!frozen) {
      if (k.has('w') || k.has('ArrowUp')) fwd += 1
      if (k.has('s') || k.has('ArrowDown')) fwd -= 1
      if (k.has('d')) strafe += 1
      if (k.has('a')) strafe -= 1
      if (k.has('ArrowLeft')) turn += 1
      if (k.has('ArrowRight')) turn -= 1
      fwd += visitor.joystick.y
      strafe += visitor.joystick.x
    }
    const manual = Math.abs(fwd) + Math.abs(strafe) > 0.05
    if (manual || turn !== 0) visitor.walkTarget = null
    L.yaw += turn * TURN_SPEED * dt

    // ── Desired velocity ─────────────────────────────────────────────
    const sinY = Math.sin(visitor.yaw)
    const cosY = Math.cos(visitor.yaw)
    let tvx = 0
    let tvz = 0
    const speed = k.has('Shift') ? V.briskSpeed : V.walkSpeed
    if (manual) {
      const len = Math.max(1, Math.hypot(fwd, strafe))
      const f = fwd / len
      const s = strafe / len
      // forward = (-sin, -cos), right = (cos, -sin)
      tvx = (-sinY * f + cosY * s) * speed
      tvz = (-cosY * f - sinY * s) * speed
    } else if (visitor.walkTarget && !frozen) {
      const t = visitor.walkTarget
      if (t.yaw !== undefined) {
        const d = Math.atan2(Math.sin(t.yaw - L.yaw), Math.cos(t.yaw - L.yaw))
        L.yaw += d * (1 - Math.exp(-4 * dt))
        if (t.pitch !== undefined) L.pitch += (t.pitch - L.pitch) * (1 - Math.exp(-4 * dt))
      }
      const dx = t.x - visitor.x
      const dz = t.z - visitor.z
      const dist = Math.hypot(dx, dz)
      if (dist < 0.06) {
        const yawDone =
          t.yaw === undefined || Math.abs(Math.atan2(Math.sin(t.yaw - L.yaw), Math.cos(t.yaw - L.yaw))) < 0.03
        if (yawDone) {
          visitor.walkTarget = null
          t.onArrive?.()
        }
      } else {
        const sp = V.walkSpeed * 1.1 * Math.min(1, dist / 0.7)
        tvx = (dx / dist) * sp
        tvz = (dz / dist) * sp
        // Stuck detection: no progress for ~0.8 s → give up gracefully.
        stuck.current.t += dt
        if (stuck.current.t > 0.8) {
          if (stuck.current.d - dist < 0.05) visitor.walkTarget = null
          stuck.current.t = 0
          stuck.current.d = dist
        }
      }
    } else {
      stuck.current.t = 0
      stuck.current.d = Infinity
    }

    const a = 1 - Math.exp(-V.acceleration * dt)
    visitor.vx += (tvx - visitor.vx) * a
    visitor.vz += (tvz - visitor.vz) * a

    // ── Integrate + collide (slide along walls) ──────────────────────
    resolveCircle(visitor.x + visitor.vx * dt, visitor.z + visitor.vz * dt, V.collisionRadius, tmp)
    if (dt > 0) {
      visitor.vx = (tmp.x - visitor.x) / dt
      visitor.vz = (tmp.z - visitor.z) / dt
    }
    visitor.x = tmp.x
    visitor.z = tmp.z

    // ── Damped look ──────────────────────────────────────────────────
    const la = 1 - Math.exp(-V.lookDamping * dt)
    visitor.yaw += (L.yaw - visitor.yaw) * la
    visitor.pitch += (L.pitch - visitor.pitch) * la
    L.lastYaw = visitor.yaw
    L.lastPitch = visitor.pitch

    camera.position.set(visitor.x, V.eyeHeight, visitor.z)
    camera.rotation.set(visitor.pitch, visitor.yaw, 0, 'YXZ')

    // ── Proximity prompt (4 Hz) ──────────────────────────────────────
    proximityTimer.current += dt
    if (proximityTimer.current > 0.25) {
      proximityTimer.current = 0
      let best: { kind: SelectionKind; id: string; title: string } | null = null
      let bestScore = Infinity
      const fx = -sinY
      const fz = -cosY
      for (const it of interactiveItems.values()) {
        const dx = it.center[0] - visitor.x
        const dz = it.center[2] - visitor.z
        const dist = Math.hypot(dx, dz)
        if (dist > 3.4 || dist < 0.2) continue
        // Visitor must be on the display side and roughly facing it.
        if (-(dx * it.normal[0] + dz * it.normal[2]) < 0.25) continue
        const facing = (dx * fx + dz * fz) / dist
        if (facing < 0.55) continue
        const ox = it.center[0] + it.normal[0] * 0.35
        const oz = it.center[2] + it.normal[2] * 0.35
        if (segmentBlocked(visitor.x, visitor.z, ox, oz, (c) => c.id.startsWith('table-') || c.id.startsWith('bench'))) continue
        const score = dist * (2 - facing)
        if (score < bestScore) {
          bestScore = score
          best = { kind: it.kind, id: it.id, title: it.title }
        }
      }
      const cur = st.nearby
      if ((cur?.id ?? null) !== (best?.id ?? null) || cur?.kind !== best?.kind) st.setNearby(best)
    }
  })

  return null
}
