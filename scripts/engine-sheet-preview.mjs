/* Render the REAL printable engine room sheet and read it back.
 *
 *   node scripts/engine-sheet-preview.mjs [out.pdf]
 *
 * test-engine-sheet.mjs proves which boxes SHOULD get a printed decimal point.
 * This proves the page DRAWS them there: every printed point is matched to the
 * row it sits on, and the dotted rows must be exactly the ones the rule chose —
 * no row missing its point, and no stray point on a row that reads in whole
 * numbers.
 *
 * It CANNOT catch a wrong rule, and once did not: it agreed perfectly with a rule
 * that gave Generator 2 the main engine's fuel-pressure box. That is the test's
 * job. This is the drawing's.
 */
import { writeFileSync, readFileSync } from 'node:fs'
import { safeOut } from './safeOut.mjs'
import { buildEngineSheet, sheetShapes, SHEET_LAYOUT, OPERATIONS } from '../src/lib/engine/printSheet.js'
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

ok(pdf.numPages === 1, 'one page — one photograph a day')
ok(has('Daily Engine Room Log') && has('AUDACIOUS · BF83'), 'titled, and names the boat')
ok(has('DATE') && ['DD', 'MM', 'YY'].every(has), 'the date has boxes of its own')
ok(has('OPERATION') && OPERATIONS.every(has), 'steaming, towing and alongside each have a tick box')
ok(items.some((i) => i.s.includes(`Layout ${SHEET_LAYOUT}`)), `it carries layout ${SHEET_LAYOUT} for the reader`)
ok(items.some((i) => /decimal point is printed/.test(i.s)), 'it tells the engineer what the printed point means')

// Every row the app stores is printed, under the app's own name.
const missing = ENGINE_TEMPLATE.flatMap((g) => g.params.map((p) => p.label)).filter((l) => !has(l))
ok(missing.length === 0, `every parameter is printed under the name the app stores${missing.length ? ' — missing: ' + missing.join(', ') : ''}`)
ok(['MAIN ENGINE 1', 'GEARBOX 1', 'GENERATORS', 'REMAINING ON BOARD', 'REFRIGERATION', 'NOTES'].every(has), 'the sections are headed')
ok(has('DG1 · Generator 1') && has('DG2 · Generator 2'), 'each generator column says which app generator it is')
ok(['Ice Machine 1', 'Ice Machine 2', 'Fishroom', 'Fish Handling'].every(has), 'each refrigeration machine has its own column')

// Nothing off the edge of the paper, and the sign-off clear of the footer.
const off = items.filter((i) => i.x < 10 || i.x > W - 10 || i.y < 10 || i.y > H - 10)
ok(off.length === 0, `nothing printed off the page${off.length ? ' — ' + off.map((i) => i.s).join(', ') : ''}`)
const signY = items.find((i) => i.s === 'LOGGED BY')?.y
const footY = items.find((i) => i.s.includes(`Layout ${SHEET_LAYOUT}`))?.y
ok(signY != null && footY != null && signY - footY >= 12, `the sign-off sits clear of the footer (${signY != null && footY != null ? Math.round(signY - footY) + 'pt' : 'not found'})`)

/* THE POINTS. Each printed '.' belongs to the row label nearest to its LEFT on
   the same line. A band row runs the full width, so "same column" is not enough;
   nearest-to-the-left is what holds for the columns and the band alike. */
const labelSet = new Set(ENGINE_TEMPLATE.flatMap((g) => g.params.map((p) => p.label)))
const labels = items.filter((i) => labelSet.has(i.s))
const dots = items.filter((i) => i.s === '.')
const bandTop = items.find((i) => i.s === 'REFRIGERATION')?.y ?? -Infinity
const blockOf = (l) => (l.y < bandTop ? 'band' : l.x < W / 2 ? 'left' : 'right')

const drawn = new Map()
let stray = 0
for (const d of dots) {
  const row = labels
    .filter((l) => l.x < d.x && Math.abs(l.y - d.y) <= 8)
    .reduce((best, l) => (!best || l.x > best.x ? l : best), null)
  if (!row) { stray++; continue }
  const key = `${blockOf(row)}|${row.s}`
  drawn.set(key, (drawn.get(key) || 0) + 1)
}

// What the rule chose: one point per group whose reading takes one, counted
// against the block the group is printed in.
const shapes = sheetShapes(ctx)
const expected = new Map()
for (const g of ENGINE_TEMPLATE) {
  const block = g.sheet?.column || 'right'
  for (const p of g.params) {
    if (!shapes.get(`${g.group}||${p.label}`).dec) continue
    const key = `${block}|${p.label}`
    expected.set(key, (expected.get(key) || 0) + 1)
  }
}

const show = (m) => [...m].map(([k, n]) => `${k}${n > 1 ? ' ×' + n : ''}`).sort().join(', ')
ok(stray === 0, `every printed point sits on a row${stray ? ` — ${stray} stray` : ''}`)
ok(show(drawn) === show(expected),
   `the points are drawn on exactly the rows the rule chose\n          drawn:    ${show(drawn)}\n          expected: ${show(expected)}`)

console.log(out)
console.log(`  ${labels.length} rows printed, ${dots.length} printed decimal points`)
if (bad) { console.log(`  ${bad} PROBLEM${bad === 1 ? '' : 'S'}`); process.exit(1) }
console.log('  one page, every row named as the app stores it, and every point where it belongs')
