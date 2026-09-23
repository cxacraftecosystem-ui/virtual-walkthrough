'use client'

import { useState } from 'react'

/**
 * A captured museum frame. Missing (not captured yet) or failing to load → a neutral
 * block-print placeholder with the picture's label, never a broken-image icon.
 */
export function Shot({ src, alt, label, className = '' }: { src: string | null; alt: string; label: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  return (
    <span className={`lp-shot ${className}`}>
      {src && !failed ? (
        <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />
      ) : (
        <span className="lp-shot__ph" role={alt ? 'img' : undefined} aria-label={alt ? `${alt} (image to come)` : undefined} aria-hidden={alt ? undefined : true}>
          <span>{label}</span>
        </span>
      )}
    </span>
  )
}
