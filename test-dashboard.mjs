import assert from 'node:assert'
import {
  priceRows, landedThisYear, boatBlocks, toDo, isNewBoat, FIRST_STEPS,
} from './src/lib/dashboard.js'

let n = 0
const ok = (c, why) => { assert.ok(c, why); n++ }
const eq = (a, b, why) => { assert.deepStrictEqual(a, b, why); n++ }

/* ---- WHY THE MARKET IS THE TOP BAND ------------------------------------
 * Measured across the thirteen fleets: quota 1, trips 1, invoices 1, crew 3,
 * landings 7 — and SIX with nothing at all. `market_prices` has no fleet_id,
 * so it is the one thing every boat has in full on the day she signs up.
 */
const p = (date, species, grade, ave) =>
  ({ price_date: date, species, grade, ave, low: ave == null ? null : ave - 0.2, high: ave == null ? null : ave + 0.3 })

{
  const prices = [
    p('2026-09-07', 'Cod', 'A2', 4.20), p('2026-09-06', 'Cod', 'A2', 3.90),
    p('2026-08-20', 'Cod', 'A2', 3.60), p('2026-08-27', 'Cod', 'A2', 3.80),
    p('2026-09-07', 'Cod', 'A3', 3.10), p('2026-09-06', 'Cod', 'A3', 3.10),
    p('2026-09-07', 'Haddock', 'A2', 2.50), p('2026-09-06', 'Haddock', 'A2', 2.80),
  ]
  const out = priceRows(prices, ['Cod', 'Haddock'])
  eq(out.day, '2026-09-07', 'the latest board day')
  eq(out.previous, '2026-09-06', 'and the one before it')

  const cod = out.rows.find((r) => r.species === 'Cod')
  const a2 = cod.grades.find((g) => g.grade === 'A2')
  eq(a2.ave, 4.2, 'yesterday average')
  eq(a2.onDay, 0.3, 'up thirty pence on the day')
  /* THE FOUR-WEEK AVERAGE EXCLUDES THE DAY BEING COMPARED. Including it drags
     the baseline towards the figure being measured and flattens the move the
     column exists to show — worst on a thin species where one day is a large
     share of the window. */
  eq(a2.avg, 3.77, 'the window is the days BEFORE, not including today')
  eq(a2.days, 3, 'and it says how many days it rests on')
  eq(a2.onAvg, 0.43, 'so the move against the average is real')

  /* NO CHANGE IS A REAL FACT and must not read as no price. */
  const a3 = cod.grades.find((g) => g.grade === 'A3')
  eq(a3.onDay, 0, 'a grade that sold at the same price moved by nothing')
  ok(a3.onDay !== null, 'which is not the same as having no move at all')

  const had = out.rows.find((r) => r.species === 'Haddock')
  eq(had.grades[0].onDay, -0.3, 'and a fall is negative')
}

/* ---- A SPECIES THE BOARD DOES NOT CARRY SAYS SO ------------------------
 * Dropping the row would read as the boat not landing it.
 */
{
  const out = priceRows([p('2026-09-07', 'Cod', 'A2', 4.2)], ['Cod', 'Squid'])
  const squid = out.rows.find((r) => r.species === 'Squid')
  ok(squid, 'a species with no prices still gets a row')
  eq(squid.onBoard, false, 'marked as not on the board')
  eq(squid.grades, [], 'with no invented grades')
}

/* ---- THE BOARD AND THE NOTES DISAGREE ON TWO NAMES ---------------------
 * Lythe is Audacious's fifth by value, and the board calls it Pollack. On a
 * naive join her own boat would have shown a blank price in the first week.
 */
{
  const out = priceRows([p('2026-09-07', 'Pollack', 'A2', 2.10)], ['Lythe'])
  const lythe = out.rows.find((r) => r.species === 'Lythe')
  eq(lythe.onBoard, true, 'lythe is found under the board name pollack')
  eq(lythe.boardName, 'Pollack', 'and the row remembers what the board calls it')
  eq(lythe.grades[0].ave, 2.1, 'with its price')
}

/* ---- NULL IS NOT ZERO -------------------------------------------------- */
{
  const out = priceRows([{ price_date: '2026-09-07', species: 'Cod', grade: 'A2', ave: null }], ['Cod'])
  const g = out.rows[0].grades[0]
  eq(g.ave, null, 'a grade that did not sell has no price')
  eq(g.onDay, null, 'and no move on the day')
  eq(g.onAvg, null, 'and none on the average')
  eq(priceRows([], ['Cod']).rows, [], 'an empty board gives nothing')
  eq(priceRows(null, ['Cod']).day, null, 'and null does not throw')
}

/* ---- WHAT SHE LANDED THIS YEAR ----------------------------------------- */
{
  const rows = [
    { landing_date: '2026-03-01', species_canon: 'Cod', value: 100, weight_kg: 20 },
    { landing_date: '2026-04-01', species_canon: 'Cod', value: 50, weight_kg: 30 },
    { landing_date: '2025-04-01', species_canon: 'Cod', value: 999, weight_kg: 999 },
    { landing_date: '2026-04-01', species: 'Ling', value: 40, weight_kg: 10 },
  ]
  const out = landedThisYear(rows, { year: 2026 })
  eq(out.find((r) => r.species === 'Cod'), { species: 'Cod', value: 150, weight: 50 },
     'this year only, summed')
  ok(out.find((r) => r.species === 'Ling'), 'falling back to the raw species where there is no canon')
  eq(out.length, 2, 'and last year is not in it')
}

