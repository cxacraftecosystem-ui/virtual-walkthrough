/**
 * Synchronous light-former environment (reflections + soft irradiance).
 *
 * Built with PMREMGenerator at mount — before the async shader precompile — so every
 * material compiles once with its final env-map variant (drei's <Environment frames>
 * renders on the first frame, which forced a second full round of shader compiles).
 * Uses only emissive panels: no network HDRIs.
 */
import { useThree } from '@react-three/fiber'
import { useLayoutEffect } from 'react'
import * as THREE from 'three'
import { LIGHTING } from '../config/lighting'
import { KEY, MUSEUM } from '../config/museum'

interface Former {
  color: string
  intensity: number
  position: [number, number, number]
  rotation?: [number, number, number]
  size: [number, number]
}

/** Panels roughly matching the real room: skylight strip, warm plaster walls, timber ceiling, oak floor. */
const GX = KEY.gx
const GW = GX * 2
const SKY_W = MUSEUM.skylight.width
const FORMERS: Former[] = [
  { color: '#eef5fb', intensity: 6, position: [0, 6, -9], rotation: [Math.PI / 2, 0, 0], size: [SKY_W, 17.4] },
  { color: '#efe4d4', intensity: 0.9, position: [-GX, 2, -9], rotation: [0, Math.PI / 2, 0], size: [18, 4] },
  { color: '#efe4d4', intensity: 0.9, position: [GX, 2, -9], rotation: [0, -Math.PI / 2, 0], size: [18, 4] },
  { color: '#efe4d4', intensity: 0.7, position: [0, 2, -18], size: [GW, 4] },
  { color: '#efe4d4', intensity: 0.5, position: [0, 2, 1], rotation: [0, Math.PI, 0], size: [GW, 4] },
  { color: '#d9b48a', intensity: 0.35, position: [0, 4.8, -9], rotation: [Math.PI / 2, 0, 0], size: [GW, 18] },
  { color: '#d6b690', intensity: 1.0, position: [0, -0.5, -9], rotation: [-Math.PI / 2, 0, 0], size: [GW, 18] },
]

export function GalleryEnvironment() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)

  useLayoutEffect(() => {
    const env = new THREE.Scene()
    env.background = new THREE.Color('#6f675e')
    const plane = new THREE.PlaneGeometry(1, 1)
    const mats: THREE.Material[] = []
    for (const f of FORMERS) {
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(f.color).multiplyScalar(f.intensity), side: THREE.DoubleSide, toneMapped: false })
      mats.push(mat)
      const mesh = new THREE.Mesh(plane, mat)
      mesh.position.set(...f.position)
      if (f.rotation) mesh.rotation.set(...f.rotation)
      mesh.scale.set(f.size[0], f.size[1], 1)
      env.add(mesh)
    }
    const pmrem = new THREE.PMREMGenerator(gl)
    // Probe from roughly the visitor's eye position in the centre of the gallery.
    const target = pmrem.fromScene(env, 0.02, 0.1, 100, { position: new THREE.Vector3(0, 1.6, -9) })
    pmrem.dispose()
    plane.dispose()
    mats.forEach((m) => m.dispose())

    const prev = scene.environment
    scene.environment = target.texture
    scene.environmentIntensity = LIGHTING.ambient.environmentIntensity
    return () => {
      scene.environment = prev
      target.dispose()
    }
  }, [gl, scene])

  return null
}
