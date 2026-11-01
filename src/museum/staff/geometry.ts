/**
 * Pure geometry for the staff tools (src/museum/staff/StaffMode.tsx): where on a display surface the
 * camera is pointing, which surface is nearest, and where a world point lands on screen. No imports,
 * so it is unit-tested on its own (tests/unit/staff-geometry.test.ts) and works for any building.
 *
 * Surfaces are read through their published shape only (src/museum/config/layout.ts `DisplaySurface`):
 *   runAxis 'x'     wall face at z = face, `at` is world x
 *   runAxis 'z'     wall face at x = face, `at` is world z
 *   runAxis 'along' wall starts at `a`, runs along unit `dir`, `at` is metres from `a`
 * `range` bounds `at` and `height` bounds y in every case.
 */

export type Vec2 = readonly [number, number]
export type Vec3 = readonly [number, number, number]

export interface SurfaceGeom {
  id: string
  label?: string
  zone?: string
  runAxis: 'x' | 'z' | 'along'
  face?: number
  normal: Vec2
  range: Vec2
  height: number
  a?: Vec2
  dir?: Vec2
}

/** An axis-aligned box that blocks the view (a straight wall). */
export interface Box3 {
  min: Vec3
  max: Vec3
}

/** A surface as a line in plan: point(at) = origin + dir * at, valid for at in [lo, hi]. */
export interface SurfaceFrame {
  ox: number
  oz: number
  dx: number
  dz: number
  lo: number
  hi: number
}

export function surfaceFrame(s: SurfaceGeom): SurfaceFrame {
  const lo = Math.min(s.range[0], s.range[1])
  const hi = Math.max(s.range[0], s.range[1])
  if (s.runAxis === 'x') return { ox: 0, oz: s.face ?? 0, dx: 1, dz: 0, lo, hi }
  if (s.runAxis === 'z') return { ox: s.face ?? 0, oz: 0, dx: 0, dz: 1, lo, hi }
  const [ax, az] = s.a ?? [0, 0]
  const [ux, uz] = s.dir ?? [-s.normal[1], s.normal[0]]
  const len = Math.hypot(ux, uz) || 1
  return { ox: ax, oz: az, dx: ux / len, dz: uz / len, lo, hi }
}

/** The `at` of the point on the surface's line closest to (x, z) — not clamped to the range. */
export function surfaceAt(s: SurfaceGeom, x: number, z: number): number {
  const f = surfaceFrame(s)
  return (x - f.ox) * f.dx + (z - f.oz) * f.dz
}

/** World (x, z) of `at` on a surface (on the wall face itself). */
export function surfaceXZ(s: SurfaceGeom, at: number): [number, number] {
  const f = surfaceFrame(s)
  return [f.ox + f.dx * at, f.oz + f.dz * at]
}

/** Labels the `at` value the way the admin does. */
export const atAxisLabel = (s: Pick<SurfaceGeom, 'runAxis'>) => (s.runAxis === 'x' ? 'world x' : s.runAxis === 'z' ? 'world z' : 'metres along wall')

/**
 * Unit view direction of the visitor camera. `yaw` and `pitch` are the radians kept in
 * src/museum/state/visitor.ts (camera rotation order YXZ: yaw 0 looks down −z, +yaw turns west, +pitch up).
 */
export function viewDirection(yaw: number, pitch: number): [number, number, number] {
  const c = Math.cos(pitch)
  return [-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c]
}

/** Compass heading in degrees (0 = north/−z, 90 = east/+x) from the visitor's yaw, in [0, 360). */
export function compassDeg(yaw: number): number {
  const d = (-yaw * 180) / Math.PI
  return ((d % 360) + 360) % 360
}

export const round = (v: number, step = 0.01) => {
  const r = Math.round(v / step) * step
  // Trim float noise (0.1 * 3 = 0.30000000000000004) and the sign of a rounded zero.
  return Number(r.toFixed(step >= 1 ? 0 : Math.round(-Math.log10(step)))) || 0
}

export interface AimHit {
  surface: SurfaceGeom
  at: number
  /** Height of the point on the wall (m above the floor). */
  y: number
  distance: number
  point: [number, number, number]
}

const EPS = 1e-9

/** Distance along a ray to a surface's rectangle (either side), or null. `front` = the ray meets its display face. */
function hitSurface(s: SurfaceGeom, eye: Vec3, dir: Vec3, maxDist: number): { t: number; at: number; y: number; front: boolean } | null {
  const [nx, nz] = s.normal
  const denom = dir[0] * nx + dir[2] * nz
  if (Math.abs(denom) < EPS) return null
  const f = surfaceFrame(s)
  // Any point of the face plane: the frame origin lies on it.
  const t = ((f.ox - eye[0]) * nx + (f.oz - eye[2]) * nz) / denom
  if (t <= EPS || t > maxDist) return null
  const x = eye[0] + dir[0] * t
  const y = eye[1] + dir[1] * t
  const z = eye[2] + dir[2] * t
  if (y < 0 || y > s.height) return null
  const at = (x - f.ox) * f.dx + (z - f.oz) * f.dz
  if (at < f.lo || at > f.hi) return null
  return { t, at, y, front: denom < 0 }
}

