/**
 * <Speaker /> — a visible surround loudspeaker: dark satin cabinet, fabric grille and a
 * very faint level-reactive status LED. Surround / rear units near a wall get a short
 * bracket to it. Speakers hidden behind a (perforated) screen are not drawn at all.
 */
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { zoneAt } from '../config/layout'
import type { Vec3 } from '../config/museum'
import type { SpeakerChannel } from '../config/videos'
import { getVideoRoute } from './videoAudio'

const SIZE: Record<SpeakerChannel, Vec3> = {
  FL: [0.34, 0.62, 0.34],
  FR: [0.34, 0.62, 0.34],
  C: [0.72, 0.28, 0.32],
  LFE: [0.52, 0.52, 0.52],
  SL: [0.25, 0.4, 0.2],
  SR: [0.25, 0.4, 0.2],
  BL: [0.25, 0.4, 0.2],
  BR: [0.25, 0.4, 0.2],
}

let grilleTex: THREE.Texture | null = null
function grilleTexture() {
  if (grilleTex) return grilleTex
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  if (g) {
    g.fillStyle = '#2a2a2d'
    g.fillRect(0, 0, 64, 64)
    // fine plain weave
    for (let i = 0; i < 64; i += 2) {
      g.fillStyle = 'rgba(0,0,0,0.35)'
      g.fillRect(i, 0, 1, 64)
      g.fillStyle = 'rgba(255,255,255,0.045)'
      g.fillRect(0, i, 64, 1)
    }
  }
  grilleTex = new THREE.CanvasTexture(c)
  grilleTex.wrapS = grilleTex.wrapT = THREE.RepeatWrapping
  grilleTex.colorSpace = THREE.SRGBColorSpace
  grilleTex.anisotropy = 4
  return grilleTex
}

const cabinetMat = new THREE.MeshStandardMaterial({ color: '#141417', roughness: 0.5, metalness: 0.05 })
const bracketMat = new THREE.MeshStandardMaterial({ color: '#1c1c1f', roughness: 0.4, metalness: 0.7 })
let grilleMat: THREE.MeshStandardMaterial | null = null
function getGrilleMat() {
  if (!grilleMat) {
    const t = grilleTexture().clone()
    t.repeat.set(10, 10)
    t.needsUpdate = true
    grilleMat = new THREE.MeshStandardMaterial({ map: t, color: '#ffffff', roughness: 1, metalness: 0 })
  }
  return grilleMat
}

export interface SpeakerProps {
  videoId: string
  channel: SpeakerChannel
  position: Vec3
  /** Listening point the cabinet is aimed at. */
  aim: Vec3
}

export function Speaker({ videoId, channel, position, aim }: SpeakerProps) {
  const [w, h, d] = SIZE[channel]
  const led = useRef<THREE.MeshBasicMaterial>(null)
  const level = useRef(0)
  const acc = useRef(0)

  const { yaw, pitch, bracket } = useMemo(() => {
    const dx = aim[0] - position[0]
    const dz = aim[2] - position[2]
    const horiz = Math.max(0.01, Math.hypot(dx, dz))
    const yaw = Math.atan2(dx, dz)
    // Floor-standing units stay level; elevated ones tilt toward the audience.
    const pitch = position[1] > 1.8 ? Math.min(0.45, Math.atan2(position[1] - aim[1], horiz)) : 0
    // Wall bracket: nearest wall of the room, if within reach.
    let bracket: { mid: Vec3; len: number; q: THREE.Quaternion; plate: Vec3; plateRotY: number } | null = null
    const z = zoneAt(position[0], position[2])
    if (z && position[1] > 1.2) {
      const r = z.rect
      const cands: { dist: number; p: Vec3; rotY: number }[] = [
        { dist: position[0] - r.minX, p: [r.minX, position[1], position[2]], rotY: Math.PI / 2 },
        { dist: r.maxX - position[0], p: [r.maxX, position[1], position[2]], rotY: -Math.PI / 2 },
        { dist: position[2] - r.minZ, p: [position[0], position[1], r.minZ], rotY: 0 },
        { dist: r.maxZ - position[2], p: [position[0], position[1], r.maxZ], rotY: Math.PI },
      ]
      const best = cands.sort((a, b) => a.dist - b.dist)[0]
      if (best.dist < 0.9 && best.dist > 0.02) {
        const a = new THREE.Vector3(...position)
        const b = new THREE.Vector3(...best.p)
        const dir = b.clone().sub(a)
        const len = dir.length()
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
        const mid = a.clone().add(b).multiplyScalar(0.5)
        bracket = { mid: [mid.x, mid.y, mid.z], len, q, plate: best.p, plateRotY: best.rotY }
      }
    }
    return { yaw, pitch, bracket }
  }, [position, aim])

  useFrame((_, dt) => {
    const m = led.current
    if (!m) return
    acc.current += dt
    if (acc.current < 1 / 20) return
    const step = acc.current
    acc.current = 0
    const target = Math.min(1, (getVideoRoute(videoId)?.level(channel) ?? 0) * 6)
    // fast attack, slow release
    const k = target > level.current ? 1 - Math.exp(-step * 30) : 1 - Math.exp(-step * 4)
    level.current += (target - level.current) * k
    const v = 0.05 + 0.5 * level.current
    m.color.setRGB(v * 0.95, v, v * 1.05)
  })

  const grilleH = h - 0.035
  return (
    <group>
      <group position={position} rotation={[pitch, yaw, 0, 'YXZ']}>
        <mesh material={cabinetMat} castShadow receiveShadow>
          <boxGeometry args={[w, h, d]} />
        </mesh>
        {/* fabric grille, slightly proud of the baffle */}
        <mesh material={getGrilleMat()} position={[0, 0.0125, d / 2 + 0.004]}>
          <boxGeometry args={[w - 0.012, grilleH - 0.012, 0.008]} />
        </mesh>
        {/* status LED on the baffle strip below the grille */}
        <mesh position={[w / 2 - 0.03, -h / 2 + 0.0105, d / 2 + 0.0015]}>
          <circleGeometry args={[0.0035, 12]} />
          <meshBasicMaterial ref={led} color="#0d0d0d" toneMapped={false} />
        </mesh>
      </group>
      {bracket && (
        <>
          <mesh material={bracketMat} position={bracket.mid} quaternion={bracket.q}>
            <cylinderGeometry args={[0.014, 0.014, bracket.len, 10]} />
          </mesh>
          <mesh material={bracketMat} position={bracket.plate} rotation={[0, bracket.plateRotY, 0]}>
            <boxGeometry args={[0.1, 0.14, 0.012]} />
          </mesh>
        </>
      )}
    </group>
  )
}
