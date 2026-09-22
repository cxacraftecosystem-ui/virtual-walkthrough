/**
 * Mutable, per-frame visitor state. Deliberately NOT React state: it is written
 * every frame by the navigation controller and read by the minimap/HUD on rAF.
 */
import { MUSEUM } from '../config/museum'

const DEG = Math.PI / 180

export interface WalkTarget {
  x: number
  z: number
  /** Optional yaw/pitch to turn toward while walking (radians). */
  yaw?: number
  pitch?: number
  onArrive?: () => void
}

export const visitor = {
  x: MUSEUM.visitor.start.x as number,
  z: MUSEUM.visitor.start.z as number,
  /** Yaw in radians. 0 = facing north (-z); positive turns toward west (left). */
  yaw: MUSEUM.visitor.start.yawDeg * DEG,
  pitch: MUSEUM.visitor.start.pitchDeg * DEG,
  vx: 0,
  vz: 0,
  /** Set to request a smooth walk to a point (click-to-walk / focus on artwork). */
  walkTarget: null as WalkTarget | null,
  /** Movement disabled (e.g. while the inspection viewer is open). */
  frozen: false,
  /** Virtual joystick input from touch UI, each in [-1, 1]. forward = +y. */
  joystick: { x: 0, y: 0 },
}

/** Instantly place the visitor (used by reset, minimap "go to", debug). yawDeg: 0 = north, 90 = facing west... */
export function teleport(x: number, z: number, yawDeg: number, pitchDeg = 0) {
  visitor.x = x
  visitor.z = z
  visitor.yaw = yawToRad(yawDeg)
  visitor.pitch = pitchDeg * DEG
  visitor.vx = 0
  visitor.vz = 0
  visitor.walkTarget = null
}

/**
 * Compass yaw (deg, 0 = north/-z, 90 = east/+x, 180 = south) → internal yaw (radians,
 * three.js camera rotation.y where 0 looks down -z and +π/2 looks toward -x).
 */
export function yawToRad(compassDeg: number) {
  return -compassDeg * DEG
}

export function resetVisitor() {
  const s = MUSEUM.visitor.start
  teleport(s.x, s.z, s.yawDeg, s.pitchDeg)
}
