/**
 * Photo mode: hides the whole overlay for a clean frame; Enter (or the shutter) saves a PNG of
 * the 3D canvas at its current resolution with a small caption strip, Esc exits.
 */
import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { useMuseum } from '../state/store'
import { tour, useTour } from '../tour/engine'
import { IconCamera, IconClose } from './icons'
import { isCoarsePointer } from './HelpOverlay'

export const CAPTION = 'Hand Block Printing — Virtual Exhibition'

export const usePhoto = create<{ on: boolean; flash: number }>(() => ({ on: false, flash: 0 }))

export function enterPhotoMode() {
  const m = useMuseum.getState()
  if (m.phase !== 'entered' || m.inspecting || usePhoto.getState().on) return
  m.select(null)
  m.setHelpOpen(false)
  m.setDrawer(null)
  // A tour walking the camera about is no good for framing a shot.
  if (useTour.getState().active) tour.pause()
  usePhoto.setState({ on: true })
}

export function exitPhotoMode() {
  if (usePhoto.getState().on) usePhoto.setState({ on: false })
}

export const togglePhotoMode = () => (usePhoto.getState().on ? exitPhotoMode() : enterPhotoMode())

/* ------------------------------------------------------------------ */
/* Capture                                                             */
/* ------------------------------------------------------------------ */

/** True when the sampled pixels are all transparent/identical (cleared drawing buffer). */
function looksBlank(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const n = 8
  let first = -1
  let varied = false
  let opaque = false
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const d = ctx.getImageData(Math.floor(((i + 0.5) / n) * w), Math.floor(((j + 0.5) / n) * h), 1, 1).data
      const v = (d[0] << 16) | (d[1] << 8) | d[2]
      if (d[3] > 0) opaque = true
      if (first === -1) first = v
      else if (v !== first) varied = true
    }
  }
  return !opaque || !varied
}

/**
 * Copy the WebGL canvas right after a rendered frame. The renderer does not preserve its
 * drawing buffer, so the copy has to happen inside the frame callback that follows R3F's
 * render (rAF callbacks run in registration order; R3F queued its own first).
 */
function grabFrame(tries = 4): Promise<HTMLCanvasElement | null> {
  const gl = window.__museum?.gl
  if (!gl) return Promise.resolve(null)
  return new Promise((resolve) => {
    const attempt = (left: number) =>
      requestAnimationFrame(() => {
        const src = gl.domElement
        const out = document.createElement('canvas')
        out.width = src.width
        out.height = src.height
        const ctx = out.getContext('2d')
        if (!ctx || !out.width || !out.height) return resolve(null)
        ctx.drawImage(src, 0, 0)
        if (!looksBlank(ctx, out.width, out.height)) return resolve(out)
        if (left > 0) return attempt(left - 1)
        resolve(null)
      })
    attempt(tries)
  })
}

function drawCaption(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!
  const s = Math.max(0.5, Math.min(canvas.width, canvas.height * 1.6) / 1600)
  const pad = 26 * s
  const font = `500 ${Math.round(24 * s)}px 'Cormorant Garamond', Cormorant, Garamond, 'Times New Roman', serif`
  ctx.font = font
  const textW = ctx.measureText(CAPTION).width
  const ruleW = 22 * s
  const gap = 12 * s
  const boxH = 46 * s
  const boxW = pad * 0.8 + ruleW + gap + textW + pad * 0.8
  const x = pad
  const y = canvas.height - pad - boxH
  ctx.save()
  ctx.fillStyle = 'rgba(245, 241, 232, 0.8)'
  ctx.shadowColor = 'rgba(43, 38, 33, 0.18)'
  ctx.shadowBlur = 18 * s
  ctx.shadowOffsetY = 4 * s
  ctx.beginPath()
  ctx.roundRect(x, y, boxW, boxH, 6 * s)
  ctx.fill()
  ctx.restore()
  // accent rule, then the caption
  ctx.fillStyle = '#8a5a3b'
  ctx.fillRect(x + pad * 0.8, y + boxH / 2 - 0.75 * s, ruleW, Math.max(1, 1.5 * s))
  ctx.fillStyle = '#2b2621'
  ctx.textBaseline = 'middle'
  ctx.font = font
  ctx.fillText(CAPTION, x + pad * 0.8 + ruleW + gap, y + boxH / 2 + 1 * s)
}

