/* Render the dashboard and read the markup back.
 *
 *   node scripts/dashboard-preview.mjs [out.html]
 *
 * THE INTERESTING STATES ARE THE EMPTY ONES. Six of the thirteen fleets on
 * this database have uploaded nothing at all, and until now they opened the
 * app on a blank page — so a preview that only rendered Audacious would prove
 * nothing about the customers who most need the page to work.
 *
 * FIVE STATES:
 *   1  a boat with everything — Audacious
 *   2  a boat with nothing — six of thirteen are here
 *   3  a boat part way — landings, no quota, no certificates
 *   4  by volume rather than by value, which changes the extras
 *   5  a board that has no prices for one of her species
 */
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import esbuild from 'esbuild'
import { safeOut } from './safeOut.mjs'

const out = safeOut(process.argv[2] || 'dashboard-preview.html', '.html')

mkdirSync('node_modules/.cache', { recursive: true })
const bundle = join('node_modules/.cache', 'dashboard-preview.mjs')
await esbuild.build({
  entryPoints: ['src/pages/DashboardBody.jsx'],
  bundle: true, format: 'esm', outfile: bundle, platform: 'node',
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react-dom/*', 'react/*', 'react-router-dom', 'react-router-dom/*'],
  logLevel: 'warning',
})
const DashboardBody = (await import(pathToFileURL(bundle).href)).default
const { renderToStaticMarkup } = await import('react-dom/server')
/* The body uses <Link>, which needs a router in context. Wrapped here rather
   than making the component take a Link prop: the thing worth rendering is the
   real component, not a version of it bent to suit the preview. */
const { MemoryRouter } = await import('react-router-dom')
const React = await import('react')
const { priceRows, landedThisYear, boatBlocks, toDo, dashboardSpecies } =
  await import(pathToFileURL('src/lib/dashboard.js').href)

/* A board shaped like the real one: cod A1-A5, haddock A1-A4, saithe A1-A4,
   plus the extras — and Pollack, which is what the board calls lythe. */
const days = ['2026-08-14', '2026-08-21', '2026-08-28', '2026-09-04', '2026-09-05', '2026-09-07']
const base = {
  Cod: { A1: 5.10, A2: 4.20, A3: 3.40, A4: 2.60, A5: 1.90 },
  Haddock: { A1: 4.90, A2: 3.05, A3: 2.40, A4: 1.65 },
  Saithe: { A1: 2.30, A2: 2.10, A3: 1.80, A4: 1.20 },
  Monkfish: { A1: 6.40, A2: 5.80, A3: 4.90 },
  Pollack: { A1: 2.40, A2: 2.05, A3: 1.70 },
  Ling: { A1: 2.90, A2: 2.40, A3: 1.90 },
  Whiting: { A2: 1.85, A3: 1.40, A4: 0.95 },
  Hake: { A1: 6.10, A2: 5.20, A3: 4.10 },
}
const prices = []
days.forEach((d, i) => {
  for (const [species, grades] of Object.entries(base)) {
    for (const [grade, p] of Object.entries(grades)) {
      /* The last day moves so the +/- columns have something real in them, and
         cod A3 is left exactly flat so "no change" can be told from "no
         price" — they are different facts and must not look alike. */
      const drift = i === days.length - 1
        ? (species === 'Haddock' ? -0.28 : species === 'Cod' && grade === 'A3' ? 0 : 0.31)
        : (i - 2) * 0.04
      prices.push({ price_date: d, species, grade, ave: round(p + drift),
                    low: round(p + drift - 0.2), high: round(p + drift + 0.3) })
    }
  }
})
/* One grade that simply did not sell on the last day. */
const gone = prices.findIndex((r) => r.price_date === '2026-09-07' && r.species === 'Saithe' && r.grade === 'A4')
prices[gone] = { ...prices[gone], ave: null, low: null, high: null }

const rows = [
  ...spread('Haddock', 3_000_000, 1_200_000), ...spread('Saithe', 1_400_000, 900_000),
  ...spread('Cod', 1_300_000, 250_000), ...spread('Monkfish', 700_000, 120_000),
  ...spread('Lythe', 300_000, 60_000), ...spread('Ling', 250_000, 180_000),
  ...spread('Whiting', 200_000, 170_000),
]
const landings = [
  { landing_date: '2026-09-01', vessel: 'AUDACIOUS BF83', value: 136_656, weight_kg: 44_805, boxes: 1192, reconcile_ok: true },
  { landing_date: '2026-09-04', vessel: 'AUDACIOUS BF83', value: 98_400, weight_kg: 31_200, boxes: 840, reconcile_ok: false },
  /* Last September: two trips inside the first eight days, one after — so the
     part-month cut has something to cut. */
  { landing_date: '2025-09-02', vessel: 'AUDACIOUS BF83', value: 121_000, weight_kg: 38_000, boxes: 1010, reconcile_ok: true },
  { landing_date: '2025-09-06', vessel: 'AUDACIOUS BF83', value: 104_500, weight_kg: 33_400, boxes: 890, reconcile_ok: true },
  { landing_date: '2025-09-10', vessel: 'AUDACIOUS BF83', value: 180_000, weight_kg: 52_000, boxes: 1400, reconcile_ok: true },
]
/* THE BOAT'S OWN STATEMENT of 23-04-2026 — all 45 lines that carry anything,
   with their real sections and their real floats, straight out of quota_lines.
   The six-line fixture this replaces had no `section` column at all, so it
   could not have exercised the zone matching, the "Blue Ling is not Ling" trap,
   the west-coast cod split across VIa and VIb, or the non-quota species — which
   is every place the bugs actually were. */
const quota = { snapshot: { last_landing_date: '2026-04-23' },
                lines: JSON.parse(readFileSync('scripts/fixtures/quota-statement.json', 'utf8')) }
const expiring = [
  { what: 'Inflatable Liferaft Service Certificate', who: 'LSA', expiry_date: '2026-08-20' },
  { what: 'ENG 1 medical', who: 'crew ticket', expiry_date: '2026-09-19' },
]

const today = '2026-09-08'
const landed = landedThisYear(rows, { year: 2026 })

function pane(title, { basis = 'value', landings: L = landings, quota: Q = quota,
                       expiring: E = expiring, landed: LD = landed, counts = {}, priceSet = prices } = {}) {
  const species = dashboardSpecies(LD, { basis })
  return [title, {
    vessel: { label: 'AUDACIOUS BF83' },
    board: priceRows(priceSet, species, { asOf: '2026-09-07' }),
    species, landed: LD, basis, source: 'PD',
    blocks: boatBlocks({ landings: L, quota: Q, expiring: E, asOf: today }),
    todo: toDo(counts), canSeeMoney: true,
  }]
}

const panes = [
  pane('A boat with everything — by value', { counts: { unreconciled: 1, unreadBundles: 2, expiredCount: 1 } }),
  /* SIX OF THIRTEEN FLEETS ARE THIS ONE. */
  pane('A boat with nothing at all', { landings: [], quota: null, expiring: [], landed: [] }),
  pane('Part way — landings, no quota, no certificates', { quota: null, expiring: [] }),
  pane('By volume — the extras change', { basis: 'volume' }),
  pane('A species the board does not carry', {
    priceSet: prices.filter((r) => r.species !== 'Pollack'),
  }),
]

const html = panes.map(([title, props]) =>
  `<h2 class="pv">${title}</h2>`
  + renderToStaticMarkup(React.createElement(MemoryRouter, null,
      React.createElement(DashboardBody, props)))).join('\n')

const appCss = readFileSync('src/index.css', 'utf8')
writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>Dashboard preview</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@400;600;700&family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;600&display=swap">
<style>${appCss}</style>
<style>
 /* Preview shell only — the app draws this page inside AppShell's main column. */
 body{margin:0;padding:0 20px 48px;background:var(--paper)}
 .wrap{max-width:1080px;margin:0 auto}
 h2.pv{font:600 14px var(--font-mono);letter-spacing:.08em;text-transform:uppercase;
       background:var(--ink);color:#fff;padding:9px 14px;margin:28px 0 0;border-radius:3px}
</style>
<div class="wrap">${html}</div>`)

const decode = (t) => t.replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
  .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
const p = html.split('<h2 ').slice(1).map(decode)
let bad = 0
const has = (i, s, why) => {
  if (p[i - 1]?.includes(s)) console.log(`  ok    ${why}`)
  else { console.log(`  FAIL  ${why} — expected ${JSON.stringify(s)}`); bad++ }
}
/* Some things must appear a set number of times, not merely appear. */
const times = (needle, paneIx, want, why) => {
  const found = (p[paneIx - 1] || '').split(needle).length - 1
  if (found === want) console.log('  ok    ' + why + ' (' + found + ')')
  else {
    console.log('  FAIL  ' + why + ' — found ' + found + ', expected ' + want)
    bad++
  }
}
const hasnt = (i, s, why) => {
  if (!p[i - 1]?.includes(s)) console.log(`  ok    ${why}`)
  else { console.log(`  FAIL  ${why} — did not expect ${JSON.stringify(s)}`); bad++ }
}

/* ---- THE MARKET IS ON EVERY STATE, including the empty boat ------------
   It needs no fleet data at all, which is the whole reason it is the top band. */
for (const i of [1, 2, 3, 4, 5]) {
  has(i, 'The market', `pane ${i} leads with the market`)
  has(i, 'Cod', `pane ${i} carries cod`)
  has(i, 'Haddock', `pane ${i} carries haddock`)
  has(i, 'Saithe', `pane ${i} carries saithe`)
  has(i, "on every boat's page", `pane ${i} says the pinned three are everyone's`)
}

has(1, '>yours<', "a boat's own species are chipped as hers")
has(1, 'Monkfish', 'and her fourth by value is there')
has(1, 'Lythe', 'as is her fifth — under the app name, not the board name')
has(1, 'Grade', 'the columns are labelled')
has(1, '4 wk', 'including the four-week column')
/* A TILE PER SPECIES, NOT ONE FULL-WIDTH TABLE. David: "visually it looks
   terrible". Four columns across a laptop put the grade name a foot from its
   price with nothing between. Six tiles in a grid; the labels sit an inch
   above their own figures, which is the only reason repeating them is right. */
times('<table', 1, 0, 'and there is no full-width table left')
times('class="sp"', 1, 6, 'six species tiles')
times('class="sp-cols"', 1, 6, 'each labelling its own columns, close to the figures')
has(1, 'against the four weeks to', 'with the comparisons explained once, at the foot')
/* THE TOGGLES WERE WHITE ON WHITE — a transparent button inheriting the global
   cobalt rule's white text. Both states are explicit now. */
has(1, 'class="seg"', 'the toggles are a proper segmented control')
hasnt(1, 'background: transparent', 'with no transparent button left to vanish')
/* NO CHANGE IS NOT NO PRICE. Cod A3 is deliberately flat. */
has(1, '0.00', 'a grade that did not move shows nought')
has(1, 'did not sell', 'and one that did not sell says so instead')

has(1, 'Last trip', 'her last trip is shown')
has(1, 'did not add up to its own printed total', 'and a note that did not reconcile says so')
has(1, 'This month', 'the month to date')
/* A PART MONTH IS NEVER COMPARED WITH A WHOLE ONE. On the live page this read
   "4 trips · -98%" against a boat that had simply not finished the month. */
has(1, 'To the 8th last year', 'against the same DAYS of the same month last year')
has(1, 'to the 8th', 'and the card says which days it is counting')
has(1, 'not the whole of it', 'saying plainly that the month is not finished')
has(1, 'Quota', 'and quota, for the one fleet that has it')
/* HIS ORDER, NOT THE STATEMENT'S. NS cod, WC cod, NS saithe, WC saithe,
   NS ling, WC ling — and the west-coast cod line is called "Cod Area VIa",
   with the zone only in the section column. */
const order = ['NS Cod', 'Cod Area VIa', 'NS Saithe', 'WC Saithe', 'NS Ling (UK)', 'WC Ling']
;(() => {
  const at = order.map((n) => p[0].indexOf('>' + n))
  if (at.some((i) => i < 0)) { console.log('  FAIL  all six named stocks appear — ' + JSON.stringify(order.filter((n, i) => at[i] < 0))); bad++ }
  else if (at.every((v, i) => i === 0 || v > at[i - 1])) console.log("  ok    the six he named, in his order")
  else { console.log('  FAIL  the six he named are out of order'); bad++ }
})()
/* RAW FLOATS WERE GOING STRAIGHT ONTO THE FRONT PAGE — "34.83933000000001" —
   and the one line that mattered, a stock 86.5 t OVER, looked exactly like the
   five that were fine. */
has(1, '86.5 t over', 'a stock over its allocation says so, in tonnes')
has(1, 'qr over', 'and is marked as over')
has(1, '% caught', 'each line says how much of its allocation is gone')
hasnt(1, '86.54504', 'and no raw float reaches the page')
hasnt(1, '731.0510899999999', 'nor any other')
/* BLUE LING IS NOT LING. Ranked on percentage it leads the whole statement at
   371%, on an allocation of 0.30 t. David: "it's not an issue as such." */
hasnt(1, '371% caught', 'a 371% overshoot on 0.3 t is not given a row')
has(1, 'WC Blue Ling 0.8 t', 'it is named at the foot with its real tonnage')
has(1, 'Over, but by under 2 t', 'under a heading saying what that line is')
/* NS Pollack is caught 8.24 t against a zero allocation, which is the biggest
   negative balance on the statement after saithe — and NOT an overshoot.
   David: "NS pollock, NS squid & NS cats are all non quota speices." */
hasnt(1, '8.2 t over', 'a non-quota species is never called over')
has(1, 'Caught with no allocation', 'it is reported for what it is')
has(1, 'NS Pollack 8.2 t', 'with its tonnage, so nothing is hidden')
has(1, 'Running out', 'what is expiring')
has(1, 'What to do next', 'and what is waiting on a decision')
has(1, 'certificate has expired', 'an expired certificate is called out')

/* ---- THE STATE SIX OF THIRTEEN FLEETS ARE IN --------------------------- */
has(2, 'Nothing of your own on here yet', 'a boat with no record is told so')
has(2, 'there whether you upload anything or not', 'and that the prices are hers regardless')
has(2, 'Drop a sales note in', 'with three things to do')
/* A BLOCK WITH NOTHING IN IT IS ABSENT, NOT EMPTY. A heading over no figure
   reads as broken rather than as not-applicable — which is what twelve of the
   thirteen fleets were getting from the quota block. */
hasnt(2, 'Last trip', 'and no empty last-trip heading')
hasnt(2, 'Quota', 'no empty quota heading')
hasnt(2, 'Running out', 'and nothing expiring')
/* Her extras are the measured fallback, and are NOT claimed as her own. */
has(2, 'chip guess', 'her extras are chipped as typical, not hers')
has(2, 'typical', 'and say so in words')
hasnt(2, '>yours<', 'with none claimed as hers')

has(3, 'Last trip', 'a part-way boat gets what she has')
hasnt(3, 'Quota', 'and not what she has not')
hasnt(3, 'Running out', 'nor certificates she has not filed')
hasnt(3, 'Nothing of your own on here yet', 'and is not treated as new')

/* THE TOGGLE ONLY CHANGES THE EXTRAS. The three stay pinned either way. */
has(4, 'Whiting', 'by volume, whiting comes into her six')
has(4, 'Saithe', 'and the pinned three are still pinned')

has(5, 'Not on this board', 'a species with no prices says so')
has(5, 'it calls it Pollack', 'and names what the board calls it')
times('Not on this board', 5, 1, 'and says it once, for the one species missing')

console.log(out)
console.log(`  ${panes.length} states rendered`)
if (bad) { console.log(`  ${bad} PROBLEM${bad === 1 ? '' : 'S'}`); process.exit(1) }
console.log('  every state says what it has to')

function round(n) { return Math.round(n * 100) / 100 }
function spread(species, value, weight) {
  return [{ landing_date: '2026-05-01', species_canon: species, value, weight_kg: weight }]
}
