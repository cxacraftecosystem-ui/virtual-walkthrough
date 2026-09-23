/**
 * Other visitors as soft, translucent silhouettes (fresnel glow, fading toward the floor) with a
 * glowing head orb and a name tag; the verified docent wears a warm halo.
 *
 * Budget: a fixed pool of LIVE.maxVisible avatars (created once). Every frame the nearest peers
 * standing in zones visible from the visitor (zone culling) are assigned to pool slots;
 * LOD — full silhouette + tag within LIVE.nearM, orb only to LIVE.farM, hidden beyond.
 * Positions arrive at ≤5 Hz and are exponentially smoothed here.
 */
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { zoneAt } from '../config/layout'
import { getItem } from '../interaction/registry'
import { isZoneVisible } from '../navigation/zoneCulling'
import { visitor } from '../state/visitor'
import { LIVE } from './config'
import { DOCENT_COLOR, peerColor, peers, useLive, type Peer } from './store'

const VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying float vY;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  vY = position.y;
  gl_Position = projectionMatrix * mv;
}`
const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uFloor;
varying vec3 vN;
varying vec3 vV;
varying float vY;
void main() {
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
  float fade = smoothstep(uFloor, uFloor + 0.9, vY);
  float a = uOpacity * (0.16 + 0.84 * f) * fade;
  gl_FragColor = vec4(uColor * (0.75 + 0.9 * f), a);
}`

function glowMaterial(color: string, opacity: number, floor: number) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uFloor: { value: floor } },
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  })
}

/** Standing figure profile (metres) — shoulders ~1.4, crown at the head orb. */
function bodyGeometry() {
  const pts = [
    [0.0, 0.0],
    [0.17, 0.02],
    [0.2, 0.35],
    [0.21, 0.8],
    [0.23, 1.2],
    [0.2, 1.36],
    [0.1, 1.44],
    [0.06, 1.5],
    [0.0, 1.5],
  ].map(([r, y]) => new THREE.Vector2(r, y))
  const g = new THREE.LatheGeometry(pts, 20)
  g.computeVertexNormals()
  return g
}

interface Slot {
  group: THREE.Group
  body: THREE.Mesh
  head: THREE.Mesh
  halo: THREE.Mesh
  tag: THREE.Sprite
  tagCanvas: HTMLCanvasElement
  tagTex: THREE.CanvasTexture
  tagKey: string
  bodyMat: THREE.ShaderMaterial
  headMat: THREE.ShaderMaterial
  peer: string | null
  color: string
}

function drawTag(s: Slot, p: Peer) {
  const docent = !!p.docentOf
  const key = `${p.name}|${p.hand}|${docent}`
  if (key === s.tagKey) return
  s.tagKey = key
  const c = s.tagCanvas
  const ctx = c.getContext('2d')!
  const label = `${p.hand ? '✋ ' : ''}${p.name}`
  ctx.clearRect(0, 0, c.width, c.height)
  ctx.font = '600 44px Inter, system-ui, sans-serif'
  const w = Math.min(c.width - 8, ctx.measureText(label).width + 56)
  const h = docent ? 104 : 72
  const x = (c.width - w) / 2
  const y = c.height - h - 4
  ctx.fillStyle = 'rgba(28, 22, 17, 0.62)'
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, 20)
  ctx.fill()
  if (docent) {
    ctx.strokeStyle = 'rgba(242, 196, 109, 0.9)'
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.fillStyle = '#f2c46d'
    ctx.font = '600 24px Inter, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('LIVE DOCENT', c.width / 2, y + 32)
  }
  ctx.fillStyle = '#f7f1e6'
  ctx.font = '600 44px Inter, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(label, c.width / 2, y + h - 22, w - 40)
  s.tagTex.needsUpdate = true
}

const byDistance = (a: { d: number }, b: { d: number }) => a.d - b.d

function setColor(s: Slot, color: string) {
  if (s.color === color) return
  s.color = color
  ;(s.bodyMat.uniforms.uColor.value as THREE.Color).set(color)
  ;(s.headMat.uniforms.uColor.value as THREE.Color).set(color)
}

function peerVisible(p: Peer) {
  const z = zoneAt(p.x, p.z)
  return z ? isZoneVisible(z.id) : true
}

