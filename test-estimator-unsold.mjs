/* AN UNSOLD GRADE DOES NOT VALUE A TALLY.
 * David, Oct 2026: "don't use unsold in estimator."
 *
 * The estimator averages the TWO most recent board days, which is what makes
 * this easy to get wrong: filtering after the group is built would still blend
 * a non-sale into a real price. These pin the three cases that matter — both
 * days unsold, one day unsold, and the two years of history where nobody read
 * the word at all and the column is null.
 */
import assert from 'node:assert'
import { buildEstimatorPrices, LAST_CLEARED_WINDOW_DAYS } from './src/lib/market/estimatorPrices.js'

let n = 0
const ok = (c, m) => { assert.ok(c, m); n++ }
const eq = (a, b, m) => { assert.strictEqual(a, b, m); n++ }

const row = (species, grade, subgrade, low, high, ave, unsold) =>
  ({ species, grade, subgrade, low, high, ave, unsold })
/* With a date, for the lookback cases. */
const on = (price_date, r) => ({ ...r, price_date })

/* ---- both days unsold: no price at all, and it is NAMED ---------------- */
{
  const { pd, unsold } = buildEstimatorPrices([
    row('Haddock', 'A4', 'Chipper', null, 2.35, 1.75, true),   // today
    row('Haddock', 'A4', 'Chipper', null, 2.40, 1.80, true),   // yesterday
    row('Haddock', 'A3', 'Seed', 3, 4.45, 3.30, false),
  ])
  eq(pd.Haddock.A4c, undefined, 'a grade unsold on both days gets no price')
  eq(pd.Haddock['A4c (high)'], undefined, 'and no high either')
  eq(pd.Haddock.A3, 3.3, 'while a grade that cleared is priced as before')
  assert.deepStrictEqual(unsold, ['Haddock A4 Chipper']); n++
}

/* ---- one day unsold, one sold: THE PRICE STANDS ------------------------
 * This is the case a naive filter gets wrong in both directions — dropping
 * the grade entirely, or averaging 1.75 and 1.80 into a number that is part
 * non-sale. The right answer is the day the market actually paid. */
{
  const { pd, unsold } = buildEstimatorPrices([
    row('Haddock', 'A4', 'Chipper', null, 2.35, 1.75, true),   // today, unsold
    row('Haddock', 'A4', 'Chipper', 1.5, 2.40, 1.80, false),   // yesterday, sold
  ])
  eq(pd.Haddock.A4c, 1.8, 'the day that cleared is the price, not a blend of the two')
  eq(unsold.length, 0, 'and nothing is reported unpriced, because it is priced')
}

/* ---- null means nobody read the word, NOT that it sold ----------------- */
/* ~60,000 rows predate this and carry null. A truthy test keeps every one of
 * them behaving exactly as before; treating null as unsold would empty the
 * board for two years of history. */
{
  const { pd, unsold } = buildEstimatorPrices([
    row('Haddock', 'A4', 'Chipper', 1.2, 2.35, 1.75, null),
    row('Cod', 'A1', 'Large', 8, 9.68, 8.89, undefined),
  ])
  eq(pd.Haddock.A4c, 1.75, 'a null unsold flag prices exactly as it always did')
  eq(pd.Cod.A1, 8.89, 'and so does a row that never had the column')
  eq(unsold.length, 0, 'neither is reported as unsold')
}

/* ---- MINI METRO AND METRO BOTH DIE WITH THE METRO ROW ------------------
 * David: "mini is the low/avg blend price of metro, metro is high/avg blend."
 * Both come off the one Metro line, so an unsold Metro costs two grades. The
 * message must say so once, not twice, and must not leave either priced. */
{
  const { pd, unsold } = buildEstimatorPrices([
    row('Haddock', 'A4', 'Metro', null, 1.25, 1.10, true),
    row('Haddock', 'A4', 'Chipper', 1.2, 2.35, 1.75, false),
  ])
  eq(pd.Haddock.A4ma, undefined, 'Mini Metro is unpriced when the Metro row is unsold')
  eq(pd.Haddock.A4m, undefined, 'and so is Metro')
  eq(pd.Haddock.A4c, 1.75, 'while Chipper, which sold, is untouched')
  assert.deepStrictEqual(unsold, ['Haddock A4 Metro']); n++
}

/* ---- the blend itself, which is the rule David stated ------------------ */
{
  const { pd } = buildEstimatorPrices([row('Haddock', 'A4', 'Metro', 1.00, 2.00, 1.50, false)])
  eq(pd.Haddock.A4ma, 1.25, 'Mini Metro is the low/avg blend')
  eq(pd.Haddock.A4m, 1.75, 'Metro is the avg/high blend')
}

/* ---- a species the estimator cannot place is a different complaint ----- */
{
  const { missing, unsold } = buildEstimatorPrices([
    row('Gurnard', 'A1', null, 1, 2, 1.5, false),
    row('Haddock', 'A4', 'Chipper', null, 2.35, 1.75, true),
  ])
  ok(missing.includes('PD Gurnard'), 'an unplaceable species is still reported missing')
  assert.deepStrictEqual(unsold, ['Haddock A4 Chipper']); n++
  ok(!missing.some(m => /Haddock/.test(m)), 'and an unsold grade is NOT called missing — it is a different fact')
}

/* ======================================================================
 * FALLING BACK TO THE GRADE'S OWN LAST CLEARED PRICE
 * David: "fall back to it's own last cleared price."
 * ====================================================================== */

