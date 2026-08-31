/* THE TWO DOCUMENTS, RENDERED, AND THE LINE BETWEEN THEM CHECKED.
 *
 * David, Aug 2026: "it would be good if bond lines saved per crewman, so if
 * there's any disputes i can reopen a saved sheet and see exactly what each
 * crewman had ... the exportable sheet doesn't need this info though, just
 * myself as skipper. office only needs to see total £ per crewman + any carried
 * over balance."
 *
 * So there are two documents off one worksheet and they must differ in exactly
 * one way. The skipper's view carries the items; the office's sheet carries the
 * totals and must NOT carry the items. That is a boundary, and a boundary only
 * ever eyeballed is one that leaks — the chalk sheet and the buyers' catalogue
 * disagreed for exactly that reason until one function forced them together.
 *
 * Both are rendered off the SAME state, through the REAL save/load shaping, and
 * the PDF is read back with pdf.js rather than trusted.
 *
 * Usage: node scripts/kept-sheet-preview.mjs
 */
import { build } from 'esbuild'
import { rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(root, 'node_modules', '.cache', 'kept-sheet.cjs')

await build({
  entryPoints: [path.join(root, 'scripts', '_keptSheetEntry.jsx')],
  bundle: true, format: 'cjs', platform: 'node', outfile: OUT,
  jsx: 'automatic', logLevel: 'silent',
  external: ['react', 'react-dom', 'react-dom/server'],
})
const { render, pdf } = require(OUT)

let n = 0, bad = 0
const check = (cond, msg) => { n++; if (!cond) { bad++; console.error('  FAIL  ' + msg) } }

/* A trip shaped like a real one: two men with several items each, a stores
 * bond, a balance carried off the last trip, and one item nobody has been
 * charged for. Every state the two documents have to tell apart. */
const state = {
  tripDate: '2026-08-13', tripNo: '64', market: 'Peterhead',
  daysAtSea: '6.75', boxesLanded: '1192', landings: '2', quota: '10',
  crew: [
    { id: 'c1', name: 'David Gatt', shareKey: 'full', shareCustom: '', bonus: '3', role: 'skipper', roleLandings: [] },
    { id: 'c2', name: 'Norman Wood', shareKey: 'full', shareCustom: '', bonus: '0.25', role: 'engineer', roleLandings: [1] },
    { id: 'c3', name: 'Andrew Smith', shareKey: '6_8', shareCustom: '', bonus: '' },
  ],
  bondItems: [
    { id: 'b1', description: 'Regal Blue KS 200s (TOBRKS)', qty: 4, unitPrice: 37, amount: 148, assignedTo: 'c1', source: '60N Bond Ltd · SI-390' },
    { id: 'b2', description: 'Aberfeldy Madeira 12YO 40% (WHIABER)', qty: 1, unitPrice: 30, amount: 30, assignedTo: 'c1', source: '60N Bond Ltd · SI-390' },
    { id: 'b3', description: 'Barefoot Pinot Grigio 11.5% 75cl (WINBFPG)', qty: 2, unitPrice: 33, amount: 66, assignedTo: 'c2', source: '60N Bond Ltd · SI-390' },
    { id: 'b4', description: 'Galley sundries', qty: 1, unitPrice: 60, amount: 60, assignedTo: 'stores', source: null },
    { id: 'b5', description: 'LM Blue 200s (TOBLMB)', qty: 1, unitPrice: 22, amount: 22, assignedTo: null, carried: true, source: '60N Bond Ltd · SI-377' },
    { id: 'b6', description: 'Tanqueray Gin (GINTAN)', qty: 1, unitPrice: 17.5, amount: 17.5, assignedTo: null, source: '60N Bond Ltd · SI-390' },
  ],
  fuel: [], labour: [], haulage: [], haulageNote: '', foreignCrew: [],
}

const w = { id: 'ws-1', landed_date: '2026-08-13', crewCount: 3, bondTotal: 343.5, unassignedBond: 39.5 }

// ---- THE SKIPPER'S VIEW ---------------------------------------------------
const v = render(state, w)
console.log('\n--- WHAT THE SKIPPER SEES ---')
console.log(v.text.slice(0, 760))

check(/David Gatt/.test(v.text) && /Norman Wood/.test(v.text), 'both men with bond are named')
check(/Regal Blue KS 200s/.test(v.text), 'the baccy is itemised — the whole reason the view exists')
check(/Aberfeldy/.test(v.text), 'and the second item too, not just a total')
check(/£148/.test(v.text) && /£30/.test(v.text), 'each item carries its own money')
check(/£178/.test(v.text), 'and the total is the sum of them')
check(/Barefoot Pinot Grigio/.test(v.text), 'the wine is against Norman')
check(/× 4/.test(v.text), 'quantities show — four hundreds of baccy is not one')
check(/SI-390/.test(v.text), 'and the invoice it came off, which is what a dispute gets checked against')

/* THE BLOCKS ARE IN ORDER, man by man: David's items must all fall between his
 * name and Norman's, or the view answers the question wrongly. */
const dv = v.text.indexOf('David Gatt'), nv = v.text.indexOf('Norman Wood')
check(v.text.indexOf('Regal Blue') > dv && v.text.indexOf('Regal Blue') < nv,
      'the baccy sits under David and above Norman')
check(v.text.indexOf('Barefoot') > nv, 'and the wine under Norman, not under David')

check(/Stores.*boat pays/.test(v.text), 'the stores bond is shown and named')
check(/Carried over.*not yet charged/.test(v.text), 'a carried balance says it is not yet charged')
check(/LM Blue 200s/.test(v.text), 'and is itemised like everything else')
check(/SI-377/.test(v.text), 'still carrying the invoice it originally came off')
check(/Unassigned.*nobody charged/.test(v.text), 'this trip\'s unassigned item is a question, separately')
check(/Tanqueray/.test(v.text), 'named, so it can be dealt with')

check(/Bond on this sheet.*£343.50/.test(v.text), 'the sheet totals to everything on it')
check(/nothing here touches the form/.test(v.text),
      'IT SAYS IT IS READ-ONLY — Open destroys the working copy and this must not read like Open')
check(/Trip 64/.test(v.text) && /Peterhead/.test(v.text), 'the trip is identified')
check(/2 landings/.test(v.text), 'including how many landings, which the bonuses divide by')

/* A SHEET KEPT BEFORE THE ITEMS WERE STORED must not read as a trip with no
 * bond on it. That is a claim about the trip; the truth is about the record. */
const old = render({ ...state, bondItems: [] }, { ...w, unassignedBond: null })
console.log('\n--- A SHEET KEPT BEFORE THE ITEMS WERE STORED ---')
console.log(old.text.slice(0, 320))
check(/kept before the bond items were stored/.test(old.text),
      'it says the RECORD is empty, not that the trip had no bond')
check(!/No bond on this trip/.test(old.text), 'and never claims the trip had none')

const none = render({ ...state, bondItems: [] }, { ...w, unassignedBond: 0 })
check(/No bond on this trip/.test(none.text),
      'while a sheet that really had none says so plainly')

// ---- THE OFFICE'S SHEET ---------------------------------------------------
const doc = pdf(state)
const bytes = new Uint8Array(doc.output('arraybuffer'))

const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
const pdfDoc = await getDocument({ data: bytes, useSystemFonts: true }).promise
let text = ''
for (let p = 1; p <= pdfDoc.numPages; p++) {
  const tc = await (await pdfDoc.getPage(p)).getTextContent()
  text += ' ' + tc.items.map((i) => i.str).join(' ')
}
text = text.replace(/\s+/g, ' ').trim()

console.log('\n--- WHAT THE OFFICE GETS ---')
console.log(text)

check(/David Gatt £178/.test(text), 'the office gets each man\'s bond TOTAL')
check(/Norman Wood £66/.test(text), 'for every man who had any')
check(/Carried over/.test(text) && /£22/.test(text),
      'AND THE CARRIED-OVER BALANCE — his one addition to what the office sees')
check(/not yet charged/.test(text), 'said plainly, so it is not mistaken for this trip\'s')
check(/Stores/.test(text), 'the stores bond as before')
check(/Unassigned \(review\)/.test(text), 'and an unassigned item still flagged for review')

/* THE BOUNDARY. Not one item description may reach the office's sheet. */
for (const item of ['Regal Blue', 'Aberfeldy', 'Barefoot', 'Pinot Grigio', 'Tanqueray',
                    'LM Blue', 'TOBRKS', 'WHIABER', 'WINBFPG', 'SI-390', 'SI-377']) {
  check(!text.includes(item),
        'THE OFFICE MUST NOT SEE "' + item + '" — what a man had is the skipper\'s record')
}

await rm(OUT, { force: true })
console.log('\n' + (bad ? bad + ' of ' + n + ' checks FAILED' : n + ' checks passed'))
process.exit(bad ? 1 : 0)
