/* The printable engine room sheet: which boxes get a printed decimal point, how
 * many boxes each reading gets, and that it still fits one page.
 *
 * Tested against Audacious's REAL limits and readings (scripts/fixtures/
 * engine-log.json), because the whole rule is "decided off this boat's record" —
 * a fixture written to suit the code would prove the arithmetic and nothing
 * about which of her gauges read in tenths.
 */
import { readFileSync } from 'node:fs'
import { boxShape, sheetShapes, sheetBlocks, buildEngineSheet, SHEET_LAYOUT } from './src/lib/engine/printSheet.js'
import { ENGINE_TEMPLATE } from './src/lib/engine/template.js'

const FIX = JSON.parse(readFileSync('scripts/fixtures/engine-log.json', 'utf8'))
const ctx = { logs: FIX.logs, limits: FIX.limits }

let pass = 0, fail = 0
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) pass++
  else { fail++; console.log(`  FAIL ${label}\n    got  ${g}\n    want ${w}`) }
}
const ok = (label, cond) => { if (cond) pass++; else { fail++; console.log(`  FAIL ${label}`) } }
const shape = (g, p, c = ctx) => { const s = boxShape(g, p, c); return { int: s.int, dec: s.dec } }
const basis = (g, p, c = ctx) => boxShape(g, p, c).basis
const shapes = sheetShapes(ctx)

// ---- THE RULE David asked for, on his own record ------------------------
// Only what was decided FROM THE RECORD — a range or real readings. The new rows
// have no record yet and are tested separately below.
const measured = [...shapes].filter(([, s]) => s.dec && (s.basis === 'range' || s.basis === 'history')).map(([k]) => k).sort()
eq('off the record, the printed point goes on exactly the low readings that have used one', measured, [
  'Generator 1||Oil', 'Generator 2||Oil',
  'Main Engine 1||Charge Air Pressure', 'Main Engine 1||Fuel Pressure', 'Main Engine 1||HT Pressure',
  'Main Engine 1||LT Pressure', 'Main Engine 1||Lube Oil Pressure', 'Main Engine 1||Stop Air Pressure',
].sort())

eq('Charge Air Pressure is one figure, a point, one figure — the 2.2 case', shape('Main Engine 1', 'Charge Air Pressure'), { int: 1, dec: 1 })
eq('GOV is low but has never been written with a point, so it gets none', shape('Main Engine 1', 'GOV'), { int: 1, dec: 0 })
eq('gearbox oil pressure is bar but reads about 28, so no point', shape('Gearbox 1', 'Oil Press'), { int: 2, dec: 0 })

// ---- HOW MANY BOXES -------------------------------------------------------
eq('main engine RPM gets four, off its confirmed range (max 1,025.8)', shape('Main Engine 1', 'RPM'), { int: 4, dec: 0 })
eq('exhaust temperatures get three', shape('Main Engine 1', 'Unit 1 Exhaust Temp'), { int: 3, dec: 0 })
eq('main engine running hours: five figures on record, plus one to grow into', shape('Main Engine 1', 'Running Hours'), { int: 6, dec: 0 })
eq('generator running hours: four on record plus one — 10,000 is not far off', shape('Generator 1', 'Running Hours'), { int: 5, dec: 0 })
eq('pitch gets three: a percentage reaches 100 though the range stops at 98.9', shape('Gearbox 1', 'Pitch'), { int: 3, dec: 0 })
eq('oil added gets three: litres run past 99', shape('Main Engine 1', 'Oil added'), { int: 3, dec: 0 })

const g2 = boxShape('Generator 2', 'Fuel Pressure', ctx)
eq('Generator 2 fuel pressure has no range and no readings, so it borrows Generator 1’s',
   { int: g2.int, dec: g2.dec, basis: g2.basis, from: g2.from },
   { ...shape('Generator 1', 'Fuel Pressure'), basis: 'sibling', from: 'Generator 1' })

