/**
 * Timber slat ceiling, perimeter light coves, roof slab and the central glass
 * skylight lantern (plaster light-well, shallow glazed gable, glazing bars and
 * white steel beams). The roof/lantern are opaque shadow casters so the sun
 * enters only through the glass.
 */
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { kelvinToHex, LIGHTING } from '../config/lighting'
import { KEY, MUSEUM } from '../config/museum'
import { createMeterBoxGeometry } from '../materials/geometry'
import { useMaterials } from '../materials/materials'
import { RAIL_BEAMS_Z } from '../lighting/tracks'

const H = MUSEUM.gallery.ceilingHeight
const T = MUSEUM.walls.exteriorThickness
const sk = MUSEUM.skylight
const SW = sk.width / 2
const ROOF_T = 0.3
const COVE_SLOT = 0.22

const voidMat = new THREE.MeshStandardMaterial({ color: '#4d4036', roughness: 0.95 })
const coveStripMat = new THREE.MeshStandardMaterial({
  color: '#fff3e0',
  emissive: new THREE.Color(kelvinToHex(LIGHTING.cove.colorK, 0.25)),
  emissiveIntensity: LIGHTING.cove.stripEmissive,
})

interface BoxSpec {
  min: [number, number, number]
  max: [number, number, number]
}

function Block({ spec, material, cast = true, receive = true }: { spec: BoxSpec; material: THREE.Material; cast?: boolean; receive?: boolean }) {
  const { min, max } = spec
  const size: [number, number, number] = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
  const geo = useMemo(() => createMeterBoxGeometry(size[0], size[1], size[2]), [size[0], size[1], size[2]]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <mesh
      geometry={geo}
      material={material}
      position={[(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]}
      castShadow={cast}
      receiveShadow={receive}
    />
  )
}

/** Instanced timber slats running along the gallery axis. */
function Slats() {
  const m = useMaterials()
  const ref = useRef<THREE.InstancedMesh>(null)
  const pitch = 0.1
  const slatW = 0.045
  const slatD = 0.07
  const zMin = KEY.gzNorth + COVE_SLOT
  const zMax = 0
  const len = zMax - zMin
  const xs = useMemo(() => {
    const out: number[] = []
    const start = SW + 0.08
    const end = KEY.gx - COVE_SLOT - 0.02
    for (let x = start; x <= end; x += pitch) {
      out.push(x, -x)
    }
    return out
  }, [])
  const geo = useMemo(() => createMeterBoxGeometry(slatW, slatD, len), [len])
  useLayoutEffect(() => {
    const im = ref.current
    if (!im) return
    const mtx = new THREE.Matrix4()
    xs.forEach((x, i) => {
      mtx.makeTranslation(x, H - slatD / 2, (zMin + zMax) / 2)
      im.setMatrixAt(i, mtx)
    })
    im.instanceMatrix.needsUpdate = true
    im.computeBoundingSphere()
  }, [xs, zMin])
  return <instancedMesh ref={ref} args={[geo, m.timberCeiling, xs.length]} castShadow receiveShadow />
}

function Coves() {
  const m = useMaterials()
  const y = H - 0.012
  const strip = 0.05
  const fasciaH = 0.14
  const fz = KEY.gzNorth + COVE_SLOT
  return (
    <group>
      {/* LED strips (emissive) tucked in the slot */}
      <Block spec={{ min: [-KEY.gx + 0.06, y - 0.01, KEY.gzNorth + 0.05], max: [-KEY.gx + 0.06 + strip, y, 0] }} material={coveStripMat} cast={false} />
      <Block spec={{ min: [KEY.gx - 0.06 - strip, y - 0.01, KEY.gzNorth + 0.05], max: [KEY.gx - 0.06, y, 0] }} material={coveStripMat} cast={false} />
      <Block spec={{ min: [-KEY.gx + 0.05, y - 0.01, KEY.gzNorth + 0.06], max: [KEY.gx - 0.05, y, KEY.gzNorth + 0.06 + strip] }} material={coveStripMat} cast={false} />
      {/* plaster fascia boards that hide the strip from normal eye positions */}
      <Block spec={{ min: [-KEY.gx + COVE_SLOT - 0.02, H - fasciaH, fz], max: [-KEY.gx + COVE_SLOT, H, 0] }} material={m.plasterCeiling} />
      <Block spec={{ min: [KEY.gx - COVE_SLOT, H - fasciaH, fz], max: [KEY.gx - COVE_SLOT + 0.02, H, 0] }} material={m.plasterCeiling} />
      <Block spec={{ min: [-KEY.gx + COVE_SLOT - 0.02, H - fasciaH, fz - 0.02], max: [KEY.gx - COVE_SLOT + 0.02, H, fz] }} material={m.plasterCeiling} />
    </group>
  )
}

function SkylightLantern() {
  const m = useMaterials()
  const wellT = 0.12
  const top = H + sk.wellHeight
  const rise = sk.ridgeRise
  const slope = Math.atan2(rise, SW)
  const paneW = Math.hypot(SW, rise)
  const len = sk.startZ - sk.endZ
  const midZ = (sk.startZ + sk.endZ) / 2

  const mullionZs = useMemo(() => {
    const out: number[] = []
    const n = Math.max(1, Math.round(len / sk.mullionSpacing))
    for (let i = 0; i <= n; i++) out.push(sk.endZ + (len * i) / n)
    return out
  }, [len])
  const beamZs = useMemo(() => {
    const out: number[] = []
    const n = Math.max(1, Math.round(len / sk.beamSpacing))
    for (let i = 1; i < n; i++) out.push(sk.endZ + (len * i) / n)
    return out
  }, [len])

  // Glass is a single plane lifted clear of the glazing bars (a thin box intersecting the
  // bars z-fought and flickered when visitors looked up).
  const paneGeo = useMemo(() => {
    const g = new THREE.PlaneGeometry(paneW, len)
    g.rotateX(-Math.PI / 2)
    return g
  }, [paneW, len])
  const GLASS_LIFT = 0.045
  const barGeo = useMemo(() => new THREE.BoxGeometry(paneW, 0.05, 0.04), [paneW])
  const ridgeGeo = useMemo(() => new THREE.BoxGeometry(0.06, 0.06, len), [len])
  const beamGeo = useMemo(() => new THREE.BoxGeometry(sk.width + wellT * 2, 0.2, 0.08), [])
  const railBeamGeo = useMemo(() => new THREE.BoxGeometry(sk.width + wellT * 2, 0.12, 0.06), [])

  return (
    <group>
      {/* plaster light-well upstands */}
      <Block spec={{ min: [-SW - wellT, H, sk.endZ - wellT], max: [-SW, top, sk.startZ + wellT] }} material={m.plasterCeiling} />
      <Block spec={{ min: [SW, H, sk.endZ - wellT], max: [SW + wellT, top, sk.startZ + wellT] }} material={m.plasterCeiling} />
      <Block spec={{ min: [-SW, H, sk.endZ - wellT], max: [SW, top + rise, sk.endZ] }} material={m.plasterCeiling} />
      <Block spec={{ min: [-SW, H, sk.startZ], max: [SW, top + rise, sk.startZ + wellT] }} material={m.plasterCeiling} />

      {/* glazed gable */}
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          geometry={paneGeo}
          material={m.glass}
          position={[(side * SW) / 2, top + rise / 2 + GLASS_LIFT, midZ]}
          rotation={[0, 0, -side * slope]}
          renderOrder={5}
          raycast={() => null}
        />
      ))}
      {/* glazing bars (cast fine shadow lines) */}
      {mullionZs.map((z) =>
        [-1, 1].map((side) => (
          <mesh key={`${z}-${side}`} geometry={barGeo} material={m.steelWhite} position={[(side * SW) / 2, top + rise / 2 - 0.02, z]} rotation={[0, 0, -side * slope]} castShadow />
        )),
      )}
      <mesh geometry={ridgeGeo} material={m.steelWhite} position={[0, top + rise - 0.02, midZ]} castShadow />
      {/* white steel beams spanning the opening */}
      {beamZs.map((z) => (
        <mesh key={z} geometry={beamGeo} material={m.steelWhite} position={[0, H + 0.2, z]} castShadow receiveShadow />
      ))}
      {RAIL_BEAMS_Z.map((z) => (
        <mesh key={`rail-${z}`} geometry={railBeamGeo} material={m.steelWhite} position={[0, H - 0.06, z]} castShadow receiveShadow />
      ))}
    </group>
  )
}

