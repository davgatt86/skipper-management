/* Render the REAL stores order sheet and read it back.
 *
 * The page is behind a login, and the export is the whole point of the feature
 * — the supplier has no login, so a sheet that comes out wrong is a sheet
 * nobody can fill. This bundles nothing and mocks nothing: it calls
 * buildStoresDoc, writes the PDF, then extracts its text with pdf.js and
 * reports what actually landed on each page.
 *
 * buildStoresDoc exists split from exportStoresPdf for this reason. doc.save()
 * reaches for a browser and does nothing at all under node — which had me
 * re-reading a stale file off disk and believing a page-break fix that had
 * never run once.
 *
 *   node scripts/stores-preview.mjs [out.pdf]
 */
import { writeFileSync } from 'node:fs'
import { buildStoresDoc } from '../src/lib/stores/exportStores.js'
import { DEFAULT_ITEMS } from '../src/lib/stores/catalogue.js'

const out = process.argv[2] || 'stores-preview.pdf'

// A realistic trip order across enough categories to break a page.
const want = [
  ['BAKERS', 'Butteries', 10], ['BAKERS', 'White Loaf', 12],
  ['CHILL', 'Cheddar Cheese', 3], ['CHILL', 'Large Eggs', 6], ['CHILL', 'Lurpak Butter', 4],
  ['FRUIT', 'Apples', 6], ['FRUIT', 'Bananas', 6],
  ['VEGETABLES', 'Neeps', 3], ['VEGETABLES', 'Onions', 4], ['VEGETABLES', 'Potatoes 25 Kilo', 2],
  ['BUTCHERS', 'Bacon', 8], ['BUTCHERS', 'Beef Sausage', 6], ['BUTCHERS', 'Mince', 10],
  ['BUTCHERS', 'Whole Black Pudding', 2],
  ['FROZEN', 'Chips', 6], ['FROZEN', 'Peas', 4], ['FROZEN', 'Tattie Waffles', 3],
  ['CANSVEG', 'Baked Beans', 12],
  ['TEACOFFEE', 'Tea Bags', 4],
  ['CEREALS', 'Cornflakes', 3], ['CEREALS', 'Porridge Oats', 4],
  ['HOUSEHOLD', 'Black Bags', 4], ['HOUSEHOLD', 'Fairy Liquid', 3], ['HOUSEHOLD', 'Toilet Rolls', 12],
]
const byName = new Map(DEFAULT_ITEMS.map((i) => [`${i.category}|${i.name}`, i]))
const lines = []
for (const [cat, name, qty] of want) {
  const it = byName.get(`${cat}|${name}`)
  if (it) lines.push({ item_key: it.key, name: it.name, category: it.category, qty, unit: it.unit, note: '' })
}
// And one category long enough to straddle a break, which is the case that was
// silently wrong: page 2 opened on a bare line with no shelf name above it.
for (const i of DEFAULT_ITEMS.filter((i) => i.category === 'BAKING')) {
  lines.push({ item_key: i.key, name: i.name, category: i.category, qty: 1, unit: i.unit, note: '' })
}

const byKey = new Map(DEFAULT_ITEMS.map((i) => [i.key, i]))
const doc = buildStoresDoc({ title: 'Trip 65', starts_on: '2026-08-21', meals_for: 11 }, lines, byKey, 'en')
const bytes = new Uint8Array(doc.output('arraybuffer'))
writeFileSync(out, bytes)

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
const pdf = await pdfjs.getDocument({ data: bytes, useSystemFonts: true }).promise

console.log(`${lines.length} lines -> ${out}  (${pdf.numPages} pages)`)
let carried = 0
for (let p = 1; p <= pdf.numPages; p++) {
  const page = await pdf.getPage(p)
  const txt = (await page.getTextContent()).items.map((i) => i.str).join(' ')
  const cont = /\(continued\)/.test(txt)
  if (cont) carried++
  const first = txt.trim().split(/\s{2,}/).slice(0, 6).join(' · ')
  console.log(`  page ${p}${cont ? '  [carries a category over]' : ''}  ${first}`)
  // Every page must name the shelf its first line belongs to, or a picker in a
  // shop is holding a quantity with nothing to say what it is for.
  if (p > 1 && !cont && !/^[A-Z][A-Z ,]{2,}/.test(txt.trim())) {
    console.log(`  !! page ${p} opens with no category heading`)
    process.exitCode = 1
  }
}
console.log(carried ? `\n${carried} page(s) repeat a category as "(continued)" — the shelf is never lost.`
                    : '\nNo category straddled a break in this order.')
