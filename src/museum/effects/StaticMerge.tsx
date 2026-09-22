/**
 * <StaticMerge> — collapses a static subtree into one mesh per material.
 *
 * The architecture is hundreds of boxes that never move; drawing them one by one
 * costs a draw call each (twice with shadows). After the subtree mounts, meshes that
 * share a material are baked into a single BufferGeometry (world transforms applied,
 * metre-UVs preserved). Originals are hidden but kept, so pointer raycasting (walls
 * occluding exhibits) keeps working. Interactive, transparent, instanced or
 * specially-ordered meshes are left untouched.
 */
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/** Interactive meshes (R3F event handlers attached directly) are never merged. */
function hasHandlers(o: THREE.Object3D): boolean {
  const r3f = (o as unknown as { __r3f?: { handlers?: Record<string, unknown> } }).__r3f
  return !!r3f?.handlers && Object.keys(r3f.handlers).length > 0
}

export function StaticMerge({ children, name }: { children: ReactNode; name?: string }) {
  const root = useRef<THREE.Group>(null)

  useLayoutEffect(() => {
    const g = root.current
    if (!g) return
    g.updateWorldMatrix(true, true)
    const inv = new THREE.Matrix4().copy(g.matrixWorld).invert()
    const buckets = new Map<string, { material: THREE.Material; cast: boolean; receive: boolean; geos: THREE.BufferGeometry[]; meshes: THREE.Mesh[] }>()

    g.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh || (mesh as unknown as THREE.InstancedMesh).isInstancedMesh) return
      if (!mesh.visible || mesh.renderOrder !== 0 || hasHandlers(mesh)) return
      const mat = mesh.material as THREE.Material
      if (Array.isArray(mesh.material) || !mat || mat.transparent) return
      const geo = mesh.geometry as THREE.BufferGeometry
      if (!geo.attributes.position || !geo.attributes.normal || !geo.attributes.uv) return
      const key = `${mat.uuid}|${mesh.castShadow}|${mesh.receiveShadow}|${geo.index ? 'i' : 'n'}|${Object.keys(geo.attributes).sort().join(',')}`
      let b = buckets.get(key)
      if (!b) {
        b = { material: mat, cast: mesh.castShadow, receive: mesh.receiveShadow, geos: [], meshes: [] }
        buckets.set(key, b)
      }
      const cloned = geo.clone()
      cloned.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld))
      // Keep only the attributes every box shares so mergeGeometries succeeds.
      for (const k of Object.keys(cloned.attributes)) if (!['position', 'normal', 'uv'].includes(k)) cloned.deleteAttribute(k)
      cloned.morphAttributes = {}
      cloned.clearGroups()
      b.geos.push(cloned)
      b.meshes.push(mesh)
    })

    const merged: THREE.Mesh[] = []
    for (const b of buckets.values()) {
      if (b.geos.length < 2) {
        b.geos.forEach((x) => x.dispose())
        continue
      }
      const geo = mergeGeometries(b.geos, false)
      b.geos.forEach((x) => x.dispose())
      if (!geo) continue
      geo.computeBoundingSphere()
      geo.computeBoundingBox()
      const m = new THREE.Mesh(geo, b.material)
      m.castShadow = b.cast
      m.receiveShadow = b.receive
      m.name = `${name ?? 'merged'}:${b.material.name || b.material.type}`
      m.raycast = () => null // raycasting stays on the hidden originals
      g.add(m)
      merged.push(m)
      for (const orig of b.meshes) orig.visible = false
    }

    return () => {
      for (const m of merged) {
        g.remove(m)
        m.geometry.dispose()
      }
      for (const b of buckets.values()) for (const orig of b.meshes) orig.visible = true
    }
  }, [name])

  return (
    <group ref={root} name={name}>
      {children}
    </group>
  )
}
