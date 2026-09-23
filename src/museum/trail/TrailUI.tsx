/**
 * "Find the motifs" discovery trail — UI.
 *
 *   <TrailButton/>      HUD: progress x/8 + popover (hints by room, stop / restart); only while active
 *   <TrailStartCard/>   help overlay: explains the trail and starts it
 *   <TrailEntryLink/>   entry screen: "Families & schools: find the motifs" (starts it and enters)
 *   <TrailLayer/>       toast when a medallion is found + the completion card with a
 *                       downloadable certificate PNG (drawn on a canvas, nothing uploaded)
 */
import { useEffect, useRef, useState } from 'react'
import { TRAIL } from '../config/amenities'
import { drawMotif } from '../exhibits/motifs'
import { useMuseum } from '../state/store'
import { TRAIL_TOTAL, useTrail } from './trail'
import '../amenities/amenities.css'

function IconMotif() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5c2 2.4 2 4.4 0 5.5-2-1.1-2-3.1 0-5.5zM12 20.5c2-2.4 2-4.4 0-5.5-2 1.1-2 3.1 0 5.5zM3.5 12c2.4-2 4.4-2 5.5 0-1.1 2-3.1 2-5.5 0zM20.5 12c-2.4-2-4.4-2-5.5 0 1.1 2 3.1 2 5.5 0z" />
    </svg>
  )
}

/* ------------------------------------------------------------------ */

