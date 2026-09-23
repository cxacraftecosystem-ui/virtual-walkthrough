/**
 * <VideoScreen config={...} /> — one embedded film.
 *
 * - <video> element (cached per id, survives Canvas remounts) → THREE.VideoTexture (sRGB).
 *   The texture only re-uploads when the video presents a new frame (requestVideoFrameCallback)
 *   and only when the screen is actually drawn, so paused / off-screen films cost nothing.
 * - Size from the video's intrinsic aspect ratio (poster first, 16:9 fallback).
 * - Styles: 'flat' (thin black bezel), 'led-wall' (slim anodised frame, module seams,
 *   slight emissive boost), 'curved' (concave cylindrical segment + black velour masking,
 *   standing off the wall so the front speakers sit behind it).
 * - Unlit, un-tone-mapped screen material so films read correctly in dark rooms.
 * - Playback policy: 'proximity' | 'always' | 'click'; click toggles play and opens the
 *   info panel. Missing footage → poster, or a deliberate "Film unavailable" card.
 * - Audio: starts muted (autoplay-safe); on the first user gesture it is routed through
 *   the shared engine (spatial or surround), after which `soundOn` governs loudness.
 * - Optional light spill: ONE RectAreaLight whose colour follows the picture.
 */
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { zoneAt } from '../config/layout'
import type { Vec3 } from '../config/museum'
import { QUALITY_PRESETS, withDevOverrides } from '../config/quality'
import type { VideoConfig } from '../config/videos'
import { registerItem } from '../interaction/registry'
import { useMuseum } from '../state/store'
import { visitor } from '../state/visitor'
import { ErrorBoundary } from '../utils/ErrorBoundary'
import { VR_MODE } from '../utils/vr'
import { inverseDistanceGain, isAudioUnsupported, onAudioUnlock, onUserGesture, setVideoAudibility } from './audioEngine'
import { curveRadius, DEFAULT_ASPECT, MASK, screenDepth, screenPlacement } from './screenMath'
import { routeVideoAudio, type VideoAudioRoute } from './videoAudio'

/* ------------------------------------------------------------------ */
/* Media cache                                                         */
/* ------------------------------------------------------------------ */

type MediaStatus = 'idle' | 'ready' | 'failed'

interface Media {
  el: HTMLVideoElement | null
  texture: THREE.VideoTexture | null
  status: MediaStatus
  aspect: number | null
  /** At least one frame decoded (the video texture is worth showing). */
  hasFrame: boolean
  /** Visitor paused a film that the policy would otherwise play. */
  userPaused: boolean
  /** Visitor started a 'click' film. */
  userPlay: boolean
  route: VideoAudioRoute | null
  listeners: Set<() => void>
  src: string
}

const media = new Map<string, Media>()

function notify(m: Media) {
  for (const l of m.listeners) l()
}

function getMedia(cfg: VideoConfig): Media {
  const existing = media.get(cfg.id)
  if (existing && existing.src === cfg.src) return existing
  const m: Media = { el: null, texture: null, status: 'idle', aspect: null, hasFrame: false, userPaused: false, userPlay: false, route: null, listeners: existing?.listeners ?? new Set(), src: cfg.src }
  media.set(cfg.id, m)
  if (!cfg.src || typeof document === 'undefined') {
    m.status = 'failed'
    return m
  }
  try {
    const el = document.createElement('video')
    el.crossOrigin = 'anonymous'
    el.playsInline = true
    el.setAttribute('playsinline', '')
    el.setAttribute('webkit-playsinline', '')
    el.muted = true
    el.defaultMuted = true
    el.setAttribute('muted', '')
    el.loop = cfg.loop
    el.preload = 'metadata'
    el.disablePictureInPicture = true
    el.addEventListener('loadedmetadata', () => {
      if (el.videoWidth > 0 && el.videoHeight > 0) m.aspect = el.videoWidth / el.videoHeight
      if (cfg.kind === 'portrait' && m.aspect && m.texture) m.aspect = applyPortraitCrop(m.texture, m.aspect, cfg.cropAspect)
      m.status = 'ready'
      notify(m)
    })
    const frame = () => {
      if (!m.hasFrame && el.readyState >= 2 && !el.paused) {
        m.hasFrame = true
        notify(m)
      }
    }
    el.addEventListener('playing', frame)
    el.addEventListener('timeupdate', frame)
    el.addEventListener('play', () => {
      notify(m)
      emitState(cfg.id, true)
    })
    el.addEventListener('pause', () => {
      notify(m)
      emitState(cfg.id, false)
    })
    el.addEventListener('error', () => {
      m.status = 'failed'
      m.hasFrame = false
      notify(m)
    })
    el.src = cfg.src
    m.el = el
    const tex = new THREE.VideoTexture(el)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.generateMipmaps = false
    m.texture = tex
  } catch {
    m.status = 'failed'
  }
  return m
}

