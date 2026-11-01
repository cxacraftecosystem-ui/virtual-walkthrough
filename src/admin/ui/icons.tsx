/**
 * Icon: the admin's small stroke icon set (24×24 grid, 1.75 stroke, currentColor), so no icon
 * library is needed. Icons are decorative (`aria-hidden`); the control that holds one carries the
 * name. Usage: `<Icon name="search" />`, or `<Icon d="M4 5h16" />` for a one-off path.
 */
import type { SVGProps } from 'react'

export const ICONS = {
  home: 'M3 11.5 12 4l9 7.5M5.5 10v10h13V10M10 20v-5h4v5',
  content: 'M4 5h16M4 12h16M4 19h10',
  exhibitions: 'M3 20V8l9-5 9 5v12M8 20v-7h8v7',
  makers: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0',
  media: 'M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4',
  capture: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  prints: 'M6 3h12v6H6zM4 9h16v8H4zM7 14h10v7H7z',
  comments: 'M4 5h16v11H9l-5 4z',
  analytics: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  errors: 'M12 3 2 20h20L12 3Zm0 6v5m0 3v.5',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21a7 7 0 0 1 14 0M17 11a3 3 0 1 0 0-6M22 21a6 6 0 0 0-5-6',
  checklist: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm9 2-3.5-3.5',
  close: 'M6 6l12 12M18 6 6 18',
  menu: 'M4 7h16M4 12h16M4 17h16',
  check: 'm5 12 4.5 4.5L19 7',
  dash: 'M6 12h12',
  chevronDown: 'm6 9 6 6 6-6',
  chevronUp: 'm6 15 6-6 6 6',
  chevronRight: 'm9 6 6 6-6 6',
  chevronLeft: 'm15 6-6 6 6 6',
  arrowLeft: 'M19 12H5m6-6-6 6 6 6',
  arrowRight: 'M5 12h14m-6-6 6 6-6 6',
  arrowUpRight: 'M7 17 17 7M8 7h9v9',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z',
  monitor: 'M3 4h18v12H3zM8 20h8M12 16v4',
  keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-11v6m0-9v.5',
  alert: 'M12 3 2 20h20L12 3Zm0 6v5m0 3v.5',
  sort: 'M8 9l4-4 4 4M8 15l4 4 4-4',
  sortUp: 'M8 11l4-4 4 4',
  sortDown: 'M8 13l4 4 4-4',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v5l3 2',
  box: 'M3 7.5 12 3l9 4.5v9L12 21l-9-4.5zM3 7.5l9 4.5 9-4.5M12 12v9',
  archive: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
  link: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
  sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6',
  refresh: 'M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4',
  undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  filter: 'M4 5h16l-6 8v6l-4-2v-4z',
  file: 'M14 3H6v18h12V7zM14 3v4h4',
  image: 'M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4M15 9.5h.01',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0',
} as const

export type IconName = keyof typeof ICONS

export function Icon({ name, d, size, ...rest }: { name?: IconName; d?: string; size?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      <path d={d ?? (name ? ICONS[name] : '')} />
    </svg>
  )
}
