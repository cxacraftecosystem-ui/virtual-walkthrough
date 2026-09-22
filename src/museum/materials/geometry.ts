/**
 * Metre-UV box geometry.
 *
 * Convention used across the museum: 1 UV unit = 1 metre on every face, so a
 * material whose texture has `repeat = 1 / tileMetres` tiles at true physical
 * scale regardless of the box's size.
 *
 * Default per-face mapping (UVs start at 0 at the face's min corner, each face
 * right-handed as seen from outside so normal maps stay consistent):
 *   ±y (top/bottom): u along x, v along z  → oak floor planks (texture V) run along z
 *   ±x faces:        u along z, v along y
 *   ±z faces:        u along x, v along y
 *
 * `grainAxis` (optional) forces texture V to follow that world axis on every face
 * that contains it — e.g. a ceiling slat or bench running along x uses
 * `grainAxis: 'x'` so the timber grain runs down its length on all faces.
 */

import * as THREE from 'three'

export interface MeterBoxOptions {
  grainAxis?: 'x' | 'y' | 'z'
}

const cache = new Map<string, THREE.BufferGeometry>()

/**
 * Create a box (centred at the origin like THREE.BoxGeometry) with metre UVs.
 * Use `getMeterBoxGeometry` for shared, cached instances.
 */
export function createMeterBoxGeometry(w: number, h: number, d: number, options: MeterBoxOptions = {}): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d)
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const nor = geo.getAttribute('normal') as THREE.BufferAttribute
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute
  const hw = w / 2
  const hh = h / 2
  const hd = d / 2
  const grain = options.grainAxis

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + hw // 0..w
    const y = pos.getY(i) + hh // 0..h
    const z = pos.getZ(i) + hd // 0..d
    const nx = nor.getX(i)
    const ny = nor.getY(i)
    const nz = nor.getZ(i)
    let u: number
    let v: number
    // Axis carried by V in the default mapping, for grain overrides.
    let vAxis: 'x' | 'y' | 'z'
    let uAxis: 'x' | 'y' | 'z'
    if (Math.abs(ny) > 0.5) {
      // top: viewed from above, right = +x, up = -z
      u = x
      v = ny > 0 ? d - z : z
      uAxis = 'x'
      vAxis = 'z'
    } else if (Math.abs(nx) > 0.5) {
      // +x face: right = -z ; -x face: right = +z
      u = nx > 0 ? d - z : z
      v = y
      uAxis = 'z'
      vAxis = 'y'
    } else {
      // +z face: right = +x ; -z face: right = -x
      u = nz > 0 ? x : w - x
      v = y
      uAxis = 'x'
      vAxis = 'y'
    }
    if (grain && grain !== vAxis && grain === uAxis) {
      // rotate 90° in the face plane (keeps handedness): (u, v) → (v, -u)
      const t = u
      u = v
      v = -t
    }
    uv.setXY(i, u, v)
  }
  uv.needsUpdate = true
  return geo
}

/** Shared, cached metre-UV box. Do not dispose instances obtained here individually. */
export function getMeterBoxGeometry(w: number, h: number, d: number, options: MeterBoxOptions = {}): THREE.BufferGeometry {
  const key = `${w.toFixed(4)}|${h.toFixed(4)}|${d.toFixed(4)}|${options.grainAxis ?? ''}`
  let g = cache.get(key)
  if (!g) {
    g = createMeterBoxGeometry(w, h, d, options)
    cache.set(key, g)
  }
  return g
}
