/* Render the REAL printable engine room sheet and read it back.
 *
 *   node scripts/engine-sheet-preview.mjs [out.pdf]
 *
 * test-engine-sheet.mjs proves which boxes SHOULD get a printed decimal point.
 * This proves the page DRAWS them there: every printed point is matched to the
 * row it sits on, and the dotted rows must be exactly the ones the rule chose —
 * no row missing its point, and no stray point on a row that reads in whole
 * numbers. A sheet whose drawing disagreed with its own rule would teach the
 * engineer the wrong place for the decimal, which is the mistake it exists to stop.
 */
import { writeFileSync, readFileSync } from 'node:fs'
import { safeOut } from './safeOut.mjs'
import { buildEngineSheet, sheetShapes, SHEET_LAYOUT } from '../src/lib/engine/printSheet.js'
import { ENGINE_TEMPLATE } from '../src/lib/engine/template.js'

const out = safeOut(process.argv[2] || 'engine-sheet-preview.pdf', '.pdf')
const FIX = JSON.parse(readFileSync('scripts/fixtures/engine-log.json', 'utf8'))
const ctx = { logs: FIX.logs, limits: FIX.limits }

const doc = buildEngineSheet({ vessel: { vessel_name: 'AUDACIOUS', pln: 'BF83' }, ...ctx, printedOn: new Date('2026-09-13T08:00:00') })
const bytes = new Uint8Array(doc.output('arraybuffer'))
writeFileSync(out, bytes)

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
const pdf = await pdfjs.getDocument({ data: bytes, useSystemFonts: true }).promise
const page = await pdf.getPage(1)
const { width: W, height: H } = page.getViewport({ scale: 1 })
const items = (await page.getTextContent()).items
  .map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5] }))
  .filter((i) => i.s.trim())

let bad = 0
const ok = (cond, why) => { if (cond) console.log('  ok    ' + why); else { console.log('  FAIL  ' + why); bad++ } }
const has = (s) => items.some((i) => i.s === s)

ok(pdf.numPages === 1, 'one page')
ok(has('Daily Engine Room Log') && has('AUDACIOUS · BF83'), 'titled, and names the boat')
ok(has('DATE') && ['DD', 'MM', 'YY'].every(has), 'the date has boxes of its own')
ok(items.some((i) => i.s.includes(`Layout ${SHEET_LAYOUT}`)), `it carries layout ${SHEET_LAYOUT} for the reader`)
ok(items.some((i) => /decimal point is printed/.test(i.s)), 'it tells the engineer what the printed point means')

// Every row the app stores is printed, under the app's own name.
const missing = ENGINE_TEMPLATE.flatMap((g) => g.params.map((p) => p.label)).filter((l) => !has(l))
ok(missing.length === 0, `every parameter is printed under the name the app stores${missing.length ? ' — missing: ' + missing.join(', ') : ''}`)
ok(['MAIN ENGINE 1', 'GEARBOX 1', 'GENERATORS', 'NOTES'].every(has), 'the sections are headed')
ok(has('DG1 · Generator 1') && has('DG2 · Generator 2'), 'each generator column says which app generator it is')

// Nothing off the edge of the paper.
const off = items.filter((i) => i.x < 10 || i.x > W - 10 || i.y < 10 || i.y > H - 10)
ok(off.length === 0, `nothing printed off the page${off.length ? ' — ' + off.map((i) => i.s).join(', ') : ''}`)

/* THE POINTS. Match each printed '.' to the row label on the same line in the
   same column; a generator row carries one point per generator that takes one. */
const labelSet = new Set(ENGINE_TEMPLATE.flatMap((g) => g.params.map((p) => p.label)))
const labels = items.filter((i) => labelSet.has(i.s))
const dots = items.filter((i) => i.s === '.')
const side = (i) => (i.x < W / 2 ? 'L' : 'R')
const drawn = new Map()
let stray = 0
for (const d of dots) {
  const row = labels.filter((l) => side(l) === side(d))
    .reduce((best, l) => (!best || Math.abs(l.y - d.y) < Math.abs(best.y - d.y) ? l : best), null)
  if (!row || Math.abs(row.y - d.y) > 8) { stray++; continue }
  const key = `${side(row)}|${row.s}`
  drawn.set(key, (drawn.get(key) || 0) + 1)
}

const shapes = sheetShapes(ctx)
const expected = new Map()
const main = ENGINE_TEMPLATE.find((g) => /^Main Engine/.test(g.group))
const gearbox = ENGINE_TEMPLATE.find((g) => /^Gearbox/.test(g.group))
const gens = ENGINE_TEMPLATE.filter((g) => /^Generator/.test(g.group))
for (const p of main.params) if (shapes.get(`${main.group}||${p.label}`).dec) expected.set(`L|${p.label}`, 1)
for (const p of gearbox.params) if (shapes.get(`${gearbox.group}||${p.label}`).dec) expected.set(`R|${p.label}`, 1)
for (const label of new Set(gens.flatMap((g) => g.params.map((p) => p.label)))) {
  const n = gens.filter((g) => shapes.get(`${g.group}||${label}`)?.dec).length
  if (n) expected.set(`R|${label}`, n)
}

const show = (m) => [...m].map(([k, n]) => `${k.slice(2)}${n > 1 ? ' ×' + n : ''}`).sort().join(', ')
ok(stray === 0, `every printed point sits on a row${stray ? ` — ${stray} stray` : ''}`)
ok(show(drawn) === show(expected),
   `the points are drawn on exactly the rows the rule chose\n          drawn:    ${show(drawn)}\n          expected: ${show(expected)}`)

console.log(out)
console.log(`  ${labels.length} rows, ${dots.length} printed decimal points`)
if (bad) { console.log(`  ${bad} PROBLEM${bad === 1 ? '' : 'S'}`); process.exit(1) }
console.log('  one page, every row named as the app stores it, and every point where it belongs')
