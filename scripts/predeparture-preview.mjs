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
const { predeparture, nextAfterCrewList, resolveGuides } =
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
    /* ONE OF EACH STATE, so every word on the page is exercised: the drill is
       past her own WEEKLY cadence but inside the statutory month (a watch); the
       steering test is past the statutory quarter (a breach); the other two are
       inside both. */
    guides: resolveGuides({ 7: 7 }),
    olbEntries: [olb(7, '2026-08-31'), olb(17, '2026-09-04'), olb(18, '2026-08-20'), olb(21, '2026-05-01')],
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
    /* Garbage answered by SKIPPING it — nothing went ashore. An empty book is
       not proof of that on its own, which is why it has to be said. */
    skips: [{ departure_on: DEP, item_key: 'garbage', skipped_name: 'B Reid' }],
  })],

  /* EVERY VOYAGE, AND A MAN WHO WAS NOT ON THE LAST ONE. David: "it's good
     practice to do drills and tests every time a voyage starts esp when there
     has been a change in the crew." */
  ['Drills every voyage, and a new man aboard', predeparture({
    departureAt: DEP, previousDepartureAt: PREV, asOf: DEP,
    guides: resolveGuides({ 7: 'voyage' }),
    crewChange: { changed: true, joined: ['Edgel Bigno', 'Lorenzo Rusiana'], known: true },
    crewLists: [{ departure_date: DEP }],
    radioEntries: [{ kind: 'test', log_date: DEP }],
    olbEntries: [olb(7, PREV), olb(17, '2026-09-04'), olb(18, '2026-08-20'), olb(21, '2026-08-25')],
  })],

  /* A DRILL THAT DID NOT HAPPEN IS NOT NOTHING. SI 1981/570 entry 8 is the
     reason one was not held, so skipping it sends him to the Official Log Book
     rather than quietly closing the question. */
  ['A drill that did not happen — and where that gets written', predeparture({
    departureAt: DEP, previousDepartureAt: PREV, asOf: DEP,
    crewLists: [{ departure_date: DEP }],
    radioEntries: [{ kind: 'test', log_date: DEP }],
    olbEntries: [olb(17, '2026-09-05'), olb(18, '2026-09-05'), olb(21, '2026-09-05')],
    skips: [
      { departure_on: DEP, item_key: 'olb_drills', skipped_name: 'D Gatt',
        reason: 'Weather — alongside all day, crew ashore' },
      { departure_on: DEP, item_key: 'bunkering', skipped_name: 'D Gatt' },
      { departure_on: DEP, item_key: 'garbage', skipped_name: 'D Gatt' },
    ],
  })],

  /* NO DEPARTURE, NO CHECK. Saying nothing is outstanding here would read as an
     all-clear, which is worse than saying nothing at all. */
  ['No sailing on record', predeparture({})],
]

const partWay = states[1][1]

/* THE HANDLERS ARE PASSED because the real page passes them, and the buttons
   only exist when they are. Rendering without them checked a page nobody
   sees — and it is the "didn’t happen" button that the whole ask/skip model
   rests on. */
const handlers = { onSkip: () => {}, onUnskip: () => {}, onGuide: () => {} }

const html = states.map(([title, check]) =>
  `<h2 class="pv">${title}</h2>`
  + renderToStaticMarkup(React.createElement(MemoryRouter, null,
      React.createElement(Body, { vessel, check, departures: trips, ...handlers })))).join('\n')
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
  has(i, 'On a repeating interval', `pane ${i} from what runs to an interval`)
  has(i, 'Only if it happened', `pane ${i} and from what depends on an event`)
}

/* IT NEVER SAYS SHE IS READY TO SAIL. */
for (const i of [1, 2, 3, 4, 5, 6]) {
  hasnt(i, 'ready to sail', `pane ${i} never says she is ready to sail`)
}
has(3, 'not a statement that the vessel is fit to sail',
    'and with nothing outstanding it says so in as many words')
has(3, 'did not happen', 'a skipped item says so')
has(3, 'Marked as not happening this trip by B Reid', 'and who said it')

/* A DRILL INSIDE ITS INTERVAL IS NOT OUTSTANDING. */
/* THE NUMBER OF DAYS IS THE FACT, and the guide is what it is read against.
   Nothing is 'overdue': the regulation says WHAT to enter, not how often. */
has(2, 'days since', 'the days since are stated, which is the fact')
has(2, 'statutory', 'with the statutory interval beside it')
/* OVERDUE MEANS THE STATUTORY, and is a breach. Past her own shorter cadence
   while still inside the law is a different word. */
has(2, 'past her own', 'past her own cadence is worded apart from a breach')
has(2, '1 is past her own interval', 'and counted apart from the two not done')
has(2, 'Musters, drills', 'the drill is listed')
has(2, '3 things are not done', 'the radio checks, the bunkering entry and the statutory breach')

/* AN EVENT WITH NO ENTRY IS. */
has(2, 'with no entry', 'a bunkering with no Oil Record Book entry is called out')
has(2, 'Steering gear', 'the quarterly steering test is listed')
 

/* THE ABSENCE OF AN EVENT IS NOT A GAP. */
/* AN EMPTY BOOK IS NOT PROOF NOTHING HAPPENED — it means either that nothing
   did or that it was never written up, and those are opposite conclusions. */
has(1, 'did this happen?', 'an empty book asks rather than declaring an all-clear')
hasnt(1, 'nothing to record', 'and never assumes nothing happened')
has(1, 'didn’t happen', 'with a way to answer that it did not')

/* FRESH WATER AND PROVISIONS ARE ONE ENTRY. */
has(1, 'provisions and fresh water', 'provisions and water are one line')
has(1, 'the book treats them as one inspection', 'and it says why')

/* NO DEPARTURE, NO CHECK. */
has(4, 'every voyage', 'a per-voyage cadence is worded, not counted in days')
has(4, 'New aboard since the last voyage', 'a change of crew is given as its own reason')
has(4, 'Edgel Bigno', 'and it names the man rather than counting him')
has(4, 'past her own', 'a drill held last voyage is not this voyage’s')

/* A DRILL THAT DID NOT HAPPEN. The row says so, names who said it, gives the
   reason, and — because a drill is not merely nothing — points at the entry
   in the Official Log Book that records why it was not held. */
has(5, 'did not happen', 'a skipped drill says it did not happen')
has(5, 'Marked as not happening this trip by D Gatt', 'and who marked it')
has(5, 'Weather — alongside all day', 'and the reason he gave')
has(5, 'entry 8 records why a drill was not held', 'and it sends him to OLB entry 8')
has(5, 'undo', 'with a way back')
hasnt(5, 'still to answer', 'a skipped item is answered, not still asking')
has(5, 'Nothing outstanding', 'and an answered book reads as clear')
hasnt(5, 'didn’t happen', 'and an already-skipped row is not offered the skip again')

has(6, 'No sailing to check against', 'with no departure it says so')
hasnt(6, 'Nothing outstanding', 'and never reads as an all-clear')

/* AND THE LINE THE CREW LIST SHOWS. */
has(7, 'Next before she sails', 'the crew list points at the next thing')
hasnt(7, 'Crew list</b>', 'and never at the thing just done')

console.log(out)
console.log(`  ${states.length + 1} states rendered`)
if (bad) { console.log(`  ${bad} PROBLEM${bad === 1 ? '' : 'S'}`); process.exit(1) }
console.log('  every state says what it has to')
