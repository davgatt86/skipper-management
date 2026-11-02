/* UK QUOTA SWAPS — /quota-swaps and src/lib/quota/ukSwaps.js.
 *
 * The page shows who swapped quota with whom, from the Marine Directorate
 * uptake report. The report gives each group's NET change per week and never
 * the other side of a deal, so the PO-to-PO grid is built from an inference,
 * and the rules worth pinning are the ones that stop an estimate passing for a
 * fact, and a total from counting the same tonnes twice.
 *
 * Synthetic rows only: the real figures are PO-level data from the SWFPA
 * and this repo is public.
 */
import assert from 'node:assert'
import {
  pairMatrix, dealsFor, stockSeries, applyFilters, sortRows, usedTone, monthsOf, isAll, t1,
} from './src/lib/quota/ukSwaps.js'
import { accessForPath, canSee, NAV } from './src/nav.js'

let n = 0
const ok = (c, m) => { assert.ok(c, m); n++ }
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++ }

const P = (from_po, to_po, tonnes, confidence, month = '2026-05', stock = 'POK/2C3A4') =>
  ({ from_po, to_po, tonnes, confidence, month, stock, date: month + '-13' })
const pairs = [
  P('FPO', 'EEFPO', 280, 'Certain'),
  P('FPO', 'SFO', 48, 'Likely'),
  P('FPO', 'NESFO', 100, 'Estimate'),
  P('International', 'SFO', 229.6, 'Likely', '2026-10'),
  P('SFO', 'Aberdeen', 10, 'Certain', '2026-10', 'HAD/2AC4.'),
]

/* ---- the grid adds up, and its totals are the same tonnes -------------- */
{
  const m = pairMatrix(pairs, { stock: 'POK/2C3A4' })
  eq(m.at('FPO', 'EEFPO'), 280, 'a certain match sits in its box')
  eq(m.given('FPO'), 428, 'FPO gave 280 + 48 + 100')
  eq(m.got('SFO'), 277.6, 'SFO got 48 from FPO and 229.6 from abroad')
  eq(m.total, 657.6, 'the grid total is every match once')
  eq(m.givers[0], 'FPO', 'biggest giver first')
  ok(!m.givers.includes('SFO'), 'the haddock deal is not in the saithe grid')
}

/* ---- AN ESTIMATE NEVER COUNTS WHEN ONLY SURE MATCHES ARE ASKED FOR ----- */
{
  const sure = pairMatrix(pairs, { stock: 'POK/2C3A4', show: 'sure' })
  eq(sure.given('FPO'), 328, 'certain + likely drops the 100 t estimate')
  eq(sure.at('FPO', 'NESFO'), 0, 'and its box is empty')
  const certain = pairMatrix(pairs, { stock: 'POK/2C3A4', show: 'certain' })
  eq(certain.given('FPO'), 280, 'certain only keeps one deal')
  eq(certain.got('SFO'), 0, 'a likely match is not certain')
}

/* ---- a PO filter keeps BOTH directions --------------------------------- */
{
  const m = pairMatrix(pairs, { po: 'SFO' })
  ok(m.givers.includes('FPO') && m.givers.includes('International') && m.givers.includes('SFO'), 'who gave to SFO, and SFO as a giver')
  ok(m.receivers.includes('Aberdeen'), 'who SFO gave to')
  ok(!m.receivers.includes('EEFPO'), 'a deal SFO was not in is gone')
}

/* ---- month narrows, All does not --------------------------------------- */
{
  eq(pairMatrix(pairs, { month: '2026-10' }).total, 239.6, 'October only')
  eq(pairMatrix(pairs, { month: 'All' }).total, pairMatrix(pairs, {}).total, 'All is the same as unset')
  ok(isAll(null) && isAll('') && isAll('All') && !isAll('2026-10'), 'what counts as All')
}

/* ---- the deals behind a box --------------------------------------------- */
{
  eq(dealsFor(pairs, { from: 'FPO', to: 'SFO' }).length, 1, 'one box, one deal')
  eq(dealsFor(pairs, { from: 'FPO' }).length, 3, 'a row: everything FPO gave')
  eq(dealsFor(pairs, { from: 'FPO', show: 'certain' }).length, 1, 'and the show filter applies to the list too')
}

