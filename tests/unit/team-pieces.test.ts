/**
 * The workshop team's pieces in Gallery D (src/museum/config/objects.ts TEAM_PIECES): every mini pedestal
 * leaves walking room to the walls and every other collider, a visitor can walk from the entrance to stand
 * in front of each piece (tour/pathing), the crescent keeps clear of the Gallery A door → block-under-glass
 * sightline and of the gallery's wall artworks, and each GLB (public/models/team/) fits under its glass hood.
 *
 * npm test
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { ARTWORKS } from '../../src/museum/config/artworks'
import { SURFACES, ZONES, zoneAt } from '../../src/museum/config/layout'
import { MUSEUM } from '../../src/museum/config/museum'
import { SCENE_OBJECTS, TEAM_PIECES, type SceneObjectConfig } from '../../src/museum/config/objects'
import { COLLIDERS, type Collider } from '../../src/museum/navigation/collision'
import { planPath, type P2 } from '../../src/museum/tour/pathing'

const ROOT = path.resolve(import.meta.dirname, '../..')
/** A visitor (0.28 m radius) passes with room to spare. */
const WALKING_ROOM = 0.6
/** Interior of the pedestal's glass hood (models/display.tsx: footprint − 0.06, 0.52 m high). */
const HOOD_HEIGHT = 0.52

const pedestals = TEAM_PIECES.filter((o) => o.kind === 'pedestal')
const pieces = TEAM_PIECES.filter((o) => o.id.endsWith('-object'))
const pedestalOf = (piece: SceneObjectConfig) => pedestals.find((p) => `${p.id}-object` === piece.id)!

/** Gap between two rectangles (0 when they touch or overlap). */
function rectGap(a: Collider, b: Collider) {
  const dx = Math.max(0, a.minX - b.maxX, b.minX - a.maxX)
  const dz = Math.max(0, a.minZ - b.maxZ, b.minZ - a.maxZ)
  return Math.hypot(dx, dz)
}

/** Distance from point p to segment a–b. */
function pointSegment(p: P2, a: P2, b: P2) {
  const vx = b.x - a.x
  const vz = b.z - a.z
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / (vx * vx + vz * vz)))
  return Math.hypot(p.x - (a.x + t * vx), p.z - (a.z + t * vz))
}

/** Where a visitor stands to look at a piece: `d` m in front of its model's front (+z turned by rotationDeg). */
function viewSpot(o: SceneObjectConfig, d = 1.1): P2 {
  const r = ((o.rotationDeg ?? 0) * Math.PI) / 180
  return { x: o.position[0] + Math.sin(r) * d, z: o.position[2] + Math.cos(r) * d }
}

/** World bounding box size of a GLB's (single, quantised) mesh: accessor min/max × the node's de-quantising transform. */
function glbSize(file: string): [number, number, number] {
  const buf = fs.readFileSync(file)
  assert.equal(buf.toString('latin1', 0, 4), 'glTF')
  const json = JSON.parse(buf.toString('utf8', 20, 20 + buf.readUInt32LE(12))) as {
    nodes: { mesh?: number; scale?: number[]; translation?: number[] }[]
    meshes: { primitives: { attributes: { POSITION: number } }[] }[]
    accessors: { min: number[]; max: number[]; normalized?: boolean; componentType: number }[]
  }
  const nodes = json.nodes.filter((n) => n.mesh !== undefined)
  assert.equal(nodes.length, 1, `${file}: one mesh node`)
  const acc = json.accessors[json.meshes[nodes[0].mesh!].primitives[0].attributes.POSITION]
  const norm = acc.normalized ? ({ 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 } as Record<number, number>)[acc.componentType] : 1
  const s = nodes[0].scale ?? [1, 1, 1]
  return [0, 1, 2].map((k) => ((acc.max[k] - acc.min[k]) / norm) * s[k]) as [number, number, number]
}

