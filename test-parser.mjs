/* Don Fishing rows whose SPECIES cell wrapped onto the next line.
 *
 * THE LINES BELOW ARE REAL — copied verbatim out of pdf.js's own text
 * extraction of the Audacious note for 13-08-2026, not an assumed line format.
 * Two earlier P&J buyer fixes failed because they were written blind against a
 * guessed layout, which is why that rule exists.
 *
 * The bug: the note is a fixed-width print, and an A+ grade is ONE CHARACTER
 * wider than a plain A grade. That is enough to push the tail of the
 * species/grade token onto a second line while the FIGURES stay on the first —
 * so the row looks complete, has no slash-token to anchor on, and was dropped
 * without a trace. It cost 13 boxes and £2,241.80 on this note alone, and the
 * same signature is on three other landings.
 */
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const PC = require('./src/lib/parse-core.cjs')

let fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

// Verbatim from pdf.js, lines 391-416 of the real note.
const LINES = [
  'AG D Duff & Partners Saithe Coley/GUT/A3 16.00 40 92.80 640 1,484.80',
  'AG D Duff & Partners Saithe Coley/GUT/A3 1.00 34 78.88 34 78.88',
  'GT Seafoods Saithe 1.00 40 56.40 40 56.40',          // wrapped ↓
  'Coley/GUT/A+4',
  'Whitelink Seafoods Saithe 3.00 40 47.60 120 142.80', // wrapped ↓
  'Coley/GUT/A+4',
  'Whitelink Seafoods Saithe Coley/GUT/A4 94.00 40 80.00 3760 7,520.00',
  'Topsail Fish Products Pollock 1.00 40 299.20 40 299.20',  // buyer wraps too ↓
  'Ltd Lyth/GUT/A+2',
  'Topsail Fish Products Pollock 1.00 5 37.40 5 37.40',
  'Ltd Lyth/GUT/A+2',
  'Marrfish Ltd Pollock Lyth/GUT/A2 2.00 40 295.60 80 591.20',
  'GT Seafoods Pollock 2.00 40 240.40 80 480.80',
  'Lyth/GUT/A+3',
  'GT Seafoods Pollock Lyth/GUT/A3 15.00 40 255.60 600 3,834.00',
  'GT Seafoods Pollock 3.00 40 248.40 120 745.20',
  'Lyth/GUT/A+4',
  'G&J Jack Seafoods Ltd Pollock 2.00 40 240.00 80 480.00',
  'Lyth/GUT/A+4',
  'G&J Jack Seafoods Ltd Pollock Lyth/GUT/A4 1.00 40 227.60 40 227.60',
]

const { rows } = PC.parseDon(LINES)

eq('every row is read, wrapped or not', rows.length, 13)
eq('and nothing is counted twice',
  rows.reduce((a, r) => a + r.boxes, 0), 16 + 1 + 1 + 3 + 94 + 1 + 1 + 2 + 2 + 15 + 3 + 2 + 1)

const wrapped = rows.filter((r) => String(r.grade).includes('+'))
eq('the seven A+ rows come through', wrapped.length, 7)
eq('with the right boxes', wrapped.reduce((a, r) => a + r.boxes, 0), 13)
eq('the right weight', wrapped.reduce((a, r) => a + r.total_weight, 0), 485)
eq('and the right money', +wrapped.reduce((a, r) => a + r.total_value, 0).toFixed(2), 2241.80)

// The species token must be REJOINED, or SPECIES_PREFIX cannot canonicalise it
// and the boat gets a species called "Lyth".
eq('a wrapped species is put back together',
  [...new Set(wrapped.map((r) => r.species))].sort(), ['Pollock Lyth', 'Saithe Coley'])
eq('and canonicalises normally',
  [...new Set(wrapped.map((r) => r.species_canon))].sort(), ['Lythe', 'Saithe'])

/* The continuation can carry the tail of the BUYER as well as the species,
 * because both cells wrap onto the same line. Leaving "Ltd" in front of the
 * species would break the prefix match and the buyer would swallow "Pollock". */