function useMediaVersion(m: Media) {
  const [, setV] = useState(0)
  useEffect(() => {
    const l = () => setV((v) => v + 1)
    m.listeners.add(l)
    return () => {
      m.listeners.delete(l)
    }
  }, [m])
}

function safePlay(el: HTMLVideoElement) {
  try {
    const p = el.play()
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        // Blocked unmuted autoplay: fall back to muted playback rather than stopping.
        if (!el.muted) {
          el.muted = true
          void el.play().catch(() => {})
        }
      })
    }
  } catch {
    /* ignore */
  }
}

/* Info-panel bridge (see ui/InfoPanel.tsx): 'museum:video_toggle' {id} in, 'museum:video_state' {id, playing} out. */
const VIDEO_TOGGLE_EVENT = 'museum:video_toggle'
const VIDEO_STATE_EVENT = 'museum:video_state'

function emitState(id: string, playing: boolean) {
  try {
    window.dispatchEvent(new CustomEvent(VIDEO_STATE_EVENT, { detail: { id, playing } }))
  } catch {
    /* ignore */
  }
}

/** Visitor-initiated play/pause (screen click or info-panel button). */
function toggleMedia(m: Media) {
  const el = m.el
  if (!el || m.status === 'failed') return
  if (el.paused) {
    m.userPaused = false
    m.userPlay = true
    safePlay(el)
  } else {
    m.userPaused = true
    m.userPlay = false
    el.pause()
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener(VIDEO_TOGGLE_EVENT, (e: Event) => {
    const id = (e as CustomEvent<{ id?: string }>).detail?.id
    const m = id ? media.get(id) : undefined
    if (m) toggleMedia(m)
  })
}

/** Pause every film (tab hidden). */
export function pauseAllVideos() {
  for (const m of media.values()) {
    try {
      m.el?.pause()
    } catch {
      /* ignore */
    }
  }
}

/* ------------------------------------------------------------------ */
/* Posters, cards, glyphs                                              */
/* ------------------------------------------------------------------ */

interface Poster {
  texture: THREE.Texture
  aspect: number
}
const posters = new Map<string, Promise<Poster | null>>()
function loadPoster(url: string | undefined): Promise<Poster | null> {
  if (!url) return Promise.resolve(null)
  let p = posters.get(url)
  if (!p) {
    p = new THREE.TextureLoader().loadAsync(url).then(
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace
        const img = t.image as { width?: number; height?: number } | undefined
        const aspect = img?.width && img?.height ? img.width / img.height : DEFAULT_ASPECT
        return { texture: t, aspect }
      },
      () => null,
    )
    posters.set(url, p)
  }
  return p
}

const cards = new Map<string, THREE.Texture>()
/** Centre-crops a landscape video texture to a portrait aspect; returns the displayed aspect. */
function applyPortraitCrop(tex: THREE.Texture, srcAspect: number, crop = 9 / 16) {
  if (srcAspect <= crop) return srcAspect
  const k = crop / srcAspect
  tex.repeat.set(k, 1)
  tex.offset.set((1 - k) / 2, 0)
  return crop
}