export function CeilingAndRoof() {
  const m = useMaterials()
  const xo = KEY.gx + T
  const zN = KEY.gzNorth - T
  const zS = KEY.rzNorth
  return (
    <group>
      {/* dark void behind slats */}
      <Block spec={{ min: [-KEY.gx, H, KEY.gzNorth], max: [-SW, H + 0.02, 0] }} material={voidMat} cast={false} />
      <Block spec={{ min: [SW, H, KEY.gzNorth], max: [KEY.gx, H + 0.02, 0] }} material={voidMat} cast={false} />
      {/* plaster soffits at the skylight ends */}
      <Block spec={{ min: [-SW, H, sk.startZ], max: [SW, H + 0.02, 0] }} material={m.plasterCeiling} />
      <Block spec={{ min: [-SW, H, KEY.gzNorth], max: [SW, H + 0.02, sk.endZ] }} material={m.plasterCeiling} />
      <Slats />
      <Coves />

      {/* roof slab (opaque shadow caster) around the skylight opening */}
      <Block spec={{ min: [-xo, H + 0.02, zN], max: [-SW, H + ROOF_T, zS] }} material={m.plaster} receive={false} />
      <Block spec={{ min: [SW, H + 0.02, zN], max: [xo, H + ROOF_T, zS] }} material={m.plaster} receive={false} />
      <Block spec={{ min: [-SW, H + 0.02, sk.startZ], max: [SW, H + ROOF_T, zS] }} material={m.plaster} receive={false} />
      <Block spec={{ min: [-SW, H + 0.02, zN], max: [SW, H + ROOF_T, sk.endZ] }} material={m.plaster} receive={false} />

      <SkylightLantern />
    </group>
  )
}
