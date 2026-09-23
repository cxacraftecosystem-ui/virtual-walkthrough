/**
 * "Share" for the info panel: a small icon button opening a popover with the item's deep
 * link (/gallery#kind=id), Copy (Clipboard API with a textarea fallback), a QR code and a
 * link to the printable QR label page (/qr/<kind>/<id>) for physical exhibition labels.
 */
import { useEffect, useRef, useState } from 'react'
import type { Selection } from '../state/store'
import { copyText, deepLinkUrl, qrLabelPath } from './deepLink'
import { QRCode } from './QRCode'
import '../amenities/amenities.css'

function IconShare() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="18" cy="5.5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="18.5" r="2.5" />
      <path d="M8.2 10.8l7.6-4.1M8.2 13.2l7.6 4.1" />
    </svg>
  )
}

export function ShareButton({ selection, title, tabIndex }: { selection: Selection | null; title?: string; tabIndex?: number }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const key = selection ? `${selection.kind}:${selection.id}` : ''
  const [lastKey, setLastKey] = useState(key)
  if (key !== lastKey) {
    // a different item: close the popover
    setLastKey(key)
    setOpen(false)
    setCopied(null)
  }
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])
  if (!selection) return null
  const url = deepLinkUrl(selection.kind, selection.id)
  const share = async () => {
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> }
    if (nav.share && matchMedia('(pointer: coarse)').matches) {
      try {
        await nav.share({ title: title ?? 'Hand Block Printing', url })
        return
      } catch {
        /* cancelled — fall back to the popover */
      }
    }
    setOpen((v) => !v)
  }
  return (
    <div className="ui-share" ref={rootRef}>
      <button type="button" className="ui-icon-btn ui-share__btn" aria-label="Share this item" data-tip="Share" aria-expanded={open} tabIndex={tabIndex} onClick={() => void share()}>
        <IconShare />
      </button>
      {open && (
        <div className="ui-share__pop ui-panel" role="dialog" aria-label="Share this item">
          <div className="ui-kicker">Share</div>
          <div className="ui-share__row">
            <input className="ui-share__url" readOnly value={url} aria-label="Link to this item" onFocus={(e) => e.currentTarget.select()} />
            <button
              type="button"
              className="ui-btn ui-share__copy"
              onClick={async () => {
                const ok = await copyText(url)
                setCopied(ok ? 'ok' : 'fail')
                window.setTimeout(() => setCopied(null), 2400)
              }}
            >
              {copied === 'ok' ? 'Copied' : 'Copy'}
            </button>
          </div>
          <span className="ui-share__status" aria-live="polite">
            {copied === 'fail' ? 'Copy failed — select the link and copy it manually.' : copied === 'ok' ? 'Link copied to the clipboard.' : ''}
          </span>
          <div className="ui-share__qr">
            <QRCode value={url} size={150} title={`QR code for ${title ?? 'this item'}`} />
            <p>
              Scan to open this {selection.kind === 'object' ? 'installation' : selection.kind} in the virtual museum.
              <br />
              <a href={qrLabelPath(selection.kind, selection.id)} target="_blank" rel="noopener">
                Printable QR label →
              </a>
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
