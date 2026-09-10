/* Render the pre-departure check and read the markup back.
 *
 *   node scripts/predeparture-preview.mjs [out.html]
 *
 * The page is behind a login, and the states worth looking at are the awkward
 * ones: no sailing on record, a drill inside its interval, an event with no
 * entry against it. A build passing proves none of them — an undefined
 * identifier is valid JavaScript, and this repo has shipped eight of them.
 *
 * THE FIXTURES ARE SHAPED LIKE THE TABLES, not like the module. The first cut
 * of `predeparture.js` read `entry_date` off the Official Log Book and the
 * radio log; both are wrong — `occurred_on` and `log_date` — and every OLB item
 * would have come out "never" for ever. The tests did not catch it because the
 * fixtures were written from the code.
 */
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import esbuild from 'esbuild'
import { safeOut } from './safeOut.mjs'

const out = safeOut(process.argv[2] || 'predeparture-preview.html', '.html')

mkdirSync('node_modules/.cache', { recursive: true })
const bundle = join('node_modules/.cache', 'predeparture-preview.mjs')
await esbuild.build({
  entryPoints: ['src/pages/certification/PreDepartureBody.jsx'],
  bundle: true, format: 'esm', outfile: bundle, platform: 'node', jsx: 'automatic',
  external: ['react', 'react-dom', 'react-dom/*', 'react/*', 'react-router-dom', 'react-router-dom/*'],
  logLevel: 'warning',
})
const mod = await import(pathToFileURL(bundle).href)
const Body = mod.default
const { NextAfterSaving } = mod
const { renderToStaticMarkup } = await import('react-dom/server')
const { MemoryRouter } = await import('react-router-dom')
const React = await import('react')
const { predeparture, nextAfterCrewList } =
  await import(pathToFileURL('src/lib/certification/predeparture.js').href)

const vessel = { id: 'v1', label: 'AUDACIOUS BF83' }
const DEP = '2026-09-10'
const PREV = '2026-09-01'
const trips = [DEP, PREV, '2026-08-22']

/* Real column names: occurred_on on the Official Log Book, log_date on the
   radio log, entry_date on the fuel and garbage logs. */
const olb = (n, on) => ({ entry_n: n, occurred_on: on })

const states = [
  ['Nothing done yet — a fresh departure', predeparture({
    departureAt: DEP, previousDepartureAt: PREV, asOf: DEP,
  })],

  ['Part way — the crew list lodged, a bunkering with no ORB entry', predeparture({
    departureAt: DEP, previousDepartureAt: PREV, asOf: DEP,
    crewLists: [{ departure_date: DEP }],
    olbEntries: [olb(7, '2026-09-05'), olb(17, '2026-09-04'), olb(18, '2026-08-20'), olb(21, '2026-07-20')],
    fuelRows: [{ id: 'f1', kind: 'fuel', entry_date: '2026-09-08', litres: 18400 }],
    orbEntries: [],
    garbageRows: [{ id: 'g1', entry_date: '2026-09-06' }],
  })],

  ['Nothing outstanding — and it still does not say she is ready', predeparture({
    departureAt: DEP, previousDepartureAt: PREV, asOf: DEP,
    crewLists: [{ departure_date: DEP }],
    radioEntries: [{ kind: 'test', log_date: DEP }],
    olbEntries: [olb(7, '2026-09-05'), olb(17, '2026-09-05'), olb(18, '2026-09-05'), olb(21, '2026-09-05')],
    fuelRows: [{ id: 'f1', kind: 'fuel', entry_date: '2026-09-08' }],
    orbEntries: [{ id: 'e1', fuel_log_id: 'f1' }],
  })],

  /* NO DEPARTURE, NO CHECK. Saying nothing is outstanding here would read as an
     all-clear, which is worse than saying nothing at all. */
  ['No sailing on record', predeparture({})],
]

const partWay = states[1][1]

