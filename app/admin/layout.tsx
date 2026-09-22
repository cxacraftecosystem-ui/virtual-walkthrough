import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import '../../src/admin/admin.css'

export const metadata: Metadata = {
  title: 'Museum Admin — Hand Block Printing',
  robots: { index: false, follow: false },
}

/** Admin area: a scrollable full-viewport layer above the museum's fixed, overflow-hidden body. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <div className="adm-root">{children}</div>
}