function Avatars() {
  const root = useRef<THREE.Group>(null)
  const pool = useMemo(() => {
    const body = bodyGeometry()
    const head = new THREE.SphereGeometry(0.13, 20, 14)
    const halo = new THREE.TorusGeometry(0.2, 0.012, 8, 40)
    const haloMat = new THREE.MeshBasicMaterial({ color: DOCENT_COLOR, transparent: true, opacity: 0.85, toneMapped: false, depthWrite: false })
    const slots: Slot[] = []
    for (let i = 0; i < LIVE.maxVisible; i++) {
      const group = new THREE.Group()
      group.visible = false
      const bodyMat = glowMaterial('#ffffff', 0.55, 0)
      const headMat = glowMaterial('#ffffff', 0.95, -1)
      const b = new THREE.Mesh(body, bodyMat)
      b.renderOrder = 5
      const h = new THREE.Mesh(head, headMat)
      h.position.y = 1.64
      h.renderOrder = 6
      const hl = new THREE.Mesh(halo, haloMat)
      hl.rotation.x = Math.PI / 2
      hl.position.y = 1.86
      const tagCanvas = document.createElement('canvas')
      tagCanvas.width = 512
      tagCanvas.height = 128
      const tagTex = new THREE.CanvasTexture(tagCanvas)
      tagTex.colorSpace = THREE.SRGBColorSpace
      const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tagTex, transparent: true, depthWrite: false, toneMapped: false }))
      tag.scale.set(0.9, 0.225, 1)
      tag.position.y = 2.02
      tag.renderOrder = 7
      group.add(b, h, hl, tag)
      slots.push({ group, body: b, head: h, halo: hl, tag, tagCanvas, tagTex, tagKey: '', bodyMat, headMat, peer: null, color: '' })
    }
    return { slots, dispose: () => [body, head, halo, haloMat].forEach((d) => d.dispose()) }
  }, [])

  useEffect(() => {
    const g = root.current
    if (!g) return
    for (const s of pool.slots) g.add(s.group)
    return () => {
      for (const s of pool.slots) {
        g.remove(s.group)
        s.bodyMat.dispose()
        s.headMat.dispose()
        s.tagTex.dispose()
        ;(s.tag.material as THREE.SpriteMaterial).dispose()
      }
      pool.dispose()
    }
  }, [pool])

  // Per-frame scratch containers, reused (no allocations in the render loop).
  const scratch = useMemo(
    () => ({
      list: [] as { p: Peer; d: number }[],
      entries: [] as { p: Peer; d: number }[],
      chosen: new Map<string, { p: Peer; d: number }>(),
      free: [] as Slot[],
      assigned: new Set<string>(),
    }),
    [],
  )
  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    const k = 1 - Math.exp(-8 * dt)
    const { list, entries, chosen, free, assigned } = scratch
    list.length = 0
    for (const p of peers.values()) {
      if (!p.has) continue
      // smoothing (snap on big jumps: teleports)
      if (Math.hypot(p.tx - p.x, p.tz - p.z) > 6) {
        p.x = p.tx
        p.z = p.tz
      } else {
        p.x += (p.tx - p.x) * k
        p.z += (p.tz - p.z) * k
      }
      p.yaw += Math.atan2(Math.sin(p.tyaw - p.yaw), Math.cos(p.tyaw - p.yaw)) * k
      const d = Math.hypot(p.x - visitor.x, p.z - visitor.z)
      if (d > LIVE.farM || d < 0.35 || !peerVisible(p)) continue
      const e = entries[list.length] ?? (entries[list.length] = { p, d })
      e.p = p
      e.d = d
      list.push(e)
    }
    list.sort(byDistance)
    const n = Math.min(list.length, pool.slots.length)
    // keep stable slot assignment where possible
    chosen.clear()
    for (let i = 0; i < n; i++) chosen.set(list[i].p.id, list[i])
    free.length = 0
    for (const s of pool.slots) {
      if (s.peer && chosen.has(s.peer)) continue
      s.peer = null
      s.group.visible = false
      free.push(s)
    }
    assigned.clear()
    for (const s of pool.slots) if (s.peer) assigned.add(s.peer)
    for (const c of chosen.values()) {
      if (assigned.has(c.p.id)) continue
      const s = free.pop()
      if (s) s.peer = c.p.id
    }
    const t = state.clock.elapsedTime
    for (const s of pool.slots) {
      if (!s.peer) continue
      const c = chosen.get(s.peer)
      if (!c) continue
      const { p, d } = c
      const docent = !!p.docentOf
      setColor(s, docent ? DOCENT_COLOR : peerColor(p.id))
      const near = d <= LIVE.nearM
      s.group.visible = true
      s.group.position.set(p.x, 0, p.z)
      s.group.rotation.y = p.yaw
      s.body.visible = near
      s.tag.visible = near
      s.halo.visible = docent
      s.head.position.y = 1.64 + Math.sin(t * 1.3 + p.x) * 0.015
      // orb grows a little with distance so it stays legible
      s.head.scale.setScalar(near ? 1 : 1 + (d - LIVE.nearM) / 20)
      s.bodyMat.uniforms.uOpacity.value = 0.5 * Math.min(1, (LIVE.nearM + 2 - d) / 4)
      if (near) {
        drawTag(s, p)
        const sc = 0.85 + d * 0.035 // canvas is 4:1
        s.tag.scale.set(sc, sc * 0.25, 1)
      }
      if (docent) s.halo.rotation.z = t * 0.6
    }
  })

  return <group ref={root} name="live-presence" />
}

/** Docent's pointer: a soft pulsing ring around the item the docent is showing. */
function FocusBeacon() {
  const focus = useLive((s) => s.focus)
  const ref = useRef<THREE.Mesh>(null)
  const geo = useMemo(() => new THREE.RingGeometry(0.47, 0.5, 64), [])
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: DOCENT_COLOR, transparent: true, opacity: 0.7, side: THREE.DoubleSide, toneMapped: false, depthWrite: false }), [])
  useEffect(
    () => () => {
      geo.dispose()
      mat.dispose()
    },
    [geo, mat],
  )
  useFrame((state) => {
    const m = ref.current
    if (!m) return
    const it = focus ? getItem(focus.kind as never, focus.id) : undefined
    if (!it) {
      m.visible = false
      return
    }
    m.visible = true
    const [cx, cy, cz] = it.center
    const [nx, , nz] = it.normal
    m.position.set(cx + nx * 0.06, cy, cz + nz * 0.06)
    m.lookAt(cx + nx, cy, cz + nz)
    const pulse = 1 + Math.sin(state.clock.elapsedTime * 3) * 0.04
    const r = Math.max(it.size[0], it.size[1]) * 0.62 + 0.12
    m.scale.setScalar(r * pulse)
    mat.opacity = 0.45 + 0.3 * (0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 3))
  })
  return <mesh ref={ref} geometry={geo} material={mat} visible={false} renderOrder={8} />
}

export function PresenceLayer() {
  const on = useLive((s) => s.status === 'online' || s.status === 'reconnecting')
  if (!on) return null
  return (
    <>
      <Avatars />
      <FocusBeacon />
    </>
  )
}