/** Slab test: entry distance of a ray into a box, or null. */
function hitBox(b: Box3, eye: Vec3, dir: Vec3, maxDist: number): number | null {
  let t0 = 0
  let t1 = maxDist
  for (let i = 0; i < 3; i++) {
    const o = eye[i]
    const d = dir[i]
    const lo = b.min[i]
    const hi = b.max[i]
    if (Math.abs(d) < EPS) {
      if (o < lo || o > hi) return null
      continue
    }
    let a = (lo - o) / d
    let c = (hi - o) / d
    if (a > c) [a, c] = [c, a]
    t0 = Math.max(t0, a)
    t1 = Math.min(t1, c)
    if (t0 > t1) return null
  }
  // A ray starting inside a box (never for a visitor) is not blocked by it.
  return t0 > EPS ? t0 : null
}

/**
 * The display surface point the camera ray meets first, or null when it meets nothing within
 * `maxDist`, a wall's back, or a blocking box first. Every surface also blocks the view from behind,
 * so a wall between the visitor and another wall hides it even without `occluders`.
 */
export function aimSurface(surfaces: readonly SurfaceGeom[], eye: Vec3, dir: Vec3, occluders: readonly Box3[] = [], maxDist = 40): AimHit | null {
  let best: { s: SurfaceGeom; t: number; at: number; y: number; front: boolean } | null = null
  for (const s of surfaces) {
    const h = hitSurface(s, eye, dir, maxDist)
    if (h && (!best || h.t < best.t)) best = { s, ...h }
  }
  if (!best || !best.front) return null
  // The wall a surface hangs on shares its face plane: only something clearly nearer blocks it.
  for (const b of occluders) {
    const t = hitBox(b, eye, dir, best.t)
    if (t !== null && t < best.t - 0.03) return null
  }
  const point: [number, number, number] = [eye[0] + dir[0] * best.t, best.y, eye[2] + dir[2] * best.t]
  return { surface: best.s, at: best.at, y: best.y, distance: best.t, point }
}

/** True when something (a surface from either side, or a box) stands between `from` and `to`. */
export function lineBlocked(surfaces: readonly SurfaceGeom[], from: Vec3, to: Vec3, occluders: readonly Box3[] = [], clearance = 0.15): boolean {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const dz = to[2] - from[2]
  const len = Math.hypot(dx, dy, dz)
  if (len <= clearance) return false
  const dir: Vec3 = [dx / len, dy / len, dz / len]
  const reach = len - clearance
  for (const s of surfaces) if (hitSurface(s, from, dir, reach)) return true
  for (const b of occluders) if (hitBox(b, from, dir, reach) !== null) return true
  return false
}

export interface NearestSurface {
  surface: SurfaceGeom
  /** `at` of the closest point, clamped to the usable range. */
  at: number
  /** Plan distance from the point to that closest point (m). */
  distance: number
}

/**
 * The surface whose usable extent is closest to (x, z) in plan, only counting surfaces whose display
 * face looks toward the point. `zone`, when given, is preferred: another room's wall wins only if no
 * surface of that zone faces the point.
 */
export function nearestSurface(surfaces: readonly SurfaceGeom[], x: number, z: number, zone?: string): NearestSurface | null {
  let best: NearestSurface | null = null
  let bestInZone: NearestSurface | null = null
  for (const s of surfaces) {
    const f = surfaceFrame(s)
    const at = Math.min(f.hi, Math.max(f.lo, (x - f.ox) * f.dx + (z - f.oz) * f.dz))
    const px = f.ox + f.dx * at
    const pz = f.oz + f.dz * at
    // Behind the display face: not a wall this visitor could be standing at.
    if ((x - px) * s.normal[0] + (z - pz) * s.normal[1] < -0.05) continue
    const c: NearestSurface = { surface: s, at, distance: Math.hypot(x - px, z - pz) }
    if (!best || c.distance < best.distance) best = c
    if (zone && s.zone === zone && (!bestInZone || c.distance < bestInZone.distance)) bestInZone = c
  }
  return bestInZone ?? best
}

export interface ViewCamera {
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  /** Vertical field of view (deg). */
  fovDeg: number
  /** width / height */
  aspect: number
  near?: number
}

/** The museum camera's vertical FOV for a viewport (mirrors src/museum/navigation/VisitorController.tsx). */
export function cameraFov(width: number, height: number, fovDeg: number, minHorizontalFovDeg: number): number {
  const aspect = width / Math.max(1, height)
  const minH = (minHorizontalFovDeg * Math.PI) / 180
  const vFromH = (2 * Math.atan(Math.tan(minH / 2) / aspect) * 180) / Math.PI
  return Math.min(80, Math.max(fovDeg, vFromH))
}

/**
 * Normalised device coordinates of a world point (x, y in −1…1 when on screen, y up) and its depth in
 * front of the camera, or null when it is behind the camera.
 */
export function projectPoint(cam: ViewCamera, p: Vec3): { x: number; y: number; depth: number } | null {
  const px = p[0] - cam.x
  const py = p[1] - cam.y
  const pz = p[2] - cam.z
  const cy = Math.cos(cam.yaw)
  const sy = Math.sin(cam.yaw)
  const x1 = px * cy - pz * sy
  const z1 = px * sy + pz * cy
  const cp = Math.cos(cam.pitch)
  const sp = Math.sin(cam.pitch)
  const y2 = py * cp + z1 * sp
  const z2 = -py * sp + z1 * cp
  const depth = -z2
  if (depth < (cam.near ?? 0.05)) return null
  const k = Math.tan((cam.fovDeg * Math.PI) / 360)
  return { x: x1 / depth / (k * cam.aspect), y: y2 / depth / k, depth }
}
