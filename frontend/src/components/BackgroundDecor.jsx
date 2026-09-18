import { useMemo } from 'react'
import './BackgroundDecor.css'

// Small retail/warehouse/scanning-themed line icons, same feather-style
// stroke/fill as every other icon in this app — scattered faintly across
// the page as pure decoration. `pointer-events: none` throughout so it
// never sits in the way of a click; `aria-hidden` since it carries no
// information.
const ICONS = {
  cart: (
    <>
      <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </>
  ),
  bag: (
    <>
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
      <path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" />
    </>
  ),
  package: (
    <>
      <path d="M3 7l9-4 9 4-9 4-9-4Z" /><path d="M3 7v10l9 4 9-4V7" /><path d="M12 11v10" />
    </>
  ),
  tag: (
    <>
      <path d="M20.59 13.41 13 21 3 11V3h8l9.59 9.59a2 2 0 0 1 0 2.82Z" />
      <circle cx="7.5" cy="7.5" r="1.5" />
    </>
  ),
  truck: (
    <>
      <rect x="1" y="3" width="15" height="13" />
      <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
      <circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
    </>
  ),
  barcode: (
    <g strokeWidth="2.4">
      <path d="M3 4v16" /><path d="M7 4v16" /><path d="M10.5 4v16" />
      <path d="M14 4v16" strokeWidth="4.5" /><path d="M18 4v16" />
      <path d="M21 4v16" strokeWidth="3.5" />
    </g>
  ),
  coffee: (
    <>
      <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
      <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8Z" />
      <line x1="6" y1="1" x2="6" y2="4" /><line x1="10" y1="1" x2="10" y2="4" /><line x1="14" y1="1" x2="14" y2="4" />
    </>
  ),
  icecream: (
    <>
      <circle cx="12" cy="7" r="5" /><polygon points="7 10 17 10 12 21" />
    </>
  ),
  pizza: (
    <>
      <polygon points="12 3 20 20 4 20" />
      <circle cx="12" cy="14" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="9" cy="17" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="17" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  checklist: (
    <>
      <rect x="7" y="3" width="10" height="4" rx="1" />
      <path d="M17 5h1a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h1" />
      <path d="M9 13l2 2 4-4" />
    </>
  ),
  gift: (
    <>
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M12 8v13" /><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
      <path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8Z" />
      <path d="M16.5 8a2.5 2.5 0 0 0 0-5C13 3 12 8 12 8Z" />
    </>
  ),
}
const ICON_NAMES = Object.keys(ICONS)

// Deterministic pseudo-random in [0,1) from an integer seed — same output
// every run (stable across re-renders, no hydration/layout flicker) while
// still looking scattered rather than a rigid, obviously-regular grid.
function pseudoRandom(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

// Fills the *entire* page (a wide row x column grid, not just the edges)
// with jittered, varied icons — size/rotation/color-tone/delay/duration
// all derived from each cell's own seed so nothing repeats in an obvious
// pattern despite being fully deterministic. Generated once (useMemo, no
// deps) rather than hand-listed, since "cover the whole page" needs far
// more entries than are practical to hand-tune individually.
const ROWS = 11
const COLS = 8

function buildPlacements() {
  const placements = []
  let i = 0
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const seed = r * COLS + c + 1
      // Cell center in percent, plus jitter so it doesn't read as a rigid
      // grid — kept within the cell's own bounds so nothing overlaps.
      const cellTop = (r + 0.5) * (100 / ROWS)
      const cellLeft = (c + 0.5) * (100 / COLS)
      const jitterT = (pseudoRandom(seed * 3.1) - 0.5) * (100 / ROWS) * 0.7
      const jitterL = (pseudoRandom(seed * 7.7) - 0.5) * (100 / COLS) * 0.7
      placements.push({
        icon: ICON_NAMES[i % ICON_NAMES.length],
        top: `${Math.min(97, Math.max(2, cellTop + jitterT)).toFixed(1)}%`,
        left: `${Math.min(97, Math.max(2, cellLeft + jitterL)).toFixed(1)}%`,
        size: Math.round(14 + pseudoRandom(seed * 5.3) * 16),
        rotate: Math.round((pseudoRandom(seed * 2.4) - 0.5) * 50),
        delay: +(pseudoRandom(seed * 9.1) * 4.5).toFixed(2),
        dur: +(5 + pseudoRandom(seed * 4.6) * 4.5).toFixed(2),
      })
      i++
    }
  }
  return placements
}

/**
 * Faint, slowly pulsing retail/warehouse/scanning icons filling the entire
 * page's background — purely decorative texture, never competing with
 * real content. Render it as the first child of a `position: relative`
 * page shell; it fills that shell via `position: absolute; inset: 0` and
 * sits behind everything else (z-index 0, with the shell's real content
 * needing its own `position: relative; z-index: 1` — see
 * DashboardPage.jsx for the pattern).
 */
export default function BackgroundDecor() {
  const placements = useMemo(() => buildPlacements(), [])

  return (
    <div className="bg-decor" aria-hidden="true">
      {placements.map((p, i) => (
        <svg
          key={i}
          className="bg-decor-icon"
          style={{
            top: p.top, left: p.left, width: p.size, height: p.size,
            '--rotate': `${p.rotate}deg`,
            animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`,
          }}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
        >
          {ICONS[p.icon]}
        </svg>
      ))}
    </div>
  )
}
