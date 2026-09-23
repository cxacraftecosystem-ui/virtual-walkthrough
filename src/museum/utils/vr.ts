/**
 * `?vr=1` — visual-regression mode (scripts/visual-regression.mjs). Time-driven animation is
 * frozen so screenshots are deterministic: sky/cloud time, banner/foliage/ripple clock
 * (MODEL_TIME), the centrepiece spin, and video playback (screens show their poster).
 */
export const VR_MODE = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('vr') === '1'
