/**
 * Distant landscape seen through the atrium facade and over the courtyard walls:
 * a ring of softly rolling terrain and an instanced tree belt (canopies + trunks).
 * Two instanced meshes + one terrain mesh; no shadows (far beyond the shadow frustum).
 */
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { MUSEUM } from '../config/museum'
import { mulberry32, TileNoise } from '../materials/noise'

const S = MUSEUM.wings.shell
const CX = (S.minX + S.maxX) / 2
const CZ = (S.minZ + S.maxZ) / 2

function Terrain() {
  const geo = useMemo(() => {
    const inner = 70
    const outer = 420
    const g = new THREE.RingGeometry(inner, outer, 160, 24)
    g.rotateX(-Math.PI / 2)
    const pos = g.attributes.position as THREE.BufferAttribute
    const noise = new TileNoise(11)
    const colors = new Float32Array(pos.count * 3)
    const low = new THREE.Color('#8e9a64')
    const high = new THREE.Color('#a9a77a')
    const c = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      const r = Math.hypot(x, z)
      const t = THREE.MathUtils.smoothstep(r, inner, inner + 90)
      const n = noise.fbm(x / 60, z / 60, 64, 64, 4, 0.5)
      const h = t * (n * 0.5 + 0.5) * 22 - 0.05
      pos.setY(i, h)
      c.copy(low).lerp(high, THREE.MathUtils.clamp(h / 20, 0, 1))
      colors.set([c.r, c.g, c.b], i * 3)
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    g.computeVertexNormals()
    return g
  }, [])
  return (
    <mesh geometry={geo} position={[CX, -0.04, CZ]} raycast={() => null}>
      <meshStandardMaterial vertexColors roughness={1} />
    </mesh>
  )
}

function Trees() {
  const canopy = useRef<THREE.InstancedMesh>(null)
  const trunks = useRef<THREE.InstancedMesh>(null)
  const count = 260
  const canopyGeo = useMemo(() => new THREE.IcosahedronGeometry(1, 1), [])
  const trunkGeo = useMemo(() => new THREE.CylinderGeometry(0.12, 0.18, 1, 5), [])
  const canopyMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#5f7040', roughness: 1, flatShading: true }), [])
  const trunkMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#5b4636', roughness: 1 }), [])

  useLayoutEffect(() => {
    const rnd = mulberry32(42)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const col = new THREE.Color()
    let i = 0
    while (i < count) {
      const a = rnd() * Math.PI * 2
      const r = 58 + rnd() * 70
      const x = CX + Math.cos(a) * r * 1.15
      const z = CZ + Math.sin(a) * r
      // keep the entrance axis (south) open so the facade view reads as an approach
      if (z > S.maxZ + 8 && Math.abs(x) < 16) continue
      const h = 5 + rnd() * 7
      const w = h * (0.35 + rnd() * 0.2)
      q.setFromEuler(new THREE.Euler(0, rnd() * Math.PI, 0))
      m.compose(new THREE.Vector3(x, h * 0.62, z), q, new THREE.Vector3(w, h * 0.42, w))
      canopy.current?.setMatrixAt(i, m)
      col.setHSL(0.22 + rnd() * 0.06, 0.28 + rnd() * 0.12, 0.3 + rnd() * 0.1)
      canopy.current?.setColorAt(i, col)
      m.compose(new THREE.Vector3(x, h * 0.2, z), q, new THREE.Vector3(1, h * 0.4, 1))
      trunks.current?.setMatrixAt(i, m)
      i++
    }
    for (const im of [canopy.current, trunks.current]) {
      if (!im) continue
      im.instanceMatrix.needsUpdate = true
      if (im.instanceColor) im.instanceColor.needsUpdate = true
      im.computeBoundingSphere()
    }
  }, [])

  return (
    <group>
      <instancedMesh ref={canopy} args={[canopyGeo, canopyMat, count]} raycast={() => null} />
      <instancedMesh ref={trunks} args={[trunkGeo, trunkMat, count]} raycast={() => null} />
    </group>
  )
}

export function Landscape() {
  return (
    <group>
      <Terrain />
      <Trees />
    </group>
  )
}
