/**
 * GLB/glTF scene-object loader.
 *
 * - Loads with drei `useGLTF` (cached per URL).
 * - Bakes node transforms and MERGES primitives that share a material, so a model costs
 *   one draw call per material however many nodes it has (Poly Haven plants: 4 → 2).
 *   The merged set is cached per URL and shared by every placement (no scene clones).
 * - Fits it: scale = `modelScale`, else `height / bbox height` (else 1); bottom at y = 0,
 *   centred on the footprint origin. Shadows on.
 */
import { useGLTF } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

interface MergedModel {
  parts: { geometry: THREE.BufferGeometry; material: THREE.Material }[]
  box: THREE.Box3
}

const merged = new Map<string, MergedModel>()

function mergeScene(url: string, scene: THREE.Object3D): MergedModel {
  const hit = merged.get(url)
  if (hit) return hit
  scene.updateMatrixWorld(true)
  const groups = new Map<THREE.Material, THREE.BufferGeometry[]>()
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || (mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh) return
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    if (mats.length !== 1) return
    const g = mesh.geometry.clone()
    g.applyMatrix4(mesh.matrixWorld)
    let list = groups.get(mats[0])
    if (!list) groups.set(mats[0], (list = []))
    list.push(g)
  })
  const parts: MergedModel['parts'] = []
  const box = new THREE.Box3()
  for (const [material, list] of groups) {
    let geos = list
    if (list.length > 1) {
      // keep only the attributes every primitive has, and a consistent index state
      const common = Object.keys(list[0].attributes).filter((k) => list.every((g) => !!g.attributes[k]))
      const indexed = list.every((g) => !!g.index)
      geos = list.map((g) => {
        for (const k of Object.keys(g.attributes)) if (!common.includes(k)) g.deleteAttribute(k)
        g.morphAttributes = {}
        return indexed ? g : g.index ? g.toNonIndexed() : g
      })
    }
    const m = geos.length === 1 ? geos[0] : mergeGeometries(geos, false)
    if (m) {
      m.computeBoundingBox()
      m.computeBoundingSphere()
      box.union(m.boundingBox!)
      parts.push({ geometry: m, material })
    } else {
      for (const g of geos) {
        g.computeBoundingBox()
        box.union(g.boundingBox!)
        parts.push({ geometry: g, material })
      }
    }
    const mat = material as THREE.MeshStandardMaterial
    // Poly Haven foliage uses alpha MASK: make sure shadows respect it
    if (mat.alphaTest > 0) mat.side = THREE.DoubleSide
  }
  const res = { parts, box }
  merged.set(url, res)
  return res
}

export interface GLTFModelProps {
  url: string
  /** Explicit uniform scale (wins over `height`). */
  scale?: number
  /** Target height (m) when `scale` is absent. */
  height?: number
}

export function GLTFModel({ url, scale, height }: GLTFModelProps) {
  const { scene } = useGLTF(url)
  const model = useMemo(() => mergeScene(url, scene), [url, scene])
  const fit = useMemo(() => {
    const size = model.box.getSize(new THREE.Vector3())
    const c = model.box.getCenter(new THREE.Vector3())
    const s = scale ?? (height && size.y > 1e-4 ? height / size.y : 1)
    return { s, offset: [-c.x * s, -model.box.min.y * s, -c.z * s] as [number, number, number] }
  }, [model, scale, height])
  return (
    <group position={fit.offset} scale={fit.s}>
      {model.parts.map((p, i) => (
        <mesh key={i} geometry={p.geometry} material={p.material} castShadow receiveShadow />
      ))}
    </group>
  )
}

/** Start fetching a model early (e.g. while the entry screen is up). */
export function preloadModel(url: string) {
  useGLTF.preload(url)
}
