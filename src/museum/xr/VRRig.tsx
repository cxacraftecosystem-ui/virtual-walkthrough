/**
 * VR rig for the museum canvas (only mounted while an immersive-vr session runs).
 *
 *  • XROrigin (the visitor's feet) starts where the desktop visitor stood, facing the same way;
 *    the museum renders at 1:1 (local-floor reference space, 1 unit = 1 m).
 *  • The head position drives `visitor.x/z/yaw`, so zone culling, the minimap and live presence
 *    keep working; physically walking into a wall pushes the origin back (resolveCircle).
 *  • Teleport: thumbstick forward shows a parabolic arc from that controller; walls block it and
 *    the landing spot is collision-resolved (furniture / walls → invalid, red). Release to jump.
 *  • Snap turn: thumbstick left/right (30°), around the head.
 *  • Trigger: select the artwork/object under the controller ray (walls occlude) → a world-space
 *    info card in front of you; trigger on the card or B/Y closes it.
 *  • Comfort vignette: brief blink on teleport, peripheral dim on snap turn.
 */
import { useFrame, useThree } from '@react-three/fiber'
import { XROrigin } from '@react-three/xr'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { zoneAt } from '../config/layout'
import { MUSEUM } from '../config/museum'
import { interactiveItems } from '../interaction/registry'
import { resolveCircle, segmentBlocked } from '../navigation/collision'
import { isZoneVisible } from '../navigation/zoneCulling'
import type { SelectionKind } from '../state/store'
import { visitor } from '../state/visitor'
import { CARD_H, CARD_W, cardInfo, drawCard } from './vrCard'

const R = MUSEUM.visitor.collisionRadius
const SNAP = (30 * Math.PI) / 180
const ARC_SPEED = 7.5
const GRAVITY = 9.8
const ARC_STEPS = 48
const ARC_DT = 0.035
const RAY_LEN = 12

const ignoreLow = (c: { id: string }) => c.id.startsWith('table-') || c.id.startsWith('bench')

interface Hand {
  aiming: boolean
  snapArmed: boolean
  trigger: boolean
  bButton: boolean
  valid: boolean
  target: THREE.Vector3
  origin: THREE.Vector3
  dir: THREE.Vector3
  has: boolean
}

const newHand = (): Hand => ({
  aiming: false,
  snapArmed: false,
  trigger: false,
  bButton: false,
  valid: false,
  target: new THREE.Vector3(),
  origin: new THREE.Vector3(),
  dir: new THREE.Vector3(),
  has: false,
})

const VIG_VERT = /* glsl */ `
varying vec3 vPos;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`
const VIG_FRAG = /* glsl */ `
uniform float uVig;
uniform float uFade;
varying vec3 vPos;
void main() {
  float c = -normalize(vPos).z;           // cos(angle from the view centre), per eye
  float edge = 1.0 - smoothstep(0.72, 0.93, c);
  float a = max(uFade, uVig * edge);
  gl_FragColor = vec4(0.02, 0.018, 0.015, a);
}`

type Hit = { kind: SelectionKind; id: string; point: THREE.Vector3; dist: number } | null

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _v = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _inv = new THREE.Matrix4()
const tmp = { x: 0, z: 0 }

/** Ray → nearest registered item (oriented rectangles), occluded by walls. */
function pickItem(o: THREE.Vector3, d: THREE.Vector3): Hit {
  let best: Hit = null
  for (const it of interactiveItems.values()) {
    const z = zoneAt(it.center[0], it.center[2])
    if (z && !isZoneVisible(z.id)) continue
    const nx = it.normal[0]
    const nz = it.normal[2]
    const nl = Math.hypot(nx, nz) || 1
    const Nx = nx / nl
    const Nz = nz / nl
    const denom = d.x * Nx + d.z * Nz
    if (Math.abs(denom) < 1e-3) continue
    const t = ((it.center[0] - o.x) * Nx + (it.center[2] - o.z) * Nz) / denom
    if (t < 0.05 || t > RAY_LEN || (best && t > best.dist)) continue
    const px = o.x + d.x * t
    const py = o.y + d.y * t
    const pz = o.z + d.z * t
    const u = (px - it.center[0]) * Nz - (pz - it.center[2]) * Nx
    const v = py - it.center[1]
    if (Math.abs(u) > it.size[0] / 2 + 0.06 || Math.abs(v) > it.size[1] / 2 + 0.06) continue
    if (segmentBlocked(o.x, o.z, px + Nx * 0.15, pz + Nz * 0.15, ignoreLow)) continue
    best = { kind: it.kind, id: it.id, point: new THREE.Vector3(px, py, pz), dist: t }
  }
  return best
}

