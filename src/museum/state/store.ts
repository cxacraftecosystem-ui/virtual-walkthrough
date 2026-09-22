import { create } from 'zustand'
import { detectInitialTier, type QualitySetting, type QualityTier } from '../config/quality'
import type { User } from '../api/client'

export type SelectionKind = 'artwork' | 'exhibit' | 'infographic' | 'object' | 'video'
export interface Selection {
  kind: SelectionKind
  id: string
}

export type Phase = 'loading' | 'ready' | 'entered'

/** Social side panels (only available when the backend is reachable). */
export type Drawer = 'favourites' | 'guestbook'

export interface AuthPrompt {
  mode: 'signin' | 'register'
  /** Optional line explaining why sign-in is needed ("Sign in to save favourites"). */
  reason?: string
}

/** Stable key for an item: `${kind}:${id}`. */
export const itemKey = (kind: SelectionKind, id: string) => `${kind}:${id}`

const QUALITY_KEY = 'museum.quality'

function readStoredQuality(): QualitySetting {
  try {
    const q = new URLSearchParams(window.location.search).get('quality') ?? localStorage.getItem(QUALITY_KEY)
    if (q === 'auto' || q === 'low' || q === 'medium' || q === 'high' || q === 'ultra') return q
  } catch {
    /* storage unavailable */
  }
  return 'auto'
}

interface MuseumState {
  phase: Phase
  /** User's choice (may be 'auto'). */
  quality: QualitySetting
  /** Effective tier currently rendered. */
  tier: QualityTier
  soundOn: boolean
  mapOpen: boolean
  helpOpen: boolean
  /** Item whose information panel is open. */
  selection: Selection | null
  /** Exhibit open in the 3D inspection viewer. */
  inspecting: string | null
  /** Item the visitor is standing in front of (subtle proximity prompt). */
  nearby: (Selection & { title: string }) | null
  hovered: Selection | null
  debug: boolean
  /** All scene shaders compiled (async) — rendering and "Enter" wait for this. */
  sceneCompiled: boolean
  /** Pointer-lock "mouse look": mouse movement turns the view, clicks hit the centre crosshair. */
  mouseLook: boolean

  setPhase: (p: Phase) => void
  setQuality: (q: QualitySetting) => void
  setTier: (t: QualityTier) => void
  toggleSound: () => void
  setMapOpen: (v: boolean) => void
  setHelpOpen: (v: boolean) => void
  select: (s: Selection | null) => void
  inspect: (exhibitId: string | null) => void
  setNearby: (n: MuseumState['nearby']) => void
  setHovered: (h: Selection | null) => void
  setSceneCompiled: (v: boolean) => void
  setMouseLook: (v: boolean) => void

  // ── Social (backend) — see src/museum/api/social.ts ───────────────
  /** Backend reachable? null = still probing, false = static site (all social UI hidden). */
  online: boolean | null
  /** Signed-in account, or null. */
  user: User | null
  /** Sign-in / register modal (null = closed). */
  auth: AuthPrompt | null
  /** Favourited item keys (`itemKey(kind, id)`) of the signed-in user. */
  favorites: string[]
  drawer: Drawer | null
  setOnline: (v: boolean) => void
  setUser: (u: User | null) => void
  openAuth: (reason?: string, mode?: AuthPrompt['mode']) => void
  closeAuth: () => void
  setFavorites: (keys: string[]) => void
  setDrawer: (d: Drawer | null) => void
}

const initialQuality = readStoredQuality()

export const useMuseum = create<MuseumState>((set) => ({
  phase: 'loading',
  quality: initialQuality,
  tier: initialQuality === 'auto' ? detectInitialTier() : initialQuality,
  soundOn: false,
  mapOpen: typeof window !== 'undefined' ? window.innerWidth > 900 : true,
  helpOpen: false,
  selection: null,
  inspecting: null,
  nearby: null,
  hovered: null,
  debug: process.env.NODE_ENV !== 'production' && typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug'),

  setPhase: (phase) => set({ phase }),
  setQuality: (quality) => {
    try {
      localStorage.setItem(QUALITY_KEY, quality)
    } catch {
      /* ignore */
    }
    const tier = quality === 'auto' ? detectInitialTier() : quality
    // A tier change remounts the Canvas: hold rendering until its shaders are recompiled.
    set((s) => ({ quality, tier, sceneCompiled: s.tier === tier ? s.sceneCompiled : false }))
  },
  setTier: (tier) => set((s) => ({ tier, sceneCompiled: s.tier === tier ? s.sceneCompiled : false })),
  toggleSound: () => set((s) => ({ soundOn: !s.soundOn })),
  setMapOpen: (mapOpen) => set({ mapOpen }),
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  select: (selection) => set({ selection }),
  inspect: (inspecting) => set({ inspecting }),
  setNearby: (nearby) => set({ nearby }),
  setHovered: (hovered) => set({ hovered }),
  sceneCompiled: false,
  setSceneCompiled: (sceneCompiled) => set({ sceneCompiled }),
  mouseLook: false,
  setMouseLook: (mouseLook) => set({ mouseLook }),

  online: null,
  user: null,
  auth: null,
  favorites: [],
  drawer: null,
  setOnline: (online) => set({ online }),
  setUser: (user) => set(user ? { user } : { user: null, favorites: [] }),
  openAuth: (reason, mode = 'signin') => set({ auth: { mode, reason } }),
  closeAuth: () => set({ auth: null }),
  setFavorites: (favorites) => set({ favorites }),
  setDrawer: (drawer) => set({ drawer }),
}))
