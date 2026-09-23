/**
 * "Examine closely" — full-screen deep-zoom viewer for artworks (OpenSeadragon).
 *
 * Source (see examineSource): a Deep Zoom Image pyramid (`deepZoom`, a .dzi URL) when
 * available, else `highRes`, else the wall `image` (OSD builds an in-memory pyramid).
 * Opened from the info panel ("Examine closely") and by double-clicking an artwork.
 *
 * While open, the 3D scene's render loop is paused (the viewer is opaque) and walking is
 * frozen; the viewer owns the keyboard (capture phase): Esc close · + / − zoom · 0 reset ·
 * F fullscreen · arrows / WASD pan.
 *
 * Scale bar: exact when the artwork has `physicalWidth`; for placeholders without one it
 * shows the size AS HUNG in the virtual gallery (and says so); otherwise hidden.
 */
import { _roots } from '@react-three/fiber'
import type OpenSeadragon from 'openseadragon'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ARTWORKS, type ArtworkConfig } from '../../config/artworks'
import { resolveFrame } from '../../config/frames'
import { computeArtworkLayout } from '../../exhibits/frameMath'
import { track } from '../../analytics/tracker'
import { visitor } from '../../state/visitor'
import { closeExamine, examineSource, useExamine, type ExamineSource } from './deepZoomStore'
import './DeepZoomViewer.css'

type OSDNamespace = typeof OpenSeadragon

export function DeepZoomViewer() {
  const id = useExamine((s) => s.artworkId)
  const art = id ? ARTWORKS.find((a) => a.id === id) : undefined
  useEffect(() => {
    if (id && !art) closeExamine()
  }, [id, art])
  if (!art) return null
  return <ExamineView key={art.id} art={art} />
}

/** Pause the museum's render loop + walking while the opaque viewer is up. */
function pauseMuseum() {
  const canvas = document.querySelector<HTMLCanvasElement>('.museum-canvas canvas')
  const root = canvas ? _roots.get(canvas) : undefined
  const paused = root?.store.getState().frameloop === 'always'
  if (paused) root!.store.getState().setFrameloop('never')
  if (document.pointerLockElement) document.exitPointerLock()
  const wasFrozen = visitor.frozen
  visitor.frozen = true
  return () => {
    visitor.frozen = wasFrozen
    if (paused && canvas?.isConnected) root!.store.getState().setFrameloop('always')
  }
}

const NICE_CM = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500]
const fmtLen = (cm: number) => (cm < 1 ? `${Math.round(cm * 10)} mm` : cm >= 100 ? `${cm / 100} m` : `${cm} cm`)

function tileSourceFor(src: ExamineSource): string | OpenSeadragon.TileSourceOptions {
  if (src.kind === 'dzi') return src.url
  return { type: 'image', url: src.url, buildPyramid: true, crossOriginPolicy: 'Anonymous' } as OpenSeadragon.TileSourceOptions
}

