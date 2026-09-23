/** Inline SVG QR code (in-house encoder: src/museum/share/qr.ts). */
import { useMemo } from 'react'
import { encodeQR, qrSvgPath } from './qr'

export function QRCode({ value, size = 168, title, dark = '#2b2621', light = '#fbf8f2' }: { value: string; size?: number; title?: string; dark?: string; light?: string }) {
  const qr = useMemo(() => {
    try {
      return encodeQR(value)
    } catch {
      return null
    }
  }, [value])
  if (!qr) return null
  const n = qr.size + 8
  return (
    <svg className="ui-qr" width={size} height={size} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" role="img" aria-label={title ?? 'QR code'}>
      {title && <title>{title}</title>}
      <rect width={n} height={n} fill={light} />
      <path d={qrSvgPath(qr)} fill={dark} />
    </svg>
  )
}
