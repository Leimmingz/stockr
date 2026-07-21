// ── Icon set ─────────────────────────────────────────────────
// A small, consistent outline-icon library replacing emoji throughout the
// app. Emoji render differently per OS/font and read as a generic "AI
// template" look; these are hand-picked, single-stroke SVGs so the whole
// app shares one visual language regardless of device or font availability.
// Usage: <Icon name="warehouse" size={20}/>  — color inherits from currentColor.

const PATHS = {
  warehouse: 'M3 21V9l9-6 9 6v12M3 21h18M9 21v-6h6v6M7 12h.01M12 12h.01M17 12h.01',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h13M20 18h.01M8 3v6M15 9v6M17 15v6',
  chart: 'M4 20V10M11 20V4M18 20v-7',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-3.9 3.6-7 8-7s8 3.1 8 7',
  bulb: 'M9 18h6M10 22h4M12 2a6 6 0 00-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0012 2z',
  speaker: 'M7 4h10a1 1 0 011 1v14a1 1 0 01-1 1H7a1 1 0 01-1-1V5a1 1 0 011-1zM12 8a2 2 0 100 4 2 2 0 000-4zM12 15h.01',
  calc: 'M6 3h12a1 1 0 011 1v16a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1zM8 7h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h.01M12 19h.01M16 19h.01',
  history: 'M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8M3 3v5h5M12 7v5l4 2',
  box: 'M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.35-4.35',
  edit: 'M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z',
  trash: 'M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z',
  move: 'M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20',
  qr: 'M3 3h7v7H3V3zM14 3h7v7h-7V3zM3 14h7v7H3v-7zM14 14h3v3h-3v-3zM19 14h2v2h-2v-2zM14 19h2v2h-2v-2zM19 19h2v2h-2v-2z',
  camera: 'M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z M12 17a4 4 0 100-8 4 4 0 000 8z',
  image: 'M3 3h18v18H3V3zM3 15l5-5 4 4 4-5 5 6M9 9a1 1 0 100-2 1 1 0 000 2z',
  check: 'M20 6L9 17l-5-5',
  x: 'M18 6L6 18M6 6l12 12',
  alert: 'M12 2L1 21h22L12 2zM12 9v5M12 17h.01',
  bell: 'M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9zM13.7 21a2 2 0 01-3.4 0',
  lock: 'M5 11h14v10H5V11zM7 11V7a5 5 0 0110 0v4',
  wifi: 'M5 13a10 10 0 0114 0M8.5 16.5a5 5 0 017 0M12 20h.01M2 8.8a15 15 0 0120 0',
  wifiOff: 'M2 2l20 20M8.5 16.5a5 5 0 017 0M5 13a10 10 0 013.5-2.4M19 13a10 10 0 00-3-2.1M12 20h.01M2 8.8a15 15 0 014.4-2.7',
  rocket: 'M4.5 16.5c-1.5 1.5-2 5-2 5s3.5-.5 5-2c.8-.8 1-2 1-2s-1.2.2-2 1zM12 15l-3-3 8-8c1-1 4-2 6-2s-1 5-2 6l-8 8zM9 12L6 9M15 15l3 3',
  home: 'M3 12l9-9 9 9M5 10v10h14V10',
  refresh: 'M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0114.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0020.5 15',
  external: 'M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3',
  download: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3',
  upload: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12',
  folder: 'M3 7a2 2 0 012-2h5l2 2h7a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z',
  info: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 16v-5M12 8h.01',
  zoomIn: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.35-4.35M11 8v6M8 11h6',
  layout: 'M3 3h18v18H3V3zM3 9h18M9 9v12',
  package: 'M12.89 1.45l8 4A2 2 0 0122 7.24v9.53a2 2 0 01-1.11 1.79l-8 4a2 2 0 01-1.79 0l-8-4a2 2 0 01-1.1-1.8V7.24a2 2 0 011.11-1.79l8-4a2 2 0 011.78 0zM2.32 6.16L12 11l9.68-4.84M12 22.76V11',
  users: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 100-6 3 3 0 000 6z',
  crown: 'M2 19h20M4 19l1.5-9L9 14l3-7 3 7 3.5-4L20 19',
  shield: 'M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z',
}

export function Icon({ name, size = 18, strokeWidth = 2, style, className }) {
  const d = PATHS[name]
  if (!d) return null
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle', ...style }}
      className={className}
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  )
}