/* ---- it reaches past the two pricing days and takes the most recent --- */
{
  const { pd, lastCleared, unsold } = buildEstimatorPrices([
    on('2026-10-12', row('Haddock', 'A4', 'Chipper', null, 2.35, 1.75, true)),   // pricing day 1
    on('2026-10-09', row('Haddock', 'A4', 'Chipper', null, 2.30, 1.70, true)),   // pricing day 2
    on('2026-10-08', row('Haddock', 'A4', 'Chipper', 1.5, 2.60, 1.90, false)),   // last cleared
    on('2026-10-07', row('Haddock', 'A4', 'Chipper', 1.4, 2.50, 1.80, false)),   // older, ignored
  ])
  eq(pd.Haddock.A4c, 1.9, 'priced off the most recent day it cleared, not the older one')
  eq(unsold.length, 0, 'so it is not reported unpriced')
  eq(lastCleared.length, 1, 'and the carry-over is reported')
  eq(lastCleared[0].label, 'Haddock A4 Chipper', '  naming the grade')
  eq(lastCleared[0].date, '2026-10-08', '  and the day it came off')
  eq(lastCleared[0].daysBack, 4, '  and how far back that is')
}

/* ---- ONLY THE TWO LATEST DAYS PRICE THE TALLY ------------------------- *
 * The window is 14 days of rows, and all but the two newest exist purely to
 * answer "when did this last clear". A grade that sold on both pricing days
 * must not have a fortnight of history averaged into it. */
{
  const { pd, lastCleared } = buildEstimatorPrices([
    on('2026-10-12', row('Haddock', 'A3', 'Seed', 3, 4, 3.50, false)),
    on('2026-10-09', row('Haddock', 'A3', 'Seed', 3, 4, 3.30, false)),
    on('2026-10-08', row('Haddock', 'A3', 'Seed', 9, 9, 9.00, false)),   // in the window, must be ignored
    on('2026-10-07', row('Haddock', 'A3', 'Seed', 9, 9, 9.00, false)),
  ])
  eq(pd.Haddock.A3, 3.4, 'the average is of the two latest days only')
  eq(lastCleared.length, 0, 'and nothing is carried over for a grade that sold')
}

/* ---- PAST THE WINDOW IS NO PRICE, NOT AN OLD ONE ---------------------- *
 * The longest unsold spell on the board's whole record is 8 board days / 11
 * calendar days, so 14 covers every one. Past that a price is too old to
 * value a hold with, and saying so beats quietly using a stale figure. */
{
  const stale = `2026-09-20`   // 22 days before the pricing day
  const { pd, unsold, lastCleared } = buildEstimatorPrices([
    on('2026-10-12', row('Haddock', 'A4', 'Chipper', null, 2.35, 1.75, true)),
    on('2026-10-09', row('Haddock', 'A4', 'Chipper', null, 2.30, 1.70, true)),
    on(stale, row('Haddock', 'A4', 'Chipper', 1.5, 2.60, 1.90, false)),
  ])
  eq(pd.Haddock?.A4c, undefined, 'a price older than the window is not used')
  eq(lastCleared.length, 0, 'and is not reported as a carry-over')
  assert.deepStrictEqual(unsold, ['Haddock A4 Chipper']); n++
  ok(LAST_CLEARED_WINDOW_DAYS === 14, 'the window is 14 days, from the board’s own record')
}

/* ---- the fallback row must itself have cleared ------------------------ */
{
  const { pd, unsold } = buildEstimatorPrices([
    on('2026-10-12', row('Haddock', 'A4', 'Chipper', null, 2.35, 1.75, true)),
    on('2026-10-08', row('Haddock', 'A4', 'Chipper', null, 2.60, 1.90, true)),   // also unsold
  ])
  eq(pd.Haddock?.A4c, undefined, 'an older UNSOLD day is not a last cleared price')
  assert.deepStrictEqual(unsold, ['Haddock A4 Chipper']); n++
}

/* ---- the carried row goes through the SAME arithmetic ----------------- *
 * It is fed into the group as a current row would be, so the Mini/Metro blend
 * runs on it unchanged. There is no second pricing path to drift. */
{
  const { pd, lastCleared } = buildEstimatorPrices([
    on('2026-10-12', row('Haddock', 'A4', 'Metro', null, 1.25, 1.10, true)),   // pricing day 1
    on('2026-10-09', row('Haddock', 'A4', 'Metro', null, 1.30, 1.15, true)),   // pricing day 2
    on('2026-10-08', row('Haddock', 'A4', 'Metro', 1.00, 2.00, 1.50, false)),  // last cleared
  ])
  eq(pd.Haddock.A4ma, 1.25, 'Mini Metro blends low/avg off the carried day')
  eq(pd.Haddock.A4m, 1.75, 'and Metro blends avg/high off the same row')
  eq(lastCleared.length, 1, 'reported once, though it priced two grades')
}

/* ---- rows with no price_date behave exactly as before ----------------- *
 * The old two-day call shape. Returning nothing for it would be a silent
 * regression in any caller not yet passing dates. */
{
  const { pd } = buildEstimatorPrices([row('Haddock', 'A3', 'Seed', 3, 4.45, 3.30, false)])
  eq(pd.Haddock.A3, 3.3, 'a dateless row still prices')
}

console.log(`estimator unsold: ${n} checks passed`)
