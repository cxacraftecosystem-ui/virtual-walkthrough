/**
 * <PrintStudio/> — the full-screen "Print it yourself" overlay.
 *
 * Opened by selecting the studio printing table (scene object kind 'print-studio'), or
 * `openPrintStudio()`. Choose a block, block face, dye and ground; stamp by click / tap
 * (hold longer for a firmer impression); repeat guides with snapping; border block; undo /
 * redo / clear; download PNG; "Hang it on the Visitors' Wall" (moderated; needs the backend —
 * in static mode the studio still works and downloads).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { SCENE_OBJECTS } from '../config/objects'
import { drawMotif } from '../exhibits/motifs'
import { pauseAllVideos } from '../media/VideoScreen'
import { useMuseum } from '../state/store'
import { visitor } from '../state/visitor'
import { IconClose } from '../ui/icons'
import { BLOCKS, BORDER_MOTIF, COLOURWAYS, DYES, getBlock, getDye, getGround, GROUNDS, type BlockId, type BlockLayer } from './palette'
import { cornerSize, DESIGN_H, DESIGN_W, drawGuides, placeBorder, pngAt, pngWithin, snapToGuide, type BorderSlot, type GuideMode } from './printEngine'
import { PRINT_MAX_BYTES, submitPrint } from './printsApi'
import { BLOCK_SIZES, CORNER_BLOCK, designCanvas, designSummary, useStudio, type BlockSize } from './studioStore'
import './printStudio.css'

export const openPrintStudio = () => useStudio.getState().setOpen(true)

/** Hold time (ms) for a full-pressure impression. */
const FULL_PRESS_MS = 900
const LAYERS: { id: BlockLayer; label: string; hint: string }[] = [
  { id: 'outline', label: 'Outline', hint: 'The fine line block' },
  { id: 'fill', label: 'Filler', hint: 'The block that fills the outline' },
  { id: 'all', label: 'Both', hint: 'Outline and filler in one impression' },
]
const GUIDES: { id: GuideMode; label: string }[] = [
  { id: 'none', label: 'Free' },
  { id: 'grid', label: 'Grid' },
  { id: 'half-drop', label: 'Half-drop' },
]
const SIZES: { id: BlockSize; label: string }[] = [
  { id: 'small', label: 'S' },
  { id: 'medium', label: 'M' },
  { id: 'large', label: 'L' },
]

const pressureOf = (ms: number) => {
  const t = Math.max(0, Math.min(1, ms / FULL_PRESS_MS))
  return 0.22 + 0.78 * (1 - (1 - t) * (1 - t))
}

/** Selecting a 'print-studio' object in the museum opens the studio instead of the info panel. */
function useOpenFromSelection() {
  useEffect(
    () =>
      useMuseum.subscribe((s, prev) => {
        const sel = s.selection
        if (!sel || sel === prev.selection || sel.kind !== 'object') return
        const obj = SCENE_OBJECTS.find((o) => o.id === sel.id)
        if (obj?.kind !== 'print-studio') return
        s.select(null)
        useStudio.getState().setOpen(true)
      }),
    [],
  )
}

/* ------------------------------------------------------------------ */
/* Block tile preview                                                  */
/* ------------------------------------------------------------------ */

function BlockPreview({ block, layer, color, ground }: { block: BlockId; layer: BlockLayer; color: string; ground: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const S = 56
    cv.width = cv.height = S * dpr
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = ground
    ctx.fillRect(0, 0, cv.width, cv.height)
    const motif = block === 'border' ? BORDER_MOTIF : block
    drawMotif(ctx, motif, cv.width / 2, cv.height / 2, cv.width * (block === 'border' ? 0.95 : 0.8), color, { layer, composite: 'multiply', alpha: 0.95 })
  }, [block, layer, color, ground])
  return <canvas ref={ref} className="ps-tile-canvas" aria-hidden="true" />
}

/* ------------------------------------------------------------------ */
/* Stage (cloth + interaction)                                         */
/* ------------------------------------------------------------------ */