// ---- THE PAPER SHEET'S OWN FIELDS, which have no record yet ---------------
eq('generator oil temp: a temperature, three boxes', shape('Generator 1', 'Oil Temp'), { int: 3, dec: 0 })
eq('gearbox oil added: three boxes', shape('Gearbox 1', 'Oil added'), { int: 3, dec: 0 })
eq('fuel oil remaining is in cubic metres and read to a tenth', shape('Remaining on Board', 'Fuel Oil'), { int: 3, dec: 1 })
eq('sludge remaining gets four boxes of litres', shape('Remaining on Board', 'Sludge'), { int: 4, dec: 0 })
eq('and that is the template’s guess, said as one', basis('Remaining on Board', 'Sludge'), 'hint')
eq('a refrigeration compressor pressure gets two figures and a point — holds 15 and 2.3 alike',
   shape('Ice Machine 1', 'Compressor HP'), { int: 2, dec: 1 })
eq('refrigeration running hours: five boxes', shape('Fishroom', 'Running Hours'), { int: 5, dec: 0 })
eq('a sibling’s GUESS is not borrowed — Ice Machine 2 has nothing real to learn from Ice Machine 1',
   basis('Ice Machine 2', 'Compressor HP'), 'default')
eq('the fishroom is not an ice machine, so it borrows from neither', basis('Fishroom', 'Compressor LP'), 'default')

// ---- WHAT MUST NOT MOVE THE BOXES ----------------------------------------
const slipped = { limits: FIX.limits, logs: [...FIX.logs, { log_date: '2026-09-01', readings: { 'Main Engine 1': { 'Charge Air Pressure': 175 } } }] }
eq('a 175-bar slip on record does not widen the box — the confirmed range governs',
   shape('Main Engine 1', 'Charge Air Pressure', slipped), { int: 1, dec: 1 })

const blanks = { limits: [], logs: [{ log_date: '2026-01-01', readings: { 'Main Engine 1': { 'Fuel Pressure': '' } } }] }
eq('a blank box on record is not a reading of nought — it falls back to the unit default',
   shape('Main Engine 1', 'Fuel Pressure', blanks), { int: 2, dec: 1 })

const real = { limits: [], logs: [{ log_date: '2026-09-20', readings: { 'Remaining on Board': { Sludge: 12450 } } }] }
eq('a real reading beats the template’s guess: 12,450 L of sludge gets five boxes',
   shape('Remaining on Board', 'Sludge', real), { int: 5, dec: 0 })

// ---- A NEW BOAT, with nothing on record ----------------------------------
const none = { logs: [], limits: [] }
eq('new boat: a pressure gets two figures and a point, which holds 28 and 2.2 alike', shape('Gearbox 1', 'Clutch Pressure', none), { int: 2, dec: 1 })
eq('new boat: a temperature gets three', shape('Main Engine 1', 'Unit 1 Exhaust Temp', none), { int: 3, dec: 0 })
eq('new boat: running hours get six', shape('Main Engine 1', 'Running Hours', none), { int: 6, dec: 0 })
eq('new boat: GOV, with no unit, gets two', shape('Main Engine 1', 'GOV', none), { int: 2, dec: 0 })

// ---- WHERE THINGS SIT ----------------------------------------------------
const blocks = sheetBlocks()
eq('the page is laid out as main engine; gearbox, generators, remaining on board; refrigeration',
   blocks.map((b) => `${b.column}:${b.title}`),
   ['left:Main Engine 1', 'right:Gearbox 1', 'right:Generators', 'right:Remaining on Board', 'band:Refrigeration'])
eq('the four refrigeration machines share one set of rows', blocks.find((b) => b.title === 'Refrigeration').groups.length, 4)
const orphan = sheetBlocks([...ENGINE_TEMPLATE, { group: 'Steering Gear', params: [{ label: 'Oil Level', unit: '' }] }])
ok('a group added without a sheet position still lands on the page, in the right-hand column',
   orphan.some((b) => b.column === 'right' && b.title === 'Steering Gear'))

// ---- THE SHEET ------------------------------------------------------------
ok('every parameter the app stores has boxes on the sheet',
   ENGINE_TEMPLATE.every((g) => g.params.every((p) => shapes.has(`${g.group}||${p.label}`))))
const doc = buildEngineSheet({ vessel: { vessel_name: 'AUDACIOUS', pln: 'BF83' }, ...ctx, printedOn: new Date('2026-09-13T08:00:00') })
eq('the whole sheet still fits on one page — one photograph a day', doc.getNumberOfPages(), 1)
eq('the layout code moved on, because rows moved', SHEET_LAYOUT, 'ER2')

console.log(`engine sheet: ${pass} checks passed${fail ? `, ${fail} FAILED` : ''}`)
if (fail) process.exit(1)
