/* VALUING THE TALLY OFF THE BOARD'S OWN GRADE CODES — 21 Oct 2026.
 *
 * The Estimator's whole grade table exists to bridge a board that was coarser
 * than the boat's grading: `"2B" -> A4c`, `"3" -> A4m`, with a column nudge to
 * make up the difference. Peterhead now prints the grading table's codes — the
 * codes the day tally prints — so where the board has the grade, it is the
 * grade.
 *
 * Rows below are the REAL boards: 21-10-2026 (new ladder) and 19-10-2026 (old),
 * straight out of `market_prices`.
 */
import assert from 'node:assert'
import { buildEstimatorPrices } from './src/lib/market/estimatorPrices.js'
import { boardCode, onCodes, CODE_KEY, CODE_LADDER } from './src/lib/market/estimatorGrades.js'

let n = 0
const ok = (c, m) => { assert.ok(c, m); n++ }
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++ }
const row = (price_date, species, grade, subgrade, low, high, ave) =>
  ({ price_date, species, grade, subgrade, low, high, ave, unsold: false })

/* The real haddock board of 21-10-2026 — every line it carried. */
const NEW_BOARD = [
  row('2026-10-21', 'Haddock', '1b', 'Large', 5.74, 5.74, 5.74),
  row('2026-10-21', 'Haddock', '1c', 'Medium', 4.70, 6.51, 5.81),
  row('2026-10-21', 'Haddock', '1d', 'Good Seed', 6.21, 6.38, 6.25),
  row('2026-10-21', 'Haddock', '2a', 'Seed', 5.13, 6.57, 5.68),
  row('2026-10-21', 'Haddock', '2b', 'Chipper', 3.66, 5.05, 4.74),
  row('2026-10-21', 'Haddock', '3', 'Metro', 2.49, 2.49, 2.49),
  row('2026-10-21', 'Haddock', '4', 'Mini Metro', 1.81, 1.98, 1.93),
]
/* And the real board of 19-10-2026, two days earlier, on the old ladder. */
const OLD_BOARD = [
  row('2026-10-19', 'Haddock', 'A1', 'Lge/Med', 3.00, 5.00, 3.94),
  row('2026-10-19', 'Haddock', 'A2', 'Selected', 5.43, 7.03, 5.86),
  row('2026-10-19', 'Haddock', 'A3', 'Seed', 3.50, 5.90, 4.70),
  row('2026-10-19', 'Haddock', 'A4', 'Chipper', 1.15, 2.18, 1.65),
  row('2026-10-19', 'Haddock', 'A4', 'Metro', 1.00, 1.59, 1.15),
  row('2026-10-19', 'Haddock', 'A4', 'Round', 0.80, 0.80, 0.80),
]

/* ---- THE TALLY'S CODE IS THE BOARD'S KEY ------------------------------ *
 * `gradeCode()` upper-cases whatever it reads off the tally, so
 * "Chipper (2b)" arrives as "2B" and has to be put back the board's way. */
eq(boardCode('2B'), '2b', 'a lettered code comes back lowercase')
eq(boardCode('1A'), '1a', 'and so does the top of the ladder')
eq(boardCode('U9A'), 'U9a', 'U9 keeps its upper case, the size letter does not')
eq(boardCode('3'), '3', 'a bare digit is already right')
eq(boardCode(''), null, 'no code is not a code')
eq(boardCode('—'), null, 'and neither is a dash')
eq(boardCode('A4'), null, 'a legacy board grade is NOT a tally code — it must not be mistaken for one')

/* ---- THE NEW BOARD IS RECOGNISED BY ITS KEYS, NEVER BY THE DATE ------- *
 * The two ladders will sit side by side in the record for as long as the
 * history does, and an old sheet re-uploaded today must still read as old. */
{
  const { pd } = buildEstimatorPrices(NEW_BOARD, [])
  const h = pd.Haddock
  ok(onCodes(h), 'the 21-10 board reads as being on codes')
  eq(h['2b'], 4.74, 'Chipper is on the board under its own code')
  eq(h['3'], 2.49, 'so is Metro')
  eq(h['4'], 1.93, 'and Mini Metro')
  eq(h['A4c'], undefined, 'and none of the legacy keys the bridge looks for exist')
  eq(h['A4m'], undefined, 'not Metro’s')
  eq(h['A4ma'], undefined, 'and not Mini Metro’s')
  /* THIS IS WHAT THE CHANGE IS FOR. Before it, the page asked for `A4ma`,
     found nothing, and had no Peterhead price for Mini Metro at all. */
  ok(h[boardCode('4')] != null, 'so the tally grade 4 finds its price only by its own code')
}

