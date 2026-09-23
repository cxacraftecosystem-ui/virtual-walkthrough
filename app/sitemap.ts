import type { MetadataRoute } from 'next'

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE}/gallery`, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${SITE}/guide`, changeFrequency: 'monthly', priority: 0.6 },
  ]
}