/** "Meet the maker" card shown on portrait screens until the film has a frame. */
function portraitCard(title: string): THREE.Texture {
  const key = `portrait|${title}`
  let t = cards.get(key)
  if (t) return t
  const c = document.createElement('canvas')
  c.width = 540
  c.height = 960
  const g = c.getContext('2d')
  if (g) {
    const grad = g.createLinearGradient(0, 0, 0, 960)
    grad.addColorStop(0, '#2a241f')
    grad.addColorStop(1, '#14110f')
    g.fillStyle = grad
    g.fillRect(0, 0, 540, 960)
    g.strokeStyle = 'rgba(214, 196, 164, 0.3)'
    g.lineWidth = 1.5
    g.strokeRect(40, 40, 460, 880)
    g.textAlign = 'center'
    g.fillStyle = 'rgba(233, 223, 204, 0.62)'
    g.font = '500 20px Inter, system-ui, sans-serif'
    g.fillText('M E E T   T H E   M A K E R', 270, 430)
    g.fillStyle = '#e9dfcc'
    g.font = "500 44px 'Cormorant Garamond', Georgia, serif"
    g.fillText(shortTitle(title), 270, 500, 420)
    g.fillStyle = 'rgba(233, 223, 204, 0.5)'
    g.font = '400 18px Inter, system-ui, sans-serif'
    g.fillText('Portrait film · placeholder', 270, 560)
  }
  t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  cards.set(key, t)
  return t
}

const shortTitle = (title: string) => title.replace(/^Meet the Maker\s*[—-]\s*/i, '')

function unavailableCard(title: string): THREE.Texture {
  let t = cards.get(title)
  if (t) return t
  const c = document.createElement('canvas')
  c.width = 1280
  c.height = 720
  const g = c.getContext('2d')
  if (g) {
    const grad = g.createRadialGradient(640, 360, 60, 640, 360, 820)
    grad.addColorStop(0, '#1d1b19')
    grad.addColorStop(1, '#0c0b0a')
    g.fillStyle = grad
    g.fillRect(0, 0, 1280, 720)
    g.strokeStyle = 'rgba(214, 196, 164, 0.35)'
    g.lineWidth = 1.5
    g.strokeRect(80, 80, 1120, 560)
    g.textAlign = 'center'
    g.fillStyle = '#e9dfcc'
    g.font = "500 58px 'Cormorant Garamond', Georgia, serif"
    g.fillText(title, 640, 340, 1000)
    g.fillStyle = 'rgba(233, 223, 204, 0.62)'
    g.font = "400 24px Inter, system-ui, sans-serif"
    g.fillText('F I L M   U N A V A I L A B L E', 640, 410)
  }
  t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  cards.set(title, t)
  return t
}

let glyphs: { play: THREE.Texture; pause: THREE.Texture } | null = null
function glyphTextures() {
  if (glyphs) return glyphs
  const make = (kind: 'play' | 'pause') => {
    const c = document.createElement('canvas')
    c.width = c.height = 128
    const g = c.getContext('2d')
    if (g) {
      g.fillStyle = 'rgba(12, 11, 10, 0.55)'
      g.beginPath()
      g.arc(64, 64, 60, 0, Math.PI * 2)
      g.fill()
      g.strokeStyle = 'rgba(245, 238, 225, 0.55)'
      g.lineWidth = 2
      g.stroke()
      g.fillStyle = 'rgba(245, 238, 225, 0.92)'
      if (kind === 'play') {
        g.beginPath()
        g.moveTo(52, 40)
        g.lineTo(90, 64)
        g.lineTo(52, 88)
        g.closePath()
        g.fill()
      } else {
        g.fillRect(46, 40, 12, 48)
        g.fillRect(70, 40, 12, 48)
      }
    }
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }
  glyphs = { play: make('play'), pause: make('pause') }
  return glyphs
}

