import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import '@fontsource/cormorant-garamond/300.css'
import '@fontsource/cormorant-garamond/400.css'
import '@fontsource/cormorant-garamond/500.css'
import '@fontsource/cormorant-garamond/600.css'
import '@fontsource/cormorant-garamond/400-italic.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '../src/styles.css'
import '../src/museum/a11y/a11y.css'
import { ServiceWorkerRegistration } from '../src/museum/pwa/ServiceWorkerRegistration'

const SHARE_TITLE = 'Hand Block Printing — Virtual Exhibition'
const SHARE_DESCRIPTION =
  'Carved wood, natural dye and cloth — walk through a virtual museum of Indian hand block printing, in your browser.'
const SHARE_IMAGE = { url: '/brand/og-image.jpg', width: 1200, height: 630, alt: 'Hand Block Printing — Virtual Exhibition' }

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: 'Hand Block Printing — Virtual Gallery',
  description: 'Hand Block Printing — a virtual museum walkthrough.',
  icons: { icon: '/favicon.svg', apple: '/brand/icon-512.png' },
  manifest: '/manifest.webmanifest',
  openGraph: {
    type: 'website',
    siteName: 'Hand Block Printing',
    title: SHARE_TITLE,
    description: SHARE_DESCRIPTION,
    images: [SHARE_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
    title: SHARE_TITLE,
    description: SHARE_DESCRIPTION,
    images: [SHARE_IMAGE.url],
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#efe9df',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  )
}
