'use client'
/** Small orbitable 3D preview of an optimised scan (loaded with the museum's own loader settings). */
import { Bounds, OrbitControls, useGLTF } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { Component, Suspense, useEffect, useMemo, type ReactNode } from 'react'
import * as THREE from 'three'

function Model({ url }: { url: string }) {
  // same flags as src/museum/exhibits/Artifact3D.tsx: Draco + meshopt decoders
  const { scene } = useGLTF(url, true, true)
  const object = useMemo(() => {
    const o = scene.clone(true)
    o.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) c.castShadow = c.receiveShadow = true
    })
    return o
  }, [scene])
  useEffect(() => () => useGLTF.clear(url), [url])
  return <primitive object={object} />
}

class Boundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
  render() {
    return this.state.error ? <div className="cap-preview-error">Preview failed: {this.state.error}</div> : this.props.children
  }
}

export function ModelPreview({ url, size }: { url: string; size: [number, number, number] }) {
  const r = Math.max(0.2, Math.hypot(...size))
  return (
    <div className="cap-preview">
      <Boundary>
        <Canvas shadows dpr={[1, 2]} camera={{ fov: 35, near: 0.01, far: 200, position: [r * 1.2, r * 0.9, r * 1.6] }} gl={{ antialias: true }}>
          <color attach="background" args={['#efe9df']} />
          <hemisphereLight args={['#fffaf0', '#8a7a66', 1.1]} />
          <directionalLight position={[2, 4, 3]} intensity={2.2} castShadow shadow-mapSize={[1024, 1024]} />
          <directionalLight position={[-3, 2, -2]} intensity={0.5} />
          <Suspense fallback={null}>
            <Bounds fit clip observe margin={1.25}>
              <Model url={url} />
            </Bounds>
          </Suspense>
          {/* 10 cm grid on the floor, 1 m cells emphasised */}
          <gridHelper args={[Math.max(1, Math.ceil(r * 2)), Math.max(10, Math.ceil(r * 2) * 10), '#b9ab98', '#d9d0c3']} />
          <mesh rotation-x={-Math.PI / 2} position-y={-0.0005} receiveShadow>
            <planeGeometry args={[r * 6, r * 6]} />
            <shadowMaterial opacity={0.18} />
          </mesh>
          <OrbitControls makeDefault enableDamping />
        </Canvas>
      </Boundary>
      <div className="cap-preview-dims">
        {(size[0] * 100).toFixed(1)} × {(size[2] * 100).toFixed(1)} cm · height {(size[1] * 100).toFixed(1)} cm · grid 10 cm
      </div>
    </div>
  )
}