/* ---- THE CHART CARRIES A VALUE FORWARD UNTIL IT CHANGES ---------------- *
 * weekly rows exist only in weeks a group's swaps moved. A line drawn only
 * through those would slope between them, suggesting quota moved in weeks it
 * did not. Every report date gets a point, holding the last value. */
{
  const periods = ['2026-01-28', '2026-02-04', '2026-02-11', '2026-02-18'].map((date) => ({ date, year: 2026, month: date.slice(0, 7) }))
  const weekly = [
    { stock: 'POK/2C3A4', po: 'FPO', date: '2026-02-04', ytd_t: -100 },
    { stock: 'POK/2C3A4', po: 'FPO', date: '2026-02-18', ytd_t: -250 },
    { stock: 'POK/2C3A4', po: 'SFO', date: '2026-02-11', ytd_t: 60 },
    { stock: 'HAD/2AC4.', po: 'SFO', date: '2026-02-11', ytd_t: 999 },
  ]
  const intlWeekly = [{ stock: 'POK/2C3A4', date: '2026-02-11', intl_ytd_t: 40 }]
  const s = stockSeries({ weekly, intlWeekly, periods, stock: 'POK/2C3A4' })
  eq(s.keys, ['FPO', 'SFO'], 'biggest swing first, other stocks ignored')
  eq(s.data.map((r) => r.FPO), [0, -100, -100, -250], 'held flat between changes')
  eq(s.data.map((r) => r.SFO), [0, 0, 60, 60], 'starts at zero before its first swap')
  eq(s.data.map((r) => r['UK international']), [0, 0, 40, 40], 'the UK line steps the same way')
  eq(stockSeries({ weekly, intlWeekly, periods, stock: 'POK/2C3A4', top: 1 }).keys, ['FPO'], 'top N caps the lines')
  eq(stockSeries({ weekly, intlWeekly, periods, stock: 'All' }).data, [], 'no stock, no chart')
}

/* ---- filters ------------------------------------------------------------ */
{
  const rows = [
    { stock: 'A', po: 'SFO', month: '2026-05' },
    { stock: 'A', po: 'FPO', month: '2026-06' },
    { stock: 'B', po: 'SFO' },                       // a position: no month
  ]
  eq(applyFilters(rows, { month: '2026-05' }).length, 2, 'a month narrows weekly rows and leaves positions alone')
  eq(applyFilters(rows, { stock: 'A', po: 'SFO' }).length, 1, 'stock and PO together')
  eq(applyFilters(rows, { po: 'SFO' }, { po: false }).length, 3, 'a tab can ignore the PO filter')
  eq(applyFilters(null, {}), [], 'nothing loaded is an empty list, not a crash')
}

/* ---- sorting: a stock with no quota never tops "most used" ------------- */
{
  const r = [{ u: 0.5 }, { u: null }, { u: 0.9 }]
  eq(sortRows(r, 'u', -1).map((x) => x.u), [0.9, 0.5, null], 'descending, null last')
  eq(sortRows(r, 'u', 1).map((x) => x.u), [0.5, 0.9, null], 'ascending, null still last')
}

/* ---- the used bar's colours are the app's signal colours --------------- */
{
  eq(usedTone(0.74), 'kelp', 'under 75% is on track')
  eq(usedTone(0.75), 'brass', '75% is watch')
  eq(usedTone(0.9), 'brass', '90% exactly is still watch')
  eq(usedTone(0.91), 'rust', 'over 90% is short')
  eq(usedTone(null), null, 'no quota, no colour')
}

{
  eq(monthsOf([{ year: 2026, month: '2026-01' }, { year: 2026, month: '2026-03' }, { year: 2025, month: '2025-12' }], 2026),
    ['2026-03', '2026-01'], 'a year\'s months, newest first')
  eq(t1(-1234.56), '-1,234.6', 'tonnes to one place, thousands marked')
}

/* ---- THE ROUTE IS NOT /quota's, AND THE DEMO NEVER SEES IT ------------- *
 * accessForPath matches a prefix only at a '/', so '/quota-swaps' must not
 * inherit '/quota' — that one is skipper-only and this one is for viewers too. */
{
  eq(accessForPath('/quota-swaps'), 'fleetTools', 'its own access, not /quota\'s')
  eq(accessForPath('/quota'), 'skipper', 'and /quota is unchanged')
  const item = NAV.flatMap((g) => g.items).find((i) => i.to === '/quota-swaps')
  ok(item && item.notOnDemo, 'off the demo menu')
  ok(canSee(item.access, { role: 'viewer' }, item), 'a viewer sees it')
  ok(canSee(item.access, { role: 'skipper' }, item), 'a skipper sees it')
  ok(!canSee(item.access, { role: 'skipper', is_demo: true }, item), 'the demo login does not')
  ok(!canSee(item.access, { role: 'officer' }, item), 'an officer does not')
}

console.log(`uk-quota-swaps: ${n} checks passed`)
