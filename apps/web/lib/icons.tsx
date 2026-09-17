/**
 * Inline icon set.
 *
 * Every glyph is a 24x24 stroked path so one component can render them all at
 * any size and they inherit `currentColor`. Shipping these inline avoids an
 * icon-font request and keeps the bundle honest — only what is listed here.
 */

const PATHS = {
  menu: 'M4 7h16M4 12h16M4 17h16',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5',
  sitemap: 'M9 3h6v4H9zM3 17h6v4H3zM15 17h6v4h-6zM12 7v4M6 17v-2a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v2',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 1 1 0-4h.2A1.6 1.6 0 0 0 4.3 6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V2a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H22a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1z',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16M21 21l-4.3-4.3',
  share: 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13',
  panel: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  close: 'M18 6 6 18M6 6l12 12',
  check: 'M20 6 9 17l-5-5',
  pencil: 'M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z',
  bold: 'M6 4h8a4 4 0 0 1 0 8H6zM6 12h9a4 4 0 0 1 0 8H6z',
  italic: 'M19 4h-9M14 20H5M15 4 9 20',
  underline: 'M6 4v6a6 6 0 0 0 12 0V4M4 21h16',
  strike: 'M16 4H9a3.5 3.5 0 0 0-1 6.9M4 12h16M8.5 16a3.5 3.5 0 0 0 3.5 3h3a3.5 3.5 0 0 0 2.4-6',
  code: 'm16 18 6-6-6-6M8 6l-6 6 6 6',
  listUl: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  listOl: 'M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 16a1 1 0 1 0-2 0M4 18h2M6 18a1 1 0 0 1-2 0',
  alignLeft: 'M21 6H3M15 12H3M17 18H3',
  alignCenter: 'M21 6H3M17 12H7M19 18H5',
  alignRight: 'M21 6H3M21 12H9M21 18H7',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  table: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 9h18M3 15h18M9 3v18M15 3v18',
  image: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M21 15l-5-5L5 21',
  undo: 'M3 7v6h6M3 13a9 9 0 1 1 3 7',
  redo: 'M21 7v6h-6M21 13a9 9 0 1 0-3 7',
  highlight: 'M12 20h9M4 17l7-7 4 4-7 7H4zM14 6l4 4',
  palette: 'M4 20h16M6 16 12 4l6 12',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7v5l3 2',
  branch: 'M6 3v12M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6M18 9a9 9 0 0 1-9 9',
  hash: 'M4 9h16M4 15h16M10 3 8 21M16 3l-2 18',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8',
  monitor: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8 21h8M12 16v5',
  trash: 'M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6',
  reply: 'M9 17l-6-6 6-6M3 11h11a6 6 0 0 1 6 6v3',
  offline: 'M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 4-2.6M2 8.8A15 15 0 0 1 6.2 6M22 8.8a15 15 0 0 0-6.3-3.5M12 20h.01',
  wifi: 'M5 12.5a10 10 0 0 1 14 0M2 8.8a15 15 0 0 1 20 0M8.5 16.2a5 5 0 0 1 7 0M12 20h.01',
  gauge: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 12l4-4',
  chevronDown: 'm6 9 6 6 6-6',
  sort: 'm8 7 4-4 4 4M8 17l4 4 4-4',
} as const

export type IconName = keyof typeof PATHS

interface IconProps {
  name: IconName
  size?: number
  strokeWidth?: number
  className?: string
}

export function Icon({ name, size = 16, strokeWidth = 1.8, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
