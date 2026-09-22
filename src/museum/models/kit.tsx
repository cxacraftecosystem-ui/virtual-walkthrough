/**
 * PROCEDURAL MODEL KIT — geometry helpers shared by every procedural model.
 *
 * Conventions (same as the rest of the museum):
 *   - metres, +y up; a model's origin is the centre of its floor footprint and its
 *     "front" faces +z before the scene object's rotation is applied;
 *   - UVs are in METRES (1 uv unit = 1 m) so the shared tiling PBR materials read at
 *     true physical scale (see materials/geometry.ts).
 *
 * Draw calls are kept low with `Builder`: every part is added with a material key and
 * a transform, and each material's parts are merged into ONE BufferGeometry. Built
 * geometry sets are cached by a string key (objects with identical parameters —
 * the four atrium columns, say — share one set).
 */
import { useMemo } from 'react'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { createMeterBoxGeometry } from '../materials/geometry'

export type V3 = [number, number, number]

/* ------------------------------------------------------------------ */
/* UV helpers                                                          */
/* ------------------------------------------------------------------ */

/** Tri-planar-style box projection: each vertex gets metre UVs from its dominant normal axis. */
export function boxProjectUVs(geo: THREE.BufferGeometry, grain: 'x' | 'y' | 'z' = 'y'): THREE.BufferGeometry {
  const pos = geo.getAttribute('position')
  const nor = geo.getAttribute('normal')
  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const ax = Math.abs(nor.getX(i))
    const ay = Math.abs(nor.getY(i))
    const az = Math.abs(nor.getZ(i))
    let u: number
    let v: number
    if (ay >= ax && ay >= az) {
      // top/bottom: grain along x or z
      if (grain === 'x') [u, v] = [z, x]
      else [u, v] = [x, z]
    } else if (ax >= az) {
      if (grain === 'z') [u, v] = [y, z]
      else [u, v] = [z, y]
    } else {
      if (grain === 'x') [u, v] = [y, x]
      else [u, v] = [x, y]
    }
    uv[i * 2] = u
    uv[i * 2 + 1] = v
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  return geo
}

/* ------------------------------------------------------------------ */
/* Primitive factories (fresh geometry each call; Builder clones anyway) */
/* ------------------------------------------------------------------ */

/** Plain box with metre UVs. `grain` = axis the timber grain follows. */
export function box(w: number, h: number, d: number, grain?: 'x' | 'y' | 'z') {
  return createMeterBoxGeometry(w, h, d, grain ? { grainAxis: grain } : {})
}

/** Box with rounded edges (bevel radius r) — the default for anything hand-made. */
export function rbox(w: number, h: number, d: number, r = 0.006, seg = 2, grain: 'x' | 'y' | 'z' = 'y') {
  const rr = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)
  return boxProjectUVs(new RoundedBoxGeometry(w, h, d, seg, Math.max(1e-4, rr)), grain)
}

/** Cylinder along y with metre UVs (u = arc length, v = height). */
export function cyl(rTop: number, rBottom: number, h: number, radial = 16, open = false, heightSegs = 1) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, radial, heightSegs, open)
  const uv = g.getAttribute('uv')
  const pos = g.getAttribute('position')
  const nor = g.getAttribute('normal')
  const r = Math.max(rTop, rBottom)
  for (let i = 0; i < uv.count; i++) {
    if (Math.abs(nor.getY(i)) > 0.9) uv.setXY(i, pos.getX(i), pos.getZ(i))
    else uv.setXY(i, uv.getX(i) * Math.PI * 2 * r, uv.getY(i) * h)
  }
  return g
}

/** Cylinder lying along x. */
export function cylX(r: number, len: number, radial = 16) {
  const g = cyl(r, r, len, radial)
  g.rotateZ(Math.PI / 2)
  return g
}

/**
 * Lathe from a [radius, y] profile with metre UVs (u = arc length at the profile's max
 * radius, v = distance along the profile). Profile runs bottom → top.
 */
export function lathe(profile: [number, number][], segments = 32, phiLength = Math.PI * 2) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y))
  const g = new THREE.LatheGeometry(pts, segments, 0, phiLength)
  const rMax = Math.max(...profile.map((p) => p[0]))
  const lens = [0]
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + pts[i].distanceTo(pts[i - 1]))
  const uv = g.getAttribute('uv')
  // Lathe vertex order: for each segment j (0..segments), for each profile point i.
  const n = pts.length
  for (let k = 0; k < uv.count; k++) {
    const i = k % n
    uv.setXY(k, uv.getX(k) * phiLength * rMax, lens[i])
  }
  return g
}

/** Lathe with a per-profile-point vertex colour (bands of slip, glaze, soot…). */
export function latheColored(profile: [number, number][], colors: THREE.ColorRepresentation[], segments = 32) {
  const g = lathe(profile, segments)
  const n = profile.length
  const cols = profile.map((_, i) => new THREE.Color(colors[Math.min(i, colors.length - 1)]))
  const pos = g.getAttribute('position')
  const arr = new Float32Array(pos.count * 3)
  for (let k = 0; k < pos.count; k++) {
    const c = cols[k % n]
    arr[k * 3] = c.r
    arr[k * 3 + 1] = c.g
    arr[k * 3 + 2] = c.b
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  return g
}

/** Tube along a curve with metre UVs. */
export function tube(curve: THREE.Curve<THREE.Vector3>, radius: number, tubular = 24, radial = 8) {
  const g = new THREE.TubeGeometry(curve, tubular, radius, radial, false)
  const len = curve.getLength()
  const uv = g.getAttribute('uv')
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len, uv.getY(i) * Math.PI * 2 * radius)
  return g
}

