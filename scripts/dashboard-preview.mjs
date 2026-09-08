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
import { writeFileSync, mkdirSync } from 'node:fs'
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
  { landing_date: '2025-09-10', vessel: 'AUDACIOUS BF83', value: 180_000, weight_kg: 52_000, boxes: 1400, reconcile_ok: true },
]
const quota = { snapshot: { last_landing_date: '2026-08-26' },
                lines: [{ stock: 'Cod North Sea', remaining: '41 t' }, { stock: 'Haddock North Sea', remaining: '212 t' }] }
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
  `<h2 style="font:600 15px system-ui;background:#0A1D26;color:#fff;padding:8px 12px;margin:28px 0 0">${title}</h2>`
  + renderToStaticMarkup(React.createElement(MemoryRouter, null,
      React.createElement(DashboardBody, props)))).join('\n')

writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>Dashboard preview</title>
<style>
 body{font:14px/1.45 system-ui;margin:0;padding:0 16px 40px;background:#ECEFEE;color:#0A1D26}
 .card{background:#fff;border:1px solid #d7dcda;border-radius:6px;padding:12px 14px;margin:10px 0}
 .muted{color:#5d6b70} h3{font-size:0.95rem} a{color:#1749A8}
 :root{--kelp:#26654F;--rust:#C2342A;--brass:#A97614;--line:#d7dcda;--mute:#5d6b70;--hull:#1749A8}
</style>${html}`)

const decode = (t) => t.replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
  .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
const p = html.split('<h2 ').slice(1).map(decode)
let bad = 0
const has = (i, s, why) => {
  if (p[i - 1]?.includes(s)) console.log(`  ok    ${why}`)
  else { console.log(`  FAIL  ${why} — expected ${JSON.stringify(s)}`); bad++ }
}
/* Some things must appear a set number of times, not merely appear. */
const ok1 = (needle, paneIx, why) => {
  const inPane = p[paneIx - 1] || ''
  /* One species block per label, and the labels appear once per block. */
  const species = (inPane.match(/watched by everyone|one of yours|most boats land/g) || []).length
  const found = inPane.split(needle).length - 1
  if (found === species) console.log('  ok    ' + why + ' (' + found + ' of ' + species + ')')
  else {
    console.log('  FAIL  ' + why + ' — found ' + found + ', expected ' + species + ' (one per species)')
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
  has(i, 'watched by everyone', `pane ${i} marks the pinned three as everyone's`)
}

has(1, 'one of yours', "a boat's own species are marked as hers")
has(1, 'Monkfish', 'and her fourth by value is there')
has(1, 'Lythe', 'as is her fifth — under the app name, not the board name')
has(1, 'On the day', 'the two comparison columns are labelled')
/* ONCE, not on every row. The labels used to repeat on all seventeen rows of
   the pinned three, which only showed up on rendering it. */
ok1('On the day', 1, 'and labelled exactly once per species table')
has(1, 'day average', 'including how many days the average rests on')
/* NO CHANGE IS NOT NO PRICE. Cod A3 is deliberately flat. */
has(1, '0.00', 'a grade that did not move shows nought')
has(1, 'did not sell', 'and one that did not sell says so instead')

has(1, 'Last trip', 'her last trip is shown')
has(1, 'did not add up to its own printed total', 'and a note that did not reconcile says so')
has(1, 'This month', 'the month to date')
has(1, 'Same month last year', 'against the same month last year, not last month')
has(1, 'Quota', 'and quota, for the one fleet that has it')
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
has(2, 'what most boats land', 'her extras say they are typical, not hers')
hasnt(2, 'one of yours', 'and none is claimed as hers')

has(3, 'Last trip', 'a part-way boat gets what she has')
hasnt(3, 'Quota', 'and not what she has not')
hasnt(3, 'Running out', 'nor certificates she has not filed')
hasnt(3, 'Nothing of your own on here yet', 'and is not treated as new')

/* THE TOGGLE ONLY CHANGES THE EXTRAS. The three stay pinned either way. */
has(4, 'Whiting', 'by volume, whiting comes into her six')
has(4, 'watched by everyone', 'and the pinned three are still pinned')

has(5, 'Not on this board', 'a species with no prices says so')
has(5, 'it calls it Pollack', 'and names what the board calls it')
hasnt(5, 'Lythe</b></div><table', 'rather than drawing an empty table')

console.log(out)
console.log(`  ${panes.length} states rendered`)
if (bad) { console.log(`  ${bad} PROBLEM${bad === 1 ? '' : 'S'}`); process.exit(1) }
console.log('  every state says what it has to')

function round(n) { return Math.round(n * 100) / 100 }
function spread(species, value, weight) {
  return [{ landing_date: '2026-05-01', species_canon: species, value, weight_kg: weight }]
}