export function VRRig() {
  const gl = useThree((s) => s.gl)
  const origin = useRef<THREE.Group>(null)
  const hands = useRef<Record<string, Hand>>({ left: newHand(), right: newHand() })
  const vig = useRef({ vig: 0, fade: 0 })
  const [card, setCard] = useState<{ kind: SelectionKind; id: string } | null>(null)
  const cardMesh = useRef<THREE.Mesh>(null)

  const parts = useMemo(() => {
    const arcGeo = new THREE.BufferGeometry()
    arcGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((ARC_STEPS + 1) * 3), 3))
    const arcMat = new THREE.LineBasicMaterial({ color: '#f3ead8', transparent: true, opacity: 0.9, toneMapped: false })
    const arc = new THREE.Line(arcGeo, arcMat)
    arc.frustumCulled = false
    arc.visible = false
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.28, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#f3ead8', transparent: true, opacity: 0.85, toneMapped: false, depthWrite: false }),
    )
    ring.visible = false
    const rays: THREE.Line[] = []
    for (let i = 0; i < 2; i++) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)])
      const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: '#fff4e0', transparent: true, opacity: 0.55, toneMapped: false }))
      l.frustumCulled = false
      l.visible = false
      rays.push(l)
    }
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 8), new THREE.MeshBasicMaterial({ color: '#f2c46d', toneMapped: false }))
    dot.visible = false
    const vignette = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 24, 16),
      new THREE.ShaderMaterial({
        vertexShader: VIG_VERT,
        fragmentShader: VIG_FRAG,
        uniforms: { uVig: { value: 0 }, uFade: { value: 0 } },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.BackSide,
      }),
    )
    vignette.renderOrder = 1000
    vignette.frustumCulled = false
    return { arc, ring, rays, dot, vignette }
  }, [])

  useEffect(
    () => () => {
      const { arc, ring, rays, dot, vignette } = parts
      for (const o of [arc, ring, dot, vignette, ...rays] as (THREE.Mesh | THREE.Line)[]) {
        o.geometry.dispose()
        ;(o.material as THREE.Material).dispose()
      }
    },
    [parts],
  )

  // Card texture
  const cardTex = useMemo(() => {
    if (!card) return null
    const info = cardInfo(card.kind, card.id)
    return info ? drawCard(info) : null
  }, [card])
  useEffect(() => () => cardTex?.dispose(), [cardTex])

  // Start where the desktop visitor stood.
  useEffect(() => {
    const o = origin.current
    if (!o) return
    o.position.set(visitor.x, 0, visitor.z)
    o.rotation.set(0, visitor.yaw, 0)
    visitor.walkTarget = null
    visitor.vx = 0
    visitor.vz = 0
    return () => {
      visitor.pitch = 0
      visitor.walkTarget = null
    }
  }, [])

  const placeCard = (head: THREE.Vector3, yaw: number) => {
    const m = cardMesh.current
    if (!m) return
    const fx = -Math.sin(yaw)
    const fz = -Math.cos(yaw)
    m.position.set(head.x + fx * 0.8, Math.max(1.0, head.y - 0.12), head.z + fz * 0.8)
    m.lookAt(head.x, m.position.y, head.z)
  }
  const pendingCardPlace = useRef<{ head: THREE.Vector3; yaw: number } | null>(null)

  useFrame((_, rawDt, frame?: XRFrame) => {
    const o = origin.current
    const refSpace = gl.xr.getReferenceSpace()
    if (!o || !frame || !refSpace) return
    const dt = Math.min(rawDt, 0.1)
    o.updateMatrixWorld()

    // ── Head ────────────────────────────────────────────────────────
    const pose = frame.getViewerPose(refSpace)
    if (!pose) return
    const p = pose.transform.position
    const head = _v.set(p.x, p.y, p.z).applyMatrix4(o.matrixWorld)
    const or = pose.transform.orientation
    _q.set(or.x, or.y, or.z, or.w).premultiply(o.quaternion)
    _e.setFromQuaternion(_q, 'YXZ')
    const headYaw = _e.y

    // physical walking vs walls: push the origin back
    resolveCircle(head.x, head.z, R, tmp)
    if (Math.abs(tmp.x - head.x) > 1e-4 || Math.abs(tmp.z - head.z) > 1e-4) {
      o.position.x += tmp.x - head.x
      o.position.z += tmp.z - head.z
      head.x = tmp.x
      head.z = tmp.z
      o.updateMatrixWorld()
    }
    visitor.x = head.x
    visitor.z = head.z
    visitor.yaw = headYaw
    visitor.pitch = 0

    if (pendingCardPlace.current) {
      placeCard(pendingCardPlace.current.head, pendingCardPlace.current.yaw)
      pendingCardPlace.current = null
    }

    // ── Controllers ────────────────────────────────────────────────
    const { arc, ring, rays, dot, vignette } = parts
    let arcShown = false
    let rayIdx = 0
    let dotShown = false
    for (const src of frame.session.inputSources) {
      const gp = src.gamepad
      if (!gp || (src.handedness !== 'left' && src.handedness !== 'right')) continue
      const h = hands.current[src.handedness]
      const rp = frame.getPose(src.targetRaySpace, refSpace)
      if (!rp) continue
      _m.fromArray(rp.transform.matrix).premultiply(o.matrixWorld)
      h.origin.setFromMatrixPosition(_m)
      h.dir.set(0, 0, -1).transformDirection(_m)
      h.has = true

      const ax = gp.axes.length >= 4 ? gp.axes[2] : (gp.axes[0] ?? 0)
      const ay = gp.axes.length >= 4 ? gp.axes[3] : (gp.axes[1] ?? 0)

      // teleport aim
      if (ay < -0.6 && Math.abs(ax) < 0.7) h.aiming = true
      if (h.aiming) {
        computeArc(h, arc)
        arcShown = true
        if (Math.abs(ay) < 0.25) {
          h.aiming = false
          if (h.valid) {
            o.position.x += h.target.x - head.x
            o.position.z += h.target.z - head.z
            head.x = h.target.x
            head.z = h.target.z
            vig.current.fade = 1
            if (card) setCard(null)
          }
        }
      } else {
        // snap turn
        if (!h.snapArmed && Math.abs(ax) > 0.7) {
          h.snapArmed = true
          const d = ax > 0 ? -SNAP : SNAP
          const dx = o.position.x - head.x
          const dz = o.position.z - head.z
          const c = Math.cos(d)
          const s = Math.sin(d)
          o.position.x = head.x + dx * c + dz * s
          o.position.z = head.z - dx * s + dz * c
          o.rotation.y += d
          vig.current.vig = 1
        } else if (Math.abs(ax) < 0.3) h.snapArmed = false
      }

      // selection ray
      const trig = !!gp.buttons[0]?.pressed
      const bBtn = !!(gp.buttons[5]?.pressed || gp.buttons[4]?.pressed)
      const onCard = cardHit(cardMesh.current, h.origin, h.dir)
      const hit = onCard ? null : pickItem(h.origin, h.dir)
      if (trig && !h.trigger) {
        if (onCard) setCard(null)
        else if (hit) {
          setCard({ kind: hit.kind, id: hit.id })
          pendingCardPlace.current = { head: head.clone(), yaw: headYaw }
        }
      }
      if (bBtn && !h.bButton && card) setCard(null)
      h.trigger = trig
      h.bButton = bBtn

      const ray = rays[rayIdx++]
      if (ray && !h.aiming) {
        const len = onCard ?? hit?.dist ?? 3
        const pos = ray.geometry.getAttribute('position') as THREE.BufferAttribute
        pos.setXYZ(0, h.origin.x, h.origin.y, h.origin.z)
        _v2.copy(h.dir).multiplyScalar(len).add(h.origin)
        pos.setXYZ(1, _v2.x, _v2.y, _v2.z)
        pos.needsUpdate = true
        ray.visible = true
        ;(ray.material as THREE.LineBasicMaterial).opacity = hit || onCard ? 0.9 : 0.35
        if ((hit || onCard) && !dotShown) {
          dot.position.copy(_v2)
          dot.visible = true
          dotShown = true
        }
      } else if (ray) ray.visible = false
    }
    for (let i = rayIdx; i < rays.length; i++) rays[i].visible = false
    if (!dotShown) dot.visible = false
    arc.visible = arcShown
    ring.visible = arcShown && [hands.current.left, hands.current.right].some((h) => h.aiming)
    if (ring.visible) {
      const h = hands.current.left.aiming ? hands.current.left : hands.current.right
      ring.position.set(h.target.x, 0.01, h.target.z)
      ;(ring.material as THREE.MeshBasicMaterial).color.set(h.valid ? '#f3ead8' : '#d0604a')
    }

    // ── Vignette ───────────────────────────────────────────────────
    const V = vig.current
    V.fade = Math.max(0, V.fade - dt * 4)
    V.vig = Math.max(V.fade, V.vig - dt * 3)
    const mat = vignette.material as THREE.ShaderMaterial
    mat.uniforms.uVig.value = Math.min(1, V.vig) * 0.85
    mat.uniforms.uFade.value = V.fade
    vignette.visible = V.vig > 0.01 || V.fade > 0.01
    vignette.position.copy(head)
    o.updateMatrixWorld()
  })

  return (
    <>
      <XROrigin ref={origin} />
      <primitive object={parts.arc} />
      <primitive object={parts.ring} />
      <primitive object={parts.rays[0]} />
      <primitive object={parts.rays[1]} />
      <primitive object={parts.dot} />
      <primitive object={parts.vignette} />
      <mesh ref={cardMesh} visible={!!cardTex} renderOrder={20}>
        <planeGeometry args={[CARD_W, CARD_H]} />
        <meshBasicMaterial map={cardTex} transparent toneMapped={false} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </>
  )
}

