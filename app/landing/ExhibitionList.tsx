'use client'

import { useEffect, useState } from 'react'

interface Exhibition {
  slug: string
  title: string
  subtitle?: string
  isDefault?: boolean
}

/** Other published exhibitions (multi-exhibition platform). Hidden when there is only one / offline. */
export function ExhibitionList() {
  const [list, setList] = useState<Exhibition[]>([])
  useEffect(() => {
    const ctrl = new AbortController()
    fetch('/api/exhibitions', { signal: ctrl.signal })
      .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? r.json() : []))
      .then((d: unknown) => {
        const arr = Array.isArray(d) ? d : Array.isArray((d as { exhibitions?: unknown })?.exhibitions) ? (d as { exhibitions: unknown[] }).exhibitions : []
        setList(arr.filter((x): x is Exhibition => !!x && typeof (x as Exhibition).slug === 'string' && typeof (x as Exhibition).title === 'string'))
      })
      .catch(() => {})
    return () => ctrl.abort()
  }, [])
  if (list.length < 2) return null
  return (
    <section className="lp-exhibitions" aria-labelledby="lp-exh">
      <div className="lp-wrap">
        <h2 id="lp-exh" className="lp-eyebrow">
          Also on view
        </h2>
        <ul className="lp-exh">
          {list.map((e) => (
            <li key={e.slug}>
              <a className="lp-exh__item" href={e.isDefault ? '/gallery' : `/gallery/${encodeURIComponent(e.slug)}`}>
                {e.isDefault && <span className="lp-exh__tag">Main exhibition</span>}
                <span className="lp-exh__title">{e.title}</span>
                {e.subtitle && <span className="lp-exh__line">{e.subtitle}</span>}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
