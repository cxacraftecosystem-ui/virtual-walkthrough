/**
 * Museum ambience — thin React/UI wrapper around the spatial soundscape
 * (src/museum/media/soundscape.ts).
 *
 * The soundscape (per-zone procedural ambience crossfaded by the visitor's zone, the
 * time-of-day outdoor layers, and footsteps synced to walking speed) runs while
 * `soundOn && phase === 'entered'` once audio has been unlocked by a user gesture, and
 * fades out otherwise (also while the tab is hidden). Optional recordings in
 * public/audio/ replace the synthesis — see public/audio/README.md. The legacy
 * `/audio/ambience.mp3` is still honoured as the gallery room-tone fallback.
 *
 * Everything shares the museum's single AudioContext (media/audioEngine.ts): the
 * soundscape feeds the engine's ambience duck stage (dips while a film is audible) and
 * the engine's master gain follows `soundOn`.
 */
import { useEffect } from 'react'
import { ensureSoundscape, startSoundscape } from '../media/soundscape'

/** Imperatively request ambience (call inside a user gesture, e.g. "Enter" / sound toggle). */
export function requestAmbientStart() {
  try {
    startSoundscape()
  } catch {
    /* audio is best-effort */
  }
}

/** Plays ambience while `soundOn && phase === 'entered'` (mount once, e.g. in the UI overlay). */
export function useAmbientAudio() {
  useEffect(() => {
    try {
      ensureSoundscape()
    } catch {
      /* audio is best-effort */
    }
  }, [])
}
