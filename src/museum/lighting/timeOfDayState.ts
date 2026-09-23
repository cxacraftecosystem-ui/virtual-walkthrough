/**
 * Eased, per-frame time-of-day ambience shared by the lighting components.
 *
 * `store.timeOfDay` snaps; these values glide toward LIGHTING.ambience[timeOfDay] (see
 * <TimeOfDayController>), so switching presets only changes light INTENSITIES and a few
 * uniforms — never the number of lights, so no shader recompiles.
 */
import { LIGHTING } from '../config/lighting'
import type { TimeOfDay } from '../state/store'

export const ambience = {
  night: 0,
  twilight: 0,
  exposure: 1,
  daylight: 1,
}

export type AmbienceKey = keyof typeof ambience

export function ambienceTarget(t: TimeOfDay) {
  return LIGHTING.ambience[t] ?? LIGHTING.ambience.midday
}

/** Snap (no easing) — used at mount so the first frame is already right. */
export function snapAmbience(t: TimeOfDay) {
  Object.assign(ambience, ambienceTarget(t))
}

/** Sun (sky) and directional-light (sun or moon) directions for a preset. */
export function lightAngles(t: TimeOfDay) {
  const p = LIGHTING.timeOfDay[t]
  const el = 'lightElevationDeg' in p ? p.lightElevationDeg : p.elevationDeg
  const az = 'lightAzimuthDeg' in p ? p.lightAzimuthDeg : p.azimuthDeg
  return { skyEl: p.elevationDeg, skyAz: p.azimuthDeg, lightEl: el, lightAz: az }
}
