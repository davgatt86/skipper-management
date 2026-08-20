/* Render the BUTCHERS shape and read it back.
 *
 * David's three real butcher notes (25-07, 17-08 and one other) all run the
 * same way: breakfast, then cold meat, then meals for N. A flat alphabetical
 * list of 27 cuts is a different document to the one the butcher is used to
 * being handed, so this checks the sheet comes off in that order — and that
 * "MEALS FOR 11" carries the crew count rather than a typed number.
 *
 * It also checks the quantity notation. The same order has read
 * "bacon rashers 30x8", "x8 20 Bacon Rashers" and "pork sausages 16 x 5"
 * across three trips; here it is one shape, "30 packs × 8".
 *
 *   node scripts/stores-butchers.mjs [out.pdf] [lang]
 */
import { writeFileSync } from 'node:fs'
import { buildStoresDoc, sectionsOf, unitCell } from '../src/lib/stores/exportStores.js'
import { DEFAULT_ITEMS, resolveCatalogue } from '../src/lib/stores/catalogue.js'

const out = process.argv[2] || 'stores-butchers.pdf'
const lang = process.argv[3] || 'en'

const catalogue = resolveCatalogue([])
const byKey = new Map(catalogue.map((i) => [i.key, i]))
const byName = new Map(catalogue.map((i) => [`${i.category}|${i.name}`, i]))

// The August butcher note, as near as the catalogue carries it.
const want = [
  ['BUTCHERS', 'Bacon', 30, 8], ['BUTCHERS', 'Pork Sausage', 16, 5],
  ['BUTCHERS', 'Lorne Sausage', 12, 6], ['BUTCHERS', 'White Pudding', 6, null],
  ['BUTCHERS', 'Whole Black Pudding', 4, null],
  ['BUTCHERS', 'Boiled Ham', 3, null], ['BUTCHERS', 'Corned Beef', 2, null],
  ['BUTCHERS', 'Sliced Polony', 2, null], ['BUTCHERS', 'Roast Beef', 2, null],
  ['BUTCHERS', 'Mince', 10, null], ['BUTCHERS', 'Stewing Steak', 6, null],
  ['BUTCHERS', 'Whole Chicken', 4, null], ['BUTCHERS', 'Lamb Chops', 11, null],
  // A second category, to prove nothing else changed shape.
  ['CHILL', 'Cheddar Cheese', 3, null], ['CHILL', 'Large Eggs', 6, null],
  ['BAKERS', 'Softies', 30, null],
]
const lines = []
for (const [cat, name, qty, pack] of want) {
  const it = byName.get(`${cat}|${name}`)
  if (!it) { console.log('MISSING', cat, name); continue }
  lines.push({
    item_key: it.key, name: it.name, category: it.category, qty,
    unit: pack ? 'pack' : it.unit, pack_size: pack,
    section: it.section, note: '',
  })
}

// The shape, before it is drawn — this is what the sheet is built from.
const butchers = lines.filter((l) => l.category === 'BUTCHERS')
console.log('BUTCHERS runs:')
for (const [sec, items] of sectionsOf(butchers)) {
  console.log(`  ${sec || '(unfiled)'}: ${items.map((i) => i.name).join(', ')}`)
}
console.log('\nquantity notation:')
for (const l of butchers.filter((l) => l.pack_size)) {
  console.log(`  ${l.qty} ${unitCell(l, lang)}  ${l.name}   = ${l.qty * l.pack_size}`)
}
// Everything else must still come back as one unnamed run.
const chill = lines.filter((l) => l.category === 'CHILL')
console.log(`\nCHILL sections: ${sectionsOf(chill).length} (want 1, unnamed: ${sectionsOf(chill)[0][0] === null})`)

const doc = buildStoresDoc({ title: 'Trip 65', starts_on: '2026-08-21', meals_for: 11 },
  lines, byKey, lang)
const bytes = new Uint8Array(doc.output('arraybuffer'))
writeFileSync(out, bytes)

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
const pdf = await pdfjs.getDocument({ data: bytes, useSystemFonts: true }).promise
console.log(`\n${lines.length} lines -> ${out} (${pdf.numPages} pages)\n`)
for (let p = 1; p <= pdf.numPages; p++) {
  const items = (await (await pdf.getPage(p)).getTextContent()).items.filter((i) => i.str.trim())
  const rows = new Map()
  for (const i of items) {
    const y = Math.round(i.transform[5])
    if (!rows.has(y)) rows.set(y, [])
    rows.get(y).push([i.transform[4], i.str])
  }
  for (const [, cells] of [...rows.entries()].sort((a, b) => b[0] - a[0])) {
    console.log('  ' + cells.sort((a, b) => a[0] - b[0]).map((c) => c[1]).join(' | '))
  }
}

/* A butchers order pushed over a page break.
 *
 * This is where it went wrong, and only rendering showed it: `startedOn` was
 * captured once per CATEGORY, so every section's table compared itself to the
 * page the category opened on. "BUTCHERS (continued)" was stamped three times
 * on top of itself at the head of page 2, while COLD MEAT and MEALS — which
 * had started on that page perfectly naturally — both claimed to be carried
 * over. Only a run that genuinely began on an earlier page is a continuation.
 */
console.log('\n--- carried over a page break')
{
  const filler = DEFAULT_ITEMS.filter((i) => i.category === 'BAKING').slice(0, 30)
    .map((i, n) => ({ item_key: i.key, name: i.name, category: i.category, qty: n + 1, unit: i.unit }))
  const cuts = DEFAULT_ITEMS.filter((i) => i.category === 'BUTCHERS')
    .map((i, n) => ({ item_key: i.key, name: i.name, category: i.category, qty: n + 1,
                      unit: i.unit, section: i.section }))
  const doc2 = buildStoresDoc({ title: 'Straddle', starts_on: '2026-08-21', meals_for: 11 },
    [...filler, ...cuts], byKey, 'en')
  const b2 = new Uint8Array(doc2.output('arraybuffer'))
  const pdf2 = await pdfjs.getDocument({ data: b2, useSystemFonts: true }).promise
  let bad = 0
  for (let pg = 1; pg <= pdf2.numPages; pg++) {
    const txt = (await (await pdf2.getPage(pg)).getTextContent()).items.map((i) => i.str)
    const conts = txt.filter((t) => /\(continued\)/.test(t))
    if (conts.length) console.log(`  page ${pg}: ${conts.join(' ~ ')}`)
    // One continuation heading per page, at most. More than one means the same
    // label is being drawn on top of itself.
    if (conts.length > 1) { console.log(`  !! page ${pg} stamps ${conts.length} continuation headings`); bad++ }
    // And a carried run must name itself, not just its shelf.
    for (const c of conts) {
      if (/BUTCHERS \(continued\)/.test(c)) { console.log(`  !! page ${pg} does not name the run`); bad++ }
    }
  }
  console.log(bad === 0
    ? '  ok — one heading per carried page, and it names the run'
    : `  ${bad} PROBLEM(S)`)
  if (bad) process.exitCode = 1
}
