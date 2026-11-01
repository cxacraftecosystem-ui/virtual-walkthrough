/**
 * Client-side mirror of the server's tour check (src/server/handlers/content.ts validateTour), so a
 * curator sees every problem at once, on the field, before saving. Error keys are the server's field
 * paths (`stops[2].view.x`); the server's own 400 uses the same paths.
 */
import { ID_RE } from '../content/model'

export const TOUR_MAX_STOPS = 80
export const ITEM_KINDS = ['artwork', 'exhibit', 'infographic', 'object', 'video'] as const
export type StopItemKind = (typeof ITEM_KINDS)[number]

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const rec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export function validateStops(stops: readonly Record<string, unknown>[]): Record<string, string> {
  const errs: Record<string, string> = {}
  if (stops.length > TOUR_MAX_STOPS) errs.stops = `A tour has at most ${TOUR_MAX_STOPS} stops.`
  const seen = new Set<string>()
  stops.forEach((s, i) => {
    const at = `stops[${i}]`
    if (typeof s.id !== 'string' || !ID_RE.test(s.id)) errs[`${at}.id`] = 'Use letters, digits, “-”, “_” or “.”, starting with a letter or digit.'
    else if (seen.has(s.id)) errs[`${at}.id`] = `An earlier stop already uses “${s.id}”.`
    if (typeof s.id === 'string') seen.add(s.id)
    for (const [k, max, word] of [
      ['place', 120, 'A place'],
      ['title', 200, 'A title'],
      ['text', 4000, 'A caption'],
    ] as const) {
      const v = s[k]
      if (typeof v !== 'string' || (k !== 'text' && !v.trim())) errs[`${at}.${k}`] = `${word} is required.`
      else if (v.length > max) errs[`${at}.${k}`] = `At most ${max} characters (now ${v.length}).`
    }
    const v = rec(s.view) ? s.view : {}
    for (const k of ['x', 'z', 'yawDeg'] as const) if (!num(v[k])) errs[`${at}.view.${k}`] = 'Enter a number.'
    if ((num(v.x) && Math.abs(v.x) > 200) || (num(v.z) && Math.abs(v.z) > 200)) errs[`${at}.view`] = 'The standing point is outside the building.'
    if (v.pitchDeg !== undefined && (!num(v.pitchDeg) || Math.abs(v.pitchDeg) > 90)) errs[`${at}.view.pitchDeg`] = 'Between −90 and 90.'
    if (s.dwellSec !== undefined && (!num(s.dwellSec) || s.dwellSec < 1 || s.dwellSec > 600)) errs[`${at}.dwellSec`] = 'Between 1 and 600 seconds.'
    if (s.item !== undefined && s.item !== null) {
      const it = rec(s.item) ? s.item : {}
      if (!ITEM_KINDS.includes(it.kind as StopItemKind)) errs[`${at}.item.kind`] = 'Choose what kind of item.'
      if (typeof it.id !== 'string' || !ID_RE.test(it.id)) errs[`${at}.item.id`] = 'Choose an item.'
    }
  })
  return errs
}

/** Index of the stop an error key belongs to (`stops[3].title` → 3), or null. */
export const stopIndexOf = (key: string): number | null => {
  const m = /^stops\[(\d+)\]/.exec(key)
  return m ? Number(m[1]) : null
}

/**
 * The stop(s) in a pasted text: a TourStop object (the museum's "Copy view as tour stop"), a list of
 * them, or `{ stops: [...] }`. Throws a reader-facing message.
 */
export function parsePastedStops(text: string): Record<string, unknown>[] {
  let v: unknown
  try {
    v = JSON.parse(text.trim())
  } catch {
    throw new Error('That isn’t a tour stop. In the museum, use “Copy view as tour stop” in the staff tools, then paste here.')
  }
  const list = Array.isArray(v) ? v : rec(v) && Array.isArray(v.stops) ? v.stops : [v]
  const stops = list.filter(rec)
  if (!stops.length || !stops.every((s) => rec(s.view))) throw new Error('That isn’t a tour stop: it has no view.')
  return stops
}
