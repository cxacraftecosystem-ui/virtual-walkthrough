/**
 * Mounted once inside the museum <Canvas>. Connects the VR store to the renderer (cheap while no
 * session runs: no controllers, no pointers) and mounts the VR rig only during immersive-vr.
 */
import { XR, useXR } from '@react-three/xr'
import { VRRig } from './VRRig'
import { vrStore } from './xrStore'

function InSession() {
  const mode = useXR((s) => s.mode)
  return mode === 'immersive-vr' ? <VRRig /> : null
}

export function XRRoot() {
  return (
    <XR store={vrStore}>
      <InSession />
    </XR>
  )
}
