/* Render the Oil Record Book and read the markup back.
 *
 *   node scripts/orb-preview.mjs [out.html]
 *
 * THE PAGE IS BEHIND A LOGIN AND A FLEET, so the only way to see what it
 * produces is to bundle the real component and server-render it. A build
 * passing proves nothing: an undefined identifier is valid JavaScript, and
 * this repo has already shipped a commit where two pages called a function
 * they never imported.
 *
 * SEVEN STATES, because the wrong ones are the ones that ship broken:
 *   1  an empty book — nothing opened yet
 *   2  a working book with a page open, a page awaiting the master, and gaps
 *   3  a corrected entry, where BOTH must be visible
 *   4  everything signed off and nothing outstanding
 *   5  the mate's view — he keeps the book and cannot sign a page
 *   6  a boat under 400 GT, where no book is required
 *   7  a boat with no tonnage on file, where that is UNKNOWN and not "no"
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import esbuild from 'esbuild'
import { safeOut } from './safeOut.mjs'

const out = safeOut(process.argv[2] || 'orb-preview.html', '.html')

/* Bundled to a FILE, not a data: URL — node resolves a data URL's bare
   specifiers against nothing, so "react" cannot be found from one. */
mkdirSync('node_modules/.cache', { recursive: true })
const bundle = join('node_modules/.cache', 'orb-preview.mjs')
await esbuild.build({
  entryPoints: ['src/pages/certification/OrbBody.jsx'],
  bundle: true, format: 'esm', outfile: bundle, platform: 'node',
  jsx: 'automatic', external: ['react', 'react-dom', 'react-dom/*', 'react/*'],
  logLevel: 'warning',
})
const OrbBody = (await import(pathToFileURL(bundle).href)).default
const { renderToStaticMarkup } = await import('react-dom/server')
const React = await import('react')
const { allEntries, CODES } = await import(pathToFileURL('src/lib/certification/orb.js').href)

const vessel = { label: 'AUDACIOUS BF83' }
const today = '2026-09-07'
const required = { required: true, gt: 498 }

/* A book shaped like a real one rather than a happy path: one signed page,
   one closed and waiting on the master, one open. */
const pages = [
  { id: 'p1', page_no: 40, closed_at: '2026-07-30T10:00:00Z', master_signed_at: '2026-07-31T08:00:00Z', master_signed_name: 'David Gatt' },
  { id: 'p2', page_no: 41, closed_at: '2026-08-28T10:00:00Z', master_signed_at: null },
  { id: 'p3', page_no: 42, closed_at: null, master_signed_at: null },
]

const e = (o) => ({ officer_name: 'D Henderson', ...o })
const entries = [
  e({ id: 'e1', page_id: 'p1', entry_date: '2026-07-06', recorded_at: '2026-07-06T09:00:00Z', code: 'C', item_n: '11.3', quantity: 2.1, unit: 'm3', tank: 'Sludge tank' }),
  e({ id: 'e2', page_id: 'p1', entry_date: '2026-07-13', recorded_at: '2026-07-13T09:00:00Z', code: 'C', item_n: '11.3', quantity: 2.6, unit: 'm3', tank: 'Sludge tank' }),
  e({ id: 'e3', page_id: 'p2', entry_date: '2026-08-03', recorded_at: '2026-08-03T09:00:00Z', code: 'H', item_n: '26.3', quantity: 38000, unit: 'litres', tank: 'No. 2 DB', port: 'Peterhead', officer_name: 'N Wood' }),
  e({ id: 'e4', page_id: 'p2', entry_date: '2026-08-24', recorded_at: '2026-08-24T09:00:00Z', code: 'C', item_n: '12.1', quantity: 4.0, unit: 'm3', port: 'Peterhead', narrative: 'Landed ashore to licensed contractor' }),
  e({ id: 'e5', page_id: 'p3', entry_date: '2026-09-07', recorded_at: '2026-09-07T09:00:00Z', code: 'I', item_n: null, narrative: 'Overboard valve sealed shut, seal no. 4471' }),
]

/* A CORRECTED ENTRY, and the whole point is that BOTH are still here. */
const corrected = [
  ...entries,
  e({ id: 'e6', page_id: 'p3', entry_date: '2026-09-07', recorded_at: '2026-09-07T11:00:00Z', code: 'C', item_n: '11.3', quantity: 3.4, unit: 'm3', tank: 'Sludge tank', corrects_entry_id: 'e2', narrative: 'Retention on 13-07 read 3.4, not 2.6' }),
]

/* Everything settled: one signed page, weekly readings unbroken. */
const tidyPages = [{ id: 'q1', page_no: 40, closed_at: '2026-08-31T10:00:00Z', master_signed_at: '2026-08-31T12:00:00Z', master_signed_name: 'David Gatt' }]
const tidyEntries = ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31']
  .map((d, i) => e({ id: `q${i}`, page_id: 'q1', entry_date: d, recorded_at: `${d}T09:00:00Z`, code: 'C', item_n: '11.3', quantity: 2 + i * 0.2, unit: 'm3', tank: 'Sludge tank' }))