let seamTex: THREE.Texture | null = null
function ledSeamTexture() {
  if (seamTex) return seamTex
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  if (g) {
    g.clearRect(0, 0, 64, 64)
    g.fillStyle = 'rgba(0,0,0,0.9)'
    g.fillRect(0, 0, 64, 1)
    g.fillRect(0, 0, 1, 64)
  }
  seamTex = new THREE.CanvasTexture(c)
  seamTex.wrapS = seamTex.wrapT = THREE.RepeatWrapping
  seamTex.magFilter = THREE.LinearFilter
  return seamTex
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

/**
 * Concave cylindrical panel. Cylinder axis at local z = zc (in front of the wall);
 * the arc runs from angle a0 to a1 (0 = straight toward the wall), height h centred at y0.
 */
function curvedPanel(R: number, zc: number, a0: number, a1: number, h: number, y0: number, segments: number, u0 = 0, u1 = 1) {
  const pos: number[] = []
  const uv: number[] = []
  const nrm: number[] = []
  const idx: number[] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const a = a0 + (a1 - a0) * t
    const x = R * Math.sin(a)
    const z = zc - R * Math.cos(a)
    const nx = -Math.sin(a)
    const nz = Math.cos(a)
    pos.push(x, y0 - h / 2, z, x, y0 + h / 2, z)
    const u = u0 + (u1 - u0) * t
    uv.push(u, 0, u, 1)
    nrm.push(nx, 0, nz, nx, 0, nz)
    if (i < segments) {
      const k = i * 2
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
  geo.setIndex(idx)
  return geo
}

/** Flat cap between the wall (z = 0) and the curve, lying in the XZ plane. */
function curvedCap(R: number, zc: number, a: number, segments: number) {
  const shape = new THREE.Shape()
  const pt = (ang: number) => [R * Math.sin(ang), zc - R * Math.cos(ang)] as const
  shape.moveTo(pt(-a)[0], 0)
  for (let i = 0; i <= segments; i++) {
    const [x, z] = pt(-a + (2 * a * i) / segments)
    shape.lineTo(x, z)
  }
  shape.lineTo(pt(a)[0], 0)
  shape.closePath()
  const geo = new THREE.ShapeGeometry(shape, 1)
  geo.rotateX(Math.PI / 2) // shape y → +z
  return geo
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

const bezelMat = new THREE.MeshStandardMaterial({ color: '#0b0b0c', roughness: 0.38, metalness: 0.25 })
const ledFrameMat = new THREE.MeshStandardMaterial({ color: '#17171a', roughness: 0.42, metalness: 0.65 })
const velourMat = new THREE.MeshStandardMaterial({ color: '#08080a', roughness: 1, metalness: 0, side: THREE.DoubleSide })

const BRIGHTNESS: Record<VideoConfig['screen'], number> = { flat: 0.92, 'led-wall': 1.05, curved: 0.9 }

function wantsToPlay(cfg: VideoConfig, m: Media, center: Vec3): boolean {
  const st = useMuseum.getState()
  if (VR_MODE || st.phase !== 'entered' || m.status === 'failed' || (typeof document !== 'undefined' && document.hidden)) return false
  const d = Math.hypot(visitor.x - center[0], visitor.z - center[2])
  const inZone = cfg.zone ? zoneAt(visitor.x, visitor.z)?.id === cfg.zone : false
  const near = d <= (cfg.activationDistance ?? (cfg.zone ? 0 : 10))
  const present = inZone || near
  if (cfg.playback === 'always') return !m.userPaused
  if (cfg.playback === 'click') {
    if (!present && d > (cfg.activationDistance ?? 12)) m.userPlay = false
    return m.userPlay
  }
  if (!present) {
    m.userPaused = false
    return false
  }
  return !m.userPaused
}

function VideoScreenBody({ config: cfg }: { config: VideoConfig }) {
  const m = useMemo(() => getMedia(cfg), [cfg])
  useMediaVersion(m)
  const tier = useMuseum((s) => s.tier)
  const preset = withDevOverrides(QUALITY_PRESETS[tier])
  const select = useMuseum((s) => s.select)
  const setHoveredStore = useMuseum((s) => s.setHovered)
  const [hovered, setHovered] = useState(false)
  const [poster, setPoster] = useState<Poster | null>(null)
  const [posterDone, setPosterDone] = useState(!cfg.poster)

  useEffect(() => {
    let alive = true
    void loadPoster(cfg.poster).then((p) => {
      if (!alive) return
      setPoster(p)
      setPosterDone(true)
    })
    return () => {
      alive = false
    }
  }, [cfg.poster])

  const aspect = m.aspect ?? (cfg.kind === 'portrait' ? (cfg.cropAspect ?? 9 / 16) : (poster?.aspect ?? DEFAULT_ASPECT))
  const W = cfg.width
  const H = W / aspect
  const place = useMemo(() => screenPlacement(cfg), [cfg])
  const depth = useMemo(() => screenDepth(cfg, aspect), [cfg, aspect])

  const center = useMemo<Vec3>(() => {
    const [x, y, z] = place.position
    const [nx, , nz] = place.normal
    return [x + nx * depth, y, z + nz * depth]
  }, [place, depth])

  // Interaction registry (proximity prompt / info panel).
  useEffect(
    () =>
      registerItem({
        id: cfg.id,
        kind: 'video',
        title: cfg.title,
        center,
        normal: place.normal,
        size: [W, H],
        viewDistance: Math.min(7, Math.max(2.2, W * 0.9)),
      }),
    [cfg.id, cfg.title, center, place.normal, W, H],
  )

  // Audio routing once the first gesture has unlocked the engine.
  useEffect(() => {
    const el = m.el
    if (!el || cfg.audio.mode === 'none') return
    const offUnlock = onAudioUnlock(() => {
      m.route = routeVideoAudio(cfg, el, center)
      if (m.route) el.muted = false
    })
    // No WebAudio at all: plain element audio after a gesture, volume handled in the loop.
    const offGesture = onUserGesture(() => {
      if (isAudioUnsupported()) el.muted = false
    })
    return () => {
      offUnlock()
      offGesture()
    }
  }, [m, cfg, center])
  useEffect(() => {
    m.route?.setPosition(center)
  }, [m, center])

  /* ---------------- material / texture selection ---------------- */
  const showVideo = m.hasFrame && m.status !== 'failed' && !!m.texture
  const portrait = cfg.kind === 'portrait'
  const fallback = portrait
    ? portraitCard(cfg.title)
    : (poster?.texture ?? (posterDone && (m.status === 'failed' || !cfg.poster) ? unavailableCard(cfg.title) : null))
  const failedNoPoster = m.status === 'failed' && !poster && !portrait
  const map = failedNoPoster ? unavailableCard(cfg.title) : showVideo ? m.texture : fallback

  const screenMat = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false, side: THREE.DoubleSide }), [])
  useEffect(() => {
    screenMat.map = map
    screenMat.color.setScalar(map ? BRIGHTNESS[cfg.screen] : 0.012)
    screenMat.needsUpdate = true
  }, [screenMat, map, cfg.screen])
  useEffect(() => () => screenMat.dispose(), [screenMat])

  /* ---------------- geometry ---------------- */
  const geo = useMemo(() => {
    if (cfg.screen !== 'curved') return null
    const R = curveRadius(cfg)
    const a = Math.asin(Math.min(0.999, W / 2 / R))
    const zc = depth + R
    const am = a + MASK.side / R
    const segs = 64
    const topY = H / 2 + MASK.top / 2
    const botY = -H / 2 - MASK.bottom / 2
    const sideH = H + MASK.top + MASK.bottom
    const sideY = (MASK.top - MASK.bottom) / 2
    const edgeZ = zc - R * Math.cos(am)
    const edgeX = R * Math.sin(am)
    return {
      screen: curvedPanel(R, zc, -a, a, H, 0, segs),
      top: curvedPanel(R, zc, -am, am, MASK.top, topY, segs),
      bottom: curvedPanel(R, zc, -am, am, MASK.bottom, botY, segs),
      left: curvedPanel(R, zc, -am, -a, sideH, sideY, 6),
      right: curvedPanel(R, zc, a, am, sideH, sideY, 6),
      cap: curvedCap(R, zc, am, segs),
      capTopY: H / 2 + MASK.top,
      capBotY: -H / 2 - MASK.bottom,
      edgeX,
      edgeZ,
      sideH,
      sideY,
    }
  }, [cfg, W, H, depth])
  useEffect(
    () => () => {
      if (!geo) return
      for (const g of [geo.screen, geo.top, geo.bottom, geo.left, geo.right, geo.cap]) g.dispose()
    },
    [geo],
  )

  /* ---------------- playback + audio loop ---------------- */
  const acc = useRef(0)
  useFrame((state, dt) => {
    acc.current += dt
    if (acc.current < 0.25) return
    acc.current = 0
    const el = m.el
    if (!el) return
    const want = wantsToPlay(cfg, m, center)
    if (want && el.paused) safePlay(el)
    else if (!want && !el.paused) el.pause()
    const playing = !el.paused
    m.route?.tick(playing)

    // Audibility at the listener (drives ambience ducking; direct-mode volume).
    let level = 0
    if (playing && cfg.audio.mode !== 'none' && !el.muted) {
      const cam = state.camera.position
      let d = Math.hypot(cam.x - center[0], cam.y - center[1], cam.z - center[2])
      if (cfg.audio.mode === 'surround') for (const s of cfg.audio.speakers ?? []) d = Math.min(d, Math.hypot(cam.x - s.position[0], cam.y - s.position[1], cam.z - s.position[2]))
      level = cfg.audio.volume * inverseDistanceGain(d, cfg.audio.refDistance, cfg.audio.rolloff, cfg.audio.maxDistance)
      if (d > cfg.audio.maxDistance) level = 0
    }
    setVideoAudibility(cfg.id, useMuseum.getState().soundOn ? level : 0)
    if (!m.route && isAudioUnsupported() && !el.muted) {
      try {
        el.volume = Math.max(0, Math.min(1, useMuseum.getState().soundOn ? level : 0))
      } catch {
        /* ignore */
      }
    }
  })
  useEffect(() => () => setVideoAudibility(cfg.id, 0), [cfg.id])

  /* ---------------- interaction ---------------- */
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (e.delta > 6 || useMuseum.getState().phase !== 'entered') return
    toggleMedia(m)
    select({ kind: 'video', id: cfg.id })
  }
  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    setHovered(true)
    setHoveredStore({ kind: 'video', id: cfg.id })
    document.body.style.cursor = 'pointer'
  }
  const onOut = () => {
    setHovered(false)
    setHoveredStore(null)
    document.body.style.cursor = ''
  }

  const playingNow = !!m.el && !m.el.paused
  const glyphSize = Math.min(0.3, Math.max(0.12, W * 0.035))
  const glyph = hovered && m.status !== 'failed' ? (playingNow ? glyphTextures().pause : glyphTextures().play) : null
  const spill = (cfg.lightSpill ?? cfg.screen === 'curved') && preset.areaLights

  const b = cfg.screen === 'led-wall' ? 0.04 : 0.028
  return (
    <group position={place.position} rotation={[0, place.rotationY, 0]}>
      <group onClick={onClick} onPointerOver={onOver} onPointerOut={onOut}>
        {cfg.screen === 'curved' && geo ? (
          <>
            <mesh geometry={geo.screen} material={screenMat} />
            <mesh geometry={geo.top} material={velourMat} />
            <mesh geometry={geo.bottom} material={velourMat} />
            <mesh geometry={geo.left} material={velourMat} />
            <mesh geometry={geo.right} material={velourMat} />
          </>
        ) : (
          <>
            <mesh position={[0, 0, depth / 2]} material={cfg.screen === 'led-wall' ? ledFrameMat : bezelMat} castShadow receiveShadow>
              <boxGeometry args={[W + 2 * b, H + 2 * b, depth]} />
            </mesh>
            <mesh position={[0, 0, depth + 0.0012]} material={screenMat}>
              <planeGeometry args={[W, H]} />
            </mesh>
          </>
        )}
      </group>
      {cfg.screen === 'curved' && geo && (
        <group>
          {/* soffit + stage lip closing the gap between screen and wall */}
          <mesh geometry={geo.cap} material={velourMat} position={[0, geo.capTopY, 0]} />
          <mesh geometry={geo.cap} material={velourMat} position={[0, geo.capBotY, 0]} />
          {/* side returns back to the wall */}
          {[-1, 1].map((s) => (
            <mesh key={s} material={velourMat} position={[s * geo.edgeX, geo.sideY, geo.edgeZ / 2]} rotation={[0, Math.PI / 2, 0]}>
              <planeGeometry args={[geo.edgeZ, geo.sideH]} />
            </mesh>
          ))}
        </group>
      )}
      {cfg.screen === 'led-wall' && <LedSeams w={W} h={H} z={depth + 0.0022} />}
      {portrait && <PortraitStand w={W} h={H} centerHeight={cfg.placement.centerHeight} title={cfg.title} />}
      {glyph && (
        <mesh position={[0, -H / 2 + glyphSize * 0.95, depth + 0.012]} renderOrder={2}>
          <planeGeometry args={[glyphSize, glyphSize]} />
          <meshBasicMaterial map={glyph} transparent depthWrite={false} toneMapped={false} />
        </mesh>
      )}
      {spill && <ScreenSpill m={m} w={W} h={H} z={depth + 0.35} active={showVideo} />}
    </group>
  )
}