const html = states.map(([title, check]) =>
  `<h2 class="pv">${title}</h2>`
  + renderToStaticMarkup(React.createElement(MemoryRouter, null,
      React.createElement(Body, { vessel, check, departures: trips })))).join('\n')
  + `<h2 class="pv">What the Crew List says after saving</h2>`
  + '<div class="card">Crew list saved ✓'
  + renderToStaticMarkup(React.createElement(MemoryRouter, null,
      React.createElement(NextAfterSaving, nextAfterCrewList(partWay) || {})))
  + '</div>'

const appCss = readFileSync('src/index.css', 'utf8')
writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>Before she sails</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@400;600;700&family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;600&display=swap">
<style>${appCss}</style>
<style>
 body{margin:0;padding:0 20px 48px;background:var(--paper)}
 .wrap{max-width:960px;margin:0 auto}
 h2.pv{font:600 13px var(--font-mono);letter-spacing:.08em;text-transform:uppercase;
       background:var(--ink);color:#fff;padding:9px 14px;margin:26px 0 0;border-radius:3px}
</style>
<div class="wrap">${html}</div>`)

/* ---- what every state has to say -------------------------------------- */
const decode = (t) => t.replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x2014;/g, '—')
const panes = html.split('<h2 class="pv">').slice(1).map(decode)
let bad = 0
const has = (i, s, why) => {
  if (panes[i - 1]?.includes(s)) console.log('  ok    ' + why)
  else { console.log('  FAIL  ' + why + ' — expected ' + JSON.stringify(s)); bad++ }
}
const hasnt = (i, s, why) => {
  if (!panes[i - 1]?.includes(s)) console.log('  ok    ' + why)
  else { console.log('  FAIL  ' + why + ' — did not expect ' + JSON.stringify(s)); bad++ }
}

/* THE THREE BANDS, on every state that has a departure. */
for (const i of [1, 2, 3]) {
  has(i, 'Every voyage', `pane ${i} separates what is done every voyage`)
  has(i, 'On their own clock', `pane ${i} from what runs to an interval`)
  has(i, 'Only if it happened', `pane ${i} and from what depends on an event`)
}

/* IT NEVER SAYS SHE IS READY TO SAIL. */
for (const i of [1, 2, 3, 4]) {
  hasnt(i, 'ready to sail', `pane ${i} never says she is ready to sail`)
}
has(3, 'not a statement that the vessel is fit to sail',
    'and with nothing outstanding it says so in as many words')

/* A DRILL INSIDE ITS INTERVAL IS NOT OUTSTANDING. */
has(2, 'Every 30 days', 'the interval is stated, so the state can be argued with')
has(2, 'Musters, drills', 'the drill is listed')
has(2, '2 things are not done', 'and only the two real gaps are counted')

/* AN EVENT WITH NO ENTRY IS. */
has(2, 'with no entry', 'a bunkering with no Oil Record Book entry is called out')
has(2, 'Steering gear', 'and the quarterly steering test that has run out')

/* THE ABSENCE OF AN EVENT IS NOT A GAP. */
has(1, 'nothing to record', 'no oil moved and no rubbish ashore reads as nothing to record')

/* FRESH WATER AND PROVISIONS ARE ONE ENTRY. */
has(1, 'provisions and fresh water', 'provisions and water are one line')
has(1, 'the book treats them as one inspection', 'and it says why')

/* NO DEPARTURE, NO CHECK. */
has(4, 'No sailing to check against', 'with no departure it says so')
hasnt(4, 'Nothing outstanding', 'and never reads as an all-clear')

/* AND THE LINE THE CREW LIST SHOWS. */
has(5, 'Next before she sails', 'the crew list points at the next thing')
hasnt(5, 'Crew list</b>', 'and never at the thing just done')

console.log(out)
console.log(`  ${states.length + 1} states rendered`)
if (bad) { console.log(`  ${bad} PROBLEM${bad === 1 ? '' : 'S'}`); process.exit(1) }
console.log('  every state says what it has to')