describe('team pieces in Gallery D', () => {
  it('pairs each mini pedestal with one piece on its top, in Gallery D, under a hood it fits', () => {
    assert.equal(pedestals.length, 6)
    assert.equal(pieces.length, 6)
    const ids = SCENE_OBJECTS.map((o) => o.id)
    assert.equal(new Set(ids).size, ids.length, 'scene object ids are unique')
    for (const p of pieces) {
      const ped = pedestalOf(p)
      assert.ok(ped, `${p.id} has a pedestal`)
      assert.equal(p.position[0], ped.position[0])
      assert.equal(p.position[2], ped.position[2])
      assert.equal(p.position[1], ped.height, `${p.id} stands on the pedestal top`)
      assert.ok(ped.height! >= 0.95 && ped.height! <= 1.05, `${ped.id} is a mini pedestal near eye level`)
      assert.deepEqual(ped.footprint, [0.4, 0.4])
      assert.equal(ped.props?.cover, true)
      assert.ok(p.height! <= HOOD_HEIGHT - 0.07, `${p.id} (${p.height} m) fits under the ${HOOD_HEIGHT} m hood`)
      for (const o of [p, ped]) {
        assert.equal(o.zone, 'gallery-d')
        assert.equal(zoneAt(o.position[0], o.position[2])?.id, 'gallery-d', `${o.id} stands in Gallery D`)
        assert.ok(SCENE_OBJECTS.includes(o), `${o.id} is in SCENE_OBJECTS`)
      }
      assert.ok(p.interactive && p.inspectable && p.placeholder, `${p.id}: interactive, inspectable, placeholder`)
      assert.ok(p.description && p.alt && p.i18n?.hi?.title && p.i18n?.bn?.title, `${p.id}: description, alt and hi/bn titles`)
    }
  })

  it('every GLB exists and its footprint fits inside the hood at the displayed height', () => {
    for (const p of pieces) {
      const file = path.join(ROOT, 'public', p.model!)
      assert.ok(fs.existsSync(file), `${p.model} exists`)
      const [w, h, d] = glbSize(file)
      const k = p.height! / h
      const hood = pedestalOf(p).footprint![0] - 0.06
      // the piece turns inside the square hood: its rotated footprint must stay inside
      const r = ((p.rotationDeg ?? 0) * Math.PI) / 180
      const extX = Math.abs(Math.cos(r)) * w * k + Math.abs(Math.sin(r)) * d * k
      const extZ = Math.abs(Math.sin(r)) * w * k + Math.abs(Math.cos(r)) * d * k
      assert.ok(Math.max(extX, extZ) <= hood - 0.02, `${p.id}: ${extX.toFixed(3)} × ${extZ.toFixed(3)} m inside the ${hood.toFixed(2)} m hood`)
    }
  })

  it(`leaves at least ${WALKING_ROOM} m walking room between each pedestal and every wall or other collider`, () => {
    for (const ped of pedestals) {
      const mine = COLLIDERS.find((c) => c.id === `object-${ped.id}`)
      assert.ok(mine, `${ped.id} collides`)
      for (const c of COLLIDERS) {
        // its own piece's collider sits inside the pedestal's
        if (c === mine || c.id === `object-${ped.id}-object`) continue
        const gap = rectGap(mine, c)
        assert.ok(gap >= WALKING_ROOM, `${ped.id} is ${gap.toFixed(2)} m from ${c.id}`)
      }
    }
  })

  it('a visitor can walk from the entrance to stand in front of each piece', () => {
    const start = { x: MUSEUM.visitor.start.x, z: MUSEUM.visitor.start.z }
    for (const p of pieces) {
      const goal = viewSpot(p)
      const route = planPath(start, goal)
      assert.ok(route, `no route to ${p.id}`)
      const end = route[route.length - 1]
      assert.ok(Math.hypot(end.x - goal.x, end.z - goal.z) < 0.05, `${p.id}: the view spot is free floor`)
      assert.equal(zoneAt(end.x, end.z)?.id, 'gallery-d')
    }
  })

  it('keeps clear of the Gallery A door → block-under-glass sightline', () => {
    // seen from just inside the doorway, each pedestal (with its hood) stays ≥ 2° to the side of the block's table
    const block = SCENE_OBJECTS.find((o) => o.id === 'centrepiece-gallery-d')!
    const door = { x: ZONES.find((z) => z.id === 'gallery-d')!.rect.maxX - 0.3, z: MUSEUM.wings.doors.galleryToGalleryD.z }
    const bearing = (x: number, z: number) => Math.atan2(x - door.x, z - door.z)
    const dist = (x: number, z: number) => Math.hypot(x - door.x, z - door.z)
    const [bx, , bz] = block.position
    const blockHalf = Math.atan(block.footprint![0] / 2 / dist(bx, bz))
    for (const ped of pedestals) {
      const [x, , z] = ped.position
      const half = Math.atan((Math.SQRT2 * ped.footprint![0]) / 2 / dist(x, z))
      const sepDeg = ((Math.abs(bearing(x, z) - bearing(bx, bz)) - half - blockHalf) * 180) / Math.PI
      assert.ok(sepDeg >= 2, `${ped.id} is ${sepDeg.toFixed(1)}° from the door → block sightline`)
      // and nothing stands on the straight walk between them
      assert.ok(pointSegment({ x, z }, door, { x: bx, z: bz }) > 0.6 + Math.SQRT2 * 0.2)
    }
  })

  it('stays out of the viewing area in front of every Gallery D wall artwork', () => {
    for (const a of ARTWORKS) {
      const s = SURFACES[a.placement.surface]
      if (s.zone !== 'gallery-d') continue
      const half = a.maxWidth / 2 + 0.3
      for (const ped of pedestals) {
        const [x, , z] = ped.position
        const along = s.runAxis === 'z' ? z : x
        const out = s.runAxis === 'z' ? (x - s.face) * s.normal[0] : (z - s.face) * s.normal[1]
        const inFront = Math.abs(along - a.placement.at) < half + 0.2 && out < 3.0 + 0.2
        assert.ok(!inFront, `${ped.id} stands in front of ${a.id}`)
      }
    }
  })
})
