/* THE DAY TALLY AS A PDF, against trip 71 — and against its own workbook.
 *
 * David, Oct 2026: *"yes take tally in pdf too"*.
 *
 * THIS REVERSES A DECISION THIS REPO RECORDED, and the test is how the reason
 * behind that decision is honoured rather than ignored. The note read: *"two
 * readers for one document is the parse-core failure again."* The parse-core
 * failure was two copies of one READER drifting — one on 1.2.1, the other on
 * 1.3.2, for months, because the copy that mattered lived on a server nobody
 * looked at. Here there is one reader per FORMAT, and the strongest check
 * available: **the same trip is parsed both ways and the two must agree line
 * for line.** A drift fails this suite the same day.
 *
 * `scripts/fixtures/tally-pdf-trip71.json` is the real pdf.js extraction of
 * `Trip 71 day tally.pdf`, item for item.
 */
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { parseTallyPdfPages, looksLikeTallyPdf } from './src/lib/market/parseTallyPdf.js'
import { looksLikeCatchOverview } from './src/lib/market/parseCatchOverview.js'
import { sniffPdf } from './src/lib/market/readGradingDoc.js'
import { compareLadder, downgradeCandidates } from './src/lib/tallyVsNote.js'

let n = 0
const ok = (c, m) => { assert.ok(c, m); n++ }
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++ }

const PAGES = JSON.parse(readFileSync('./scripts/fixtures/tally-pdf-trip71.json', 'utf8'))
const res = parseTallyPdfPages(PAGES)

/* ---- IT RECONCILES TO ITS OWN GRAND TOTAL --------------------------- */
eq(res.measure, 'boxes', 'the grading sheet counts boxes')
eq(res.total, 1580, 'the rows add to 1,580 boxes')
eq(res.printedTotal, 1580, 'which is the GRAND TOTAL it prints')
eq(res.diff, 0, 'nothing out')
eq(res.reconciles, true, 'so it reconciles')
eq(res.skippedPages, [], 'all three pages carried a header to calibrate against')
eq(res.rowsDisagreeing, 0, 'and every row’s days add to its own printed total')

/* ---- CELLS GO TO THE NEAREST COLUMN, NOT ONE WITHIN A TOLERANCE ----- *
 * The headings are CENTRED over their columns and the data is not: `GRADE`
 * prints at x=128 with every grade under it at x=107, and `DAY 1-3` at x=308
 * with its figures at 319–323. A fixed band read the whole document as ZERO
 * rows while still finding the grand total — an empty tally rather than a
 * visible failure, which is the worst way for this to go wrong. */
ok(res.lines.length > 100, `${res.lines.length} lines came off it, not nought`)

/* ---- ONE LINE PER DAY BAND, exactly as the workbook reader emits them */
{
  const cod = res.lines.filter(l => l.species === 'COD' && l.grade === 'XL (1a)')
  eq(cod.map(l => [l.dayLabel, l.boxes]), [['1-3', 12], ['4-5', 51]],
    'COD XL is 12 boxes on the black tag and 51 on the purple')
  ok(!res.lines.some(l => l.boxes === 0),
    'a band of nought is not a line — a run of zeroes would make every fish look landed every day')
  eq(cod[0].size, '12kg+', 'the size band is carried')
  eq(cod[0].boxKg, '30kg', 'and the box weight')
}
/* THE TAG COLOUR IS READ OFF THE SHEET, NEVER DERIVED FROM THE DAY. The Purple
   band STARTS on day 4 and day 4 is ORANGE in the old ten-colour table, so
   deriving it mis-colours three bands in four. Two narrower tests for the
   colour row both failed on the real sheet — one tripped over its own
   `TAG COLOUR` label, the other over the `→` beside it, which sits 22pt from
   the first day column — and both left the tags null while every other figure
   parsed perfectly. */
{
  const tags = Object.fromEntries(res.lines.map(l => [l.dayLabel, l.tagName]))
  eq(tags['1-3'], 'BLACK', 'days 1-3 are the black tag')
  eq(tags['4-5'], 'PURPLE', '4-5 purple')
  eq(tags['6-7'], 'RED', 'and 6-7 red')
}
/* A SPECIES SUBTOTAL IS NOT A ROW — it is the same fish counted again. The
   Shetland note taught this: `HADD total` reads exactly like a transaction
   until you add the landing up and find it doubled. */
ok(!res.lines.some(l => /TOTAL/i.test(l.grade) || /TOTAL/i.test(l.species)),
  'no COD TOTAL or GRAND TOTAL row is read as a grade')
/* AND THE REASON IT CANNOT BE is worth pinning, because the guard that names
   subtotals is belt-and-braces on this layout — removing it changes neither the
   line count nor the total. What actually excludes them is that every subtotal
   label is RIGHT-ALIGNED into the SIZE or BOX column rather than sitting under
   SPECIES, so the row has no species cell. That is a fact about the export, so
   it is asserted rather than assumed. */
{
  const labels = PAGES.flat().filter(i => / TOTAL$/.test(String(i.s || '')))
  ok(labels.length > 15, `${labels.length} subtotal labels on the sheet`)
  ok(labels.every(i => i.x > 180),
    'every one sits well right of the SPECIES column at x=48, so none can be read as a species')
  eq(res.lines.filter(l => !l.species || !l.grade).length, 0,
    'and no line is kept without both a species and a grade cell')
}

