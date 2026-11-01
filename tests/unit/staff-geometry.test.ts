/**
 * Staff tools geometry (src/museum/staff/geometry.ts, tourStop.ts): the display surface and `at` under
 * the centre of the view for walls running along x, along z and along any direction ('along'), the
 * nearest surface, screen projection, and tour stops captured from a view.
 *
 * npm test
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  aimSurface,
  atAxisLabel,
  cameraFov,
  compassDeg,
  lineBlocked,
  nearestSurface,
  projectPoint,
  round,
  surfaceAt,
  surfaceXZ,
  viewDirection,
  type SurfaceGeom,
} from '../../src/museum/staff/geometry'
import { appendStop, asStops, slugId, stopFromView, uniqueStopId } from '../../src/museum/staff/tourStop'
import { SURFACES } from '../../src/museum/config/layout'

const DEG = Math.PI / 180
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`)

/** Visitor yaw (radians, src/museum/state/visitor.ts) that looks along the plan direction (dx, dz). */
const yawFacing = (dx: number, dz: number) => Math.atan2(-dx, -dz)

// A 10 m square room: north wall (runs along x, faces +z), east wall (runs along z, faces −x), and a
// diagonal wall in the south-west corner described the 'along' way.
const north: SurfaceGeom = { id: 'north', zone: 'room', runAxis: 'x', face: -5, normal: [0, 1], range: [-5, 5], height: 4 }
const east: SurfaceGeom = { id: 'east', zone: 'room', runAxis: 'z', face: 5, normal: [-1, 0], range: [-5, 5], height: 4 }
const s2 = Math.SQRT1_2
// Starts at (−5, 2), runs toward (−2, 5); faces into the room (+x, −z).
const diag: SurfaceGeom = { id: 'diag', zone: 'room', runAxis: 'along', a: [-5, 2], dir: [s2, s2], normal: [s2, -s2], range: [0, 3 * Math.SQRT2], height: 3 }
const ROOM = [north, east, diag]

describe('surface frames', () => {
  it('measures at as world x, world z, or metres along the wall', () => {
    near(surfaceAt(north, 2.5, 0), 2.5)
    near(surfaceAt(east, 0, -1.25), -1.25)
    near(surfaceAt(diag, -3.5, 3.5), Math.hypot(1.5, 1.5))
    const [x, z] = surfaceXZ(diag, Math.SQRT2)
    near(x, -4)
    near(z, 3)
    assert.equal(atAxisLabel(north), 'world x')
    assert.equal(atAxisLabel(east), 'world z')
    assert.equal(atAxisLabel(diag), 'metres along wall')
  })
})

