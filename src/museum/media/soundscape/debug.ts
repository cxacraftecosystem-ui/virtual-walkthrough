/** Live debug/automation handle, exposed as window.__soundscape. */
import type { ZoneId } from '../../config/layout'

export type FloorMaterial = 'oak' | 'stone' | 'concrete' | 'carpet'

export const debug = {
  active: false,
  /** Scheduler ticks so far, AudioContext state and clock (for automation). */
  ticks: 0,
  ctxState: 'none' as string,
  ctxTime: 0,
  zone: null as ZoneId | null,
  /** Indoor ambience channel currently faded in (null = none, e.g. theatre / courtyard). */
  channel: null as string | null,
  timeOfDay: 'midday' as string,
  material: null as FloorMaterial | null,
  speed: 0,
  stepsPerSec: 0,
  steps: 0,
  stepsByMaterial: { oak: 0, stone: 0, concrete: 0, carpet: 0 } as Record<FloorMaterial, number>,
  lastStepSource: null as 'synth' | 'file' | null,
  /** Current bus gains: zone channels, outdoor sites ("site:courtyard") and their time-of-day layers. */
  levels: {} as Record<string, number>,
  sources: {} as Record<string, 'synth' | 'file' | 'silent'>,
  events: { birds: 0, bubbles: 0, thumps: 0, rustles: 0, murmur: 0, crickets: 0, frogs: 0, owls: 0, cuckoos: 0, calls: 0, leaves: 0 },
  files: {} as Record<string, 'pending' | 'ok' | 'missing'>,
}
export type SoundscapeDebug = typeof debug

declare global {
  interface Window {
    __soundscape?: SoundscapeDebug
  }
}