function ExamineView({ art }: { art: ArtworkConfig }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const viewerRef = useRef<OpenSeadragon.Viewer | null>(null)
  const osdRef = useRef<OSDNamespace | null>(null)
  const zoomRef = useRef<HTMLSpanElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const barLabelRef = useRef<HTMLSpanElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [usingFallback, setUsingFallback] = useState(false)
  const [scaleNote, setScaleNote] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [hint, setHint] = useState(true)
  const [closing, setClosing] = useState(false)

  const close = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    setClosing(true)
    window.setTimeout(closeExamine, 200)
  }, [])

  // museum pause / focus restore / analytics
  useEffect(() => {
    const resume = pauseMuseum()
    const prevFocus = document.activeElement as HTMLElement | null
    closeRef.current?.focus({ preventScroll: true })
    track('inspect_open', { itemKind: 'artwork', itemId: art.id, meta: { viewer: 'deepzoom' } })
    return () => {
      resume()
      if (prevFocus?.isConnected) prevFocus.focus({ preventScroll: true })
    }
  }, [art.id])

  // OpenSeadragon
  useEffect(() => {
    let cancelled = false
    let viewer: OpenSeadragon.Viewer | null = null
    const primary = examineSource(art)
    if (!primary) {
      setStatus('error')
      return
    }
    const fallbackUrl = art.highRes || art.image
    const usingFallbackRef = { current: false }

    void import('openseadragon')
      .then((mod) => {
        if (cancelled || !hostRef.current) return
        const OSD = ((mod as unknown as { default?: OSDNamespace }).default ?? mod) as OSDNamespace
        osdRef.current = OSD
        viewer = OSD({
          element: hostRef.current,
          tileSources: tileSourceFor(primary),
          crossOriginPolicy: 'Anonymous',
          drawer: ['webgl', 'canvas'],
          showNavigationControl: false,
          showNavigator: true,
          navigatorPosition: 'BOTTOM_RIGHT',
          navigatorSizeRatio: 0.16,
          navigatorAutoFade: false,
          navigatorBackground: '#1f1b17',
          navigatorBorderColor: 'rgba(245,241,232,0.18)',
          navigatorDisplayRegionColor: '#d9b48f',
          animationTime: 0.9,
          springStiffness: 8,
          blendTime: 0.15,
          zoomPerScroll: 1.35,
          zoomPerClick: 2,
          visibilityRatio: 0.6,
          constrainDuringPan: true,
          minZoomImageRatio: 0.7,
          maxZoomPixelRatio: 2.5,
          preserveImageSizeOnResize: true,
          imageLoaderLimit: 8,
          timeout: 60_000,
          gestureSettingsMouse: { clickToZoom: false, dblClickToZoom: true, scrollToZoom: true, flickEnabled: true },
          gestureSettingsTouch: { pinchRotate: false, dblClickToZoom: true, flickEnabled: true },
        })
        viewerRef.current = viewer
        const v = viewer

        const update = () => {
          const item = v.world.getItemAt(0)
          if (!item) return
          const zoom = item.viewportToImageZoom(v.viewport.getZoom(true)) // screen px per image px
          if (zoomRef.current) zoomRef.current.textContent = `${Math.max(1, Math.round(zoom * 100))}%`
          const size = item.getContentSize()
          const widthM = physicalWidthFor(art, size.x, size.y)
          const bar = barRef.current
          if (!bar) return
          if (!widthM) {
            bar.hidden = true
            return
          }
          const pxPerCm = (zoom * size.x) / (widthM * 100)
          const target = Math.min(170, Math.max(60, window.innerWidth * 0.12))
          let cm = NICE_CM[0]
          for (const c of NICE_CM) if (c * pxPerCm <= target) cm = c
          bar.hidden = false
          bar.style.width = `${Math.round(cm * pxPerCm)}px`
          if (barLabelRef.current) barLabelRef.current.textContent = fmtLen(cm)
        }

        v.addHandler('open', () => {
          if (cancelled) return
          setStatus('ready')
          const item = v.world.getItemAt(0)
          const size = item?.getContentSize()
          if (size) {
            setScaleNote(art.physicalWidth ? null : physicalWidthFor(art, size.x, size.y) ? 'Scale as hung in the gallery (placeholder)' : null)
          }
          update()
        })
        v.addHandler('open-failed', () => {
          if (cancelled) return
          // A broken/missing pyramid falls back to the plain image once.
          if (primary.kind === 'dzi' && fallbackUrl && !usingFallbackRef.current) {
            usingFallbackRef.current = true
            setUsingFallback(true)
            v.open(tileSourceFor({ kind: 'image', url: fallbackUrl }) as unknown as OpenSeadragon.TileSourceSpecifier) // (types lag: open() takes URLs too)
          } else setStatus('error')
        })
        v.addHandler('animation', update)
        v.addHandler('resize', update)
        v.addHandler('canvas-press', () => setHint(false))
        v.addHandler('canvas-scroll', () => setHint(false))
      })
      .catch(() => !cancelled && setStatus('error'))

    return () => {
      cancelled = true
      viewer?.destroy()
      viewerRef.current = null
    }
  }, [art])

  useEffect(() => {
    const t = window.setTimeout(() => setHint(false), 6000)
    return () => window.clearTimeout(t)
  }, [])

  // fullscreen state
  useEffect(() => {
    const on = () => setFullscreen(document.fullscreenElement === rootRef.current)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])

  const zoomBy = useCallback((f: number) => {
    const v = viewerRef.current
    if (!v) return
    v.viewport.zoomBy(f)
    v.viewport.applyConstraints()
    setHint(false)
  }, [])
  const reset = useCallback(() => viewerRef.current?.viewport.goHome(), [])
  const toggleFullscreen = useCallback(() => {
    const el = rootRef.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    else void el.requestFullscreen?.().catch(() => undefined)
  }, [])
  const pan = useCallback((dx: number, dy: number) => {
    const v = viewerRef.current
    const OSD = osdRef.current
    if (!v || !OSD) return
    const b = v.viewport.getBounds()
    v.viewport.panBy(new OSD.Point(b.width * dx, b.height * dy))
    v.viewport.applyConstraints()
  }, [])

  // keyboard: the viewer owns it (capture phase keeps museum shortcuts + walking off)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab' || e.ctrlKey || e.metaKey || e.altKey) return
      e.stopPropagation()
      let handled = true
      switch (e.key) {
        case 'Escape':
          close()
          break
        case '+':
        case '=':
          zoomBy(1.5)
          break
        case '-':
        case '_':
          zoomBy(1 / 1.5)
          break
        case '0':
        case 'Home':
          reset()
          break
        case 'f':
        case 'F':
          toggleFullscreen()
          break
        case 'ArrowLeft':
        case 'a':
        case 'A':
          pan(-0.15, 0)
          break
        case 'ArrowRight':
        case 'd':
        case 'D':
          pan(0.15, 0)
          break
        case 'ArrowUp':
        case 'w':
        case 'W':
          pan(0, -0.15)
          break
        case 'ArrowDown':
        case 's':
        case 'S':
          pan(0, 0.15)
          break
        default:
          handled = false
      }
      // let Enter / Space activate focused buttons
      if (handled) e.preventDefault()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [close, zoomBy, reset, toggleFullscreen, pan])

  const facts = [art.technique, art.material, art.region].filter((x): x is string => !!x && !!x.trim())
  const canFullscreen = typeof document !== 'undefined' && document.fullscreenEnabled

  return (
    <div
      ref={rootRef}
      className={`dz-root${closing ? ' is-closing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Examine closely: ${art.title}`}
    >
      <div ref={hostRef} className="dz-stage" />

      <header className="dz-head">
        <div className="dz-head__text">
          <div className="dz-kicker">Examine closely</div>
          <h2 className="dz-title">{art.title}</h2>
          {facts.length > 0 && <div className="dz-facts">{facts.join(' · ')}</div>}
        </div>
        {art.placeholder && (
          <span className="dz-badge" title="Generated stand-in until the workshop's photograph is supplied">
            Placeholder image
          </span>
        )}
        <button ref={closeRef} type="button" className="dz-icon-btn dz-close" aria-label="Close (Esc)" title="Close (Esc)" onClick={close}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      {status === 'loading' && (
        <div className="dz-status" role="status">
          <span className="dz-spinner" aria-hidden="true" />
          Preparing the high-resolution view…
        </div>
      )}
      {status === 'error' && (
        <div className="dz-status dz-status--error" role="alert">
          The high-resolution image could not be loaded.
          <button type="button" className="dz-text-btn" onClick={close}>
            Return to the gallery
          </button>
        </div>
      )}

      <div className={`dz-hint${hint && status === 'ready' ? ' is-on' : ''}`} aria-hidden="true">
        Scroll or pinch to zoom · drag to move · double-click to look closer
      </div>

      <div className="dz-scale" aria-hidden={scaleNote === null && !art.physicalWidth}>
        <div ref={barRef} className="dz-scale__bar" hidden>
          <span ref={barLabelRef} className="dz-scale__label" />
        </div>
        {scaleNote && <div className="dz-scale__note">{scaleNote}</div>}
      </div>

      <div className="dz-toolbar" role="toolbar" aria-label="Zoom controls">
        <button type="button" className="dz-icon-btn" onClick={() => zoomBy(1 / 1.6)} aria-label="Zoom out (−)" title="Zoom out (−)">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h14" />
          </svg>
        </button>
        <span ref={zoomRef} className="dz-zoom" aria-live="off" title="Magnification relative to the image's own pixels">
          —
        </span>
        <button type="button" className="dz-icon-btn" onClick={() => zoomBy(1.6)} aria-label="Zoom in (+)" title="Zoom in (+)">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h14M12 5v14" />
          </svg>
        </button>
        <span className="dz-sep" aria-hidden="true" />
        <button type="button" className="dz-icon-btn" onClick={reset} aria-label="Reset view (0)" title="Reset view (0)">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
            <path d="M4.5 4.5v3.8h3.8" />
          </svg>
        </button>
        {canFullscreen && (
          <button
            type="button"
            className="dz-icon-btn"
            onClick={toggleFullscreen}
            aria-label={fullscreen ? 'Exit full screen (F)' : 'Full screen (F)'}
            title={fullscreen ? 'Exit full screen (F)' : 'Full screen (F)'}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {fullscreen ? <path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5" /> : <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />}
            </svg>
          </button>
        )}
      </div>

      {usingFallback && status === 'ready' && <div className="dz-fallback">Deep-zoom tiles unavailable — showing the standard image.</div>}
    </div>
  )
}

/** Real width (m) for the scale bar: `physicalWidth`, else (placeholders only) the size as hung. */
function physicalWidthFor(art: ArtworkConfig, pxW: number, pxH: number): number | null {
  if (art.physicalWidth && art.physicalWidth > 0) return art.physicalWidth
  if (!art.placeholder) return null
  const layout = computeArtworkLayout(pxW, pxH, resolveFrame(art.frame), { maxWidth: art.maxWidth, maxHeight: art.maxHeight })
  return layout.image.w > 0 ? layout.image.w : null
}