describe('aimSurface', () => {
  it('reads at and height on a wall running along x', () => {
    const hit = aimSurface(ROOM, [1.5, 1.6, 0], viewDirection(0, 0))
    assert.equal(hit?.surface.id, 'north')
    near(hit!.at, 1.5)
    near(hit!.y, 1.6)
    near(hit!.distance, 5)
  })

  it('reads at on a wall running along z, looking up', () => {
    const pitch = Math.atan2(0.5, 3) // rises 0.5 m over the 3 m to the wall
    const hit = aimSurface(ROOM, [2, 1.6, -2], viewDirection(yawFacing(1, 0), pitch))
    assert.equal(hit?.surface.id, 'east')
    near(hit!.at, -2)
    near(hit!.y, 2.1)
  })

  it('reads metres along an angled wall', () => {
    // Stand 2 m in front of the wall's midpoint, facing it.
    const mid = surfaceXZ(diag, 1.5 * Math.SQRT2)
    const eye: [number, number, number] = [mid[0] + 2 * s2, 1.5, mid[1] - 2 * s2]
    const hit = aimSurface(ROOM, eye, viewDirection(yawFacing(-s2, s2), 0))
    assert.equal(hit?.surface.id, 'diag')
    near(hit!.at, 1.5 * Math.SQRT2)
    near(hit!.distance, 2)
  })

  it('misses above the wall, beyond its range, behind it and past maxDist', () => {
    assert.equal(aimSurface([north], [0, 1.6, 0], viewDirection(0, 60 * DEG)), null) // over the 4 m wall
    assert.equal(aimSurface([north], [7, 1.6, 0], viewDirection(0, 0)), null) // x = 7 is past the range
    assert.equal(aimSurface([north], [0, 1.6, -8], viewDirection(Math.PI, 0)), null) // behind, looking south
    assert.equal(aimSurface([north], [0, 1.6, 0], viewDirection(0, 0), [], 4), null)
  })

  it('does not see through a wall, from either side or a blocking box', () => {
    const screen: SurfaceGeom = { id: 'screen', runAxis: 'x', face: -2, normal: [0, -1], range: [-1, 1], height: 3 }
    // The screen's display face looks north, so from here we meet its back first.
    assert.equal(aimSurface([north, screen], [0, 1.6, 0], viewDirection(0, 0)), null)
    // A box in between blocks as well; the wall the surface hangs on (sharing its plane) does not.
    const box = { min: [-1, 0, -3.2] as const, max: [1, 3, -3] as const }
    assert.equal(aimSurface([north], [0, 1.6, 0], viewDirection(0, 0), [box]), null)
    const host = { min: [-5, 0, -5.3] as const, max: [5, 4, -5] as const }
    assert.equal(aimSurface([north], [0, 1.6, 0], viewDirection(0, 0), [host])?.surface.id, 'north')
  })

  it('works for every surface of the building', () => {
    for (const s of Object.values(SURFACES) as SurfaceGeom[]) {
      const lo = Math.min(s.range[0], s.range[1])
      const hi = Math.max(s.range[0], s.range[1])
      const at = (lo + hi) / 2
      const y = Math.min(1.5, s.height / 2)
      const [x, z] = surfaceXZ(s, at)
      // 0.4 m in front of the face, looking straight at it.
      const eye: [number, number, number] = [x + s.normal[0] * 0.4, y, z + s.normal[1] * 0.4]
      const hit = aimSurface([s], eye, viewDirection(yawFacing(-s.normal[0], -s.normal[1]), 0))
      assert.ok(hit, `no hit on ${s.id}`)
      near(hit.at, at, 1e-6)
      near(hit.y, y, 1e-6)
    }
  })
})

describe('lineBlocked', () => {
  it('is blocked by a wall in between, not by the wall the target hangs on', () => {
    const screen: SurfaceGeom = { id: 'screen', runAxis: 'x', face: -2, normal: [0, -1], range: [-1, 1], height: 3 }
    assert.equal(lineBlocked([north, screen], [0, 1.6, 0], [0, 1.6, -4.95]), true)
    assert.equal(lineBlocked([north], [0, 1.6, 0], [0, 1.6, -4.95]), false)
  })
})

describe('nearestSurface', () => {
  it('finds the closest wall facing the point and clamps at to its range', () => {
    const n = nearestSurface(ROOM, 4, -4.2)
    assert.equal(n?.surface.id, 'north')
    near(n!.distance, 0.8)
    const c = nearestSurface([north], 9, 0)
    near(c!.at, 5) // clamped to the end of the range
  })

  it('ignores walls whose display face looks away, and prefers the current zone', () => {
    assert.equal(nearestSurface([north], 0, -7), null)
    const other: SurfaceGeom = { ...east, id: 'other', zone: 'next' }
    assert.equal(nearestSurface([north, other], 4.5, 0, 'room')?.surface.id, 'north')
    assert.equal(nearestSurface([north, other], 4.5, 0)?.surface.id, 'other')
  })

  it('handles angled walls', () => {
    const n = nearestSurface([diag], -3, 3)
    assert.equal(n?.surface.id, 'diag')
    near(n!.distance, Math.SQRT2 / 2) // the wall is the line z − x = 7; (−3, 3) has z − x = 6
  })
})