/* THE FUEL LOG SIDE. Shaped like `vessel_fuel_log` — the same four kinds the
   page carries — with one movement already in the book, so the panel has both
   a gap and a thing that is not a gap to tell apart. */
const fuelRows = [
  { id: 'fl1', kind: 'fuel', entry_date: '2026-08-14', litres: 18400, grade: 'MGO',
    location: 'Peterhead', counterparty: 'John A Smith & Sons', vessel_id: vessel.id },
  { id: 'fl2', kind: 'lube_oil', entry_date: '2026-08-14', litres: 400, grade: 'Meropa 150',
    location: 'Peterhead', counterparty: 'John A Smith & Sons', vessel_id: vessel.id },
  { id: 'fl3', kind: 'dirty_oil', entry_date: '2026-08-20', litres: 1200,
    location: 'Peterhead', counterparty: 'Reception facility', vessel_id: vessel.id },
  /* Not an oil movement the book wants — it must not appear as a gap. */
  { id: 'fl4', kind: 'consumption', entry_date: '2026-08-21', litres: 5800, vessel_id: vessel.id },
]

/* fl1 is already in the book; the other two are not. */
const entriesWithLink = entries.concat([{
  id: 'linked-1', page_id: pages[0].id, entry_date: '2026-08-14', code: 'H', item_n: '26.3',
  /* As the draft makes it: the book is kept in cubic metres and the receipt
     figure rides in the narrative. */
  quantity: 18.4, unit: 'm3', port: 'Peterhead', tank: 'No.2 DB',
  narrative: 'Bunkering of fuel oil. grade MGO. 18,400 L as bunkered. Raised from the fuel log.',
  officer_name: 'N Wood', recorded_at: '2026-08-14T10:00:00Z', fuel_log_id: 'fl1',
}])

const panes = [
  ['An empty book', { vessel, required, pages: [], entries: [], canSign: true, today }],
  ['A working book — a page open, a page awaiting the master', { vessel, required, pages, entries, canSign: true, today }],
  ['A corrected entry — both stay', { vessel, required, pages, entries: corrected, canSign: true, today }],
  ['Nothing outstanding', { vessel, required, pages: tidyPages, entries: tidyEntries, canSign: true, today: '2026-09-01' }],
  ['The mate keeps it and cannot sign', { vessel, required, pages, entries, canSign: false, today }],
  ['Under 400 GT — none required', { vessel: { label: 'A SMALLER BOAT PD100' }, required: { required: false, gt: 320 }, pages: [], entries: [], canSign: true, today }],
  ['No tonnage on file — unknown, not "no"', { vessel: { label: 'A THIRD BOAT' }, required: { required: null, why: 'no gross tonnage on file' }, pages: [], entries: [], canSign: true, today }],
  ['The fuel log against the book — two movements with no entry',
   { vessel, required, pages, entries: entriesWithLink, canSign: true, today,
     fuelRows, onAddEntry: () => {} }],
  ['Nothing outstanding against the fuel log',
   { vessel, required, pages, entries: entriesWithLink, canSign: true, today,
     fuelRows: fuelRows.filter((r) => r.id === 'fl1' || r.kind === 'consumption'), onAddEntry: () => {} }],
]

const html = panes.map(([title, props]) =>
  `<h2 style="font:600 15px system-ui;background:#0A1D26;color:#fff;padding:8px 12px;margin:28px 0 0">${title}</h2>`
  + renderToStaticMarkup(React.createElement(OrbBody, props))).join('\n')

writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>Oil Record Book preview</title>
<style>
 body{font:14px/1.45 system-ui;margin:0;padding:0 16px 40px;background:#ECEFEE;color:#0A1D26}
 .card{background:#fff;border:1px solid #d7dcda;border-radius:6px;padding:12px 14px;margin:10px 0}
 .muted{color:#5d6b70} h3{font-size:0.95rem}
 button{cursor:pointer;border:1px solid #b9c2c0;background:#fff;border-radius:4px;padding:3px 8px}
 input,select{border:1px solid #b9c2c0;border-radius:4px;padding:3px 6px}
 :root{--kelp:#26654F;--rust:#C2342A;--brass:#A97614;--line:#d7dcda;--mute:#5d6b70}
</style>${html}`)

/* ---- read it back ------------------------------------------------------- */
const decode = (t) => t
  .replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
const panesOut = html.split('<h2 ').slice(1).map(decode)
let bad = 0
const has = (i, s, why) => {
  if (panesOut[i - 1]?.includes(s)) console.log(`  ok    ${why}`)
  else { console.log(`  FAIL  ${why} — expected ${JSON.stringify(s)}`); bad++ }
}
const hasnt = (i, s, why) => {
  if (!panesOut[i - 1]?.includes(s)) console.log(`  ok    ${why}`)
  else { console.log(`  FAIL  ${why} — did not expect ${JSON.stringify(s)}`); bad++ }
}

/* THE STANDING WARNING IS ON EVERY BOOK THAT EXISTS. An app that quietly let
   a skipper believe this was the approved record would be worse than one that
   had never offered it: he would stop writing the paper book. */
for (const i of [1, 2, 3, 4, 5]) {
  has(i, 'The paper book is still the record', `pane ${i} says the paper book is still the record`)
  has(i, 'MEPC.312(74)', `pane ${i} names the guidelines approval would be against`)
}

has(1, 'No page open', 'an empty book says so')
has(1, 'Open page 1', 'and offers to open the first')
has(1, 'rather than at 1', 'and says to start at the number the paper book has reached')
/* The label stays and its value is an em dash, the same as Pages and Entries
   beside it — that is the row saying it has none. What must NOT appear is the
   sentence explaining a retention basis, because there is nothing to retain
   from and a stated basis reads as a stated date. */
hasnt(1, 'three years after the last entry', 'an empty book claims no retention basis')
hasnt(1, 'weeks with no sludge reading', 'and nothing is outstanding on an unopened book')

has(2, 'Page 42', 'the open page is drawn')
has(2, 'awaiting the master', 'and a closed page says what it is waiting for')
has(2, 'not signed by the master', 'which is listed as outstanding')
has(2, 'no. 41, 42', 'naming the pages, not counting them')
/* CODE (C) ITEM 11.3 IS THE WEEKLY ONE, and a gap in it is the first thing a
   port state inspector counts. It must be reported and never filled in. */
has(2, 'weeks with no sludge reading', 'the weekly gaps are reported')
has(2, 'must not appear in this book', 'and it says nothing was filled in for them')
has(2, '07-09-2026', 'entries carry their date')
has(2, '(C) 11.3', 'and their code and item, the way the book is read')
has(2, '(I)', 'a remarks entry carries the code alone')
has(2, 'D Henderson', 'the officer in charge is named against the entry')
has(2, 'N Wood', 'and it is per entry, not per page')
has(2, 'Make an entry on page 42', 'entries are offered on the open page')
has(2, 'cannot be edited or deleted', 'and the form says so before anything is written')
/* NO EDIT AND NO DELETE ANYWHERE. If either word ever appears as a button on
   this page, the book has stopped being a record book. */
hasnt(2, 'Delete entry', 'nothing offers to delete an entry')
hasnt(2, 'Edit entry', 'and nothing offers to edit one')

has(3, 'Superseded by the entry of', 'a corrected entry says it was superseded')
has(3, 'nothing in an oil record book is erased', 'and says why it is still there')
has(3, 'Made to correct an earlier entry', 'and the correction says what it is')
has(3, 'Retention on 13-07 read 3.4', 'the correction carries its own reading')
has(3, '2.6 m³ (2,600 L)', 'and the original figure is STILL in the book')

has(4, 'Every completed page signed by the master', 'a tidy book says so')
has(4, 'no week without a sludge reading', 'and that the weekly reading is unbroken')
has(4, 'signed 31-08-2026 by David Gatt', 'a signed page names who signed it and when')
has(4, '31-08-2029', 'and the book is kept three years after its last entry')
hasnt(4, 'Outstanding', 'with nothing outstanding, nothing is listed')

has(5, 'Only the master signs a page', 'the mate is told he cannot sign')
has(5, 'Only the skipper can sign one', 'and the outstanding list says who can')
has(5, 'Make an entry on page 42', 'but he still keeps the book')

has(6, 'No Oil Record Book Part I is required', 'a boat under 400 GT is told none is required')
has(6, '320 GT', 'and her measured tonnage')
has(6, 'may still be kept voluntarily', 'without being told she may not keep one')
hasnt(6, 'Make an entry', 'and no book is drawn')

/* UNKNOWN AND NOT-REQUIRED MUST NOT READ ALIKE. `null` is not `false`. */
has(7, 'The paper book is still the record', 'an unknown tonnage still gets the standing warning')
has(7, 'cannot be worked out', 'and is told the question is open')
has(7, '400 GT is the line', 'and what would settle it')
hasnt(7, 'No Oil Record Book Part I is required', 'it never says none is required')

console.log(out)
console.log(`  ${CODES.length} codes · ${allEntries().length} prescribed items · ${panes.length} states rendered`)
if (bad) { console.log(`  ${bad} PROBLEM${bad === 1 ? '' : 'S'}`); process.exit(1) }
console.log('  every state says what it has to')
