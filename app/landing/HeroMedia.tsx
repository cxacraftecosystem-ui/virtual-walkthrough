'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Full-bleed hero picture. The still (a real captured frame of the museum) renders first;
 * a short muted loop recorded from the museum fades in over it once it is actually playing —
 * but only on wider screens, with motion allowed and no data-saver.
 */
export function HeroMedia({ poster, video, alt }: { poster: string | null; video: string | null; alt: string }) {
  const [useVideo, setUseVideo] = useState(false)
  const [playing, setPlaying] = useState(false)
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (!video) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    const wide = window.matchMedia('(min-width: 700px)')
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true
    const decide = () => setUseVideo(!reduce.matches && wide.matches && !saveData)
    decide()
    reduce.addEventListener('change', decide)
    wide.addEventListener('change', decide)
    return () => {
      reduce.removeEventListener('change', decide)
      wide.removeEventListener('change', decide)
    }
  }, [video])

  // Pause while the hero is off screen / the tab is hidden.
  useEffect(() => {
    const el = ref.current
    if (!useVideo || !el) return
    const root = el.closest<HTMLElement>('.lp') ?? undefined
    const io = new IntersectionObserver(([e]) => (e.isIntersecting && !document.hidden ? el.play().catch(() => {}) : el.pause()), { root, threshold: 0.05 })
    io.observe(el)
    return () => io.disconnect()
  }, [useVideo])

  return (
    <div className="lp-hero__media" role="img" aria-label={alt}>
      {poster ? <img className="lp-hero__still" src={poster} alt="" fetchPriority="high" decoding="async" /> : <div className="lp-hero__still lp-hero__still--empty" />}
      {useVideo && video && (
        <video
          ref={ref}
          className={`lp-hero__video${playing ? ' is-playing' : ''}`}
          src={video}
          poster={poster ?? undefined}
          muted
          loop
          playsInline
          autoPlay
          preload="auto"
          aria-hidden="true"
          tabIndex={-1}
          onPlaying={() => setPlaying(true)}
        />
      )}
    </div>
  )
}