/* ---- MINI METRO IS NOT A BLEND ANY MORE ------------------------------- *
 * It used to be derived from the single Metro row: Mini = (low+ave)/2.
 * On this board that gives 2.49 for BOTH, where Mini Metro actually made
 * 1.93 — 29% out on the grade that is usually the bulk of the A4. */
{
  const { pd } = buildEstimatorPrices(NEW_BOARD, [])
  const h = pd.Haddock
  const blended = (2.49 + 2.49) / 2
  ok(h['4'] !== blended, 'the real Mini Metro line is not what the blend would have said')
  eq(h['4'], 1.93, 'it is the board’s own figure')
  ok(h['3'] > h['4'], 'and Metro is dearer than Mini Metro, as the ladder expects')
}

/* ---- EVERY BOARD ALREADY FILED STILL READS AS IT DID ------------------ */
{
  const { pd } = buildEstimatorPrices(OLD_BOARD, [])
  const h = pd.Haddock
  ok(!onCodes(h), 'the 19-10 board does not read as being on codes')
  eq(h['A4c'], 1.65, 'Chipper is still under its legacy key')
  /* The blend is still running on this board, and must: it prints ONE Metro
     row (ave 1.15, high 1.59) and the boat grades two.
         Metro = (ave + high)/2 = 1.37      Mini = (low + ave)/2 = 1.08     */
  eq(h['A4m'], 1.37, 'Metro is still the ave/high blend of that one row')
  eq(h['A4ma'], 1.08, 'and Mini Metro the low/ave blend — the board does not print it')
  eq(h['2b'], undefined, 'no code-shaped key is invented for it')
}

/* ---- A GRADE THAT DID NOT SELL STEPS TO ITS NEIGHBOUR ----------------- *
 * The ladder is the reason this is safe. Without one, a missing grade fell
 * through to "any priced grade in this species" — which on 21-10 would have
 * valued Metro at the first haddock price found, XL at £5.74 against its
 * real £2.49. */
{
  const i = (c) => CODE_LADDER.indexOf(c)
  ok(i('1a') < i('2b'), 'bigger fish sit earlier in the ladder')
  ok(i('2b') < i('3'), 'Chipper is above Metro')
  ok(i('3') < i('4'), 'and Metro above Mini Metro')
  ok(i('4c') < i('5'), 'a lettered size sorts inside its own number')
  ok(CODE_LADDER.every((c) => CODE_KEY.test(c) || c === 'U9'),
    'every rung is a shape the board actually prints')
  /* The step runs DOWN first — to the cheaper neighbour — which is what
     stops a missing grade being valued at a dearer one. */
  ok(i('4') > i('3'), 'so stepping forward from Metro reaches Mini Metro, not XL')
}

/* ---- THE " (high)" COMPANION KEY COUNTS AS A CODE KEY ----------------- *
 * The loader stores the high column as `"2b (high)"`. A board holding only
 * those must still read as being on codes, or the Mid toggle would silently
 * drop back to the legacy bridge. */
ok(CODE_KEY.test('2b (high)'), 'the high-column key is recognised')
ok(CODE_KEY.test('U9a'), 'and a U9 size')
ok(!CODE_KEY.test('A4c'), 'a legacy key is not')
ok(!CODE_KEY.test('A1 (high)'), 'nor its high column')
ok(onCodes({ '3 (high)': 2.49 }), 'a board of only high columns still reads as codes')

/* ---- AND THE PAGE ACTUALLY CALLS IT ----------------------------------- *
 * `Estimator.jsx` is 1,000 lines behind a login and a file picker, so the
 * helpers above can be perfect and reach nothing. This repo has shipped that
 * exact fault twice — a provider imported and never rendered, and a save
 * library exported and called by nothing — both green the whole time.
 *
 * Asserted against the SOURCE, the way test-reader-guard.mjs does: it cannot
 * prove the page prices a tally, and it does prove nobody has quietly cut the
 * code out of the path. */
{
  const src = await (await import('node:fs/promises')).readFile('./src/pages/Estimator.jsx', 'utf8')
  ok(/import \{[^}]*boardCode[^}]*\} from ['"]\.\.\/lib\/market\/estimatorGrades['"]/.test(src),
    'the page imports the shared helpers rather than keeping a second copy')
  ok(/resolvePD=\(sp,gr,code\)/.test(src), 'resolvePD takes the code')
  ok(/if\(code&&onCodes\(o\)\)\s*return stepGrade\(o,code,CODE_LADDER/.test(src),
    'and prefers the board’s own line, stepping within the code ladder')
  ok(/resolvePD\(m\.pdSp,m\.pdGr,m\.pdCode\)/.test(src),
    'the row builder passes the tally’s code through')
  ok((src.match(/pdCode/g) || []).length >= 5, 'and every mapping branch carries it')
  ok(/const pdCode=boardCode\(code\)/.test(src), 'taken off the tally’s own grade code')
  /* The legacy bridge must still be there: it is what every board already
     filed is read through. */
  ok(/A4ma|A4m/.test(src) && /pdLadder=\["A1"/.test(src),
    'the old A-ladder bridge is kept for every sheet already on file')
}

console.log(`estimator codes: ${n} checks passed`)
