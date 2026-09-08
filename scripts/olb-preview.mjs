/* Render the Official Log Book and read the markup back.
 *
 *   node scripts/olb-preview.mjs [out.html]
 *
 * THE PAGE IS BEHIND A LOGIN, so the only way to see what it produces is to
 * bundle the real component and server-render it. A build passing proves
 * nothing: an undefined identifier is valid JavaScript, and this repo has now
 * shipped four of them past a clean build.
 *
 * EIGHT STATES:
 *   1  no book open
 *   2  a working book, with drills overdue and an entry missing its witness
 *   3  an entry amended by a further entry — BOTH must stay
 *   4  nothing outstanding
 *   5  closed and not yet delivered
 *   6  the mate's view — he writes it, he does not open or close it
 *   7  the mate with no book open — he cannot start one
 *   8  under 55 feet, where no book is required
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import esbuild from 'esbuild'
import { safeOut } from './safeOut.mjs'

const out = safeOut(process.argv[2] || 'olb-preview.html', '.html')

mkdirSync('node_modules/.cache', { recursive: true })
const bundle = join('node_modules/.cache', 'olb-preview.mjs')
await esbuild.build({
  entryPoints: ['src/pages/certification/OlbBody.jsx'],
  bundle: true, format: 'esm', outfile: bundle, platform: 'node',
  jsx: 'automatic', external: ['react', 'react-dom', 'react-dom/*', 'react/*'],
  logLevel: 'warning',
})
const OlbBody = (await import(pathToFileURL(bundle).href)).default
const { renderToStaticMarkup } = await import('react-dom/server')
const React = await import('react')
const { OLB_ENTRIES, IN_PERSON } = await import(pathToFileURL('src/lib/certification/olb.js').href)

const vessel = { label: 'AUDACIOUS BF83' }
const today = '2026-09-08'
const required = { required: true, metres: 29.8, feet: 97.8 }

const open = { id: 'b1', book_no: '4', opened_on: '2026-01-06', opened_place: 'Peterhead', closed_on: null }
const shut = { id: 'b0', book_no: '3', opened_on: '2025-01-07', opened_place: 'Peterhead',
               closed_on: '2026-01-05', closed_place: 'Peterhead', delivered_on: null }

const e = (o) => ({ book_id: 'b1', signed_name: 'D Gatt', signed_by_officer: false, ...o })
const working = [
  e({ id: 'e1', entry_n: 7, occurred_on: '2026-05-02', recorded_at: '2026-05-02T10:00:00Z',
      narrative: 'Abandon ship and fire drill, all hands', witness_name: 'B Reid' }),
  e({ id: 'e2', entry_n: 21, occurred_on: '2026-08-14', recorded_at: '2026-08-14T10:00:00Z',
      narrative: 'Emergency steering tested from the tiller flat', witness_name: 'N Wood' }),
  /* An entry the Schedule says needs a witness, made without one. */
  e({ id: 'e3', entry_n: 32, occurred_on: '2026-08-30', recorded_at: '2026-08-30T10:00:00Z',
      narrative: 'Deckhand cut hand on wire, dressed and logged', witness_name: null }),
  /* AND THE DELEGATION RULE BROKEN: entry 29 is one of the seven the skipper
     may not delegate, signed here by an authorised officer. */
  e({ id: 'e4', entry_n: 29, occurred_on: '2026-09-01', recorded_at: '2026-09-01T10:00:00Z',
      narrative: 'Loss of a person overboard, search commenced', witness_name: 'B Reid',
      signed_name: 'N Wood', signed_by_officer: true }),
]

const amended = [
  ...working,
  e({ id: 'e5', entry_n: 32, occurred_on: '2026-09-02', recorded_at: '2026-09-02T10:00:00Z',
      narrative: 'Amending the entry of 30-08: the injury was to the left hand, not the right',
      witness_name: 'B Reid', corrects_entry_id: 'e3' }),
]

/* Everything up to date and properly signed. */
const tidy = [7, 17, 18, 21].map((n, i) => e({
  id: `t${i}`, entry_n: n, occurred_on: '2026-09-01', recorded_at: '2026-09-01T10:00:00Z',
  narrative: 'Carried out and recorded', witness_name: 'B Reid',
}))

const panes = [
  ['No book open', { vessel, required, books: [], entries: [], canOpen: true, today }],
  ['A working book — drills overdue, an entry short of a witness',
   { vessel, required, books: [open], entries: working, canOpen: true, today }],
  ['An entry amended by a further entry — both stay',
   { vessel, required, books: [open], entries: amended, canOpen: true, today }],
  ['Nothing outstanding',
   { vessel, required, books: [open], entries: tidy, canOpen: true, today: '2026-09-08' }],
  ['Closed, and not yet delivered',
   { vessel, required, books: [{ ...shut, closed_on: '2026-09-01' }], entries: [], canOpen: true, today }],
  ['The mate writes it but does not open or close it',
   { vessel, required, books: [open], entries: working, canOpen: false, today }],
  /* THE MATE WITH NO BOOK OPEN. He opens the page, there is nothing to write
     in, and he cannot start one — so he has to be told why rather than shown
     a form that will refuse him. Only rendering it found this state missing. */
  ['The mate, with no book open',
   { vessel, required, books: [], entries: [], canOpen: false, today }],
  ['Under 55 feet — none required',
   { vessel: { label: 'A SMALLER BOAT' }, required: { required: false, metres: 16, feet: 52.5 },
     books: [], entries: [], canOpen: true, today }],
]

const html = panes.map(([title, props]) =>
  `<h2 style="font:600 15px system-ui;background:#0A1D26;color:#fff;padding:8px 12px;margin:28px 0 0">${title}</h2>`
  + renderToStaticMarkup(React.createElement(OlbBody, props))).join('\n')

writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>Official Log Book preview</title>
<style>
 body{font:14px/1.45 system-ui;margin:0;padding:0 16px 40px;background:#ECEFEE;color:#0A1D26}
 .card{background:#fff;border:1px solid #d7dcda;border-radius:6px;padding:12px 14px;margin:10px 0}
 .muted{color:#5d6b70} h3{font-size:0.95rem}
 button{cursor:pointer;border:1px solid #b9c2c0;background:#fff;border-radius:4px;padding:3px 8px}
 input,select{border:1px solid #b9c2c0;border-radius:4px;padding:3px 6px}
 :root{--kelp:#26654F;--rust:#C2342A;--brass:#A97614;--line:#d7dcda;--mute:#5d6b70;--hull:#1749A8}
</style>${html}`)

/* ---- read it back ------------------------------------------------------- */
const decode = (t) => t
  .replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
const out2 = html.split('<h2 ').slice(1).map(decode)
let bad = 0
const has = (i, s, why) => {
  if (out2[i - 1]?.includes(s)) console.log(`  ok    ${why}`)
  else { console.log(`  FAIL  ${why} — expected ${JSON.stringify(s)}`); bad++ }
}
const hasnt = (i, s, why) => {
  if (!out2[i - 1]?.includes(s)) console.log(`  ok    ${why}`)
  else { console.log(`  FAIL  ${why} — did not expect ${JSON.stringify(s)}`); bad++ }
}

/* THE STANDING WARNING IS ON EVERY STATE WHERE THE BOOK IS DRAWN. MGN 690
   covers the SOLAS V deck logbook only; there is no approved electronic
   official log book, and an app that let a skipper believe otherwise would
   stop him writing the one that actually gets delivered. */
for (const i of [1, 2, 3, 4, 5, 6, 7]) {
  has(i, 'The paper book is still the record', `pane ${i} says the paper book is the record`)
  has(i, 'MGN 690', `pane ${i} names the notice it is relying on`)
}

has(1, 'No book open', 'an empty state says so')
has(1, 'Entries 1, 2, 3 and 5', 'and what opening one records')
has(1, 'same number so the two agree', 'and to match the paper book number')
has(1, 'Open the book', 'and offers to open it')

has(2, 'Book 4', 'the open book is drawn')
/* THE RECURRING ENTRIES ARE THE ONLY ONES THAT CAN BE CHASED. A death cannot
   be predicted and a missing one is not evidence of anything. */
has(2, 'Musters, drills, safety training', 'an overdue drill is named')
has(2, '129 days', 'with how long it has been')
has(2, 'nothing recorded under this entry at all', 'and never-written-in says exactly that')
/* The entry dropdown legitimately lists all 33, so the check has to be on the
   OVERDUE rendering specifically — which is the only place an entry appears in
   bold. Asserting on the bare name failed here and the page was right; the
   assertion was wrong, the same way the firm-dropdown one was on the invoices
   preview. */
hasnt(2, '<b>9. Casualty', 'a one-off entry is never reported as overdue')
has(2, '<b>17. Inspection of crew accommodation', 'while every recurring one is')
/* AND THE REGULATION ITSELF PROVIDES FOR "IT DID NOT HAPPEN". */
has(2, 'entry 8', 'a missed drill points at the entry the Schedule provides for it')
has(2, 'Nothing has been filled in for it', 'and nothing is invented')

has(2, 'must be witnessed by a member of the crew', 'an entry short of its witness says so')
/* THE DELEGATION RULE — the book's distinctive one, and nothing else in the
   app has anything like it. */
has(2, 'must be signed by the skipper IN PERSON', 'and one of the seven signed by an officer is caught')
has(2, 'authorised officer', 'naming what was wrong with it')
has(2, 'Emergency steering tested', 'entries carry what actually happened')
/* NO EDIT AND NO DELETE ANYWHERE ON THIS PAGE. */
hasnt(2, 'Delete entry', 'nothing offers to delete an entry')
hasnt(2, 'Edit entry', 'and nothing offers to edit one')
has(2, 'cannot be edited or deleted afterwards', 'and the form says so before anything is written')

has(3, 'Amended by the entry of', 'an amended entry says so')
has(3, 'nothing in an official log book is erased', 'and why it is still there')
has(3, 'Made to amend an earlier entry', 'and the amendment says what it is')
has(3, 'the left hand, not the right', 'the correction carries its own words')
has(3, 'cut hand on wire', 'and the ORIGINAL is still in the book')

has(4, 'Every recurring entry is up to date', 'a tidy book says so')
hasnt(4, 'Outstanding', 'with nothing listed')

has(5, 'not yet delivered', 'a closed book says it has not gone')
has(5, 'within 48 hours', 'and by when it must')
has(5, 'Record delivery', 'and offers to record it')

has(6, 'Make an entry', 'but he still writes the book')
hasnt(6, 'Close the book', 'and is not offered the closing')
has(7, 'Only the skipper opens a book', 'with no book open he is told why he cannot start one')
hasnt(7, 'Open the book', 'and is not offered the button')

has(8, 'No official log book is required', 'a boat under 55 feet is told none is required')
has(8, '52.5 feet', 'and her length in the units the regulation uses')
has(8, 'may still be kept voluntarily', 'without being told she may not keep one')
hasnt(8, 'Make an entry', 'and no book is drawn')

console.log(out)
console.log(`  ${OLB_ENTRIES.length} prescribed entries · ${IN_PERSON.length} signed in person · ${panes.length} states rendered`)
if (bad) { console.log(`  ${bad} PROBLEM${bad === 1 ? '' : 'S'}`); process.exit(1) }
console.log('  every state says what it has to')
