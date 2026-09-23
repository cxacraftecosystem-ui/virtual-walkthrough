import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { AMENITY_OBJECTS } from '../../../../src/museum/config/amenities'
import { ZONES } from '../../../../src/museum/config/layout'
import { deepLinkUrl, isLinkKind, type LinkKind } from '../../../../src/museum/share/deepLink'
import { encodeQR, qrSvgPath } from '../../../../src/museum/share/qr'
import { loadGuideContent } from '../../../guide/guideData'
import { PrintButton } from '../../../guide/PrintButton'
import '../../qr.css'

/**
 * /qr/<kind>/<id> — a printable QR label for physical exhibition cross-linking: the item's
 * title and a QR code for its virtual-museum deep link (/gallery#<kind>=<id>).
 * kind: artwork | object | exhibit | infographic | video | zone.
 */
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ kind: string; id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }

const KIND_LABEL: Record<LinkKind, string> = {
  artwork: 'Textile',
  exhibit: 'Hand block',
  object: 'Installation',
  infographic: 'Craft panel',
  video: 'Film',
  zone: 'Room',
}

async function origin(): Promise<string> {
  const env = process.env.NEXT_PUBLIC_SITE_URL
  if (env) return env.replace(/\/+$/, '')
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (/^(localhost|127\.|\[::1\])/.test(host) ? 'http' : 'https')
  return `${proto}://${host}`
}

async function resolve(kindRaw: string, idRaw: string) {
  if (!isLinkKind(kindRaw)) return null
  const kind = kindRaw
  const id = decodeURIComponent(idRaw)
  if (kind === 'zone') {
    const z = ZONES.find((x) => x.id === id)
    return z ? { kind, id, title: z.name, placeholder: false } : null
  }
  const c = await loadGuideContent()
  const list: { id: string; title: string; placeholder?: boolean }[] =
    kind === 'artwork' ? c.artworks : kind === 'exhibit' ? c.exhibits : kind === 'object' ? c.objects : kind === 'infographic' ? c.infographics : c.videos
  // amenity fixtures (shop, library, credits) may be missing from an older server content set
  const item = (list ?? []).find((x) => x.id === id) ?? (kind === 'object' ? AMENITY_OBJECTS.find((x) => x.id === id) : undefined)
  return item ? { kind, id, title: item.title, placeholder: !!item.placeholder } : null
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { kind, id } = await params
  const it = await resolve(kind, id)
  return { title: it ? `QR label — ${it.title}` : 'QR label', robots: { index: false, follow: false } }
}

export default async function QrLabelPage({ params, searchParams }: Props) {
  const { kind, id } = await params
  const it = await resolve(kind, id)
  if (!it) notFound()
  const sp = await searchParams
  const size = sp.size === 'large' ? 'large' : 'small'
  const url = deepLinkUrl(it.kind, it.id, await origin())
  const qr = encodeQR(url)
  const n = qr.size + 8
  return (
    <main className={`qr-page qr-page--${size}`}>
      <div className="qr-tools">
        <PrintButton label="Print label" />
        <a className="qr-tool" href={`?size=${size === 'large' ? 'small' : 'large'}`}>
          {size === 'large' ? 'Small label' : 'Large label'}
        </a>
        <a className="qr-tool" href={url}>
          Open in the virtual museum →
        </a>
      </div>
      <article className="qr-label" aria-label={`QR label for ${it.title}`}>
        <svg className="qr-label__code" viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" role="img" aria-label={`QR code linking to ${it.title} in the virtual museum`}>
          <rect width={n} height={n} fill="#fff" />
          <path d={qrSvgPath(qr)} fill="#1f1b17" />
        </svg>
        <div className="qr-label__text">
          <div className="qr-label__kicker">{KIND_LABEL[it.kind]} · Virtual museum</div>
          <h1 className="qr-label__title">{it.title}</h1>
          {it.placeholder && <p className="qr-label__note">Placeholder item — content to be supplied by the workshop.</p>}
          <p className="qr-label__cta">Scan to see this in the Hand Block Printing virtual museum.</p>
          <p className="qr-label__url">{url.replace(/^https?:\/\//, '')}</p>
        </div>
      </article>
    </main>
  )
}
