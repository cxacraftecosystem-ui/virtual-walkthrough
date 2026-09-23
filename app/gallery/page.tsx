import type { Metadata } from 'next'
import { MuseumClient } from '../MuseumClient'

export const metadata: Metadata = {
  title: 'Virtual Gallery — Hand Block Printing',
}

/** The 3D museum (default exhibition). A fully client-side WebGL experience; this page is its host. */
export default function GalleryPage() {
  return <MuseumClient />
}
