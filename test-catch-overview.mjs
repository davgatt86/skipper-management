/* THE CATCH OVERVIEW READER, against trip 72's real export.
 *
 * David, Oct 2026: *"upload only accepts xsls. not pdf"* — and the PDF he has
 * is this one, which is the better document for the tally check: the WEIGHED
 * landing rather than the wheelhouse count, so it sits beside the sales note
 * instead of 9% above it.
 *
 * `scripts/fixtures/catch-overview-trip72.json` is the real pdf.js extraction,
 * item for item, so every artefact below is one the document actually carries.
 * The reader is split from the pdf.js call for exactly this reason — the hard
 * part is picking columns out of an OCR layer, and that is what wants testing.
 */
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { parseCatchOverviewPages, looksLikeCatchOverview } from './src/lib/market/parseCatchOverview.js'
import { compareLadder, downgradeCandidates, bandTotalsFromTally } from './src/lib/tallyVsNote.js'
import { SPEC_A2 } from './src/lib/salesAgg.js'

let n = 0
const ok = (c, m) => { assert.ok(c, m); n++ }
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++ }

const PAGES = JSON.parse(readFileSync('./scripts/fixtures/catch-overview-trip72.json', 'utf8'))
const res = parseCatchOverviewPages(PAGES)

/* ---- IT RECONCILES, WHICH IS THE WHOLE LICENCE TO USE IT ------------- *
 * The text layer is OCR: one generated font, stray question marks where digits
 * belong, and cells run together. Nothing here may be taken on trust, so the
 * parse is checked against the total the document prints on itself — the sales
 * note's own discipline. */
eq(res.measure, 'kg', 'this document is read in kilos')
eq(res.total, 38115, 'the rows add to 38,115 kg')
eq(res.printedTotal, 38115, 'which is exactly what it prints')
eq(res.diff, 0, 'so there is nothing out')
eq(res.reconciles, true, 'and it reconciles')
eq(res.skippedPages, [], 'all three pages carried a header to calibrate against')

/* ---- AND THE BOX COLUMN DOES NOT, WHICH IS WHY WEIGHT IS COMPARED --- *
 * 960 of the 1,037 boxes it prints, with 28 rows losing theirs outright. A
 * figure right 87% of the time and silent about the rest is the exact shape
 * this codebase keeps being caught by, so boxes are read and never compared. */
eq(res.printedBoxes, 1037, 'it prints 1,037 boxes')
ok(res.totalBoxes < res.printedBoxes, 'and the OCR does not give them all back')
ok(res.boxesUnread > 0, `${res.boxesUnread} rows lose their box count`)
ok(res.lines.some(l => l.boxes === null), 'an unread box count is NULL, never 0 — nought is a landing of none')

