'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface NavLink {
  href: string
  label: string
}

/**
 * The landing page's top bar. Transparent over the hero, it solidifies once the page scrolls,
 * tucks away while reading downwards and returns on the way back up. Below 1080 px the links
 * move into a full-height menu sheet. Also drives the page's scroll-reveal motion (skipped
 * entirely under prefers-reduced-motion).
 *
 * The landing page scrolls inside `.lp` (the museum's global stylesheet locks <body>), so
 * every scroll listener / observer here is rooted on that element.
 */
export function LandingNav({ links }: { links: NavLink[] }) {
  const barRef = useRef<HTMLElement>(null)
  const menuBtnRef = useRef<HTMLButtonElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const [solid, setSolid] = useState(false)
  const [tucked, setTucked] = useState(false)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<string | null>(null)

  // Scroll state (solid / tucked).
  useEffect(() => {
    const root = barRef.current?.closest<HTMLElement>('.lp')
    if (!root) return
    let last = root.scrollTop
    let raf = 0
    const update = () => {
      raf = 0
      const y = root.scrollTop
      const heroH = root.querySelector<HTMLElement>('.lp-hero')?.offsetHeight ?? window.innerHeight
      setSolid(y > 24)
      if (Math.abs(y - last) > 6) {
        setTucked(y > last && y > heroH * 0.6)
        last = y
      }
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      root.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [])

  // Current section → aria-current on its link.
  useEffect(() => {
    const root = barRef.current?.closest<HTMLElement>('.lp')
    if (!root || !('IntersectionObserver' in window)) return
    const ids = links.map((l) => l.href).filter((h) => h.startsWith('#')).map((h) => h.slice(1))
    const els = ids.map((id) => document.getElementById(id)).filter((e): e is HTMLElement => !!e)
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id)
      },
      { root, rootMargin: '-45% 0px -50% 0px' },
    )
    els.forEach((el) => io.observe(el))
    const clear = () => {
      if (root.scrollTop < (root.querySelector<HTMLElement>('.lp-hero')?.offsetHeight ?? 0) * 0.5) setActive(null)
    }
    root.addEventListener('scroll', clear, { passive: true })
    return () => {
      io.disconnect()
      root.removeEventListener('scroll', clear)
    }
  }, [links])

  // Scroll-reveal: content rises in gently as it enters the viewport.
  useEffect(() => {
    const root = barRef.current?.closest<HTMLElement>('.lp')
    if (!root || !('IntersectionObserver' in window)) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const els = [...root.querySelectorAll<HTMLElement>('[data-reveal]')]
    const vh = root.clientHeight
    // Anything already on screen stays put; only content below the fold animates.
    const below = els.filter((el) => el.getBoundingClientRect().top > vh * 0.92)
    if (!below.length) return
    root.dataset.motion = 'on'
    below.forEach((el) => el.classList.add('is-pending'))
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          const el = e.target as HTMLElement
          el.classList.add('is-in')
          el.classList.remove('is-pending')
          io.unobserve(el)
        }
      },
      { root, rootMargin: '0px 0px -8% 0px', threshold: 0.01 },
    )
    below.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  // Menu sheet: lock page scroll, Esc closes, focus moves in and back.
  const close = useCallback((restoreFocus = true) => {
    setOpen(false)
    if (restoreFocus) menuBtnRef.current?.focus({ preventScroll: true })
  }, [])
  useEffect(() => {
    if (!open) return
    const root = barRef.current?.closest<HTMLElement>('.lp')
    root?.classList.add('is-locked')
    sheetRef.current?.querySelector<HTMLElement>('a')?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      if (e.key !== 'Tab' || !sheetRef.current) return
      const items = [menuBtnRef.current, ...sheetRef.current.querySelectorAll<HTMLElement>('a')].filter((x): x is HTMLElement => !!x)
      const i = items.indexOf(document.activeElement as HTMLElement)
      const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i === items.length - 1 ? 0 : i + 1
      e.preventDefault()
      items[next]?.focus()
    }
    const onResize = () => window.innerWidth > 1080 && close(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      root?.classList.remove('is-locked')
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  }, [open, close])

  const cls = ['lp-nav', solid || open ? 'is-solid' : '', tucked && !open ? 'is-tucked' : '', open ? 'is-open' : ''].filter(Boolean).join(' ')

  return (
    <header ref={barRef} className={cls}>
      <div className="lp-nav__bar">
        <a className="lp-nav__brand lp-plaque" href="#top" aria-label="Hand Block Printing — back to top" onClick={() => open && close(false)}>
          <img src="/brand/dc-handicrafts.png" width={642} height={240} alt="DC Handicrafts — Indian Handicrafts, continuing tradition" />
        </a>

        <nav className="lp-nav__links" aria-label="Sections">
          {links.map((l) => (
            <a key={l.href} href={l.href} aria-current={active && l.href === `#${active}` ? 'true' : undefined}>
              {l.label}
            </a>
          ))}
        </nav>

        <div className="lp-nav__end">
          <a className="lp-nav__cta" href="/gallery">
            Enter the gallery
          </a>
          <span className="lp-nav__iit lp-plaque">
            <img src="/brand/iit-kharagpur.svg" width={268} height={300} alt="IIT Kharagpur" />
          </span>
          <button
            ref={menuBtnRef}
            type="button"
            className="lp-nav__menu-btn"
            aria-expanded={open}
            aria-controls="lp-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((v) => !v)}
          >
            <span aria-hidden="true" />
            <span aria-hidden="true" />
          </button>
        </div>
      </div>

      <div id="lp-menu" ref={sheetRef} className="lp-menu" hidden={!open}>
        <nav aria-label="Sections">
          <ol className="lp-menu__links">
            {links.map((l, i) => (
              <li key={l.href}>
                <a href={l.href} onClick={() => close(false)}>
                  <span className="lp-menu__num">{String(i + 1).padStart(2, '0')}</span>
                  {l.label}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <div className="lp-menu__cta">
          <a className="lp-btn lp-btn--primary" href="/gallery">
            Enter the virtual gallery
          </a>
          <a className="lp-btn lp-btn--line" href="/gallery?autostart&tour">
            Take the guided tour
          </a>
          <a className="lp-menu__guide" href="/guide">
            Accessible text guide
          </a>
        </div>
      </div>
    </header>
  )
}
