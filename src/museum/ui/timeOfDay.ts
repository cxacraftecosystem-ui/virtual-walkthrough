/** Time-of-day presets for the HUD control (the lighting reads `store.timeOfDay`). */
import { useEffect } from 'react'
import { useMuseum, type TimeOfDay } from '../state/store'

export const TIME_OPTIONS: { value: TimeOfDay; label: string; note: string }[] = [
  { value: 'morning', label: 'Morning', note: 'Cool, low sun' },
  { value: 'midday', label: 'Midday', note: 'Bright, overhead' },
  { value: 'golden', label: 'Golden hour', note: 'Warm, raking light' },
]

export const timeLabel = (t: TimeOfDay) => TIME_OPTIONS.find((o) => o.value === t)?.label ?? t

const KEY = 'museum.timeOfDay'
const isTime = (v: unknown): v is TimeOfDay => TIME_OPTIONS.some((o) => o.value === v)

/** T shortcut: morning → midday → golden hour → morning. */
export function cycleTimeOfDay() {
  const s = useMuseum.getState()
  const i = TIME_OPTIONS.findIndex((o) => o.value === s.timeOfDay)
  s.setTimeOfDay(TIME_OPTIONS[(i + 1) % TIME_OPTIONS.length].value)
}

/** Restore the visitor's last choice on load and remember changes. */
export function useTimeOfDayPersistence() {
  useEffect(() => {
    try {
      const stored = localStorage.getItem(KEY)
      if (isTime(stored) && stored !== useMuseum.getState().timeOfDay) useMuseum.getState().setTimeOfDay(stored)
    } catch {
      /* storage unavailable */
    }
    return useMuseum.subscribe((s, prev) => {
      if (s.timeOfDay === prev.timeOfDay) return
      try {
        localStorage.setItem(KEY, s.timeOfDay)
      } catch {
        /* ignore */
      }
    })
  }, [])
}
