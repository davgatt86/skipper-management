/* Render the REAL buyers' catalogue and read it back.
 *
 * The page is behind a login and a file picker, and this sheet goes into a
 * buyer's hand at the auction — so it is checked by building the actual
 * document and extracting its text, not by looking at the code.
 *
 *   node scripts/catalogue-preview.mjs [out.pdf]
 */
import { writeFileSync } from 'node:fs'
import { buildCatalogue } from '../src/lib/market/catalogue.js'
import { buildCatalogueDoc } from '../src/lib/market/exportCatalogue.js'
import { resolveRules } from '../src/lib/market/layoutRules.js'

const out = process.argv[2] || 'catalogue-preview.pdf'
const L = (species, grade, size, day, boxes, seq) =>
  ({ species, grade, size, boxKg: '30kg', day, boxes, seq })

// A realistic trip: several species, several grades, days 1–5.
const lines = [
  L('COD', 'XL (1a)', '12kg+', 5, 12, 12), L('COD', 'XL (1a)', '12kg+', 4, 8, 12),
  L('COD', 'XL (1a)', '12kg+', 3, 4, 12),
  L('COD', 'Large (1b)', '10-12kg', 5, 20, 13), L('COD', 'Large (1b)', '10-12kg', 4, 14, 13),
  L('COD', 'Sprag (2)', '4-7kg', 5, 30, 15), L('COD', 'Sprag (2)', '3', 3, 18, 15),
  L('HADDOCK', 'Med (3)', '0.4-0.6kg', 5, 60, 40), L('HADDOCK', 'Med (3)', '0.4-0.6kg', 4, 44, 40),
  L('HADDOCK', 'Med (3)', '0.4-0.6kg', 2, 22, 40),
  L('HADDOCK', 'Chipper (2b)', '0.6-1kg', 5, 38, 41),
  L('WHITING', 'Med', null, 5, 25, 50), L('WHITING', 'Med', null, 1, 9, 50),
  L('MONKS', 'Large', null, 4, 6, 70), L('MONKS', 'Med', null, 5, 11, 71),
  L('BLACK', 'Large', null, 5, 40, 60), L('BLACK', 'Sma (4a)', null, 3, 27, 61),
  L('HAKE', 'Large', null, 5, 9, 80), L('HAKE', 'Med', null, 2, 5, 81),
  L('MEGS', 'Large', null, 5, 7, 84),
]

const cat = buildCatalogue({ lines, rules: resolveRules(null) })
const doc = buildCatalogueDoc(cat, {
  vessel: 'AUDACIOUS BF83', port: 'PETERHEAD', saleDate: '2026-08-22',
})
const bytes = new Uint8Array(doc.output('arraybuffer'))
writeFileSync(out, bytes)

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
const pdf = await pdfjs.getDocument({ data: bytes, useSystemFonts: true }).promise
console.log(`${lines.length} tally lines · ${cat.totalBoxes} boxes · ${cat.speciesCount} species`)
console.log(`freshest day ${cat.freshestDay} -> ${out} (${pdf.numPages} pages)\n`)

let problems = 0
for (let p = 1; p <= pdf.numPages; p++) {
  const items = (await (await pdf.getPage(p)).getTextContent()).items.filter((i) => i.str.trim())
  const rows = new Map()
  for (const i of items) {
    const y = Math.round(i.transform[5] / 4) * 4
    if (!rows.has(y)) rows.set(y, [])
    rows.get(y).push([i.transform[4], i.str])
  }
  const ordered = [...rows.entries()].sort((a, b) => b[0] - a[0])
  for (const [, cells] of ordered) {
    console.log('  ' + cells.sort((a, b) => a[0] - b[0]).map((c) => c[1]).join(' | '))
  }
  console.log('')
  // Every page must carry the A+ rule: a buyer picking up page 3 has not read
  // page 1, and the sheet means nothing without it.
  const txt = items.map((i) => i.str).join(' ')
  if (!/sells as A\+/.test(txt)) { console.log(`  !! page ${p} does not state the A+ rule`); problems++ }
  if (!/CLOCK|NOT ON A CLOCK/.test(txt)) { console.log(`  !! page ${p} has no clock heading`); problems++ }
}
console.log(problems ? `${problems} PROBLEM(S)` : 'every page states the A+ rule and names its clock')
if (problems) process.exitCode = 1
