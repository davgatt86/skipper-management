/* THE DAY TALLY'S COLUMNS ARE TAGS, AND PETERHEAD CUT TEN TO FOUR.
 *
 * PPA moved to a four-tag system on 2 Oct 2026 — Black 1-3, Purple 4-5,
 * Red 6-7, Orange 8-9 — so the wheelhouse sheet now heads its columns
 * "DAY 1-3" instead of "DAY 1". `^DAY (\d+)$` matched none of them, and the
 * page said "Found the SPECIES header but no DAY columns under it" on a
 * perfectly good tally.
 *
 * The workbooks are built here rather than read off the boat's OneDrive, so
 * the rule is pinned by something that travels with the repo. The real Trip 71
 * sheet is what the behaviour was measured against: 110 lines, 1,580 boxes,
 * reconciling to the sheet's own GRAND TOTAL.
 */
import * as XLSX from 'xlsx'
import { parseDayTally } from './src/lib/market/parseDayTally.js'

let fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

/** A workbook shaped like the real thing: header, TAG COLOUR row, fish, totals. */
function book(header, tagRow, body) {
  const rows = [
    ['AUDACIOUS — Peterhead Grading Sheet'],
    ['Vessel Name & PLN', '', '', 'AUDACIOUS BF83'],
    header, tagRow, ...body,
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'AUDACIOUS TOTALS')
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))
}

/* ---- THE NEW FOUR-TAG LAYOUT ----------------------------------------- */
{
  const r = parseDayTally(book(
    ['SPECIES', 'GRADE', 'SIZE', 'BOX (kg)', 'DAY 1-3', 'DAY 4-5', 'DAY 6-7', 'DAY 8-9', 'TOTAL'],
    ['TAG COLOUR →', '', '', '', 'BLACK', 'PURPLE', 'RED', 'ORANGE', ''],
    [
      ['COD', 'XL (1a)', '12kg+', '30kg', 12, 51, 0, 0, 63],
      ['COD TOTAL', '', '', '', 12, 51, 0, 0, 63],
      ['GRAND TOTAL (all species)', '', '', '', '', '', '', '', 63],
    ],
  ))
  eq('a banded tally loads at all', r.error, undefined)
  eq('a band per column that carried fish', r.lines.map((l) => l.dayLabel), ['1-3', '4-5'])
  /* `day` stays the FIRST day of the band, so freshest-first ordering,
     high-to-low stacking and the A+ mark all work unchanged. */
  eq('the day is the band’s first day', r.lines.map((l) => l.day), [1, 4])
  eq('and it knows where the band ends', r.lines.map((l) => l.dayTo), [3, 5])
  eq('the colour is read off the sheet', r.lines.map((l) => l.tagName), ['BLACK', 'PURPLE'])
  eq('empty bands bring no lines', r.lines.length, 2)
  eq('the subtotal row is not read as fish', r.total, 63)
  eq('and it ties to the sheet’s own grand total', r.printedTotal, 63)
}

/* ---- EVERY TALLY ALREADY ON FILE STILL READS THE SAME ----------------- *
 * The old sheets put the day NUMBER under the header, not a colour name, and
 * one of those numbers must never be mistaken for a tag colour. */
{
  const r = parseDayTally(book(
    ['SPECIES', 'GRADE', 'SIZE', 'BOX (kg)', 'DAY 1', 'DAY 2', 'TOTAL'],
    ['TAG COLOUR →', '', '', '', 1, 2, ''],
    [
      ['COD', 'XL (1a)', '12kg+', '30kg', 4, 8, 12],
      ['GRAND TOTAL (all species)', '', '', '', '', '', 12],
    ],
  ))
  eq('the old per-day layout still loads', r.error, undefined)
  eq('its days are unchanged', r.lines.map((l) => l.day), [1, 2])
  eq('a single day labels itself plainly', r.lines.map((l) => l.dayLabel), ['1', '2'])
  eq('a day number is not a colour', r.lines.map((l) => l.tagName), [null, null])
  eq('and it still totals', r.total, 12)
}

/* ---- A BAND WRITTEN BACKWARDS IS DROPPED WHOLE ------------------------ *
 * Which of the two numbers is wrong is not knowable, so it is refused rather
 * than reversed — the same refusal the invoice reader makes on a page range
 * that ends before it starts. Reversing it would silently file the fish under
 * a tag nobody printed. */
{
  const r = parseDayTally(book(
    ['SPECIES', 'GRADE', 'SIZE', 'BOX (kg)', 'DAY 5-2', 'DAY 6-7', 'TOTAL'],
    ['TAG COLOUR →', '', '', '', 'GREEN', 'RED', ''],
    [['COD', 'XL (1a)', '12kg+', '30kg', 9, 4, 13]],
  ))
  eq('a backwards band is ignored', r.lines.map((l) => l.dayLabel), ['6-7'])
  eq('and its boxes do not reach the floor', r.total, 4)
}

/* ---- AND A SHEET WITH NO DAY COLUMNS STILL SAYS SO -------------------- */
{
  const r = parseDayTally(book(
    ['SPECIES', 'GRADE', 'SIZE', 'BOX (kg)', 'TOTAL'],
    ['TAG COLOUR →', '', '', '', ''],
    [['COD', 'XL (1a)', '12kg+', '30kg', 0]],
  ))
  eq('no day columns is still reported', r.error, 'Found the SPECIES header but no DAY columns under it.')
}

console.log('')
console.log(fail === 0 ? 'all passed' : `${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