interface Press {
  id: number
  x: number
  y: number
  t0: number
  cssX: number
  cssY: number
}

function Stage() {
  const wrap = useRef<HTMLDivElement>(null)
  const cloth = useRef<HTMLCanvasElement>(null)
  const over = useRef<HTMLCanvasElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0, dpr: 1 })
  const version = useStudio((s) => s.version)
  const guides = useStudio((s) => s.guides)
  const size = useStudio((s) => s.size)
  const block = useStudio((s) => s.block)
  const layer = useStudio((s) => s.layer)
  const dye = useStudio((s) => s.dye)
  const turns = useStudio((s) => s.turns)
  const snap = useStudio((s) => s.snap)
  const hover = useRef<{ x: number; y: number } | null>(null)
  const press = useRef<Press | null>(null)
  const raf = useRef(0)
  const [stamped, setStamped] = useState(0)

  // fit the 4:3 cloth into the stage
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const fit = () => {
      const r = el.getBoundingClientRect()
      const k = Math.min(r.width / DESIGN_W, r.height / DESIGN_H)
      setBox({ w: Math.floor(DESIGN_W * k), h: Math.floor(DESIGN_H * k), dpr: Math.min(2, window.devicePixelRatio || 1) })
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // cloth view
  useEffect(() => {
    const cv = cloth.current
    if (!cv || !box.w) return
    cv.width = Math.round(box.w * box.dpr)
    cv.height = Math.round(box.h * box.dpr)
  }, [box])
  useEffect(() => {
    const cv = cloth.current
    if (!cv || !box.w) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(designCanvas(), 0, 0, cv.width, cv.height)
  }, [version, box])

  const blockSize = BLOCK_SIZES[size] * (getBlock(block).aspect > 1 ? 1.35 : 1)
  const rot = (turns * Math.PI) / 2

  /** Where a stamp at design point (x, y) actually lands. */
  const placement = useCallback(
    (x: number, y: number): BorderSlot => {
      if (block === 'border') return placeBorder(x, y, blockSize, snap)
      const [sx, sy] = snap ? snapToGuide(x, y, blockSize, guides) : [x, y]
      return { x: sx, y: sy, rot }
    },
    [block, blockSize, snap, guides, rot],
  )

  // overlay: guides, ghost block, pressure ring
  const drawOverlay = useCallback(() => {
    const cv = over.current
    if (!cv || !box.w) return
    if (cv.width !== Math.round(box.w * box.dpr)) {
      cv.width = Math.round(box.w * box.dpr)
      cv.height = Math.round(box.h * box.dpr)
    }
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const k = cv.width / DESIGN_W
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, cv.width, cv.height)
    if (block !== 'border') drawGuides(ctx, blockSize, guides, k)
    const p = press.current ?? hover.current
    if (!p) return
    const at = placement(p.x, p.y)
    const color = getDye(dye).color
    const motif = at.corner ? CORNER_BLOCK : block === 'border' ? BORDER_MOTIF : block
    const size = at.corner ? cornerSize(blockSize) : blockSize
    const held = press.current ? performance.now() - press.current.t0 : 0
    const pr = press.current ? pressureOf(held) : 0
    ctx.save()
    // ghost of the block face (what will print)
    drawMotif(ctx, motif, at.x * k, at.y * k, size * k * (1 - pr * 0.015), color, { layer, rotation: -at.rot, alpha: press.current ? 0.2 + pr * 0.25 : 0.24 })
    // block outline
    ctx.translate(at.x * k, at.y * k)
    ctx.rotate(at.rot)
    const bw = size * k
    const bh = block === 'border' && !at.corner ? bw / getBlock('border').aspect : bw
    ctx.strokeStyle = 'rgba(43, 38, 33, 0.55)'
    ctx.lineWidth = 1.2 * box.dpr
    ctx.setLineDash([5 * box.dpr, 4 * box.dpr])
    ctx.strokeRect(-bw / 2, -bh / 2, bw, bh)
    ctx.restore()
    if (press.current) {
      // pressure ring (fills while held)
      const r = Math.max(14, Math.min(bw, bh) * 0.28) * 0.5 + 10 * box.dpr
      ctx.save()
      ctx.translate(at.x * k, at.y * k)
      ctx.lineWidth = 3 * box.dpr
      ctx.strokeStyle = 'rgba(245, 241, 232, 0.9)'
      ctx.beginPath()
      ctx.arc(0, 0, r, 0, Math.PI * 2)
      ctx.stroke()
      ctx.strokeStyle = '#8a5a3b'
      ctx.beginPath()
      ctx.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, held / FULL_PRESS_MS))
      ctx.stroke()
      ctx.restore()
    }
  }, [box, block, blockSize, guides, placement, dye, layer])

  useEffect(() => {
    drawOverlay()
  }, [drawOverlay, version])

  const toDesign = (e: ReactPointerEvent) => {
    const r = over.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * DESIGN_W, y: ((e.clientY - r.top) / r.height) * DESIGN_H }
  }

  const loop = useCallback(() => {
    drawOverlay()
    if (press.current) raf.current = requestAnimationFrame(loop)
  }, [drawOverlay])

  const onDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 || press.current) return
    const p = toDesign(e)
    press.current = { id: e.pointerId, ...p, t0: performance.now(), cssX: e.clientX, cssY: e.clientY }
    hover.current = p
    try {
      over.current?.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(loop)
  }
  const onMove = (e: ReactPointerEvent) => {
    const pr = press.current
    if (pr && pr.id === e.pointerId) {
      // moving the block while pressed would smear it: lift (cancel) instead
      if (Math.hypot(e.clientX - pr.cssX, e.clientY - pr.cssY) > 14) {
        press.current = null
        hover.current = toDesign(e)
        drawOverlay()
      }
      return
    }
    hover.current = toDesign(e)
    drawOverlay()
  }
  const onUp = (e: ReactPointerEvent) => {
    const pr = press.current
    if (!pr || pr.id !== e.pointerId) return
    press.current = null
    cancelAnimationFrame(raf.current)
    const at = placement(pr.x, pr.y)
    useStudio.getState().stamp(at.x, at.y, at.rot, pressureOf(performance.now() - pr.t0), at.corner)
    setStamped((n) => n + 1)
    if (e.pointerType !== 'mouse') hover.current = null
  }
  const onCancel = () => {
    press.current = null
    cancelAnimationFrame(raf.current)
    drawOverlay()
  }
  const onLeave = (e: ReactPointerEvent) => {
    if (press.current) return
    if (e.pointerType === 'mouse') {
      hover.current = null
      drawOverlay()
    }
  }
  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  return (
    <div className="ps-stage" ref={wrap}>
      <div className="ps-cloth" style={{ width: box.w, height: box.h }}>
        <canvas ref={cloth} className="ps-cloth-canvas" style={{ width: box.w, height: box.h }} />
        <canvas
          ref={over}
          className="ps-cloth-overlay"
          style={{ width: box.w, height: box.h }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onCancel}
          onPointerLeave={onLeave}
          aria-label="Cloth — click or tap to print; hold longer for a firmer impression"
          role="img"
        />
        {stamped === 0 && useStudio.getState().ops.length === 0 && (
          <div className="ps-cloth-hint" aria-hidden="true">
            Click or tap to print · hold longer to press harder
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Wall submission                                                     */
/* ------------------------------------------------------------------ */

type SendState = { kind: 'idle' } | { kind: 'form' } | { kind: 'sending' } | { kind: 'done' } | { kind: 'error'; message: string }

function WallDialog({ state, setState }: { state: SendState; setState: (s: SendState) => void }) {
  const user = useMuseum((s) => s.user)
  const [name, setName] = useState(user?.displayName ?? '')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (state.kind === 'form') input.current?.focus()
  }, [state.kind])
  if (state.kind === 'idle') return null
  const send = async () => {
    setState({ kind: 'sending' })
    try {
      const png = await pngWithin(designCanvas(), PRINT_MAX_BYTES)
      await submitPrint(png, name.trim(), designSummary())
      setState({ kind: 'done' })
    } catch (e) {
      setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }
  return (
    <div className="ps-dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && state.kind !== 'sending' && setState({ kind: 'idle' })}>
      <div className="ps-dialog" role="dialog" aria-modal="true" aria-labelledby="ps-dialog-title">
        {state.kind === 'done' ? (
          <>
            <h2 id="ps-dialog-title">Thank you</h2>
            <p>Your print has been sent to the Visitors’ Wall. It will appear in the workshop once a curator has reviewed it.</p>
            <div className="ps-dialog-actions">
              <button className="ps-btn primary" onClick={() => setState({ kind: 'idle' })}>
                Back to the studio
              </button>
            </div>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void send()
            }}
          >
            <h2 id="ps-dialog-title">Hang it on the Visitors’ Wall</h2>
            <p className="ps-muted">Your print joins other visitors’ cloths in the Craft Workshop Hall after review. Only the image and the name below are shown.</p>
            <label className="ps-field">
              <span>Name on the label (optional)</span>
              <input ref={input} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Anonymous visitor" autoComplete="nickname" />
            </label>
            {state.kind === 'error' && (
              <p className="ps-error" role="alert">
                {state.message}
              </p>
            )}
            <div className="ps-dialog-actions">
              <button type="button" className="ps-btn ghost" onClick={() => setState({ kind: 'idle' })} disabled={state.kind === 'sending'}>
                Cancel
              </button>
              <button type="submit" className="ps-btn primary" disabled={state.kind === 'sending'}>
                {state.kind === 'sending' ? 'Sending…' : 'Send to the wall'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Overlay                                                             */
/* ------------------------------------------------------------------ */

function Swatch({ color, label, active, onClick }: { color: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button className={`ps-swatch${active ? ' is-active' : ''}`} onClick={onClick} aria-pressed={active} title={label}>
      <span className="ps-swatch-chip" style={{ background: color }} />
      <span className="ps-swatch-label">{label}</span>
    </button>
  )
}

function StudioOverlay({ onClose }: { onClose: () => void }) {
  const s = useStudio()
  const online = useMuseum((m) => m.online)
  const [send, setSend] = useState<SendState>({ kind: 'idle' })
  const [closing, setClosing] = useState(false)
  const groundColor = getGround(s.ground).color
  const dyeColor = getDye(s.dye).color
  // the wall needs the backend; probe it ourselves too (the museum's health probe is short)
  const [wallUp, setWallUp] = useState<boolean | null>(online === true ? true : null)
  useEffect(() => {
    if (online === true) return setWallUp(true)
    if (new URLSearchParams(window.location.search).has('static')) return setWallUp(false)
    let alive = true
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 20000)
    fetch('/api/prints?limit=1', { signal: ctrl.signal, credentials: 'include' })
      .then((r) => alive && setWallUp(r.ok && (r.headers.get('content-type') ?? '').includes('json')))
      .catch(() => alive && setWallUp(false))
      .finally(() => clearTimeout(t))
    return () => {
      alive = false
      ctrl.abort()
    }
  }, [online])
  // optimistic while probing: a failed send reports its error in the dialog
  const canWall = wallUp !== false
  const empty = s.ops.length === 0

  const close = useCallback(() => {
    setClosing(true)
    setTimeout(onClose, 220)
  }, [onClose])

  const download = useCallback(async () => {
    const png = await pngAt(designCanvas(), DESIGN_W)
    const url = URL.createObjectURL(png)
    const a = document.createElement('a')
    a.href = url
    a.download = `my-block-print-${new Date().toISOString().slice(0, 10)}.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  }, [])

  // keyboard: the studio owns it while open (capture phase, before the museum's shortcuts)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      e.stopPropagation()
      if (typing && e.key !== 'Escape') return
      const st = useStudio.getState()
      const mod = e.ctrlKey || e.metaKey
      if (e.key === 'Escape') {
        if (send.kind !== 'idle') {
          if (send.kind !== 'sending') setSend({ kind: 'idle' })
        } else close()
      } else if (mod && (e.key === 'z' || e.key === 'Z')) {
        if (e.shiftKey) st.redoOp()
        else st.undo()
      } else if (mod && (e.key === 'y' || e.key === 'Y')) st.redoOp()
      else if (!mod && (e.key === 'r' || e.key === 'R')) st.set({ turns: (st.turns + 1) % 4 })
      else if (!mod && (e.key === 'g' || e.key === 'G')) st.set({ guides: GUIDES[(GUIDES.findIndex((g) => g.id === st.guides) + 1) % GUIDES.length].id })
      else return
      e.preventDefault()
    }
    const onKeyUp = (e: KeyboardEvent) => e.stopPropagation()
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onKeyUp, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onKeyUp, true)
    }
  }, [close, send.kind])

  const loadPct = Math.round(s.load * 100)
  const isBorder = s.block === 'border'
  const tiles = useMemo(() => BLOCKS, [])

  return (
    <div className={`ps-root${closing ? ' is-closing' : ''}`} role="dialog" aria-modal="true" aria-label="Print it yourself — block printing studio">
      <header className="ps-head">
        <div className="ps-title">
          <span className="ps-kicker">Craft Workshop Hall · Studio</span>
          <h1>Print it yourself</h1>
        </div>
        <p className="ps-lede">
          Choose a block and a dye, then press it onto the cloth. Hold longer for a firmer impression — every print comes out a little different, as it
          does by hand.
        </p>
        <button className="ps-close" onClick={close} aria-label="Close the studio">
          <IconClose />
        </button>
      </header>

      <div className="ps-body">
        <main className="ps-main">
          <Stage />
          <div className="ps-toolbar" role="toolbar" aria-label="Print actions">
            <button className="ps-btn" onClick={s.undo} disabled={empty && !s.cleared} title="Undo (Ctrl+Z)">
              Undo
            </button>
            <button className="ps-btn" onClick={s.redoOp} disabled={!s.redo.length} title="Redo (Ctrl+Shift+Z)">
              Redo
            </button>
            <button className="ps-btn ghost" onClick={s.clear} disabled={empty}>
              Clear cloth
            </button>
            <span className="ps-ink" title="Ink on the block — it is re-inked automatically when it runs dry">
              <span className="ps-ink-label">Ink</span>
              <span className="ps-ink-bar">
                <span style={{ width: `${loadPct}%`, background: dyeColor }} />
              </span>
              <button className="ps-link" onClick={s.reInk}>
                Re-ink
              </button>
            </span>
            <span className="ps-spacer" />
            <button className="ps-btn" onClick={() => void download()} disabled={empty}>
              Download PNG
            </button>
            <button
              className="ps-btn primary"
              onClick={() => setSend({ kind: 'form' })}
              disabled={empty || !canWall}
              title={canWall ? undefined : 'The Visitors’ Wall needs the museum server — you can still download your print'}
            >
              Hang it on the Visitors’ Wall
            </button>
          </div>
          {wallUp === false && <p className="ps-offline">Offline mode: the Visitors’ Wall is unavailable, but you can download your print.</p>}
        </main>

        <aside className="ps-panel" aria-label="Studio tools">
          <section>
            <h2>Block</h2>
            <div className="ps-tiles">
              {tiles.map((b) => (
                <button key={b.id} className={`ps-tile${s.block === b.id ? ' is-active' : ''}`} onClick={() => s.set({ block: b.id })} aria-pressed={s.block === b.id}>
                  <BlockPreview block={b.id} layer={s.layer} color={dyeColor} ground={groundColor} />
                  <span>{b.name}</span>
                </button>
              ))}
            </div>
            <div className="ps-seg" role="group" aria-label="Block face">
              {LAYERS.map((l) => (
                <button key={l.id} className={s.layer === l.id ? 'is-active' : ''} onClick={() => s.set({ layer: l.id })} title={l.hint} aria-pressed={s.layer === l.id}>
                  {l.label}
                </button>
              ))}
            </div>
            <div className="ps-row">
              <div className="ps-seg small" role="group" aria-label="Block size">
                {SIZES.map((z) => (
                  <button key={z.id} className={s.size === z.id ? 'is-active' : ''} onClick={() => s.set({ size: z.id })} aria-pressed={s.size === z.id}>
                    {z.label}
                  </button>
                ))}
              </div>
              {!isBorder && (
                <button className="ps-btn small" onClick={() => s.set({ turns: (s.turns + 1) % 4 })} title="Turn the block (R)">
                  Turn {s.turns * 90}°
                </button>
              )}
            </div>
            {isBorder && (
              <p className="ps-note">
                The border block snaps to the nearest edge of the cloth.{' '}
                <button className="ps-link" onClick={s.borderAllRound}>
                  Print a border all round
                </button>
              </p>
            )}
          </section>

          <section>
            <h2>Dye</h2>
            <div className="ps-swatches">
              {DYES.map((d) => (
                <Swatch key={d.id} color={d.color} label={d.name} active={s.dye === d.id} onClick={() => s.setDye(d.id)} />
              ))}
            </div>
            <p className="ps-note">Colour names only.</p>
          </section>

          <section>
            <h2>Ground cloth</h2>
            <div className="ps-swatches">
              {GROUNDS.map((g) => (
                <Swatch key={g.id} color={g.color} label={g.name} active={s.ground === g.id} onClick={() => s.setGround(g.id)} />
              ))}
            </div>
          </section>

          <section>
            <h2>Colourways</h2>
            <div className="ps-chips">
              {COLOURWAYS.map((c) => (
                <button key={c.id} className="ps-chip" onClick={() => s.applyColourway(c.id)} title={`Ground: ${getGround(c.ground).name} · outline ${getDye(c.outline).name}, filler ${getDye(c.fill).name}`}>
                  <span className="ps-chip-dots">
                    <i style={{ background: getGround(c.ground).color }} />
                    <i style={{ background: getDye(c.outline).color }} />
                    <i style={{ background: getDye(c.fill).color }} />
                  </span>
                  {c.name}
                </button>
              ))}
            </div>
            <p className="ps-note">A colourway sets the ground and the outline dye. Print the outlines, then switch to the filler face and its dye.</p>
          </section>

          <section>
            <h2>Repeat guide</h2>
            <div className="ps-seg" role="group" aria-label="Repeat guide">
              {GUIDES.map((g) => (
                <button key={g.id} className={s.guides === g.id ? 'is-active' : ''} onClick={() => s.set({ guides: g.id })} aria-pressed={s.guides === g.id}>
                  {g.label}
                </button>
              ))}
            </div>
            <label className="ps-check">
              <input type="checkbox" checked={s.snap} onChange={(e) => s.set({ snap: e.target.checked })} />
              Snap impressions to the guide
            </label>
          </section>
          <p className="ps-foot">Blocks are placeholder designs made for this museum, not reproductions of documented traditional blocks.</p>
        </aside>
      </div>
      <WallDialog state={send} setState={setSend} />
    </div>
  )
}

/** Mount once in the UI overlay. */
export function PrintStudio() {
  useOpenFromSelection()
  const open = useStudio((s) => s.open)
  const setOpen = useStudio((s) => s.setOpen)

  useEffect(() => {
    if (!open) return
    visitor.frozen = true
    visitor.walkTarget = null
    const m = useMuseum.getState()
    if (m.mouseLook) m.setMouseLook(false)
    try {
      if (document.pointerLockElement) document.exitPointerLock()
    } catch {
      /* ignore */
    }
    pauseAllVideos()
    return () => {
      visitor.frozen = false
    }
  }, [open])

  if (!open) return null
  return <StudioOverlay onClose={() => setOpen(false)} />
}