/* ---- A BLOCK WITH NOTHING IN IT IS ABSENT, NOT EMPTY -------------------
 * Twelve of thirteen fleets were shown a quota heading over nothing, and a
 * heading with no figure under it reads as broken rather than as
 * not-applicable.
 */
{
  const empty = boatBlocks({})
  for (const k of ['lastTrip', 'month', 'quota', 'expiring', 'books']) {
    eq(empty[k].has, false, `${k} is absent when there is nothing in it`)
  }
  ok(isNewBoat(empty), 'and a boat with none of them is a new boat')
  eq(FIRST_STEPS.length, 3, 'who gets three things to do, each one click')

  const some = boatBlocks({
    landings: [{ landing_date: '2026-09-01', value: 1000, weight_kg: 400, boxes: 20, vessel: 'X', reconcile_ok: true }],
  })
  eq(some.lastTrip.has, true, 'a landing gives a last trip')
  eq(some.quota.has, false, 'and quota stays absent — it is a block like any other now')
  ok(!isNewBoat(some), 'a boat with a landing is not new')
}

/* ---- THE LAST TRIP, AND WHETHER IT CAN BE TRUSTED ---------------------- */
{
  const b = boatBlocks({ landings: [
    { landing_date: '2026-09-01', value: 1000, weight_kg: 400, boxes: 20, reconcile_ok: false },
    { landing_date: '2026-08-01', value: 500, weight_kg: 200, boxes: 10, reconcile_ok: true },
  ] })
  eq(b.lastTrip.date, '2026-09-01', 'the most recent landing is the last trip')
  eq(b.lastTrip.ppk, 2.5, 'with its price per kilo')
  /* A NOTE THAT DID NOT RECONCILE CANNOT BE TRUSTED FOR ITS FIGURES, and the
     front page is the worst place to print them silently. */
  eq(b.lastTrip.reconciled, false, 'and says when it did not add up to its own printed total')
  /* Three states, not two: a note printing no total has not FAILED. */
  eq(boatBlocks({ landings: [{ landing_date: '2026-09-01', value: 1, weight_kg: 1, reconcile_ok: null }] })
     .lastTrip.reconciled, null, 'a note with no printed total to check is neither')
}

/* ---- THE SAME MONTH LAST YEAR, not last month -------------------------
 * A boat's year is seasonal; comparing September with August says nothing.
 */
{
  const b = boatBlocks({
    asOf: '2026-09-08',
    landings: [
      { landing_date: '2026-09-01', value: 1000, weight_kg: 100 },
      { landing_date: '2026-09-05', value: 500, weight_kg: 50 },
      { landing_date: '2026-08-20', value: 9999, weight_kg: 999 },
      /* Last September: two trips in the first eight days, two after. */
      { landing_date: '2025-09-03', value: 1200, weight_kg: 120 },
      { landing_date: '2025-09-07', value: 800, weight_kg: 80 },
      { landing_date: '2025-09-10', value: 90_000, weight_kg: 9000 },
      { landing_date: '2025-09-25', value: 200_000, weight_kg: 20_000 },
    ],
  })
  eq(b.month.gross, 1500, 'this month is September only')
  eq(b.month.trips, 2, 'two trips')

  /* A PART MONTH IS NEVER COMPARED WITH A WHOLE ONE, and this is the bug David
     hit on the live page: on the 8th, this month held eight days and last
     September held thirty, so the front page reported "4 trips, −98%" against
     a boat that had simply not finished the month yet.
     The invoice rule arriving somewhere else — and worse here, because a month
     is short enough that one trip either way swings it by a hundred per cent. */
  eq(b.month.lastYear, 2000, 'only the same DAYS of the same month last year')
  eq(b.month.lastYearTrips, 2, 'and only those trips')
  eq(b.month.through, 8, 'with the day it is compared through')
  eq(b.month.month, '2026-09', 'and the month it is')
  ok(b.month.lastYear < 290_000, 'the rest of last September is not in it')

  /* NOTHING TO SOMETHING IS NOT A CHANGE. A boat in her first year gets the
     figure and no comparison. */
  const first = boatBlocks({ asOf: '2026-09-08',
    landings: [{ landing_date: '2026-09-01', value: 1000, weight_kg: 100 }] })
  eq(first.month.lastYear, null, 'a first year has nothing to compare against')
  eq(first.month.lastYearTrips, null, 'and says so rather than showing nought')
}

/* ---- WHAT TO DO NEXT --------------------------------------------------
 * Only what a person can act on today. A list that includes things nobody can
 * do anything about is the alerts page — and the alerts page is WHY this
 * exists: 6,236 unread across the fleets, 6,126 of them market price alerts
 * raised for everyone, so a fleet that has never uploaded anything carries
 * more than a thousand and the badge means nothing.
 */
{
  eq(toDo({}), [], 'nothing to do is an empty list, not a heading over nothing')
  const out = toDo({ unreconciled: 2, unreadBundles: 1, unfiledFirms: 3, expiredCount: 1 })
  eq(out.length, 4, 'each thing is its own item')
  eq(out[0].key, 'expired', 'an expired certificate comes first')
  ok(out[0].urgent, 'and is marked urgent')
  ok(out.every((i) => i.to && i.says), 'every item says what and where')
  ok(/2 sales notes/.test(out.find((i) => i.key === 'reconcile').says), 'plurals are right')
  ok(/1 invoice bundle /.test(out.find((i) => i.key === 'bundles').says), 'and singulars too')
}

console.log('dashboard: ' + n + ' checks passed')
