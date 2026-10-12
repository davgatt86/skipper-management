/* "% OF INCOME" ON A SETTLEMENT LINE.
 *
 * The arithmetic is one division and is not what this guards. What it guards is
 * the DENOMINATOR and the REFUSAL, because both were measured off the live
 * record and both are easy to undo by accident:
 *
 *   - the denominator is the settlement's own total_income, never the sum of
 *     the income LINES. 365 of 389 settlements have no income lines at all — a
 *     Beryl sheet has a gross sales figure and no income section — so summing
 *     the lines divides by zero on 94% of the record while looking perfectly
 *     right on the 24 Audacious sheets somebody happens to be testing with.
 *
 *   - no income is NO percentage. Not 0.00, not Infinity, not NaN. There is
 *     nothing to divide by, so there is no answer, and an em dash says that
 *     where a number would be a claim.
 */
import assert from 'node:assert'
import { pctOfIncome } from './src/lib/su/metrics.js'

let n = 0
const ok = (c, m) => { assert.ok(c, m); n++ }
const eq = (a, b, m) => { assert.strictEqual(a, b, m); n++ }
const near = (a, b, m) => { assert.ok(Math.abs(a - b) < 0.005, `${m} (got ${a}, want ${b})`); n++ }

/* ---- the real sheet: settlement 2321936, Audacious, 09-10-2026 --------- */
const INCOME = 185709.57

near(pctOfIncome(185709.57, INCOME), 100, 'the fish sales line is the whole of income')
near(pctOfIncome(103412.04, INCOME), 55.68, 'expenses are 55.68% of income')
near(pctOfIncome(60000, INCOME), 32.31, 'fuel alone is a third of the gross')
near(pctOfIncome(6400, INCOME), 3.45, 'recoveries')

/* The agent's commission lands on exactly 5.00%, which is a real check on the
 * whole thing: it is a rate, so the arithmetic has to reproduce it. */
near(pctOfIncome(9285.48, INCOME), 5.00, 'commission comes back as the 5% rate it is')

/* ---- no income is no percentage --------------------------------------- */
for (const bad of [0, null, undefined, '', NaN, -1]) {
  eq(pctOfIncome(1000, bad), null, `income of ${JSON.stringify(bad)} yields no percentage`)
}

/* A ZERO LINE IS A REAL ZERO, and must not be confused with the above. The
 * sheet carried the line and it came to nothing; that is 0.00%, an answer. */
eq(pctOfIncome(0, INCOME), 0, 'a line of nought is nought per cent, not a blank')

/* A line with no amount has nothing to express as a share. */
for (const bad of [null, undefined, '', NaN]) {
  eq(pctOfIncome(bad, INCOME), null, `an amount of ${JSON.stringify(bad)} yields no percentage`)
}

/* ---- a credit line keeps its sign ------------------------------------- */
near(pctOfIncome(-5000, INCOME), -2.69, 'a negative line reads negative, not absolute')

/* ---- strings off the database ----------------------------------------- */
/* Postgres numerics arrive as STRINGS through PostgREST, which is how
 * `Number('')  === 0` has bitten this repo seven times. Both arguments are
 * coerced, and the empty string is refused above rather than read as nought. */
near(pctOfIncome('60000.00', '185709.57'), 32.31, 'numerics arriving as strings still divide')

/* ---- THE DENOMINATOR IS NOT THE INCOME LINES -------------------------- */
/* A Beryl sheet: a gross sales figure, no income section whatever. Summed from
 * its (non-existent) income lines the denominator is 0 and every expense on
 * every Beryl settlement would render as an em dash — 365 of 389 sheets. */
const BERYL_GROSS = 136421
const berylIncomeLines = []
const summed = berylIncomeLines.reduce((a, l) => a + Number(l.amount || 0), 0)
eq(pctOfIncome(42300, summed), null, 'summing a Beryl sheet’s income lines gives nothing to divide by')
near(pctOfIncome(42300, BERYL_GROSS), 31.01, 'its own total_income gives the boat share as the 31% it is')

console.log(`settlement % of income: ${n} checks passed`)