export function TrailButton() {
  const active = useTrail((s) => s.active)
  const found = useTrail((s) => s.found)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [open])
  if (!active) return null
  const rooms = [...new Set(TRAIL.map((m) => m.place))]
  return (
    <div className="ui-quality ui-trail" ref={rootRef}>
      <button
        type="button"
        className="ui-trail__btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Find the motifs trail: ${found.length} of ${TRAIL_TOTAL} found`}
        data-tip={open ? undefined : 'Find the motifs'}
        onClick={() => setOpen((v) => !v)}
      >
        <IconMotif />
        <span className="ui-trail__count">
          {found.length}/{TRAIL_TOTAL}
        </span>
      </button>
      {open && (
        <div className="ui-quality__menu ui-panel ui-trail__menu" role="dialog" aria-label="Find the motifs">
          <div className="ui-kicker ui-quality__menu-title">Find the motifs</div>
          <p className="ui-trail__lede">Eight small brass medallions are hidden around the museum, low on walls and columns. Click one when you spot it.</p>
          <ul className="ui-trail__rooms">
            {rooms.map((room) => {
              const ms = TRAIL.filter((m) => m.place === room)
              const n = ms.filter((m) => found.includes(m.id)).length
              return (
                <li key={room} className={n === ms.length ? 'is-done' : undefined}>
                  <span>{room}</span>
                  <span>{n === ms.length ? '✓' : `${n}/${ms.length}`}</span>
                </li>
              )
            })}
          </ul>
          <div className="ui-trail__actions">
            {found.length === TRAIL_TOTAL && (
              <button type="button" className="ui-btn" onClick={() => useTrail.getState().setCelebrate(true)}>
                Certificate
              </button>
            )}
            <button type="button" className="ui-btn ui-btn--ghost" onClick={() => useTrail.getState().reset()}>
              Start again
            </button>
            <button
              type="button"
              className="ui-btn ui-btn--ghost"
              onClick={() => {
                useTrail.getState().stop()
                setOpen(false)
              }}
            >
              Hide trail
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

export function TrailStartCard() {
  const active = useTrail((s) => s.active)
  const found = useTrail((s) => s.found.length)
  return (
    <section className="ui-trail-card" aria-labelledby="ui-trail-card-title">
      <h3 className="ui-kicker" id="ui-trail-card-title">
        For families & schools
      </h3>
      <p>
        <strong>Find the motifs</strong> — eight small brass medallions, each stamped with a printing motif, are hidden around the museum. Spot them all to earn a certificate.
      </p>
      <button
        type="button"
        className="ui-btn ui-btn--ghost"
        aria-pressed={active}
        onClick={() => {
          const s = useTrail.getState()
          if (s.active) s.stop()
          else {
            s.start()
            useMuseum.getState().setHelpOpen(false)
          }
        }}
      >
        {active ? `Hide the trail (${found}/${TRAIL_TOTAL} found)` : found ? `Resume the trail (${found}/${TRAIL_TOTAL})` : 'Start the trail'}
      </button>
    </section>
  )
}

export function TrailEntryLink({ onStart, disabled }: { onStart: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      className="ui-entry__trail"
      disabled={disabled}
      onClick={() => {
        useTrail.getState().start()
        onStart()
      }}
    >
      Families & schools: find the motifs →
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* Certificate                                                         */
/* ------------------------------------------------------------------ */

const SERIF = '"Cormorant Garamond", Georgia, serif'
const SANS = 'Inter, "Helvetica Neue", Arial, sans-serif'

export async function drawCertificate(name: string, date: Date): Promise<HTMLCanvasElement> {
  try {
    await Promise.all([document.fonts.load(`400 64px "Cormorant Garamond"`), document.fonts.load(`500 32px Inter`)])
  } catch {
    /* fonts optional */
  }
  const W = 1754
  const H = 1240 // A4 landscape at 150 dpi
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const g = cv.getContext('2d')!
  g.fillStyle = '#f6f1e6'
  g.fillRect(0, 0, W, H)
  // double rule border with motif corners
  g.strokeStyle = '#8a4a33'
  g.lineWidth = 6
  g.strokeRect(60, 60, W - 120, H - 120)
  g.lineWidth = 1.5
  g.strokeRect(84, 84, W - 168, H - 168)
  for (const [x, y] of [
    [84, 84],
    [W - 84, 84],
    [84, H - 84],
    [W - 84, H - 84],
  ])
    drawMotif(g, 'rosette', x, y, 70, '#8a4a33')
  g.textAlign = 'center'
  g.fillStyle = '#8a4a33'
  g.font = `500 26px ${SANS}`
  const c = g as CanvasRenderingContext2D & { letterSpacing?: string }
  if ('letterSpacing' in c) c.letterSpacing = '8px'
  g.fillText('HAND BLOCK PRINTING — VIRTUAL MUSEUM', W / 2, 250)
  if ('letterSpacing' in c) c.letterSpacing = '0px'
  g.fillStyle = '#2e2a26'
  g.font = `400 116px ${SERIF}`
  g.fillText('Find the Motifs', W / 2, 390)
  g.font = `italic 400 44px ${SERIF}`
  g.fillStyle = 'rgba(46,42,38,0.8)'
  g.fillText('This certifies that', W / 2, 500)
  g.font = `500 84px ${SERIF}`
  g.fillStyle = '#2e2a26'
  g.fillText(name.trim() || 'A keen-eyed explorer', W / 2, 610)
  g.fillStyle = '#8a4a33'
  g.fillRect(W / 2 - 260, 640, 520, 2)
  g.font = `400 34px ${SANS}`
  g.fillStyle = 'rgba(46,42,38,0.85)'
  g.fillText(`found all ${TRAIL_TOTAL} hidden motifs on the museum trail.`, W / 2, 720)
  // the eight motifs, stamped in a row
  const n = TRAIL.length
  const pitch = 150
  const x0 = W / 2 - ((n - 1) * pitch) / 2
  TRAIL.forEach((m, i) => drawMotif(g, m.motif, x0 + i * pitch, 850, 96, m.ink, { alpha: 0.92 }))
  let dateText = date.toDateString()
  try {
    dateText = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' }).format(date)
  } catch {
    /* default */
  }
  g.font = `400 28px ${SANS}`
  g.fillStyle = 'rgba(46,42,38,0.7)'
  g.fillText(dateText, W / 2, 1010)
  g.font = `400 22px ${SANS}`
  g.fillText('A keepsake from the virtual exhibition. The motifs shown are placeholder designs.', W / 2, 1080)
  return cv
}

function CompletionCard() {
  const celebrate = useTrail((s) => s.celebrate)
  const completedAt = useTrail((s) => s.completedAt)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!celebrate) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        useTrail.getState().setCelebrate(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    cardRef.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true })
    return () => window.removeEventListener('keydown', onKey, true)
  }, [celebrate])
  if (!celebrate) return null
  const download = async () => {
    setBusy(true)
    try {
      const cv = await drawCertificate(name, completedAt ? new Date(completedAt) : new Date())
      const blob = await new Promise<Blob | null>((r) => cv.toBlob(r, 'image/png'))
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'find-the-motifs-certificate.png'
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 4000)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="ui-trail-done" role="dialog" aria-modal="true" aria-labelledby="ui-trail-done-title" onPointerDown={(e) => e.target === e.currentTarget && useTrail.getState().setCelebrate(false)}>
      <div className="ui-trail-done__card ui-panel" ref={cardRef}>
        <div className="ui-trail-done__motifs" aria-hidden="true">
          {TRAIL.map((m) => (
            <MotifStamp key={m.id} motif={m.motif} ink={m.ink} />
          ))}
        </div>
        <div className="ui-kicker">Trail complete</div>
        <h2 id="ui-trail-done-title" className="ui-trail-done__title">
          You found all {TRAIL_TOTAL} motifs
        </h2>
        <p>Well spotted. Add a name if you like, and download a certificate to keep or print.</p>
        <label className="ui-trail-done__label">
          Name on the certificate (optional)
          <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="e.g. Class 5B" />
        </label>
        <div className="ui-trail-done__actions">
          <button type="button" className="ui-btn" disabled={busy} onClick={() => void download()}>
            Download certificate (PNG)
          </button>
          <button type="button" className="ui-btn ui-btn--ghost" onClick={() => useTrail.getState().setCelebrate(false)}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function MotifStamp({ motif, ink }: { motif: (typeof TRAIL)[number]['motif']; ink: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    const g = cv?.getContext('2d')
    if (!cv || !g) return
    g.clearRect(0, 0, cv.width, cv.height)
    drawMotif(g, motif, cv.width / 2, cv.height / 2, cv.width * 0.86, ink)
  }, [motif, ink])
  return <canvas ref={ref} width={64} height={64} />
}

function FoundToast() {
  const last = useTrail((s) => s.lastFound)
  const count = useTrail((s) => s.found.length)
  const m = last ? TRAIL.find((x) => x.id === last) : undefined
  return (
    <div className={`ui-trail-toast ui-panel${m ? ' is-visible' : ''}`} role="status" aria-live="polite">
      {m && (
        <>
          <MotifStamp motif={m.motif} ink={m.ink} />
          <span>
            <strong>Motif found</strong> — {count} of {TRAIL_TOTAL}
            {count < TRAIL_TOTAL ? ' · keep looking' : ''}
          </span>
        </>
      )}
    </div>
  )
}

export function TrailLayer() {
  const active = useTrail((s) => s.active)
  const entered = useMuseum((s) => s.phase === 'entered')
  if (!entered || !active) return null
  return (
    <>
      <FoundToast />
      <CompletionCard />
    </>
  )
}
