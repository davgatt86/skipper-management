/* THE SALES NOTE WHEN IT FOLLOWS THE PRICE BOARD ONTO THE GRADING CODES.
 *
 * Peterhead moved the daily PRICE BOARD onto the grading table's codes on
 * 21-10-2026. The SALES NOTES have not followed — measured 22-10, the Don note
 * of 21-10 still reads A+1..A+5, A1..A5, U9 — so the two Don Fishing documents
 * now use different vocabularies and the notes will catch up.
 *
 * WHEN THEY DO, THE OLD TOKEN DROPPED MOST OF EVERY NOTE. `SLASH_TOKEN` read
 * the grade as `[A-Z0-9+]+`, uppercase only, and the codes are lowercase:
 *
 *     2b  5a  4a  U9a   -> every one dropped whole
 *     3                 -> came through, being a bare digit
 *
 * Six of haddock's eight codes and five of cod's eight are lettered, so a note
 * would have come in short by whatever those rows were worth — with no error,
 * and the only sign a negative reconcile against its own printed total. That is
 * the fourth silent-drop fault of this shape in this parser, after the wrapped
 * row, the starred price and the page-break wrap; the first three each cost
 * real money and were invisible until somebody reconciled a note.
 *
 * THE CONTROLS ARE HALF THE TEST. A run where the old grades fail too is the
 * harness talking, not the parser — which is exactly what the first attempt at
 * this did, calling `parseDon` and reading `.length` off an object that carries
 * `{ rows, meta }`. Every old grade is asserted alongside every new one.
 */
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const PC = require('./src/lib/parse-core.cjs')

let n = 0, fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++; else n++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

/** One Don row, as pdf.js extracts it, parsed through the real entry point. */
const grade = (g, species = 'Hadd', pres = 'GUT') => {
  const { rows } = PC.parseDon([`GT Seafoods Ltd ${species}/${pres}/${g} 1.00 40 56.40 40 56.40`])
  return rows.length ? rows[0].grade : null
}

/* ---- THE LADDER THE NOTES USE TODAY still reads, every grade of it ---- */
for (const g of ['A1', 'A2', 'A3', 'A4', 'A5', 'U9', 'B4', 'A9'])
  eq(`control: ${g} still parses`, grade(g), g)
for (const g of ['A+1', 'A+2', 'A+3', 'A+4', 'A+5'])
  eq(`control: ${g} still parses`, grade(g), g)

/* ---- AND THE GRADING-TABLE CODES, which is what changes --------------- *
 * Every code on the crew grading table, all fifteen species' worth of
 * shapes: a bare digit, a digit plus a letter, and the U9 sizes. */
for (const g of ['1', '1a', '1b', '1c', '1d', '2', '2a', '2b', '2c', '3', '3a', '3b',
                 '4', '4a', '4b', '4c', '5', '5a', '5b'])
  eq(`new code ${g} parses`, grade(g), g)
for (const g of ['U9a', 'U9b', 'U9c', 'U9d', 'U9e', 'U9f'])
  eq(`new code ${g} parses`, grade(g), g)

/* THE NOTE MAY PRINT IT UPPER CASE. Costs nothing to accept, and a note that
   writes `2B` must not drop the row over a letter case. */
eq('an upper-case code parses too', grade('2B'), '2B')

/* THE GRADE IS STORED AS PRINTED, never tidied — the board's own spelling is
   what the day tally carries and what `estimatorGrades.boardCode` normalises
   later. A parser that lower-cased here would hide a note printing 2B. */
eq('and is kept exactly as the note prints it', grade('U9A'), 'U9A')

/* ---- THE WRAPPED ROW TAKES THE NEW CODES TOO -------------------------- *
 * `speciesWrap` shares SLASH_TOKEN, so the species cell wrapping onto the
 * next line — the 1.3.3 fault — had to keep working for a lettered code. An
 * A+ grade is one character wider than a plain one, which is what causes the
 * wrap; `2b` is the same width, so this stays live. */
{
  const { rows } = PC.parseDon(['GT Seafoods Ltd Saithe 1.00 40 56.40 40 56.40', 'Coley/GUT/4a'])
  eq('a wrapped row rejoins with a lettered code', rows.length, 1)
  eq('and keeps its species', rows[0] && rows[0].species_canon, 'Saithe')
  eq('its grade', rows[0] && rows[0].grade, '4a')
  eq('and its money', rows[0] && rows[0].total_value, 56.4)
}

/* ---- WHAT MUST STILL BE REFUSED --------------------------------------- *
 * The token is widened, not opened. It anchors on SPECIES/PRES/GRADE with an
 * upper-case presentation, so an ordinary slashed phrase is still not a fish. */
eq('a lower-case presentation is not a species token', grade('2b', 'Hadd', 'gut'), null)
eq('and neither is a two-part token', PC.parseDon(['Some Buyer And/Or 1.00 40 56.40 40 56.40']).rows.length, 0)

console.log('')
console.log(fail === 0 ? `parser codes: ${n} checks passed` : `${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
