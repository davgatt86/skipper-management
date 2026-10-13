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
import { buildEstimatorPrices } from './src/lib/market/estimatorPrices.js'

let n = 0
const ok = (c, m) => { assert.ok(c, m); n++ }
const eq = (a, b, m) => { assert.strictEqual(a, b, m); n++ }

const row = (species, grade, subgrade, low, high, ave, unsold) =>
  ({ species, grade, subgrade, low, high, ave, unsold })

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

console.log(`estimator unsold: ${n} checks passed`)
