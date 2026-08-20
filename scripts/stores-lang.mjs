/* Render the order sheet in a supplier's language and read it back.
 *
 * The point of checking rather than assuming: every translated word on this
 * sheet has to have its English beside it. That is the rule the whole feature
 * rests on — a word of mine being wrong must cost the shop nothing — and it is
 * only provable by reading the rendered page.
 *
 *   node scripts/stores-lang.mjs da [out.pdf]
 */
import { writeFileSync } from 'node:fs'
import { buildStoresDoc } from '../src/lib/stores/exportStores.js'
import { DEFAULT_ITEMS, resolveCatalogue } from '../src/lib/stores/catalogue.js'

const lang = process.argv[2] || 'da'
const out = process.argv[3] || `stores-${lang}.pdf`

// A few translated, most not — which is the real state of a boat that has just
// started filling them in, and the case the sheet has to be honest about.
const overrides = [
  { item_key: 'CHILL:large-eggs', name_da: 'Store æg', name_no: 'Store egg' },
  { item_key: 'VEGETABLES:onions', name_da: 'Løg', name_no: 'Løk' },
  { item_key: 'VEGETABLES:potatoes-25-kilo', name_da: 'Kartofler 25 kg', name_no: 'Poteter 25 kg' },
  { item_key: 'BUTCHERS:bacon', name_da: 'Bacon', name_no: 'Bacon' },
  { item_key: 'TEACOFFEE:tea-bags', name_da: 'Tebreve', name_no: 'Teposer' },
]
const catalogue = resolveCatalogue(overrides)
const byKey = new Map(catalogue.map((i) => [i.key, i]))

const want = [
  ['BAKERS', 'Butteries', 10], ['BAKERS', 'Softies', 30],
  ['CHILL', 'Large Eggs', 6], ['CHILL', 'Lurpak Butter', 4],
  ['VEGETABLES', 'Neeps', 3], ['VEGETABLES', 'Onions', 4], ['VEGETABLES', 'Potatoes 25 Kilo', 2],
  ['BUTCHERS', 'Bacon', 8], ['BUTCHERS', 'Sliced Polony', 2], ['BUTCHERS', 'Lorne Sausage', 6],
  ['TEACOFFEE', 'Tea Bags', 4],
  ['JUICE', 'Irn Bru', 3],
  ['FROZEN', 'Tattie Waffles', 3],
]
const byName = new Map(catalogue.map((i) => [`${i.category}|${i.name}`, i]))
const lines = []
for (const [cat, name, qty] of want) {
  const it = byName.get(`${cat}|${name}`)
  if (!it) { console.log('MISSING', cat, name); continue }
  lines.push({ item_key: it.key, name: it.name, category: it.category, qty, unit: it.unit, note: '' })
}

const doc = buildStoresDoc({ title: 'Trip 65', starts_on: '2026-08-21', meals_for: 11 }, lines, byKey, lang)
const bytes = new Uint8Array(doc.output('arraybuffer'))
writeFileSync(out, bytes)

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
const pdf = await pdfjs.getDocument({ data: bytes, useSystemFonts: true }).promise
console.log(`${lines.length} lines · ${lang} -> ${out} (${pdf.numPages} pages)\n`)
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
