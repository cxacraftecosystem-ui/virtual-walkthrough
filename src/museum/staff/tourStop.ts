/**
 * Tour stops captured from the staff view (src/museum/staff/StaffMode.tsx). Pure: unit-tested in
 * tests/unit/staff-geometry.test.ts. The shape is the one PUT /api/admin/content/tour accepts
 * (src/server/handlers/content.ts) and src/museum/config/tour.ts plays.
 */
import type { SelectionKind } from '../state/store'
import { compassDeg, round } from './geometry'

export interface CapturedStop {
  id: string
  place: string
  title: string
  text: string
  view: { x: number; z: number; yawDeg: number; pitchDeg: number }
  item?: { kind: SelectionKind; id: string }
}

/** Ids the server accepts for a stop (src/server/util.ts ID_RE). */
const STOP_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/

/** A readable id from a seed ('Gallery A' → 'gallery-a'), never empty. */
export function slugId(seed: string): string {
  const s = seed
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return s || 'stop'
}

/** `base`, or `base-2`, `base-3`… — the first that is not already taken. */
export function uniqueStopId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  const root = STOP_ID_RE.test(base) ? base : slugId(base)
  if (!used.has(root)) return root
  for (let n = 2; ; n++) {
    const id = `${root}-${n}`
    if (!used.has(id)) return id
  }
}

export interface ViewState {
  x: number
  z: number
  /** Visitor yaw / pitch in radians (src/museum/state/visitor.ts). */
  yaw: number
  pitch: number
}

/** A stop that stands exactly where the visitor stands and looks where they look. */
export function stopFromView(v: ViewState, o: { place: string; title: string; text?: string; item?: { kind: SelectionKind; id: string } | null; taken?: Iterable<string> }): CapturedStop {
  const seed = o.item ? o.item.id : o.title || o.place
  const stop: CapturedStop = {
    id: uniqueStopId(slugId(seed), o.taken ?? []),
    place: o.place,
    title: o.title,
    text: o.text ?? '',
    view: {
      x: round(v.x, 0.01),
      z: round(v.z, 0.01),
      yawDeg: round(compassDeg(v.yaw), 0.1) % 360,
      pitchDeg: round((v.pitch * 180) / Math.PI, 0.1),
    },
  }
  if (o.item) stop.item = { kind: o.item.kind, id: o.item.id }
  return stop
}

/** Read a stored tour (unknown JSON) as a list of stop records; anything else counts as no tour. */
export function asStops(v: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(v) || v.length === 0) return null
  return v.filter((s): s is Record<string, unknown> => !!s && typeof s === 'object' && !Array.isArray(s))
}

/** The tour with `stop` appended, its id made unique against the stops already there. */
export function appendStop(stops: readonly Record<string, unknown>[], stop: CapturedStop): { stops: Record<string, unknown>[]; stop: CapturedStop } {
  const taken = stops.map((s) => (typeof s.id === 'string' ? s.id : '')).filter(Boolean)
  const placed = { ...stop, id: uniqueStopId(stop.id, taken) }
  return { stops: [...stops, placed as unknown as Record<string, unknown>], stop: placed }
}
