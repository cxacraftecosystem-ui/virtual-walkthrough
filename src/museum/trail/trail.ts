/**
 * Discovery trail "Find the motifs" (families / schools) — state.
 *
 * Off by default: the medallions only appear once the visitor starts the trail (help
 * overlay / entry screen). Progress is kept in localStorage so a family can come back.
 */
import { create } from 'zustand'
import { TRAIL } from '../config/amenities'

const KEY = 'museum.trail'

interface Stored {
  active: boolean
  found: string[]
  completedAt?: string
}

function read(): Stored {
  const empty: Stored = { active: false, found: [] }
  if (typeof window === 'undefined') return empty
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Stored> | null
    if (!s) return empty
    const ids = new Set(TRAIL.map((m) => m.id))
    return { active: !!s.active, found: Array.isArray(s.found) ? s.found.filter((id) => ids.has(id)) : [], completedAt: typeof s.completedAt === 'string' ? s.completedAt : undefined }
  } catch {
    return empty
  }
}

function write(s: Stored) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* storage unavailable */
  }
}

interface TrailState extends Stored {
  /** Last medallion found (drives the small toast); cleared after a few seconds. */
  lastFound: string | null
  /** Completion card open. */
  celebrate: boolean
  start: () => void
  stop: () => void
  reset: () => void
  find: (id: string) => void
  setCelebrate: (v: boolean) => void
}

export const useTrail = create<TrailState>((set, get) => {
  const persist = () => {
    const { active, found, completedAt } = get()
    write({ active, found, completedAt })
  }
  let toastTimer: ReturnType<typeof setTimeout> | undefined
  return {
    ...read(),
    lastFound: null,
    celebrate: false,
    start: () => {
      set({ active: true })
      persist()
    },
    stop: () => {
      set({ active: false, celebrate: false })
      persist()
    },
    reset: () => {
      set({ found: [], completedAt: undefined, celebrate: false, lastFound: null })
      persist()
    },
    find: (id) => {
      const s = get()
      if (!s.active || s.found.includes(id) || !TRAIL.some((m) => m.id === id)) return
      const found = [...s.found, id]
      const done = found.length === TRAIL.length
      set({ found, lastFound: id, celebrate: done, completedAt: done ? new Date().toISOString() : s.completedAt })
      persist()
      clearTimeout(toastTimer)
      toastTimer = setTimeout(() => set({ lastFound: null }), 3600)
    },
    setCelebrate: (celebrate) => set({ celebrate }),
  }
})

export const TRAIL_TOTAL = TRAIL.length
