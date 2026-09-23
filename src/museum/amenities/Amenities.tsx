/**
 * <Amenities/> — scene-side visitor amenities (mounted once in MuseumScene):
 *
 *   RoomLights       recessed downlights + pooled accent washes for the shop and library
 *   Signage          door plaques and directional totems (zone names in the visitor's language)
 *   TrailMedallions  "Find the motifs" medallions — only while the visitor runs the trail
 *
 * The furniture itself is ordinary SCENE_OBJECTS (config/amenities.ts → models/shop|library).
 */
import type { ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { compassRotation, compassVec, SIGNS, TRAIL, TRAIL_SIZE, type SignConfig, type TrailMedallion } from '../config/amenities'
import { SIDE_ROOMS } from '../config/layout'
import { kelvinToHex } from '../config/lighting'
import { MUSEUM, type Vec3 } from '../config/museum'
import { useLang } from '../i18n'
import { registerSpot } from '../lighting/SpotPool'
import { useModelMaterials } from '../models/modelMaterials'
import { ZoneGroup } from '../navigation/zoneCulling'
import { useMuseum } from '../state/store'
import { useTrail } from '../trail/trail'
import { useAsyncTexture } from '../utils/useAsyncTexture'
import { medallionTextures, plaqueTexture, totemTexture } from './signTextures'

const RH = MUSEUM.reception.ceilingHeight
const WARM = kelvinToHex(3000, 0.6)

/* ------------------------------------------------------------------ */
/* Room lighting                                                       */
/* ------------------------------------------------------------------ */

const downlightMat = new THREE.MeshStandardMaterial({ color: '#fff8ee', emissive: new THREE.Color(kelvinToHex(3000, 0.35)), emissiveIntensity: 2.4 })
const trimMat = new THREE.MeshStandardMaterial({ color: '#c9b089', metalness: 0.8, roughness: 0.35 })

interface Wash {
  from: Vec3
  to: Vec3
  intensity: number
  angle: number
}

const S = SIDE_ROOMS.shop
const L = SIDE_ROOMS.library
/** Downlight / accent positions: shelves & bookcases washed from the ceiling, tables pooled. */
const WASHES: Wash[] = [
  // shop — east shelving (two washes per run), tables, stole rail, counter
  { from: [8.3, RH - 0.05, 2.1], to: [S.maxX - 0.2, 1.3, 2.1], intensity: 16, angle: 0.62 },
  { from: [8.3, RH - 0.05, 3.6], to: [S.maxX - 0.2, 1.3, 3.6], intensity: 16, angle: 0.62 },
  { from: [8.3, RH - 0.05, 5.2], to: [S.maxX - 0.2, 1.3, 5.2], intensity: 16, angle: 0.62 },
  { from: [8.3, RH - 0.05, 6.8], to: [S.maxX - 0.2, 1.3, 6.8], intensity: 16, angle: 0.62 },
  { from: [7.4, RH - 0.05, 3.25], to: [7.4, 0.78, 3.25], intensity: 11, angle: 0.55 },
  { from: [7.4, RH - 0.05, 5.75], to: [7.4, 0.78, 5.75], intensity: 11, angle: 0.55 },
  { from: [7.6, RH - 0.05, 6.6], to: [7.6, 1.1, S.maxZ - 0.3], intensity: 13, angle: 0.6 },
  { from: [6.9, RH - 0.05, 2.0], to: [6.9, 1.0, 1.1], intensity: 9, angle: 0.7 },
  // library — bookcases, reading table (the lamps add their own), lectern
  { from: [-8.6, RH - 0.05, 1.6], to: [L.minX + 0.2, 1.5, 1.6], intensity: 13, angle: 0.62 },
  { from: [-8.6, RH - 0.05, 3.9], to: [L.minX + 0.2, 1.5, 3.9], intensity: 13, angle: 0.62 },
  { from: [-8.6, RH - 0.05, 6.3], to: [L.minX + 0.2, 1.5, 6.3], intensity: 13, angle: 0.62 },
  { from: [-6.2, RH - 0.05, 2.2], to: [-5.95, 1.1, 1.35], intensity: 9, angle: 0.5 },
]

/** Visible recessed downlight discs on the side-room ceilings (a regular grid). */
const DISCS: [number, number][] = (() => {
  const out: [number, number][] = []
  for (const r of [S, L]) {
    const cx = (r.minX + r.maxX) / 2
    for (const dx of [-1.15, 1.15]) for (const z of [1.6, 3.6, 5.6, 7.3]) out.push([cx + dx, z])
  }
  return out
})()

function RoomLights() {
  useEffect(() => {
    const offs = WASHES.map((w) => registerSpot({ position: w.from, target: w.to, intensity: w.intensity, angle: w.angle, penumbra: 0.85, color: WARM }))
    return () => offs.forEach((f) => f())
  }, [])
  const disc = useMemo(() => new THREE.CircleGeometry(0.06, 20), [])
  const ring = useMemo(() => new THREE.RingGeometry(0.06, 0.075, 24), [])
  useEffect(
    () => () => {
      disc.dispose()
      ring.dispose()
    },
    [disc, ring],
  )
  return (
    <group>
      {DISCS.map(([x, z]) => (
        <group key={`${x}-${z}`} position={[x, RH - 0.002, z]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh geometry={disc} material={downlightMat} raycast={() => null} />
          <mesh geometry={ring} material={trimMat} raycast={() => null} />
        </group>
      ))}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Signage                                                             */
/* ------------------------------------------------------------------ */

const PLAQUE = { w: 0.46, h: 0.2 }
const TOTEM = { w: 0.5, h: 1.95, d: 0.14, face: 1.3 }

function Plaque({ sign }: { sign: SignConfig }) {
  const m = useModelMaterials()
  const lang = useLang()
  const line = sign.lines[0]
  const tex = useAsyncTexture(() => plaqueTexture(line, lang, PLAQUE.w, PLAQUE.h), [line.zone, lang])
  const rot = compassRotation(sign.facing)
  const [nx, nz] = compassVec(sign.facing)
  const [x, y, z] = sign.position
  return (
    <group position={[x + nx * 0.006, y, z + nz * 0.006]} rotation={[0, rot, 0]}>
      <mesh material={m.brass} position={[0, 0, 0.004]} raycast={() => null}>
        <boxGeometry args={[PLAQUE.w + 0.016, PLAQUE.h + 0.016, 0.008]} />
      </mesh>
      {tex && (
        <mesh position={[0, 0, 0.0085]} raycast={() => null}>
          <planeGeometry args={[PLAQUE.w, PLAQUE.h]} />
          <meshStandardMaterial map={tex} roughness={0.8} />
        </mesh>
      )}
    </group>
  )
}

function TotemFace({ sign, back }: { sign: SignConfig; back?: boolean }) {
  const lang = useLang()
  const facing = back ? (({ N: 'S', S: 'N', E: 'W', W: 'E', NE: 'SW', SW: 'NE', NW: 'SE', SE: 'NW' }) as const)[sign.facing] : sign.facing
  const key = sign.lines.map((l) => `${l.zone}:${l.dir ?? ''}`).join('|')
  const tex = useAsyncTexture(() => totemTexture(sign.lines, facing, lang, TOTEM.w - 0.06, TOTEM.face), [key, facing, lang])
  if (!tex) return null
  return (
    <mesh position={[0, TOTEM.h - 0.12 - TOTEM.face / 2, back ? -TOTEM.d / 2 - 0.0015 : TOTEM.d / 2 + 0.0015]} rotation={[0, back ? Math.PI : 0, 0]} raycast={() => null}>
      <planeGeometry args={[TOTEM.w - 0.06, TOTEM.face]} />
      <meshStandardMaterial map={tex} roughness={0.55} metalness={0.15} />
    </mesh>
  )
}

function Totem({ sign }: { sign: SignConfig }) {
  const m = useModelMaterials()
  const rot = compassRotation(sign.facing)
  return (
    <group position={sign.position} rotation={[0, rot, 0]}>
      <mesh material={m.walnut} position={[0, TOTEM.h / 2 + 0.03, 0]} castShadow receiveShadow raycast={() => null}>
        <boxGeometry args={[TOTEM.w, TOTEM.h - 0.06, TOTEM.d]} />
      </mesh>
      <mesh material={m.brass} position={[0, 0.015, 0]} raycast={() => null}>
        <boxGeometry args={[TOTEM.w + 0.06, 0.03, TOTEM.d + 0.06]} />
      </mesh>
      <mesh material={m.brass} position={[0, TOTEM.h + 0.006, 0]} raycast={() => null}>
        <boxGeometry args={[TOTEM.w + 0.02, 0.012, TOTEM.d + 0.02]} />
      </mesh>
      <TotemFace sign={sign} />
      <TotemFace sign={sign} back />
    </group>
  )
}

function Signage() {
  return (
    <group name="signage">
      {SIGNS.map((s) => (
        <ZoneGroup key={s.id} zones={s.zones}>
          {s.kind === 'plaque' ? <Plaque sign={s} /> : <Totem sign={s} />}
        </ZoneGroup>
      ))}
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* Discovery trail medallions                                          */
/* ------------------------------------------------------------------ */

const medallionGeo = new THREE.CylinderGeometry(TRAIL_SIZE / 2, TRAIL_SIZE / 2, 0.012, 40).rotateX(Math.PI / 2)

function Medallion({ m }: { m: TrailMedallion }) {
  const found = useTrail((s) => s.found.includes(m.id))
  const find = useTrail((s) => s.find)
  const [hover, setHover] = useState(false)
  const { map, bump } = useMemo(() => medallionTextures(m.motif, m.ink), [m.motif, m.ink])
  const faceMat = useMemo(
    () => new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 1.2, metalness: 0.75, roughness: 0.38, emissive: new THREE.Color('#ffcf85'), emissiveIntensity: 0 }),
    [map, bump],
  )
  const edgeMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#a47a3a', metalness: 0.9, roughness: 0.35 }), [])
  useEffect(() => {
    faceMat.emissiveIntensity = found ? 0.18 : hover ? 0.12 : 0
  }, [faceMat, found, hover])
  useEffect(
    () => () => {
      faceMat.dispose()
      edgeMat.dispose()
    },
    [faceMat, edgeMat],
  )
  const rot = compassRotation(m.facing)
  const [nx, nz] = compassVec(m.facing)
  const [x, y, z] = m.position
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (e.delta > 6 || useMuseum.getState().phase !== 'entered') return
    find(m.id)
  }
  return (
    <group position={[x + nx * 0.006, y, z + nz * 0.006]} rotation={[0, rot, 0]}>
      <mesh
        geometry={medallionGeo}
        material={[edgeMat, faceMat, edgeMat]}
        name={`trail-${m.id}`}
        onClick={onClick}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHover(true)
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={() => {
          setHover(false)
          document.body.style.cursor = ''
        }}
      />
    </group>
  )
}

function TrailMedallions() {
  const active = useTrail((s) => s.active)
  if (!active) return null
  return (
    <group name="trail">
      {TRAIL.map((m) => (
        <ZoneGroup key={m.id} zones={[m.zone]}>
          <Medallion m={m} />
        </ZoneGroup>
      ))}
    </group>
  )
}

/* ------------------------------------------------------------------ */

export function Amenities() {
  return (
    <group name="amenities">
      <ZoneGroup zones={['shop', 'library', 'reception']}>
        <RoomLights />
      </ZoneGroup>
      <Signage />
      <TrailMedallions />
    </group>
  )
}
