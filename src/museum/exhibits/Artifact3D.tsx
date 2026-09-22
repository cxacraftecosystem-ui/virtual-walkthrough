/**
 * The 3D craft object for an exhibit.
 *
 * - `exhibit.model` set  → GLB/GLTF loaded with useGLTF, cloned, scaled by `modelScale`,
 *   shadows enabled, centred on the origin with its bottom at y = 0.
 * - missing / failed / loading → the procedural PLACEHOLDER block.
 */

import { Suspense, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import type { ExhibitConfig } from '../config/exhibits'
import { ErrorBoundary } from '../utils/ErrorBoundary'
import { HandBlockPlaceholder } from './HandBlockPlaceholder'

function GLTFArtifact({ url, scale }: { url: string; scale: number }) {
  const { scene } = useGLTF(url)
  const object = useMemo(() => {
    const root = scene.clone(true)
    root.scale.setScalar(scale)
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true
        o.receiveShadow = true
      }
    })
    root.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(root)
    if (!box.isEmpty()) {
      const c = box.getCenter(new THREE.Vector3())
      root.position.set(-c.x, -box.min.y, -c.z)
    }
    return root
  }, [scene, scale])
  return <primitive object={object} />
}

export function Artifact3D({ exhibit }: { exhibit: ExhibitConfig }) {
  const placeholder = (
    <HandBlockPlaceholder motif={exhibit.placeholderMotif} size={exhibit.placeholderSize} inkColor={exhibit.inkColor} />
  )
  if (!exhibit.model) return placeholder
  return (
    <ErrorBoundary key={exhibit.model} fallback={placeholder}>
      <Suspense fallback={placeholder}>
        <GLTFArtifact url={exhibit.model} scale={exhibit.modelScale ?? 1} />
      </Suspense>
    </ErrorBoundary>
  )
}
