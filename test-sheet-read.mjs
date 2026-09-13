/* The photo reader for the engine room sheet: what the reader is asked for, and
 * what the page does with what comes back.
 *
 * Built against Audacious's REAL limits and readings, because the box shapes
 * the reader is told about are the ones the printed sheet carries — and those
 * come off this boat's record.
 */
import { readFileSync } from 'node:fs'
import { sheetFields, reviewSheetRead, flagText, readKey, LABEL_CHARS } from './src/lib/engine/sheetRead.js'
import { sheetShapes, SHEET_LAYOUT } from './src/lib/engine/printSheet.js'
import { ENGINE_TEMPLATE } from './src/lib/engine/template.js'

const FIX = JSON.parse(readFileSync('scripts/fixtures/engine-log.json', 'utf8'))
const shapes = sheetShapes({ logs: FIX.logs, limits: FIX.limits })
const fields = sheetFields(ENGINE_TEMPLATE, shapes)

let pass = 0, fail = 0
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) pass++
  else { fail++; console.log(`  FAIL ${label}\n    got  ${g}\n    want ${w}`) }
}
const ok = (label, cond) => { if (cond) pass++; else { fail++; console.log(`  FAIL ${label}`) } }

// ---- WHAT THE READER IS ASKED FOR ------------------------------------------
const total = ENGINE_TEMPLATE.reduce((n, g) => n + g.params.length, 0)
eq('every row the app stores is asked for', fields.length, total)
eq('and none twice', new Set(fields.map((f) => readKey(f.group, f.param))).size, total)
ok('each carries exactly the box shape the printed sheet has',
   fields.every((f) => { const s = shapes.get(readKey(f.group, f.param)); return s.int === f.int && s.dec === f.dec }))
const field = (g, p) => fields.find((f) => f.group === g && f.param === p)
eq('charge air: one box, a printed point, one box — the 2.2 case', [field('Main Engine 1', 'Charge Air Pressure').int, field('Main Engine 1', 'Charge Air Pressure').dec], [1, 1])
ok('the new paper-sheet rows are asked for too', !!field('Remaining on Board', 'Sludge') && !!field('Fish Handling', 'Compressor LP'))

/* THE KEY THE READER BUILDS MUST BE THE KEY THE PAGE LOOKS UP. The function
   strips anything outside this set from a label before it becomes a key, so a
   label carrying another character would have its figure come back unfindable. */
ok('every section and row label survives the reader’s character filter',
   fields.every((f) => LABEL_CHARS.test(f.group) && LABEL_CHARS.test(f.param) && f.group.length <= 60 && f.param.length <= 60))
ok('and every unit', fields.every((f) => !f.unit || (LABEL_CHARS.test(f.unit) && f.unit.length <= 8)))
const fnSrc = readFileSync('supabase/functions/su-parse-document/index.ts', 'utf8')
ok('the function filters on the same characters as LABEL_CHARS',
   fnSrc.includes('replace(/[^\\p{L}\\p{N} °³%().&/-]/gu, "")') && LABEL_CHARS.source === '^[\\p{L}\\p{N} °³%().&/-]+$')

// ---- WHAT COMES BACK --------------------------------------------------------
const TODAY = '2026-09-13'
const r = reviewSheetRead({
  layout: 'ER2', date: '2026-09-06', vessel_operation: 'Towing', logged_by: '  Norman Wood ', notes: 'Filter changed on DG1',
  readings: {
    'Main Engine 1||Running Hours': 67912,
    'Main Engine 1||Charge Air Pressure': 2.2,
    'Generator 1||Running Hours': 7396,
    'Main Engine 1||GOV': 1.5,
    'Main Engine 1||Lube Oil Pressure': 4.65,
    'Gearbox 1||Oil Press': 280,
    'Main Engine 1||RPM': null,
    'Not A Machine||Pressure': 5,
    'Main Engine 1||Fuel Pressure': '4.5',
  },
  unsure: ['Main Engine 1||Running Hours', 'Main Engine 1||RPM', 'Nope||x'],
}, fields, { today: TODAY, layout: SHEET_LAYOUT })

