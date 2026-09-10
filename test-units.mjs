import assert from 'node:assert'
import { toCubic, toLitres, fmtCubic, fmtLitres, bothFromLitres } from './src/lib/units.js'

let n = 0
const ok = (c, why) => { assert.ok(c, why); n++ }
const eq = (a, b, why) => { assert.deepStrictEqual(a, b, why); n++ }

/* ---- THE ONE CONVERSION THIS CODEBASE DOES SILENTLY --------------------
 * David: "litres in fuel/oil log as thats what we get on our fuel reciept. but
 * auto convert it so the draft in ORB has m3."
 *
 * It is the exception that shows the rule. A currency conversion rests on a
 * rate nobody printed, which is why `orig_total` and `fx_rate` are kept beside
 * it and a DKK invoice at face value is a lie. 1 m³ = 1000 L is not a rate: it
 * is exact, it does not move, and it needs no source.
 */
{
  eq(toCubic(18400), 18.4, 'a bunkering off the receipt')
  eq(toCubic(1200), 1.2, 'and a disposal')
  /* NO FLOAT DUST IN A STATUTORY RECORD. Done naively this is
     18.400000000000002, which would be written into the Oil Record Book. */
  ok(!String(toCubic(18400)).includes('000000'), 'and no float dust in the figure')
  eq(toCubic(12345), 12.345, 'litre precision is kept')
  eq(toCubic(1), 0.001, 'down to a single litre')
}

/* ---- NULL IS NOT ZERO -------------------------------------------------- */
{
  eq(toCubic(null), null, 'nothing converts to nothing')
  eq(toCubic(''), null, 'and so does blank')
  eq(toCubic(undefined), null, 'and undefined')
  eq(toCubic('not a number'), null, 'and rubbish')
  /* A REAL NOUGHT SURVIVES. `Number('') === 0` has bitten this repo six times;
     the point is that an empty box and a measured nought are different facts. */
  eq(toCubic(0), 0, 'while a measured nought is a measured nought')
}

/* ---- AND BACK, EXACTLY ------------------------------------------------- */
{
  eq(toLitres(18.4), 18400, 'cubic metres read back as litres')
  eq(toLitres(12.345), 12345, 'to the litre')
  eq(toLitres(null), null, 'and nothing stays nothing')
  for (const l of [18400, 1200, 12345, 1, 0, 999999]) {
    eq(toLitres(toCubic(l)), l, l + ' L survives the round trip exactly')
  }
}

/* ---- WHAT A PERSON READS ----------------------------------------------- */
{
  eq(fmtCubic(18.4), '18.4 m³', 'no trailing noughts — 18.4, not 18.400')
  eq(fmtCubic(12.345), '12.345 m³', 'and litre precision where there is any')
  eq(fmtCubic(0), '0 m³', 'a nought is shown')
  eq(fmtCubic(null), null, 'and nothing is not shown at all')
  eq(fmtLitres(18400), '18,400 L', 'litres are grouped, as on the receipt')
  eq(fmtCubic(18.4, { unit: false }), '18.4', 'the unit can be left off')
}

/* ---- BOTH, AND THE LEAD UNIT IS THE READER'S ---------------------------
 * "would it be wrong to have both in the ORB too?" — no. What would be wrong is
 * two numbers in the prescribed QUANTITY column, which is an ambiguity somebody
 * has to resolve. Beside it, in words, the second unit ties the book to the
 * delivery note.
 */
{
  eq(bothFromLitres(18400), '18,400 L (18.4 m³)', 'the fuel log leads in litres')
  eq(bothFromLitres(18400, { lead: 'm3' }), '18.4 m³ (18,400 L)', 'the book leads in cubic metres')
  eq(bothFromLitres(null), null, 'and nothing gives nothing')
  eq(bothFromLitres(0, { lead: 'm3' }), '0 m³ (0 L)', 'a nought is stated both ways')
}

console.log('units: ' + n + ' checks passed')
