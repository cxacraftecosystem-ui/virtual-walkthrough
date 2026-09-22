/**
 * VIDEO SCREENS — embedded films with positional / surround audio.
 *
 * `src` may be any browser-playable file (MP4 H.264/AAC recommended; WebM VP9/Opus fine).
 * Multichannel (5.1) files are routed channel-by-channel to the virtual speakers in
 * `audio.speakers`; stereo files are up-mixed (L→FL+SL, R→FR+SR, L+R→C).
 *
 * PLACEHOLDER STATUS: every clip below is a generated placeholder (see
 * scripts/generate-placeholder-videos.mjs) until the workshop supplies footage.
 */
import type { Vec3 } from './museum'
import type { SurfaceId } from './layout'

export type SpeakerChannel = 'FL' | 'FR' | 'C' | 'LFE' | 'SL' | 'SR' | 'BL' | 'BR'

export interface VideoConfig {
  id: string
  title: string
  description?: string
  src: string
  poster?: string
  /** Wall mounting (like artworks) … */
  placement: { surface: SurfaceId; at: number; centerHeight: number }
  /** Screen width in metres; height follows the video's aspect ratio (fallback 16:9). */
  width: number
  screen: 'flat' | 'led-wall' | 'curved'
  /** Horizontal arc (deg) for curved screens. */
  curveDeg?: number
  audio: {
    mode: 'spatial' | 'surround' | 'none'
    /** 0–1 */
    volume: number
    /** Distance (m) at which volume starts to fall off. */
    refDistance: number
    rolloff: number
    maxDistance: number
    /** Surround speakers (world positions); only for mode 'surround'. */
    speakers?: { channel: SpeakerChannel; position: Vec3 }[]
    /**
     * Source channel count override (2 = stereo → up-mixed, 6 = 5.1, 8 = 7.1).
     * Omit to auto-detect from the decoded stream.
     */
    channels?: 2 | 6 | 8
    /** Room reverb send (0–1) for surround rooms. Default 0.16 for 'surround', 0 otherwise. */
    reverb?: number
  }
  /** Add ONE colour-following RectAreaLight in front of the screen (areaLights tiers only). Default: true for 'curved'. */
  lightSpill?: boolean
  /** 'proximity' = plays while the visitor is in `zone` (or within activationDistance). */
  playback: 'proximity' | 'always' | 'click'
  activationDistance?: number
  zone?: string
  loop: boolean
  placeholder?: boolean
}

const PLACEHOLDER = 'Placeholder film generated for layout and audio calibration. Replace `src` with the final footage.'

const th = { x0: -23, x1: -10.3, z0: 5.072, z1: 17.5 }

export const VIDEOS: VideoConfig[] = [
  {
    id: 'welcome-film',
    title: 'Welcome Film',
    description: PLACEHOLDER,
    src: '/videos/welcome-film.webm',
    poster: '/videos/welcome-film.jpg',
    placement: { surface: 'atrium-north-west', at: -5.6, centerHeight: 3.1 },
    width: 6.4,
    screen: 'led-wall',
    audio: { mode: 'spatial', volume: 0.55, refDistance: 3, rolloff: 1.4, maxDistance: 30 },
    playback: 'proximity',
    zone: 'atrium',
    loop: true,
    placeholder: true,
  },
  {
    id: 'theatre-film',
    title: 'Immersive Theatre — Feature Film',
    description: PLACEHOLDER,
    src: '/videos/theatre-film.webm',
    poster: '/videos/theatre-film.jpg',
    placement: { surface: 'theatre-screen', at: (th.z0 + th.z1) / 2, centerHeight: 3.0 },
    width: 9.6,
    screen: 'curved',
    curveDeg: 38,
    audio: {
      mode: 'surround',
      volume: 0.8,
      refDistance: 4,
      rolloff: 1,
      maxDistance: 40,
      speakers: [
        { channel: 'FL', position: [th.x0 + 0.6, 2.4, th.z0 + 1.2] },
        { channel: 'FR', position: [th.x0 + 0.6, 2.4, th.z1 - 1.2] },
        { channel: 'C', position: [th.x0 + 0.4, 1.0, (th.z0 + th.z1) / 2] },
        { channel: 'LFE', position: [th.x0 + 0.8, 0.4, th.z0 + 3.0] },
        { channel: 'SL', position: [-16.4, 3.2, th.z0 + 0.35] },
        { channel: 'SR', position: [-16.4, 3.2, th.z1 - 0.35] },
        { channel: 'BL', position: [th.x1 - 0.6, 3.2, th.z0 + 1.6] },
        { channel: 'BR', position: [th.x1 - 0.6, 3.2, th.z1 - 1.6] },
      ],
    },
    playback: 'proximity',
    zone: 'theatre',
    loop: true,
    placeholder: true,
  },
  {
    id: 'process-film-1',
    title: 'Process Film — Printing',
    description: PLACEHOLDER,
    src: '/videos/process-film-1.webm',
    poster: '/videos/process-film-1.jpg',
    placement: { surface: 'workshop-west', at: -1.2, centerHeight: 2.2 },
    width: 2.8,
    screen: 'flat',
    audio: { mode: 'spatial', volume: 0.45, refDistance: 2, rolloff: 1.8, maxDistance: 18 },
    playback: 'proximity',
    activationDistance: 9,
    loop: true,
    placeholder: true,
  },
  {
    id: 'process-film-2',
    title: 'Process Film — Dyeing',
    description: PLACEHOLDER,
    src: '/videos/process-film-2.webm',
    poster: '/videos/process-film-2.jpg',
    placement: { surface: 'workshop-south', at: 20.5, centerHeight: 2.3 },
    width: 3.2,
    screen: 'flat',
    audio: { mode: 'spatial', volume: 0.45, refDistance: 2, rolloff: 1.8, maxDistance: 18 },
    playback: 'proximity',
    activationDistance: 9,
    loop: true,
    placeholder: true,
  },
]