const standMat = new THREE.MeshStandardMaterial({ color: '#1b1a19', roughness: 0.5, metalness: 0.6 })

/** Free-standing stand for a portrait screen: slim post, weighted base and a caption plate. */
function PortraitStand({ w, h, centerHeight, title }: { w: number; h: number; centerHeight: number; title: string }) {
  const caption = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 512
    c.height = 128
    const g = c.getContext('2d')
    if (g) {
      g.fillStyle = '#f3ede1'
      g.fillRect(0, 0, 512, 128)
      g.fillStyle = '#8a5a3b'
      g.font = '600 18px Inter, system-ui, sans-serif'
      g.fillText('M E E T   T H E   M A K E R', 24, 42)
      g.fillStyle = '#2b2621'
      g.font = "500 40px 'Cormorant Garamond', Georgia, serif"
      g.fillText(shortTitle(title), 24, 94, 470)
    }
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 4
    return t
  }, [title])
  useEffect(() => () => caption.dispose(), [caption])
  const postH = centerHeight - h / 2 + 0.05
  const capY = -h / 2 - 0.11
  return (
    <group>
      <mesh material={standMat} position={[0, -centerHeight + postH / 2, -0.012]} castShadow>
        <cylinderGeometry args={[0.022, 0.026, postH, 12]} />
      </mesh>
      <mesh material={standMat} position={[0, -centerHeight + 0.008, -0.012]} castShadow receiveShadow>
        <boxGeometry args={[Math.max(0.4, w * 0.8), 0.016, 0.3]} />
      </mesh>
      <group position={[0, capY, 0.03]} rotation={[-0.5, 0, 0]}>
        <mesh material={standMat}>
          <boxGeometry args={[w, w / 4 + 0.02, 0.012]} />
        </mesh>
        <mesh position={[0, 0, 0.0065]}>
          <planeGeometry args={[w - 0.02, w / 4]} />
          <meshStandardMaterial map={caption} roughness={0.85} />
        </mesh>
      </group>
    </group>
  )
}