describe('camera', () => {
  it('turns the visitor yaw into a compass heading', () => {
    near(compassDeg(0), 0)
    near(compassDeg(yawFacing(1, 0)), 90)
    near(compassDeg(yawFacing(0, 1)), 180)
    near(compassDeg(yawFacing(-1, 0)), 270)
  })

  it('projects the view centre to the middle of the screen, and right of it to +x', () => {
    const cam = { x: 0, y: 1.6, z: 0, yaw: 0.7, pitch: 0.2, fovDeg: 58, aspect: 16 / 9 }
    const d = viewDirection(cam.yaw, cam.pitch)
    const c = projectPoint(cam, [d[0] * 5, 1.6 + d[1] * 5, d[2] * 5])
    near(c!.x, 0)
    near(c!.y, 0)
    near(c!.depth, 5)
    const straight = { ...cam, yaw: 0, pitch: 0 }
    assert.ok(projectPoint(straight, [1, 1.6, -5])!.x > 0)
    assert.ok(projectPoint(straight, [0, 2.6, -5])!.y > 0)
    assert.equal(projectPoint(straight, [0, 1.6, 5]), null) // behind
    // A point on the top edge of the frustum lands on y = 1.
    const k = Math.tan((29 * Math.PI) / 180)
    near(projectPoint(straight, [0, 1.6 + 5 * k, -5])!.y, 1)
  })

  it('widens the vertical FOV on portrait screens', () => {
    assert.equal(cameraFov(1600, 900, 58, 62), 58)
    assert.ok(cameraFov(400, 900, 58, 62) > 58)
    assert.ok(cameraFov(100, 1000, 58, 62) <= 80)
  })

  it('rounds without float noise', () => {
    assert.equal(round(0.1 + 0.2), 0.3)
    assert.equal(round(-0.001), 0)
    assert.equal(round(12.345, 0.1), 12.3)
  })
})

describe('tour stops', () => {
  it('captures the view as a stop the server accepts', () => {
    const stop = stopFromView({ x: 1.234, z: -5.678, yaw: yawFacing(1, 0), pitch: 5 * DEG }, { place: 'Gallery A', title: 'Indigo yardage', item: { kind: 'artwork', id: 'aw-1' }, taken: ['aw-1'] })
    assert.deepEqual(stop, {
      id: 'aw-1-2',
      place: 'Gallery A',
      title: 'Indigo yardage',
      text: '',
      view: { x: 1.23, z: -5.68, yawDeg: 90, pitchDeg: 5 },
      item: { kind: 'artwork', id: 'aw-1' },
    })
    const plain = stopFromView({ x: 0, z: 0, yaw: -0.0001, pitch: 0 }, { place: 'Atrium', title: 'Atrium' })
    assert.equal(plain.id, 'atrium')
    assert.equal(plain.view.yawDeg, 0)
    assert.equal('item' in plain, false)
  })

  it('makes ids unique and readable', () => {
    assert.equal(slugId('Gallery D — Regional'), 'gallery-d-regional')
    assert.equal(slugId('—'), 'stop')
    assert.equal(uniqueStopId('a', ['a', 'a-2']), 'a-3')
    assert.equal(uniqueStopId('bad id!', []), 'bad-id')
  })

  it('appends to a stored tour, and reads anything else as no tour', () => {
    const base = [{ id: 'one' }, { id: 'two' }]
    const s = stopFromView({ x: 0, z: 0, yaw: 0, pitch: 0 }, { place: 'p', title: 'two' })
    const { stops, stop } = appendStop(base, s)
    assert.equal(stops.length, 3)
    assert.equal(stop.id, 'two-2')
    assert.equal(base.length, 2) // not mutated
    assert.equal(asStops(null), null)
    assert.equal(asStops([]), null)
    assert.equal(asStops({}), null)
    assert.deepEqual(asStops([{ id: 'a' }, 3, null]), [{ id: 'a' }])
  })
})
