/* Trip rates.
 *
 * The one thing this must get right: A TRIP IS NOT A LANDING. Measured on
 * Audacious, 120 landings collapse to 72 trips — and every landing on a trip
 * carries that whole trip's days at sea, so treating each as its own trip
 * counts the same days two and three times and understates the rate by 42%.
 */
import { buildTrips, matchTrip, estLitres, MATCH_AFTER } from './src/lib/tripAgg.js'

let fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

const trip = (nr, dep, arr, extra = {}) => ({ trip_nr: nr, departure_at: dep + 'T06:00:00Z', arrival_at: arr + 'T06:00:00Z', vessel: 'AUDACIOUS BF83', ...extra })
const land = (date, value, extra = {}) => ({ landing_date: date, value, weight_kg: value / 2, boxes: Math.round(value / 50), days_at_sea: null, vessel: 'AUDACIOUS BF83', ...extra })

/* The real shape that broke the naive version: one 8-day trip landing a single
 * box at Ullapool and the trip proper at Peterhead the next day. */
{
  const trips = [trip(101, '2026-03-11', '2026-03-19')]
  const landings = [
    land('2026-03-19', 98, { market: 'Don Fishing · Ullapool', boxes: 1, days_at_sea: 8 }),
    land('2026-03-20', 79902, { market: 'Don Fishing · Peterhead', boxes: 400, days_at_sea: 8 }),
  ]
  const { trips: out, totals } = buildTrips(landings, trips)
  eq('two landings make ONE trip', out.length, 1)
  eq('and it knows it landed twice', out[0].landingCount, 2)
  eq('gross is summed across both', out[0].gross, 80000)
  eq('days come from the logbook, counted ONCE', out[0].days, 8)
  eq('so the rate is trip gross over trip days', out[0].perDay, 10000)
  // The bug this replaces: 98/8 = £12/day would have been reported as a trip.
  eq('the one-box landing never becomes a £12/day trip', totals.worst, 10000)
  eq('both markets are named', out[0].markets.length, 2)
}

/* Days at sea: logbook wins, the typed figure is reported, never resolved. */
{
  const { trips: out } = buildTrips(
    [land('2026-04-10', 60000, { days_at_sea: 3 })],
    [trip(102, '2026-04-03', '2026-04-10')])
  eq('the logbook figure is used', out[0].days, 7)
  eq('the typed one is kept beside it', out[0].typedDays, 3)
  eq('and the disagreement is flagged, not silently fixed', out[0].daysDisagree, true)
  eq('the rate uses the logbook', out[0].perDay, Math.round(60000 / 7))
}
{
  const { trips: out } = buildTrips(
    [land('2026-04-10', 60000, { days_at_sea: 7 })],
    [trip(103, '2026-04-03', '2026-04-10')])
  eq('agreement is not flagged', out[0].daysDisagree, false)
}

/* Matching window. A sales note is dated when the fish hits the market — the
 * day of arrival or a day or two after, never before the boat sailed. */
{
  const ts = [trip(1, '2026-01-01', '2026-01-08')]
  eq('the day of arrival matches', matchTrip('2026-01-08', ts)?.trip_nr, 1)
  eq('the day before matches (an early note)', matchTrip('2026-01-07', ts)?.trip_nr, 1)
  eq('three days after still matches', matchTrip('2026-01-11', ts)?.trip_nr, 1)
  eq('four days after does not', matchTrip('2026-01-12', ts), null)
  eq('two days before does not', matchTrip('2026-01-06', ts), null)
  eq('mid-trip does not', matchTrip('2026-01-04', ts), null)
}
{
  // Back-to-back trips: the nearer arrival must win, not the first found.
  const ts = [trip(1, '2026-01-01', '2026-01-08'), trip(2, '2026-01-09', '2026-01-16')]
  eq('the nearest arrival wins', matchTrip('2026-01-16', ts)?.trip_nr, 2)
  eq('and the earlier one keeps its own', matchTrip('2026-01-08', ts)?.trip_nr, 1)
}

/* A landing with no logbook trip is KEPT and reported, never dropped. One that
 * has quietly vanished from a rate is worse than one shown as unattached. */
{
  const { trips: out, unmatched } = buildTrips(
    [land('2026-06-01', 5000), land('2026-06-20', 7000)],
    [trip(200, '2026-05-25', '2026-06-01')])
  eq('the matched one is a trip', out.length, 1)
  eq('the orphan is reported', unmatched.length, 1)
  eq('and is not counted in the gross', out[0].gross, 5000)
}

/* Pair teams: sum gross and boxes, NEVER days. Both boats fished the same
 * days, so the pair rate is pair gross over the trip's days. */
{
  const { trips: out } = buildTrips([
    land('2026-05-08', 40000, { vessel: 'BOY JOHN INS110' }),
    land('2026-05-08', 36000, { vessel: 'ROSEBLOOM INS353' }),
  ], [trip(300, '2026-05-01', '2026-05-08')])
  eq('a pair makes one trip', out.length, 1)
  eq('gross is the pair total', out[0].gross, 76000)
  eq('days are NOT doubled', out[0].days, 7)
  eq('so the pair rate is pair gross over the trip days', out[0].perDay, Math.round(76000 / 7))
  eq('and both boats are named', out[0].vessels.length, 2)
}

/* Totals are weighted, not a mean of rates — a two-day run must not carry the
 * same weight as a nine-day one. */
{
  const { totals } = buildTrips([
    land('2026-02-03', 2000), land('2026-02-20', 90000),
  ], [trip(1, '2026-02-01', '2026-02-03'), trip(2, '2026-02-11', '2026-02-20')])
  eq('gross over total days, not the average of the rates',
    totals.perDay, Math.round(92000 / 11))
  eq('which is NOT the mean of 1000 and 10000', totals.perDay === Math.round((1000 + 10000) / 2), false)
  eq('best and worst are still per trip', [totals.best, totals.worst], [10000, 1000])
}

/* Rubbish must not throw or silently corrupt a rate. */
{
  eq('no landings', buildTrips([], []).totals.trips, 0)
  eq('null everything', buildTrips(null, null).totals.trips, 0)
  eq('a zero-value landing is ignored',
    buildTrips([land('2026-01-08', 0)], [trip(1, '2026-01-01', '2026-01-08')]).trips.length, 0)
  const sameDay = buildTrips([land('2026-01-01', 500)], [trip(1, '2026-01-01', '2026-01-01')])
  eq('a trip with no measurable length gets no rate rather than a divide by zero',
    sameDay.trips[0].perDay, null)
  eq('and is left out of the weighted total', sameDay.totals.perDay, null)
}

eq('estimated litres is a quantity, from measured burn', estLitres(7), 40922)
eq('and nothing without days', estLitres(null), null)
eq('the match window is stated, not magic', MATCH_AFTER, 3)

console.log('')
console.log(fail === 0 ? 'all passed' : `${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