/* ---- THE ONE ARTEFACT THAT HID THE WHOLE FINDING -------------------- *
 * The Good Seed weight is printed `732.00?`. Anchored, the money match threw it
 * away; with that one null the comparison read A1 at -0.2 points instead of
 * -6.4 and raised NO candidate at all. It is a prefix match now, and the
 * reconcile above is what makes that safe rather than hopeful. */
{
  const gs = res.lines.find(l => l.grade === 'Good Seed (1d)')
  ok(gs, 'the Good Seed row is read')
  eq(gs.kg, 732, 'at its real 732 kg, despite the stray question mark on it')
  eq(gs.species, 'HADDOCK', 'filed under the tally’s own species name, via the FAO code')
}
/* The haddock ladder, in the tally's spelling so one grade reader serves both. */
{
  const had = res.lines.filter(l => l.species === 'HADDOCK')
  eq(had.length, 7, 'seven haddock rungs')
  eq(had.map(l => l.grade), [
    'Chat (1b)', 'Pinger (1c)', 'Good Seed (1d)', 'Seed (2a)',
    'Chippers (2b)', 'Metros (3)', 'Mini Metro (4)',
  ], 'the code is turned round into the tally’s `Name (code)` form')
  eq(had.reduce((s, l) => s + l.kg, 0), 11123, 'and they add to the 11,123 kg printed for haddock')
}
/* ---- AN UNCODED GRADE IS STILL READ --------------------------------- *
 * Redfish grades `Medium` / `Selected` / `Small` and tusk reads `Mix`. They sit
 * on no A-ladder rung — but they are real landed weight, and dropping them
 * would break the reconcile for a reason that is nothing to do with a misread
 * digit, which is the one check standing between this scan and a wrong answer. */
{
  const uncoded = res.lines.filter(l => !/\([0-9ux]/i.test(l.grade))
  ok(uncoded.length > 0, 'the uncoded grades are kept')
  ok(uncoded.some(l => /Mix/.test(l.grade)), 'including `Mix`')
  ok(uncoded.every(l => l.kg > 0), 'each with its weight, which is why the total still adds up')
}

/* ---- COMPARED ON WEIGHT, IT FINDS THE SAME THING -------------------- */
const NOTE = [
  ['A+1', 1, 40], ['A1', 16, 613], ['A+2', 23, 896], ['A2', 44, 1746],
  ['A+3', 31, 1214], ['A3', 18, 720], ['A+4', 123, 4907], ['A4', 24, 960],
].map(([grade, boxes, total_weight], i) => ({ id: 'n' + i, species_canon: 'Haddock', grade, boxes, total_weight }))

{
  const cmp = compareLadder(res.lines, NOTE, { measure: 'kg' })
  eq(cmp.measure, 'kg', 'the comparison reports which column it used')
  eq(cmp.tallyTotal, 11123, 'the scales weighed 11,123 kg of haddock')
  eq(cmp.noteTotal, 11096, 'and the note sold 11,096 — far closer than boxes get')
  const by = Object.fromEntries(cmp.rows.map(r => [r.digit, r]))
  eq(by['1'].gap, -6.4, 'A1 sold 6.4 points short')
  eq(by['2'].gap, 6.7, 'A2 6.7 over')
  /* THE QUIET HALF IS QUIETER ON WEIGHT, which is the argument for using it:
     A4 is +0.9 here against +3.0 on boxes, because a weighed kilo matches a
     weighed kilo and a counted box does not. */
  eq(by['4'].gap, 0.9, 'and A4 only 0.9 over, where boxes made it 3.0')
  ok(Math.abs(by['3'].gap) < 3 && Math.abs(by['4'].gap) < 3, 'so neither raises anything')

  const cand = downgradeCandidates(cmp)
  eq(cand.length, 1, 'one candidate, the same one')
  eq(cand[0].name, 'Good Seed', 'Good Seed')
  eq(cand[0].code, '1d', '')
  eq(cand[0].explains, 97, 'accounting for 97% of the gap — 98% on boxes, the same answer')
}
/* THE SPLITTER TAKES ITS TOTALS IN THE SAME MEASURE, or it would be comparing
   1,898 kg against 67 boxes and flagging a difference that is only a unit. */
{
  const t = bandTotalsFromTally(res.lines, SPEC_A2, 'HADDOCK', 'kg')
  eq(t, { Chipper: 1003, Seed: 895 }, 'the A2 bands in kilos, off the scales')
}

/* ---- AND IT KNOWS WHAT IT IS ---------------------------------------- */
ok(looksLikeCatchOverview('PRODUCT GROUP ... LIVING WEIGHT ... BOXES'), 'recognised by its own headings')
ok(!looksLikeCatchOverview('SPECIES DAY 1-3 DAY 4-5'), 'and a day tally is not one')
ok(!looksLikeCatchOverview(''), 'nor is nothing')

/* A DOCUMENT THAT DOES NOT ADD UP MUST NOT RECONCILE. Dropping a digit from one
   weight is exactly what an OCR layer does, and the caller refuses on this. */
{
  const broken = JSON.parse(JSON.stringify(PAGES))
  let hit = false
  for (const page of broken) for (const it of page) {
    if (!hit && it.s === '5,786.00') { it.s = '786.00'; hit = true }
  }
  ok(hit, 'the Mini Metro weight is in the fixture to break')
  const r = parseCatchOverviewPages(broken)
  eq(r.reconciles, false, 'a dropped digit stops it reconciling')
  eq(r.diff, -5000, 'and the shortfall is reported rather than swallowed')
}

console.log(`catch overview: ${n} checks passed`)
