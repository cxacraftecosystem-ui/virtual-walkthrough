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

  // Only reveal the film once a real (non-black) frame is on screen; on a stall or a decode
  // error it hides again, so the hero never shows an empty black rectangle over the still.
  const reveal = () => {
    const el = ref.current
    if (!el) return
    try {
      const c = document.createElement('canvas')
      c.width = 32
      c.height = 18
      const g = c.getContext('2d', { willReadFrequently: true })
      if (g) {
        g.drawImage(el, 0, 0, 32, 18)
        const d = g.getImageData(0, 0, 32, 18).data
        let sum = 0
        for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2]
        if (sum / (d.length / 4) / 3 < 24) {
          // decoded frame is (near) black — try again on a later frame
          window.setTimeout(() => (el.paused ? undefined : reveal()), 400)
          return
        }
      }
    } catch {
      /* canvas unavailable: trust the playing event */
    }
    setPlaying(true)
  }

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
          onPlaying={reveal}
          onWaiting={() => setPlaying(false)}
          onError={() => {
            setPlaying(false)
            setUseVideo(false)
          }}
        />
      )}
    </div>
  )
}