eq('the date read off the sheet files the entry', r.draft.log_date, '2026-09-06')
eq('the ticked operation is kept, in the stored lower case', r.draft.vessel_operation, 'towing')
eq('logged by is trimmed', r.draft.logged_by, 'Norman Wood')
eq('the notes box comes across', r.draft.notes, 'Filter changed on DG1')
eq('figures arrive as the strings the form edits', r.draft.readings['Main Engine 1']['Running Hours'], '67912')
eq('a printed-point reading keeps its decimal', r.draft.readings['Main Engine 1']['Charge Air Pressure'], '2.2')

/* NOTHING IS CORRECTED. 7,396 under Generator 1 is the real mistake off the
   06-09 paper sheet, and it is the save check's to catch — a reader that changed
   or moved it would hide it. */
eq('7,396 under Generator 1 comes across exactly as written', r.draft.readings['Generator 1']['Running Hours'], '7396')
ok('and is not flagged here — that is the reversal check’s job on save', !r.flags['Generator 1||Running Hours'])

eq('a figure the reader was unsure of is marked', r.flags['Main Engine 1||Running Hours'], ['unsure'])
eq('a decimal where the sheet prints no point is marked', r.flags['Main Engine 1||GOV'], ['decimal'])
eq('two decimal places in a one-box decimal is marked', r.flags['Main Engine 1||Lube Oil Pressure'], ['places'])
eq('three figures in a two-box reading is marked — the 2.8/28 slip the sheet was built against', r.flags['Gearbox 1||Oil Press'], ['boxes'])
ok('an unreadable figure stays blank, even though the reader listed it as unsure',
   r.draft.readings['Main Engine 1']?.RPM === undefined && !r.flags['Main Engine 1||RPM'])
ok('a key nobody asked for is dropped', !r.draft.readings['Not A Machine'])
ok('a figure that is not a number is not a reading', r.draft.readings['Main Engine 1']['Fuel Pressure'] === undefined)
eq('the count: six read, four to check, the rest blank', r.summary, { read: 6, blank: total - 6, flagged: 4 })
eq('the layout is recognised as the one the app prints', [r.layout, r.layoutMatches], ['ER2', true])
eq('reasons read as a sentence', flagText(['unsure', 'boxes']), 'the reader was not sure of it; more figures than the sheet has boxes for')

// ---- THE DATE IS NEVER TRUSTED WHEN IT CANNOT BE TRUE -----------------------
const dated = (date) => reviewSheetRead({ date, readings: {} }, fields, { today: TODAY, layout: SHEET_LAYOUT })
eq('a future date is not used — today, and the note says why', [dated('2026-09-20').draft.log_date, dated('2026-09-20').dateNote], [TODAY, 'future'])
eq('31 February is not a date', [dated('2026-02-31').draft.log_date, dated('2026-02-31').dateNote], [TODAY, 'impossible'])
eq('a date in the sheet’s own format is not guessed at', dated('06/09/26').dateNote, 'impossible')
eq('no date read', [dated(null).draft.log_date, dated(null).dateNote], [TODAY, 'unread'])

// ---- OPERATION, LAYOUT, AND A PHOTO OF NOTHING ------------------------------
const op = (v) => reviewSheetRead({ vessel_operation: v, readings: {} }, fields, { today: TODAY }).draft.vessel_operation
eq('ALONGSIDE is alongside', op('ALONGSIDE'), 'alongside')
eq('anything but the three words is left unticked', op('steaming and towing'), '')
const old = reviewSheetRead({ layout: 'ER1', readings: { 'Generator 1||Oil': 2.2 } }, fields, { today: TODAY, layout: SHEET_LAYOUT })
eq('an older sheet is named as one', [old.layout, old.layoutMatches, old.expectedLayout], ['ER1', false, 'ER2'])
const none = reviewSheetRead(null, fields, { today: TODAY, layout: SHEET_LAYOUT })
eq('a photo of nothing reads as nothing, not as a blank log ready to save', [none.summary.read, none.draft.readings, none.dateNote], [0, {}, 'unread'])
eq('a five-figure generator counter fits its five boxes and is not marked',
   reviewSheetRead({ readings: { 'Generator 1||Running Hours': 10123 } }, fields, { today: TODAY }).flags, {})

console.log(`sheet read: ${pass} checks passed${fail ? `, ${fail} FAILED` : ''}`)
if (fail) process.exit(1)
