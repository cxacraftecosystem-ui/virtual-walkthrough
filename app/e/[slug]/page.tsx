import { permanentRedirect } from 'next/navigation'

/** Legacy /e/<slug> → /gallery/<slug> (per-exhibition museum routes live under /gallery). */
export default async function LegacyExhibitionRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  permanentRedirect(`/gallery/${encodeURIComponent(slug)}`)
}
