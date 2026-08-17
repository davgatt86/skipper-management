/* What each TRIP earned, per day at sea.
 *
 * THE UNIT IS THE TRIP, NOT THE LANDING, and that is the whole point of this
 * file. A trip routinely lands more than once — a few boxes at Ullapool on the
 * way past, then the trip proper at Peterhead — and EVERY ONE of those
 * landings carries the whole trip's days at sea. Measured on Audacious:
 *
 *     120 landings · 51 within 3 days of the one before
 *                  · 37 of those carrying an identical days-at-sea figure
 *     they collapse to 72 real trips, 1.67 landings each
 *
 * So dividing a landing's gross by its days_at_sea counts the same days two
 * and three times over, and understates the rate badly: £11,951 a day per
 * landing against £20,454 a day per trip, a 42% error. A one-box landing at
 * Ullapool reads as a catastrophic £12/day trip when it is half an hour's work
 * inside a good one.
 *
 * THE TRIP BOUNDARY IS REAL, NOT INFERRED. `quota_trips` carries trip_nr,
 * departure_at and arrival_at straight off the logbook export — 167 trips for
 * Audacious with both dates, back to 2022. Every one of the 120 sales landings
 * attaches to one. That is worth insisting on: the settlement solver has to
 * infer its boundaries because the office does not supply them, and it is the
 * hardest code in the repo. Here the answer is already recorded, so guessing
 * would be inventing a problem.
 *
 * DAYS AT SEA COME FROM THE LOGBOOK, not from the typed figure. Both are kept
 * and a disagreement is reported rather than silently resolved — 13 of the 72
 * trips differ by more than a day, and which is right is a question for the
 * skipper, not for this file.
 */

const day = 86400000
const toDate = (v) => (v ? new Date(v) : null)
const dayNum = (v) => { const d = toDate(v); return d ? Math.floor(d.getTime() / day) : null }
const r2 = (n) => Math.round(n * 100) / 100

/* A landing belongs to the trip it was landed off. Sales are dated the day the
 * fish hits the market, which is the day of arrival or a day or two after it
 * once the note comes through — never before the boat sailed. */
export const MATCH_BEFORE = 1     // a note dated the day before arrival
export const MATCH_AFTER = 3      // or up to three days after

export function matchTrip(landingDate, trips) {
  const ld = dayNum(landingDate)
  if (ld == null) return null
  let best = null, bestGap = Infinity
  for (const t of trips) {
    const arr = dayNum(t.arrival_at)
    if (arr == null) continue
    const gap = ld - arr
    if (gap < -MATCH_BEFORE || gap > MATCH_AFTER) continue
    if (Math.abs(gap) < bestGap) { best = t; bestGap = Math.abs(gap) }
  }
  return best
}

/* → { trips, unmatched, totals }
 *
 * `trips` are newest first, each carrying its landings. `unmatched` holds
 * landings with no logbook trip — kept and reported rather than dropped,
 * because a landing that has quietly vanished from a rate calculation is worse
 * than one that is shown as unattached. */
export function buildTrips(landings, quotaTrips, opts = {}) {
  const minDays = opts.minDays ?? 0.5
  const byNr = new Map()
  const unmatched = []

  for (const l of landings || []) {
    if (!(Number(l.value) > 0)) continue
    const t = matchTrip(l.landing_date, quotaTrips || [])
    if (!t) { unmatched.push(l); continue }
    if (!byNr.has(t.trip_nr)) byNr.set(t.trip_nr, { trip: t, landings: [] })
    byNr.get(t.trip_nr).landings.push(l)
  }

  const trips = [...byNr.values()].map(({ trip, landings: ls }) => {
    const dep = toDate(trip.departure_at)
    const arr = toDate(trip.arrival_at)
    // From the logbook: the boat sailed here and came back there.
    const rawDays = dep && arr ? (arr - dep) / day : null
    const days = rawDays != null && rawDays >= minDays ? r2(rawDays) : null

    const gross = ls.reduce((s, l) => s + Number(l.value || 0), 0)
    const kg = ls.reduce((s, l) => s + Number(l.weight_kg || 0), 0)
    const boxes = ls.reduce((s, l) => s + Number(l.boxes || 0), 0)

    // The typed figure, for comparison only. Every landing on a trip carries
    // the same one, so take the largest rather than summing — summing is the
    // error this whole file exists to avoid.
    const typedVals = ls.map((l) => Number(l.days_at_sea)).filter((n) => Number.isFinite(n) && n > 0)
    const typedDays = typedVals.length ? Math.max(...typedVals) : null

    return {
      tripNr: trip.trip_nr,
      vessel: trip.vessel || ls[0]?.vessel || '',
      departedAt: trip.departure_at, arrivedAt: trip.arrival_at,
      departurePort: trip.departure_port || '', arrivalPort: trip.arrival_port || '',
      days, typedDays,
      // Reported, never resolved. Which figure is right is the skipper's call.
      daysDisagree: days != null && typedDays != null && Math.abs(days - typedDays) > 1,
      landings: ls.slice().sort((a, b) => String(a.landing_date).localeCompare(b.landing_date)),
      landingCount: ls.length,
      markets: [...new Set(ls.map((l) => l.market).filter(Boolean))],
      gross: r2(gross), kg: r2(kg), boxes: r2(boxes),
      perDay: days ? Math.round(gross / days) : null,
      perKg: kg > 0 ? r2(gross / kg) : null,
      // Only ever true for a pair team. Gross and boxes sum across the two
      // boats; DAYS MUST NOT — both fished the same days, so the pair rate is
      // pair gross over the trip's days. Using the trip's own figure rather
      // than anything summed makes that correct by construction.
      vessels: [...new Set(ls.map((l) => l.vessel).filter(Boolean))],
    }
  })

  trips.sort((a, b) => String(b.arrivedAt || '').localeCompare(String(a.arrivedAt || '')))

  const rated = trips.filter((t) => t.perDay != null)
  const totalGross = trips.reduce((s, t) => s + t.gross, 0)
  const totalDays = rated.reduce((s, t) => s + t.days, 0)

  return {
    trips,
    unmatched,
    totals: {
      trips: trips.length,
      landings: trips.reduce((s, t) => s + t.landingCount, 0),
      gross: r2(totalGross),
      kg: r2(trips.reduce((s, t) => s + t.kg, 0)),
      days: r2(totalDays),
      // Weighted across the fleet's whole record, NOT a mean of the per-trip
      // rates: a two-day run must not carry the same weight as a nine-day one.
      perDay: totalDays > 0 ? Math.round(totalGross / totalDays) : null,
      best: rated.length ? Math.max(...rated.map((t) => t.perDay)) : null,
      worst: rated.length ? Math.min(...rated.map((t) => t.perDay)) : null,
      median: median(rated.map((t) => t.perDay)),
      disagreeing: trips.filter((t) => t.daysDisagree).length,
      multiLanding: trips.filter((t) => t.landingCount > 1).length,
    },
  }
}

function median(xs) {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}

/* Litres burned, estimated. There is no fuel price on any entry in the log, so
 * this is a QUANTITY and never a cost — it would be a made-up number.
 * 5,846 L per day at sea is measured across the twelve settlements carrying
 * fuel_used, Jan–Jul 2026. */
export const L_PER_DAY = 5846
export const estLitres = (days) => (days ? Math.round(days * L_PER_DAY) : null)
