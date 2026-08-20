/* HOW LONG THE GEAR LASTS.
 *
 * "Bridles lasted X days/trips, hoppers lasted X days/trips between renewal,
 * net lasted X days/trips between renewal. The usage tracked would show avg
 * time for each." (David, Aug 2026)
 *
 * The whole thing rests on components being objects with two dates rather than
 * events in a stream — a life is `removed_on - fitted_on`, read straight off.
 *
 * TWO DISCIPLINES THIS FILE EXISTS TO ENFORCE.
 *
 * 1. A SET STILL ON THE NET IS NOT A LIFE. It has not finished. Averaging it in
 *    would drag every figure down towards however recently the last renewal
 *    happened, and the more diligently the log is kept the worse the answer
 *    gets. It is reported separately, as the one still running, and compared
 *    against the average rather than folded into it.
 *
 * 2. THE COUNT IS PART OF THE ANSWER. One renewal is an anecdote, not an
 *    average, and a mean of two is barely better. Every summary carries `n` so
 *    the page can say so — the same discipline as the pair price-gap baseline,
 *    which reported 29 paired days and a mean difference of £0.000 rather than
 *    a headline number.
 */

import { daysBetween } from './gearAgg.js'

/* Trips whose arrival falls inside a window, ends INCLUSIVE.
 *
 * Inclusive on both ends because a set fitted the day the boat landed was
 * fitted after that trip, and a set taken off the day she landed came off after
 * that one too — the gear did the trip either way. Getting this wrong is an
 * off-by-one that no amount of reading the page would reveal.
 */
export function tripsBetween(dates, from, to) {
  if (!from) return null
  const a = String(from).slice(0, 10)
  const b = String(to || new Date().toISOString().slice(0, 10)).slice(0, 10)
  if (b < a) return 0
  return (dates || []).reduce((n, d) => {
    const s = String(d).slice(0, 10)
    return n + (s >= a && s <= b ? 1 : 0)
  }, 0)
}

/* Finished lives, newest first. A life needs BOTH dates: a set with no fitted
 * date has no measurable life, and one still on has not finished. */
export function livesOf(components, { netId = null, partKey = null, tripDates = {}, netVessel = {} } = {}) {
  return (components || [])
    .filter((c) => c.fitted_on && c.removed_on)
    .filter((c) => (!netId || c.net_id === netId) && (!partKey || c.part_key === partKey))
    .map((c) => ({
      ...c,
      days: daysBetween(c.fitted_on, c.removed_on),
      trips: tripsBetween(tripDates[netVessel[c.net_id]] || [], c.fitted_on, c.removed_on),
    }))
    .filter((c) => Number.isFinite(c.days))
    .sort((a, b) => String(b.removed_on).localeCompare(String(a.removed_on)))
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

/* The summary of a set of lives. Everything is null rather than 0 when there is
 * nothing to average — a zero average reads as "they last no time at all",
 * which is the opposite of "nobody has renewed one yet". */
export function summarise(lives) {
  const days = lives.map((l) => l.days).filter(Number.isFinite)
  const trips = lives.map((l) => l.trips).filter(Number.isFinite)
  // Cost is often unknown, so it is averaged over the ones that HAVE it and the
  // page says how many that was. A mean over "the ones we know" presented as a
  // mean over all of them is a quiet lie.
  const costs = lives.map((l) => Number(l.cost)).filter((c) => Number.isFinite(c) && c > 0)
  return {
    n: lives.length,
    avgDays: days.length ? Math.round(mean(days)) : null,
    minDays: days.length ? Math.min(...days) : null,
    maxDays: days.length ? Math.max(...days) : null,
    avgTrips: trips.length ? Math.round(mean(trips) * 10) / 10 : null,
    minTrips: trips.length ? Math.min(...trips) : null,
    maxTrips: trips.length ? Math.max(...trips) : null,
    avgCost: costs.length ? Math.round(mean(costs)) : null,
    costKnown: costs.length,
  }
}

/* The set currently on a net: how long it has been there, and how that sits
 * against what one of these usually lasts. `over` is the fraction past the
 * average — 0.32 is "a third longer than usual" — and is null when there is no
 * average to compare against, which is most of the time at first. */
export function running(component, { avgDays, tripDates = [], today } = {}) {
  if (!component || !component.fitted_on) return null
  const days = daysBetween(component.fitted_on, today)
  const trips = tripsBetween(tripDates, component.fitted_on, today)
  return {
    component, days, trips,
    over: Number.isFinite(avgDays) && avgDays > 0 && Number.isFinite(days)
      ? Math.round(((days - avgDays) / avgDays) * 100) / 100
      : null,
  }
}

/* PER PART, across the whole fleet's nets — the table David asked for. Rows are
 * parts, because "how long do bridles last" is a question about bridles, not
 * about any one net. Each row also carries what is running now, per net, since
 * that is the thing you act on. */
export function partLives({ parts, nets, components, tripDates = {}, today }) {
  const netVessel = Object.fromEntries((nets || []).map((n) => [n.id, n.vessel_id]))
  const netById = Object.fromEntries((nets || []).map((n) => [n.id, n]))

  return (parts || []).map((part) => {
    const lives = livesOf(components, { partKey: part.key, tripDates, netVessel })
    const stats = summarise(lives)
    const fitted = (components || []).filter(
      (c) => c.part_key === part.key && !c.removed_on && netById[c.net_id])
    return {
      part,
      lives,
      ...stats,
      running: fitted
        .map((c) => ({
          net: netById[c.net_id],
          ...running(c, { avgDays: stats.avgDays, tripDates: tripDates[netVessel[c.net_id]] || [], today }),
        }))
        .filter((r) => r.days !== null || r.component)
        .sort((a, b) => (b.days ?? -1) - (a.days ?? -1)),
    }
  })
}

/* PER NET — the net's own life, and what its rig has cost it in renewals.
 * A net that has not been retired is still running, so its age is reported as
 * an age and never as a life. */
export function netLives({ nets, components, tripDates = {}, today, vessels = [] }) {
  const vesselOf = Object.fromEntries((vessels || []).map((v) => [v.id, v]))
  return (nets || []).map((net) => {
    const dates = tripDates[net.vessel_id] || []
    const end = net.retired_on || today
    const lives = livesOf(components, {
      netId: net.id, tripDates, netVessel: { [net.id]: net.vessel_id },
    })
    return {
      net,
      vessel: vesselOf[net.vessel_id] || null,
      retired: !!net.retired_on,
      ageDays: daysBetween(net.came_aboard, end),
      ageTrips: net.came_aboard ? tripsBetween(dates, net.came_aboard, end) : null,
      renewals: lives.length,
      ...summarise(lives),
    }
  }).sort((a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1))
}

/* How sure can we be? Kept in one place so every figure is labelled the same
 * way, rather than each panel inventing its own hedge. */
export function confidence(n) {
  if (!n) return { level: 'none', text: 'no renewals logged yet' }
  if (n === 1) return { level: 'one', text: 'one renewal — not an average yet' }
  if (n === 2) return { level: 'thin', text: 'two renewals — thin' }
  return { level: 'ok', text: `${n} renewals` }
}