const stamp = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

let capturing = false

/** Save a PNG of the current view. Resolves false when nothing could be captured. */
export async function capturePhoto(): Promise<boolean> {
  if (capturing) return false
  capturing = true
  try {
    try {
      await document.fonts?.load(`500 24px 'Cormorant Garamond'`)
    } catch {
      /* fall back to the serif stack */
    }
    const frame = await grabFrame()
    if (!frame) return false
    drawCaption(frame)
    const blob = await new Promise<Blob | null>((r) => frame.toBlob(r, 'image/png'))
    if (!blob) return false
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `hand-block-printing-${stamp()}.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 4000)
    usePhoto.setState((s) => ({ flash: s.flash + 1 }))
    return true
  } finally {
    capturing = false
  }
}

// Automation / console handle.
if (typeof window !== 'undefined') {
  ;(window as unknown as { __photo?: unknown }).__photo = { usePhoto, enterPhotoMode, exitPhotoMode, capturePhoto, grabFrame }
}

/* ------------------------------------------------------------------ */
/* Overlay                                                             */
/* ------------------------------------------------------------------ */

const HINT_MS = 3200
const IDLE_MS = 2600

export function PhotoMode() {
  const on = usePhoto((s) => s.on)
  const flash = usePhoto((s) => s.flash)
  const entered = useMuseum((s) => s.phase === 'entered')
  const inspecting = useMuseum((s) => !!s.inspecting)
  const [hint, setHint] = useState(false)
  const [awake, setAwake] = useState(true)
  const idle = useRef(0)
  const coarse = isCoarsePointer()

  // Leaving the museum view or opening the 3D viewer ends photo mode.
  useEffect(() => {
    if (on && (!entered || inspecting)) exitPhotoMode()
  }, [on, entered, inspecting])

  useEffect(() => {
    if (!on) return
    setHint(true)
    setAwake(true)
    const t = window.setTimeout(() => setHint(false), HINT_MS)
    // Controls rest out of sight until the pointer moves.
    const wake = () => {
      setAwake(true)
      window.clearTimeout(idle.current)
      idle.current = window.setTimeout(() => setAwake(false), IDLE_MS)
    }
    wake()
    window.addEventListener('pointermove', wake)
    window.addEventListener('pointerdown', wake)
    return () => {
      window.clearTimeout(t)
      window.clearTimeout(idle.current)
      window.removeEventListener('pointermove', wake)
      window.removeEventListener('pointerdown', wake)
    }
  }, [on])

  if (!on) return null

  return (
    <div className="ui-photo">
      <div className={`ui-photo__hint ui-panel${hint ? ' is-visible' : ''}`} role="status">
        <IconCamera />
        {coarse ? (
          <span>
            Photo mode · <strong>Capture</strong> to save · <strong>✕</strong> to exit
          </span>
        ) : (
          <span>
            Photo mode · <kbd className="ui-kbd">Esc</kbd> to exit · <kbd className="ui-kbd">Enter</kbd> to capture
          </span>
        )}
      </div>
      <div className={`ui-photo__bar ui-panel ui-interactive${awake || coarse ? ' is-awake' : ''}`}>
        <button type="button" className="ui-photo__shutter" aria-label="Capture photo (Enter)" onClick={() => void capturePhoto()}>
          <span aria-hidden="true" />
          Capture
        </button>
        <button type="button" className="ui-icon-btn" aria-label="Exit photo mode (Esc)" onClick={exitPhotoMode}>
          <IconClose />
        </button>
      </div>
      {flash > 0 && <div key={flash} className="ui-photo__flash" aria-hidden="true" />}
    </div>
  )
}
