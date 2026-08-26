/* THE MARKET AS PETERHEAD ACTUALLY BUILT IT.
 *
 * Read off `PD Market Layout.xlsx`, David's own sheet: 176 tiers in three areas
 * of three depths, numbered 1 to 177 with 100 missing. Every figure below was
 * verified cell by cell against that workbook, not assumed — `scratch` script
 * at build time walked all 176 and found no disagreement.
 *
 * The old model — 21 top, 26 bottom, forever — is true of the middle of the new
 * market and nowhere else.
 */
import assert from 'node:assert/strict'
import {
  PETERHEAD, AREAS, areaOf, areaLabel, marketTotals, tierAt,
  tiersFrom, fitShot, areaWarnings, PRINTED_DISAGREES,
} from './src/lib/market/markets.js'

let n = 0
const eq = (a, b, m) => { n++; assert.deepEqual(a, b, m) }
const ok = (c, m) => { n++; assert.ok(c, m) }

// ---- the shape of the building -------------------------------------------
const T = marketTotals()
eq(T.tiers, 176, '176 tiers on the floor')
eq(T.footprints, 5000, 'five thousand footprints, exactly')
eq(T.byArea.map((a) => [a.area, a.tiers, a.footprints]),
   [['new', 77, 3537], ['cafe', 34, 488], ['old', 65, 975]],
   'the three areas, as drawn')

/* TIER 100 DOES NOT EXIST. The sheet skips it, so the model skips it — the
 * number on the floor is what gets called over the phone, and tidying the gap
 * away would rename 77 tiers. */
eq(tierAt(PETERHEAD, 100), null, 'there is no tier 100')
eq(tierAt(PETERHEAD, 99).area, 'cafe', 'but 99 is there')
eq(tierAt(PETERHEAD, 101).area, 'cafe', 'and so is 101')
eq(PETERHEAD.tiers[PETERHEAD.tiers.length - 1].n, 177, 'the last tier is numbered 177')

// ---- ONLY THE NEW MARKET HAS A TOP ---------------------------------------
eq(areaOf('new').hasTop, true, 'the new market has a top row')
eq(areaOf('cafe').hasTop, false, 'the cafe corner does not')
eq(areaOf('old').hasTop, false, 'nor the old market')
ok(PETERHEAD.tiers.filter((t) => t.area !== 'new').every((t) => t.top === 0),
   'so every tier outside the new market draws nothing on top')
ok(PETERHEAD.tiers.filter((t) => t.area === 'new').every((t) => t.top > 0),
   'and every tier inside it does')

// ---- the standard tier, and the ones that are not ------------------------
const std = tierAt(PETERHEAD, 40)
eq([std.top, std.bottom, std.total], [21, 26, 47],
   'the middle of the new market is the 21/26/47 the app already knew')
eq(PETERHEAD.tiers.filter((t) => t.total === 47).length, 61,
   'and it is only 61 of the 176 — the old model was true of a third of the market')

/* START AND END ARE DIFFERENT, which is the whole reason this exists. */
eq([tierAt(PETERHEAD, 1).top, tierAt(PETERHEAD, 1).total], [18, 44], 'tier 1 is shallower on top')
eq([tierAt(PETERHEAD, 70).top, tierAt(PETERHEAD, 70).total], [19, 45], 'so is tier 70')
eq([tierAt(PETERHEAD, 75).top, tierAt(PETERHEAD, 75).bottom], [20, 14], 'the short bay at the far end')

// THE CAFE CORNER IS DIFFERENT SIZES — David's own words, and the data agrees.
eq([78, 80, 82, 90].map((x) => tierAt(PETERHEAD, x).total), [14, 12, 8, 15],
   'four different sized tiers in the cafe corner')
eq(new Set(PETERHEAD.tiers.filter((t) => t.area === 'old').map((t) => t.total)).size, 1,
   'the old market is uniform')

/* The sheet prints 28 where 15 squares should print 30. Carried, not resolved:
 * the drawn squares are the authority, and a figure that disagrees with its own
 * drawing is worth saying out loud. */
eq(PRINTED_DISAGREES.drawn, 15, 'drawn 15')
eq(PRINTED_DISAGREES.printed, 28, 'printed 28 — which is 30 at two high, so one of them is out')

// ---- running from a start tier -------------------------------------------
eq(tiersFrom(PETERHEAD, 1).length, 176, 'from the top, the whole market')
eq(tiersFrom(PETERHEAD, 113).length, 65, 'from 113, the old market alone')
eq(tiersFrom(PETERHEAD, 999), [], 'a tier that does not exist gives nothing')
eq(tiersFrom(PETERHEAD, 100), [], 'and neither does the missing one')

{
  // A small shot well inside the new market: no warnings at all.
  const f = fitShot(PETERHEAD, 7, 200)
  ok(f.fits, 'it fits')
  eq(f.areas, ['new'], 'entirely in the new market')
  eq(f.warnings, [], 'so nothing to warn about')
  eq(f.firstTier, 7, 'starting where he asked')
  eq(f.tiers.reduce((s, t) => s + t.used, 0), 200, 'and every footprint placed')
}

{
  /* AMBER INTO THE CAFE. Start at 70 with more than the eight remaining new
   * market tiers can hold and it crosses the boundary. */
  const f = fitShot(PETERHEAD, 70, 400)
  ok(f.fits, 'it fits')
  ok(f.areas.includes('cafe'), 'and reaches the cafe corner')
  ok(!f.areas.includes('old'), 'but not the old market')
  eq(f.warnings.map((w) => w.tone), ['amber'], 'one amber warning')
  ok(f.warnings[0].text.includes('Cafe Corner'), 'and it names it')
}

{
  // RED INTO THE OLD MARKET, and amber too, because it crossed both.
  const f = fitShot(PETERHEAD, 74, 800)
  eq(f.areas, ['new', 'cafe', 'old'], 'through all three')
  eq(f.warnings.map((w) => w.tone), ['amber', 'red'], 'amber for the cafe, red for the old market')
}

{
  /* IT DOES NOT WRAP. Running off the end is reported as running off the end,
   * never by starting again at tier 1 — a sheet that quietly continued at the
   * far end of the building would send a buyer the length of it. */
  const f = fitShot(PETERHEAD, 170, 500)
  ok(!f.fits, 'it does not fit')
  eq(f.capacityFrom, 8 * 15, 'only eight tiers left from 170')
  eq(f.shortBy, 500 - 120, 'and it says by how much')
  ok(f.warnings.some((w) => w.tone === 'red' && w.text.includes('do not fit')),
     'which is a red warning, not a silent short answer')
  ok(f.tiers.every((t) => t.n >= 170), 'nothing wrapped round to the start')
}

{
  // Nothing to place is not an error, and warns about nothing.
  const f = fitShot(PETERHEAD, 7, 0)
  ok(f.fits, 'nothing fits trivially')
  eq(f.tiers, [], 'and uses no tiers')
  eq(f.warnings, [], 'with nothing to say')
}

// ---- the warnings on their own -------------------------------------------
eq(areaWarnings(['new']), [], 'the new market alone is the quiet case')
eq(areaWarnings(['new', 'cafe']).map((w) => w.tone), ['amber'], 'amber for the cafe')
eq(areaWarnings(['old']).map((w) => w.tone), ['red'], 'red for the old market')
eq(areaLabel('cafe'), 'Cafe Corner', 'named as the market names it')
eq(AREAS.map((a) => a.key), ['new', 'cafe', 'old'], 'and they run in floor order')

console.log('markets: ' + n + ' checks passed')
