'use client'

import { useEffect } from 'react'

export default function GalleryError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    void import('../../src/museum/utils/errorReporter').then((m) => m.reportError(error, { extra: { stage: 'route' } })).catch(() => {})
  }, [error])
  return (
    <div className="ui-nogl" role="alert">
      <div className="ui-nogl__inner">
        <div className="ui-kicker">A Virtual Exhibition</div>
        <h1 className="ui-nogl__title">Something went wrong</h1>
        <p>The gallery hit an unexpected error. Reloading usually fixes it.</p>
        <p style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button type="button" className="ui-btn ui-btn--ghost" onClick={() => reset()}>
            Try again
          </button>
          <button type="button" className="ui-btn ui-btn--ghost" onClick={() => window.location.reload()}>
            Reload
          </button>
        </p>
      </div>
    </div>
  )
}
