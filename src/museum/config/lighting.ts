/**
 * LIGHTING CONFIGURATION
 *
 * PDF lighting plan (GA-101):
 *   1. Central skylight — soft natural daylight
 *   2. Track lights (3000K LED) — ceiling-mounted linear track, warm ambient glow
 *   3. Accent spotlights — directional, one per artwork
 *   4. Ambient cove lighting — recessed perimeter cove, eliminates harsh shadows
 *
 * Intensities are in three.js physical units (spot = candela, area = nits-ish)
 * and were calibrated visually against Khronos PBR Neutral tone mapping.
 */

export const LIGHTING = {
  exposure: 1.0,

  sun: {
    /** Sun elevation above the horizon (deg). */
    elevationDeg: 58,
    /** Compass azimuth (deg): 0 = north (-z), 90 = east (+x), 180 = south (+z). */
    azimuthDeg: 118,
    intensity: 4.4,
    colorK: 5600,
  },

  /**
   * Time-of-day presets (visitor-selectable). Each overrides the sun and part of the sky;
   * `midday` equals the defaults above.
   */
  timeOfDay: {
    morning: { elevationDeg: 22, azimuthDeg: 96, intensity: 3.3, colorK: 4400, turbidity: 4.2, rayleigh: 1.6, skyExposure: 0.5 },
    midday: { elevationDeg: 58, azimuthDeg: 118, intensity: 4.4, colorK: 5600, turbidity: 3.2, rayleigh: 1.05, skyExposure: 0.55 },
    golden: { elevationDeg: 11, azimuthDeg: 252, intensity: 3.1, colorK: 3200, turbidity: 6.5, rayleigh: 2.6, skyExposure: 0.46 },
    /**
     * Blue hour: the sun is just below the horizon (the atmosphere keeps a warm band in the west);
     * the directional light becomes a faint cool sky light from `lightElevationDeg/AzimuthDeg`.
     */
    dusk: { elevationDeg: -3.2, azimuthDeg: 262, intensity: 0.32, colorK: 11000, turbidity: 3.4, rayleigh: 2.2, skyExposure: 1, lightElevationDeg: 24, lightAzimuthDeg: 250 },
    /** Night: sun off, moonlight (the directional light) from the south-east; interior lamps take over. */
    night: { elevationDeg: -26, azimuthDeg: 300, intensity: 0.16, colorK: 9000, turbidity: 2, rayleigh: 1, skyExposure: 1, lightElevationDeg: 46, lightAzimuthDeg: 148 },
  },

  /**
   * Artificial-light takeover per time of day (see lighting/timeOfDayState.ts):
   *   night     0 = daylight scene … 1 = full night (sky formers dimmed, lanterns on, stars/moon)
   *   twilight  blue-hour sky gradient amount
   *   exposure  renderer exposure multiplier (eye adapts to the darker scene)
   *   daylight  multiplier on the skylight/area daylight fill and the hemisphere "bounce" fill
   */
  ambience: {
    morning: { night: 0, twilight: 0, exposure: 1, daylight: 1 },
    midday: { night: 0, twilight: 0, exposure: 1, daylight: 1 },
    golden: { night: 0, twilight: 0, exposure: 1.02, daylight: 0.9 },
    dusk: { night: 0.55, twilight: 1, exposure: 1.2, daylight: 0.28 },
    night: { night: 1, twilight: 0, exposure: 1.35, daylight: 0.04 },
  },

  /** Courtyard wall lanterns (lit at dusk/night; they borrow slots from the SpotPool). */
  lanterns: {
    colorK: 2300,
    /** Downlight candela at full night. */
    intensity: 26,
    emissive: 3.2,
  },

  sky: {
    turbidity: 3.2,
    rayleigh: 1.05,
    mieCoefficient: 0.0045,
    mieDirectionalG: 0.82,
    /** Multiplier applied to the atmospheric scattering output. */
    exposure: 0.55,
    clouds: {
      enabled: true,
      coverage: 0.32,
      density: 0.45,
      elevation: 0.55,
      scale: 0.00022,
      speed: 0.000012,
    },
  },

  /** Diffuse daylight arriving through the skylight glass (area light under the lantern). */
  skylightFill: {
    intensity: 2.4,
    colorK: 6500,
  },

  /** Soft global fill (stands in for multi-bounce GI off white plaster and oak). */
  ambient: {
    hemisphereSky: '#e9eef2',
    hemisphereGround: '#d2b692',
    hemisphereIntensity: 0.45,
    environmentIntensity: 0.85,
  },

  track: {
    colorK: 3000,
    /** 0 = pure 3000K, 1 = neutral white. Mimics the eye/camera's partial chromatic adaptation. */
    chromaticAdaptation: 0.45,
    /** Default accent spotlight intensity (candela) per artwork. */
    artworkIntensity: 22,
    /** Hand-block table spot intensity (candela). */
    tableIntensity: 12,
    penumbra: 0.85,
    /** Height of the track rail below the ceiling. */
    railDrop: 0.12,
    /** Beam aim angle from vertical (deg) — museum rule-of-thumb is ~30°. */
    aimAngleDeg: 30,
  },

  cove: {
    colorK: 3000,
    intensity: 1.1,
    /** Emissive strength of the visible LED strip inside the cove slot. */
    stripEmissive: 2.2,
  },

  reception: {
    downlightIntensity: 22,
  },
} as const

/** Tanner Helland's blackbody approximation → linear-ish sRGB hex (good enough for lighting design). */
export function kelvinToRGB(kelvin: number): [number, number, number] {
  const t = kelvin / 100
  let r: number, g: number, b: number
  if (t <= 66) {
    r = 255
    g = 99.4708025861 * Math.log(t) - 161.1195681661
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592)
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492)
    b = 255
  }
  const c = (v: number) => Math.min(255, Math.max(0, v)) / 255
  return [c(r), c(g), c(b)]
}

export function kelvinToHex(kelvin: number, adaptation = 0): string {
  const [r, g, b] = kelvinToRGB(kelvin).map((v) => v + (1 - v) * adaptation)
  const h = (v: number) =>
    Math.round(Math.min(1, v) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}