const topsail = rows.filter((r) => r.buyer.startsWith('Topsail'))
eq('a buyer that wrapped is rejoined too', topsail.length, 2)
eq('with its tail on the end', [...new Set(topsail.map((r) => r.buyer))], ['Topsail Fish Products Ltd'])
eq('and its species intact', [...new Set(topsail.map((r) => r.species))], ['Pollock Lyth'])

// No row may end up with the species text stuck in the buyer, which is the
// failure mode if the fragment is appended in the wrong place.
eq('no buyer contains a slash token', rows.some((r) => /\//.test(r.buyer)), false)
eq('no buyer starts with a species word',
  rows.some((r) => /^(Pollock|Saithe|Coley|Lyth)\b/i.test(r.buyer)), false)

// The unwrapped rows must be untouched by all of this.
const plain = rows.filter((r) => !String(r.grade).includes('+'))
eq('the ordinary rows are unaffected', plain.length, 6)
eq('and still total correctly',
  +plain.reduce((a, r) => a + r.total_value, 0).toFixed(2),
  +(1484.80 + 78.88 + 7520 + 591.20 + 3834 + 227.60).toFixed(2))

// A continuation carrying figures is a REAL row, never a fragment.
const notAFragment = PC.parseDon([
  'GT Seafoods Pollock 2.00 40 240.40 80 480.80',
  'Marrfish Ltd Pollock Lyth/GUT/A2 2.00 40 295.60 80 591.20',
])
eq('a following row is not eaten as a continuation', notAFragment.rows.length, 1)

/* ---- A STARRED PRICE (1.3.4) -----------------------------------------
 *
 * The office flags a figure with a leading '*'. On a fixed-width print the
 * star costs a character, so a price that should read 2343.75 comes out as
 * "*2343." with the pence pushed off the end. The old pattern wanted
 * [\d,]+\.\d{2} in that column, got neither the digits nor the star, and
 * dropped the whole row without a trace.
 *
 * Found by Colin on the Beryl note of 11-08-2026, where that ONE halibut row
 * is the entire £2,343.75 the landing was short. Lines below are as they read
 * on the note. */
{
  const starred = PC.parseDon([
    'AG D Duff & Partners Halibut/GUT/U9 1.00 188 *2343. 188 2,343.75',
  ]).rows
  eq('a starred, truncated price no longer drops the row', starred.length, 1)
  eq('and the value is the one the note printed', starred[0].total_value, 2343.75)
  eq('the buyer survives it', starred[0].buyer, 'AG D Duff & Partners')
  eq('and the species', starred[0].species_canon, 'Halibut')
  // The star ate the pence, so the printed price is short — take it from the
  // value column, which is unstarred and exact.
  eq('the lost pence are recovered from the value', starred[0].price_per_box, 2343.75)
  eq('and £/kg is right', starred[0].price_per_kg, 12.47)

  // A star on the VALUE column instead — the flag can land on either.
  eq('a starred value is read too',
    PC.parseDon(['G&J Jack Seafoods Ltd Hake/GUT/U9 1.00 25 65.00 25 *65.00']).rows[0]?.total_value, 65)

  // The ordinary rows either side of it on Colin's screen must be unchanged.
  const plain = PC.parseDon([
    'Whitelink Seafoods Black / GL H/GUT/A4 26.00 40 155.00 1040 4,030.00',
    'G&J Jack Seafoods Ltd Halibut/GUT/U9 4.00 40 475.00 160 1,900.00',
    'AG D Duff & Partners Halibut/GUT/U9 1.00 29 362.50 29 362.50',
  ]).rows
  eq('an unstarred row is untouched', plain.map(r => r.total_value), [4030, 1900, 362.5])
  eq('and keeps the price the note printed', plain.map(r => r.price_per_box), [155, 475, 362.5])
}

eq('the version was bumped', PC.VERSION, '1.3.4')

console.log('')
console.log(fail === 0 ? 'all passed' : `${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