/** Distance along the ray to the info card, or null. */
function cardHit(m: THREE.Mesh | null, o: THREE.Vector3, d: THREE.Vector3): number | null {
  if (!m || !m.visible) return null
  m.updateMatrixWorld()
  _inv.copy(m.matrixWorld).invert()
  const lo = _v2.copy(o).applyMatrix4(_inv)
  const ld = new THREE.Vector3().copy(d).transformDirection(_inv)
  if (Math.abs(ld.z) < 1e-4) return null
  const t = -lo.z / ld.z
  if (t <= 0 || t > 4) return null
  const x = lo.x + ld.x * t
  const y = lo.y + ld.y * t
  return Math.abs(x) <= CARD_W / 2 && Math.abs(y) <= CARD_H / 2 ? t : null
}

/** Parabolic teleport arc; walls stop it; landing collision-resolved. Writes h.valid / h.target. */
function computeArc(h: Hand, arc: THREE.Line) {
  const pos = arc.geometry.getAttribute('position') as THREE.BufferAttribute
  let x = h.origin.x
  let y = h.origin.y
  let z = h.origin.z
  const vx = h.dir.x * ARC_SPEED
  let vy = h.dir.y * ARC_SPEED
  const vz = h.dir.z * ARC_SPEED
  let n = 0
  pos.setXYZ(n++, x, y, z)
  h.valid = false
  let landed = false
  for (let i = 0; i < ARC_STEPS; i++) {
    const nx = x + vx * ARC_DT
    let ny = y + vy * ARC_DT
    const nz = z + vz * ARC_DT
    vy -= GRAVITY * ARC_DT
    let fx = nx
    let fz = nz
    if (ny <= 0) {
      const t = y / (y - ny)
      fx = x + (nx - x) * t
      fz = z + (nz - z) * t
      ny = 0
      landed = true
    }
    if (segmentBlocked(x, z, fx, fz, ignoreLow) || ny > 4.2) {
      pos.setXYZ(n++, fx, Math.max(ny, 0), fz)
      break
    }
    x = fx
    y = ny
    z = fz
    pos.setXYZ(n++, x, y, z)
    if (landed) break
  }
  for (let i = n; i <= ARC_STEPS; i++) pos.setXYZ(i, x, y, z)
  pos.needsUpdate = true
  arc.geometry.setDrawRange(0, n)
  if (landed) {
    resolveCircle(x, z, R + 0.02, tmp)
    const moved = Math.hypot(tmp.x - x, tmp.z - z)
    h.target.set(tmp.x, 0, tmp.z)
    h.valid = moved < 0.35 && !!zoneAt(tmp.x, tmp.z)
  } else h.target.set(x, 0, z)
  ;(arc.material as THREE.LineBasicMaterial).color.set(h.valid ? '#f3ead8' : '#d0604a')
}