/**
 * Sweeps a 2D cross-section profile [z, y] along x (length `len`, centred), e.g. a cloth
 * laid over a table and hanging down both long edges. UV: u = x / len (0..1),
 * v = arc length / total (0..1) — suited to one texture stretched over the whole piece.
 */
export function sweepX(profile: [number, number][], len: number, segX = 1) {
  const n = profile.length
  const lens = [0]
  for (let i = 1; i < n; i++) lens.push(lens[i - 1] + Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]))
  const total = lens[n - 1] || 1
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  for (let s = 0; s <= segX; s++) {
    const x = -len / 2 + (len * s) / segX
    for (let i = 0; i < n; i++) {
      pos.push(x, profile[i][1], profile[i][0])
      uv.push(s / segX, lens[i] / total)
    }
  }
  for (let s = 0; s < segX; s++)
    for (let i = 0; i < n - 1; i++) {
      const a = s * n + i
      const b = (s + 1) * n + i
      idx.push(a, a + 1, b, b, a + 1, b + 1)
    }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/** Rounded rectangle cross-section corner helper for sweep profiles. */
export function arc(cx: number, cy: number, r: number, a0: number, a1: number, steps = 4): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Builder — merge parts per material                                  */
/* ------------------------------------------------------------------ */

export interface PartOpts {
  p?: V3
  /** Euler rotation (radians, XYZ). */
  r?: V3
  s?: number | V3
  /** Per-vertex colour (for vertex-colour materials). */
  color?: THREE.ColorRepresentation
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()

function normalise(g: THREE.BufferGeometry, withColor: boolean): THREE.BufferGeometry {
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name)
  if (!g.getAttribute('normal')) g.computeVertexNormals()
  if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2))
  if (withColor && !g.getAttribute('color')) {
    const c = new Float32Array(g.getAttribute('position').count * 3).fill(1)
    g.setAttribute('color', new THREE.BufferAttribute(c, 3))
  }
  if (!withColor && g.getAttribute('color')) g.deleteAttribute('color')
  if (!g.index) {
    const n = g.getAttribute('position').count
    const idx = new (n > 65535 ? Uint32Array : Uint16Array)(n)
    for (let i = 0; i < n; i++) idx[i] = i
    g.setIndex(new THREE.BufferAttribute(idx, 1))
  }
  g.morphAttributes = {}
  return g
}

export class Builder {
  private groups = new Map<string, THREE.BufferGeometry[]>()

  /** Add `geo` (not modified — it is cloned) under material `key`. */
  add(key: string, geo: THREE.BufferGeometry, o: PartOpts = {}): this {
    const g = geo.clone()
    const s = o.s ?? 1
    _p.set(...(o.p ?? [0, 0, 0]))
    _q.setFromEuler(_e.set(...(o.r ?? [0, 0, 0])))
    if (typeof s === 'number') _s.setScalar(s)
    else _s.set(...s)
    _m.compose(_p, _q, _s)
    g.applyMatrix4(_m)
    if (o.color !== undefined) {
      const c = new THREE.Color(o.color)
      const n = g.getAttribute('position').count
      const arr = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        arr[i * 3] = c.r
        arr[i * 3 + 1] = c.g
        arr[i * 3 + 2] = c.b
      }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
    }
    let list = this.groups.get(key)
    if (!list) this.groups.set(key, (list = []))
    list.push(g)
    return this
  }

  /** Merge each material group into one geometry. */
  build(): BuiltParts {
    const out: BuiltParts = []
    for (const [key, list] of this.groups) {
      const withColor = list.some((g) => !!g.getAttribute('color'))
      const norm = list.map((g) => normalise(g, withColor))
      const merged = norm.length === 1 ? norm[0] : mergeGeometries(norm, false)
      if (!merged) continue
      merged.computeBoundingSphere()
      merged.computeBoundingBox()
      out.push({ key, geometry: merged })
      if (norm.length > 1) norm.forEach((g) => g.dispose())
    }
    this.groups.clear()
    return out
  }
}

export type BuiltParts = { key: string; geometry: THREE.BufferGeometry }[]

const builtCache = new Map<string, BuiltParts>()

/** Build (once per cache key) a merged part set. Cached sets are shared and never disposed. */
export function useBuilt(cacheKey: string, build: () => Builder): BuiltParts {
  return useMemo(() => {
    let hit = builtCache.get(cacheKey)
    if (!hit) {
      hit = build().build()
      builtCache.set(cacheKey, hit)
    }
    return hit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey])
}

/** Renders merged parts, resolving each key to a material. */
export function Parts({
  parts,
  materials,
  castShadow = true,
  receiveShadow = true,
}: {
  parts: BuiltParts
  materials: Record<string, THREE.Material | undefined>
  castShadow?: boolean
  receiveShadow?: boolean
}) {
  return (
    <>
      {parts.map(({ key, geometry }) => {
        const mat = materials[key]
        if (!mat) return null
        return <mesh key={key} geometry={geometry} material={mat} castShadow={castShadow} receiveShadow={receiveShadow} />
      })}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Deterministic randomness                                            */
/* ------------------------------------------------------------------ */

export function rng(seed: number | string) {
  let a = typeof seed === 'number' ? seed >>> 0 : hashStr(seed)
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hashStr(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