function LedSeams({ w, h, z }: { w: number; h: number; z: number }) {
  const tex = useMemo(() => {
    const t = ledSeamTexture().clone()
    // 0.5 m cabinets (typical 500 × 500 mm LED modules).
    t.repeat.set(w / 0.5, h / 0.5)
    t.needsUpdate = true
    return t
  }, [w, h])
  useEffect(() => () => tex.dispose(), [tex])
  return (
    <mesh position={[0, 0, z]}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={tex} transparent opacity={0.12} depthWrite={false} toneMapped={false} />
    </mesh>
  )
}

/* ------------------------------------------------------------------ */
/* Light spill (one RectAreaLight following the picture's colour)      */
/* ------------------------------------------------------------------ */

let sampler: { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null = null
function sampleColor(el: HTMLVideoElement, out: THREE.Color): boolean {
  try {
    if (!sampler) {
      const c = document.createElement('canvas')
      c.width = 16
      c.height = 9
      const g = c.getContext('2d', { willReadFrequently: true })
      if (!g) return false
      sampler = { c, g }
    }
    const { g } = sampler
    g.drawImage(el, 0, 0, 16, 9)
    const d = g.getImageData(0, 0, 16, 9).data
    let r = 0
    let gg = 0
    let b = 0
    for (let i = 0; i < d.length; i += 4) {
      r += d[i]
      gg += d[i + 1]
      b += d[i + 2]
    }
    const n = (d.length / 4) * 255
    out.setRGB(r / n, gg / n, b / n, THREE.SRGBColorSpace)
    return true
  } catch {
    return false
  }
}

const SPILL_INTENSITY = 12

function ScreenSpill({ m, w, h, z, active }: { m: Media; w: number; h: number; z: number; active: boolean }) {
  const light = useRef<THREE.RectAreaLight>(null)
  const target = useRef(new THREE.Color(0, 0, 0))
  const current = useRef(new THREE.Color(0, 0, 0))
  const acc = useRef(0)
  useFrame((_, dt) => {
    const l = light.current
    if (!l) return
    const el = m.el
    acc.current += dt
    if (acc.current >= 0.2) {
      acc.current = 0
      if (!active || !el || el.paused || !sampleColor(el, target.current)) {
        if (!active || !el || el.paused) target.current.setRGB(0, 0, 0)
      }
    }
    current.current.lerp(target.current, 1 - Math.exp(-dt * 4))
    const c = current.current
    const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
    // Intensity follows brightness; colour = the picture's hue, half-desaturated (walls
    // and seats scatter the spill). Never toggle `visible` — that would recompile shaders.
    l.intensity = SPILL_INTENSITY * lum
    const mx = Math.max(c.r, c.g, c.b)
    if (mx > 1e-4) l.color.setRGB(0.5 + (0.5 * c.r) / mx, 0.5 + (0.5 * c.g) / mx, 0.5 + (0.5 * c.b) / mx)
  })
  // Emits along local -z → turn to face the room.
  return <rectAreaLight ref={light} position={[0, 0, z]} rotation={[0, Math.PI, 0]} width={w * 0.92} height={h * 0.92} intensity={0} />
}

/** Error-contained screen: any failure renders nothing rather than breaking the scene. */
export function VideoScreen({ config }: { config: VideoConfig }) {
  return (
    <ErrorBoundary fallback={null}>
      <VideoScreenBody config={config} />
    </ErrorBoundary>
  )
}

// Read-only inspection hook for automated checks / support: window.__mediaDebug()
if (typeof window !== 'undefined') {
  ;(window as unknown as { __mediaDebug?: () => unknown }).__mediaDebug = () =>
    Object.fromEntries(
      [...media.entries()].map(([id, m]) => [
        id,
        {
          status: m.status,
          paused: m.el?.paused ?? null,
          muted: m.el?.muted ?? null,
          time: m.el ? +m.el.currentTime.toFixed(2) : null,
          aspect: m.aspect,
          hasFrame: m.hasFrame,
          route: m.route ? { mode: m.route.mode, layout: m.route.layout(), levels: (['FL', 'FR', 'C', 'LFE', 'SL', 'SR', 'BL', 'BR'] as const).map((c) => +m.route!.level(c).toFixed(3)) } : null,
        },
      ]),
    )
}
