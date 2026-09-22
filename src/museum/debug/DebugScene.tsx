/**
 * Development-only debug layer (enable with `?debug` on the dev server):
 * FPS/GPU stats, collision geometry, zone outlines. Never mounted in production.
 */
import { Stats } from '@react-three/drei'
import { COLLIDERS } from '../navigation/collision'

export function DebugScene() {
  return (
    <group>
      <Stats />
      {COLLIDERS.map((c) => (
        <mesh key={c.id} position={[(c.minX + c.maxX) / 2, 0.02, (c.minZ + c.maxZ) / 2]} raycast={() => null}>
          <boxGeometry args={[c.maxX - c.minX, 0.04, c.maxZ - c.minZ]} />
          <meshBasicMaterial color="#ff3b6b" wireframe toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}
