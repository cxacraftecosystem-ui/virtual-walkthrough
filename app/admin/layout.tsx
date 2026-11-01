import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { SITE } from '../../src/site'
import { THEME_BOOT_SCRIPT } from '../../src/admin/theme'
import '../../src/admin/admin.css'

export const metadata: Metadata = {
  title: `Museum Admin — ${SITE.shortName}`,
  robots: { index: false, follow: false },
}

/**
 * Admin area: a scrollable full-viewport layer above the museum's fixed, overflow-hidden body.
 * The inline script is the root's first child and sets `data-theme` before the first paint (see
 * src/admin/theme.ts); `suppressHydrationWarning` lets React keep the attributes it wrote.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="adm-root" suppressHydrationWarning>
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      {children}
    </div>
  )
}
