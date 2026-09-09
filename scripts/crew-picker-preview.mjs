/* Render the crew picker on its own, with the boat's real crew.
 *
 *   node scripts/crew-picker-preview.mjs [out.html]
 *
 * The picker is markup inside `CrewList.jsx`, which is behind a login and drags
 * the supabase client in behind it, so it cannot be server-rendered the way
 * `SheetBody` and `DashboardBody` are. What CAN be checked without any of that
 * is the thing David actually complained about — that nothing lined up — so
 * this pairs the real classes out of `src/index.css` with the real nineteen
 * names and writes a page to look at.
 *
 * IT CHECKS THE CSS AND THE ROW SHAPE, NOT THE WIRING. Say so rather than
 * letting it read as proof the page works.
 */
import { writeFileSync, readFileSync } from 'node:fs'
import { safeOut } from './safeOut.mjs'

const out = safeOut(process.argv[2] || 'crew-picker-preview.html', '.html')

/* Audacious's crew as at Sep 2026 — nine aboard of nineteen. Long names and
   short ones together, because ragged lengths are what broke the old layout. */
const CREW = [
  ['Alfie Reid', true], ['Andrejs Gundarovs', false], ['Andrew Smith', true],
  ['Barry Reid', true], ['Christopher Catam', true], ['David Gatt', false],
  ['David Henderson', true], ['Duncan Cruikshank', false], ['Edgel Bigno', true],
  ['Elizer Tano', false], ['Eugene Tano', false], ['Gregor Smith', true],
  ['Jackson Gatt', false], ['James Napier', true], ['John Gabriel Binggan', false],
  ['Lorenzo Rusiana', true], ['Norman Wood', false], ['Paul Craib', false],
  ['Ronald Beagrie', false],
]

const aboard = CREW.filter(([, on]) => on).length
const rows = CREW.map(([name, on]) => `
  <label class="pickrow${on ? ' on' : ''}">
    <input type="checkbox"${on ? ' checked' : ''}>
    <span class="nm" title="${name}">${name}</span>
    <span class="st ${on ? 'aboard' : 'ashore'}">${on ? 'on board' : 'on leave'}</span>
  </label>`).join('')

const appCss = readFileSync('src/index.css', 'utf8')

writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>Crew picker</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@400;600;700&family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;600&display=swap">
<style>${appCss}</style>
<style>
 body{margin:0;padding:24px;background:var(--paper)}
 .wrap{max-width:900px;margin:0 auto}
 h2.pv{font:600 13px var(--font-mono);letter-spacing:.08em;text-transform:uppercase;
       background:var(--ink);color:#fff;padding:8px 12px;margin:22px 0 0;border-radius:3px}
</style>
<div class="wrap">
  <h2 class="pv">The picker, 19 men, 9 aboard</h2>
  <div class="card">
    <p class="muted" style="font-size:0.82rem;margin-top:0">
      Ticking a man puts him on this voyage <b>and marks him on board</b> on Crew
      status. Unticking puts him on leave. The two are the same fact, so they are
      kept as one.
    </p>
    <div class="pickgrid">${rows}</div>
    <p class="pickcount">${aboard} on board · ${CREW.length - aboard} on leave</p>
  </div>

  <h2 class="pv">Narrow — the same rows, one column</h2>
  <div class="card" style="max-width:340px">
    <div class="pickgrid" style="grid-template-columns:1fr">${rows}</div>
    <p class="pickcount">${aboard} on board · ${CREW.length - aboard} on leave</p>
  </div>
</div>`)

/* ---- what the layout has to guarantee ---------------------------------- */
let bad = 0
const has = (s, why) => {
  const html = readFileSync(out, 'utf8')
  if (html.includes(s)) console.log('  ok    ' + why)
  else { console.log('  FAIL  ' + why + ' — expected ' + JSON.stringify(s)); bad++ }
}

/* THREE FIXED COLUMNS is the whole fix: the checkbox, the name, and the state
   in a column of its own. The old row was a flex with the chip butted against
   the name, so every row ended somewhere different. */
has('grid-template-columns: 1.1rem 1fr auto', 'the row is three fixed columns')
has('.pickrow .st', 'and the state has a column to itself')
has('text-align: right', 'right-aligned, so it reads as a column')

/* A STATE ON EVERY ROW, not a chip on some. "No chip" is not a state anybody
   can read, and it was half of why the column looked ragged. */
const onBoard = (readFileSync(out, 'utf8').match(/on board</g) || []).length
const onLeave = (readFileSync(out, 'utf8').match(/on leave</g) || []).length
if (onBoard >= aboard && onLeave >= CREW.length - aboard) {
  console.log('  ok    every man says his state (' + onBoard + ' on board, ' + onLeave + ' on leave)')
} else { console.log('  FAIL  not every man carries a state'); bad++ }

has('text-overflow: ellipsis', 'a long name is clipped rather than breaking the grid')

console.log(out)
if (bad) { console.log('  ' + bad + ' PROBLEM' + (bad === 1 ? '' : 'S')); process.exit(1) }
console.log('  the picker lines up')