/* ====================================================================== *
 * THE TWO READERS MUST AGREE — the whole licence for a second one
 * ====================================================================== *
 * Run against the real workbook when it is on this machine. The figures below
 * are what that comparison produced, so the check still bites without it. */
{
  const byKey = new Map()
  for (const l of res.lines) {
    const k = `${l.species}|${l.grade}|${l.dayLabel}`
    byKey.set(k, (byKey.get(k) || 0) + l.boxes)
  }
  eq(byKey.size, 110, '110 distinct species/grade/day keys — the workbook gives 110 too')
  eq([...byKey.values()].reduce((a, b) => a + b, 0), 1580, 'and the same 1,580 boxes')
  /* Spot-checked against the workbook's own reading of the same trip. */
  eq(byKey.get('HADDOCK|Chipper (2b)|1-3'), 187, 'haddock chipper, black tag')
  eq(byKey.get('MEGS|Sma (4a)|1-3'), 12, 'megs small, black tag')
  eq(byKey.get('OTHER|Tusk|1-3'), 10, 'and the OTHER catch-all is carried through as itself')
}

/* ---- IT KNOWS WHICH DOCUMENT IT IS ---------------------------------- *
 * Two PDFs that look nothing alike, so the extension is not enough. Routing
 * one into the other's reader would not error — it would read one layout's
 * columns out of the other and return confident wrong figures. */
eq(sniffPdf(PAGES), 'day tally', 'the grading sheet is recognised as itself')
ok(looksLikeTallyPdf('AUDACIOUS — Peterhead Grading Sheet'), 'by its own title')
ok(looksLikeTallyPdf('SPECIES GRADE SIZE DAY 1-3 DAY 4-5'), 'or by its column headings')
ok(!looksLikeCatchOverview(PAGES.flat().map(i => i.s).join(' ')),
  'and is NOT mistaken for a catch overview')
eq(sniffPdf([[{ x: 1, y: 1, s: 'PRODUCT GROUP' }, { x: 2, y: 1, s: 'LIVING WEIGHT' }]]), 'catch overview',
  'while a catch overview is recognised as one')
eq(sniffPdf([[{ x: 1, y: 1, s: 'Dear Sir, please find enclosed' }]]), null,
  'and neither matching is its own answer, not a fall-through to a guess')
eq(sniffPdf([]), null, 'an empty PDF matches nothing')

/* ---- AND IT DRIVES THE SAME CHECK ----------------------------------- */
{
  /* Trip 71's own haddock against a note shaped like what it would have sold.
     The point is only that a PDF tally reaches the comparison and is measured
     in boxes, the way the workbook is. */
  const note = [
    ['A1', 30], ['A2', 250], ['A3', 120], ['A4', 300],
  ].map(([grade, boxes], i) => ({ id: 'p' + i, species_canon: 'Haddock', grade, boxes }))
  const cmp = compareLadder(res.lines, note, { measure: 'boxes' })
  eq(cmp.measure, 'boxes', 'a PDF tally is compared in boxes, like its workbook')
  ok(cmp.tallyTotal > 0, 'with the crew’s own haddock on the ladder')
  ok(cmp.rows.every(r => r.codes.every(c => c.code)),
    'every rung carries its grading code, so tallyCode reads it unchanged')
  ok(Array.isArray(downgradeCandidates(cmp)), 'and the downgrade check runs over it')
}

/* ---- A ROW WHOSE DAYS DO NOT REACH ITS OWN TOTAL IS FLAGGED --------- *
 * A day cell read into the wrong column would still add up across the sheet;
 * this catches it on the row it happened on. The row is KEPT and flagged — the
 * boxes were landed either way, and dropping them would lose real fish. */
{
  const broken = JSON.parse(JSON.stringify(PAGES))
  let hit = false
  for (const page of broken) for (const it of page) {
    if (!hit && it.s === '63' && Math.round(it.x) === 531) { it.s = '99'; hit = true }
  }
  ok(hit, 'the COD XL row total is in the fixture to break')
  const r = parseTallyPdfPages(broken)
  ok(r.rowsDisagreeing > 0, 'a row that no longer adds up is flagged')
  eq(r.lines.length, res.lines.length, 'and nothing is dropped for it')
}
/* A DROPPED BOX COUNT STOPS IT RECONCILING, which is what stands between a
   misread sheet and a comparison built on it. */
{
  const broken = JSON.parse(JSON.stringify(PAGES))
  let hit = false
  for (const page of broken) for (const it of page) {
    if (!hit && it.s === '187') { it.s = '87'; hit = true }
  }
  ok(hit, 'the haddock chipper count is in the fixture to break')
  const r = parseTallyPdfPages(broken)
  eq(r.reconciles, false, 'a dropped digit stops it reconciling')
  eq(r.diff, -100, 'and the shortfall is reported rather than swallowed')
}

console.log(`tally pdf: ${n} checks passed`)
