/**
 * Curator analytics samplers (started by tracker.ts → startAnalytics):
 *  - 'pos'       every 2 s while the visitor is inside the museum and the tab is visible:
 *                { x, z, zone } rounded to 0.1 m. The server aggregates them into a 0.5 m heatmap
 *                grid per exhibition/day and never stores the raw positions.
 *  - 'tour_step' when the guided tour arrives at a stop: { itemId: stop id, meta: { index, total } }.
 * Anonymous (the tracker's random session id only). Never throws.
 */
import type { AnalyticsEvent, AnalyticsEventType } from '../api/client'
import { zoneAt } from '../config/layout'
import { useMuseum } from '../state/store'
import { visitor } from '../state/visitor'

export const POS_SAMPLE_MS = 2000

type Track = (type: AnalyticsEventType, extra?: Omit<AnalyticsEvent, 't' | 'type'>) => void

const r1 = (v: number) => Math.round(v * 10) / 10

export function startCuratorTracking(track: Track) {
  try {
    window.setInterval(() => {
      try {
        if (useMuseum.getState().phase !== 'entered' || document.visibilityState !== 'visible') return
        if (!Number.isFinite(visitor.x) || !Number.isFinite(visitor.z)) return
        track('pos', { x: r1(visitor.x), z: r1(visitor.z), zone: zoneAt(visitor.x, visitor.z)?.id })
      } catch {
        /* ignore */
      }
    }, POS_SAMPLE_MS)

    // Loaded lazily: tour/engine imports the tracker, so a static import would be circular.
    void Promise.all([import('../tour/engine'), import('../config/tour')])
      .then(([{ useTour }, { TOUR_STOPS }]) => {
        useTour.subscribe((s, prev) => {
          try {
            if (!s.active || s.phase !== 'viewing') return
            if (prev.active && prev.phase === 'viewing' && prev.index === s.index) return
            const stop = TOUR_STOPS[s.index]
            if (stop) track('tour_step', { itemId: stop.id, zone: zoneAt(visitor.x, visitor.z)?.id, meta: { index: s.index, total: TOUR_STOPS.length } })
          } catch {
            /* ignore */
          }
        })
      })
      .catch(() => undefined)
  } catch {
    /* never throw */
  }
}
