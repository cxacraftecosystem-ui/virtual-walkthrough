/** Minimal hairline icon set for the UI overlay (24px grid, currentColor strokes). */
import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement>

function Svg(props: P) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    />
  )
}

export const IconHelp = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6" />
    <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconSoundOn = (p: P) => (
  <Svg {...p}>
    <path d="M4 9.5h3.2L11.5 6v12l-4.3-3.5H4z" />
    <path d="M15 9.2a4 4 0 0 1 0 5.6M17.6 6.7a7.5 7.5 0 0 1 0 10.6" />
  </Svg>
)

export const IconSoundOff = (p: P) => (
  <Svg {...p}>
    <path d="M4 9.5h3.2L11.5 6v12l-4.3-3.5H4z" />
    <path d="M15.5 9.5l5 5M20.5 9.5l-5 5" />
  </Svg>
)

export const IconFullscreen = (p: P) => (
  <Svg {...p}>
    <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
  </Svg>
)

export const IconFullscreenExit = (p: P) => (
  <Svg {...p}>
    <path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5" />
  </Svg>
)

export const IconQuality = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="17" r="2" />
  </Svg>
)

export const IconReset = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
    <path d="M4.5 4.5v3.8h3.8" />
  </Svg>
)

export const IconMap = (p: P) => (
  <Svg {...p}>
    <path d="M9 5 4 7v12l5-2 6 2 5-2V5l-5 2z" />
    <path d="M9 5v12M15 7v12" />
  </Svg>
)

export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
)

export const IconMinus = (p: P) => (
  <Svg {...p}>
    <path d="M6 12h12" />
  </Svg>
)

export const IconCube = (p: P) => (
  <Svg {...p}>
    <path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z" />
    <path d="M4 7.5 12 12l8-4.5M12 12v9" />
  </Svg>
)

export const IconInfo = (p: P) => (
  <Svg {...p} strokeWidth={2}>
    <path d="M12 11v6" />
    <circle cx="12" cy="7.3" r="0.9" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconHeart = ({ filled, ...p }: P & { filled?: boolean }) => (
  <Svg {...p}>
    <path
      d="M12 19.5s-7-4.3-7-9.4A3.9 3.9 0 0 1 12 7.6a3.9 3.9 0 0 1 7 2.5c0 5.1-7 9.4-7 9.4z"
      fill={filled ? 'currentColor' : 'none'}
    />
  </Svg>
)

export const IconBook = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 5.5c2.6-.9 5.1-.6 7.5 1v12c-2.4-1.6-4.9-1.9-7.5-1z" />
    <path d="M19.5 5.5c-2.6-.9-5.1-.6-7.5 1v12c2.4-1.6 4.9-1.9 7.5-1z" />
  </Svg>
)

export const IconUser = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 19.5c1.2-3.3 3.8-5 7-5s5.8 1.7 7 5" />
  </Svg>
)

/** Guided tour: a route with stops. */
export const IconTour = (p: P) => (
  <Svg {...p}>
    <circle cx="6" cy="18" r="2" />
    <circle cx="18" cy="6" r="2" />
    <path d="M8 18h6.5a3 3 0 0 0 0-6h-5a3 3 0 0 1 0-6H16" />
  </Svg>
)

/** Mouse look: a mouse with a crosshair dot. */
export const IconMouseLook = (p: P) => (
  <Svg {...p}>
    <rect x="7" y="3.5" width="10" height="17" rx="5" />
    <path d="M12 3.5v5" />
    <circle cx="12" cy="13.5" r="0.9" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconPlay = (p: P) => (
  <Svg {...p}>
    <path d="M8 5.5v13l10.5-6.5z" />
  </Svg>
)

export const IconPause = (p: P) => (
  <Svg {...p}>
    <path d="M8.5 5.5v13M15.5 5.5v13" />
  </Svg>
)

export const IconNext = (p: P) => (
  <Svg {...p}>
    <path d="M6.5 6l7 6-7 6M17.5 6v12" />
  </Svg>
)

export const IconPrev = (p: P) => (
  <Svg {...p}>
    <path d="M17.5 6l-7 6 7 6M6.5 6v12" />
  </Svg>
)

export const IconArrowRight = (p: P) => (
  <Svg {...p}>
    <path d="M5 12h13M13 7l5 5-5 5" />
  </Svg>
)

export const IconSignOut = (p: P) => (
  <Svg {...p}>
    <path d="M14 4.5H6.5v15H14M10 12h10M16.5 8.5 20 12l-3.5 3.5" />
  </Svg>
)

export const IconNarration = (p: P) => (
  <Svg {...p}>
    <path d="M5 9.5h2.8L12 6v12l-4.2-3.5H5z" />
    <path d="M15.2 9.4a3.6 3.6 0 0 1 0 5.2M17.8 7a7 7 0 0 1 0 10" />
  </Svg>
)

/** Stylised carved-block rosette used as an ornament. */
export const Rosette = (p: P) => (
  <Svg viewBox="0 0 48 48" strokeWidth={1} {...p}>
    <circle cx="24" cy="24" r="21" />
    <circle cx="24" cy="24" r="4" />
    {Array.from({ length: 8 }, (_, i) => (
      <ellipse key={i} cx="24" cy="13" rx="3.6" ry="8" transform={`rotate(${i * 45} 24 24)`} />
    ))}
    {Array.from({ length: 16 }, (_, i) => (
      <circle key={`d${i}`} cx="24" cy="5.6" r="0.7" fill="currentColor" stroke="none" transform={`rotate(${i * 22.5} 24 24)`} />
    ))}
  </Svg>
)
