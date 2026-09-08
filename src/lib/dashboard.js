/* THE FRONT PAGE, AND WHY IT IS BUILT THIS WAY ROUND.
 *
 * David, Sep 2026: "not sure i like the quota position as main dashboard page
 * with the banner of the last trip details. not every boat will have quota in
 * their system so is it appropriate?"
 *
 * He was right, and the measurement is worse than the objection. Across the
 * thirteen fleets on this database:
 *
 *     quota snapshots        1 of 13      logbook trips   1
 *     invoices               1            engine/fuel     1
 *     crew                   3            landings        7
 *     NOTHING AT ALL         6
 *
 * So the quota block — the main thing on the front page — was empty for twelve
 * fleets out of thirteen, and six customers opened the app on a page with
 * nothing on it whatever.
 *
 * THE ONE THING EVERY BOAT HAS IS THE MARKET. `market_prices` carries no
 * `fleet_id`: it is the shared Peterhead and Denmark board, 45,973 rows, and it
 * was current yesterday. A boat on the day she signs up has it in full, before
 * she has uploaded a thing. That is why prices are the first band and not a
 * corner of the page.
 *
 * THREE BANDS, AND A BAND THAT HAS NOTHING IN IT DOES NOT APPEAR:
 *
 *   1  the market      — everyone, always
 *   2  your boat       — each block only if she has told us something
 *   3  what to do next — only if there is something to do
 */

import { dashboardSpecies, speciesBasis, boardNameFor } from './market/boardNames.js'

export { dashboardSpecies, speciesBasis }

/* ==== 1. THE MARKET ======================================================= */

/**
 * One row per species and grade: what it made on the latest board day, against
 * the day before and against the four weeks before that.
 *
 * `prices` is [{ price_date, species, grade, subgrade, ave, low, high }] from
 * `market_prices`, already filtered to one source.
 *
 * THE FOUR-WEEK AVERAGE EXCLUDES THE DAY BEING COMPARED. Including it drags the
 * baseline towards the figure being measured, which flattens exactly the move
 * the column exists to show — worst on a thin species where one day is a large
 * share of the window.
 */
export function priceRows(prices = [], species = [], { asOf, windowDays = 28 } = {}) {
  const rows = Array.isArray(prices) ? prices : []
  const days = [...new Set(rows.map((r) => day(r.price_date)).filter(Boolean))].sort()
  const latest = asOf ? day(asOf) : days[days.length - 1] || null
  if (!latest) return { day: null, previous: null, rows: [] }

  const previous = days.filter((d) => d < latest).pop() || null
  const from = shiftDays(latest, -windowDays)

  /* The board's own name for each species, because the board and the notes
     disagree on two of them and one is Audacious's fifth by value. */
  const want = new Map(species.map((s) => [boardNameFor(s), s]))

  const out = []
  for (const [boardName, appName] of want) {
    const mine = rows.filter((r) => r.species === boardName)
    /* A SPECIES THE BOARD DOES NOT CARRY IS SAID, not dropped and not blank.
       Vanishing would look like the boat does not land it. */
    if (!mine.length) {
      out.push({ species: appName, boardName, onBoard: false, grades: [] })
      continue
    }
    const grades = [...new Set(mine.map(gradeKey))].sort()
    out.push({
      species: appName,
      boardName,
      onBoard: true,
      grades: grades.map((g) => {
        const today = mine.find((r) => gradeKey(r) === g && day(r.price_date) === latest)
        const yday = previous
          ? mine.find((r) => gradeKey(r) === g && day(r.price_date) === previous) : null
        const window = mine.filter((r) => gradeKey(r) === g
          && day(r.price_date) >= from && day(r.price_date) < latest)
        const avg = mean(window.map((r) => num(r.ave)))
        const now = today ? num(today.ave) : null
        return {
          grade: g,
          ave: now, low: today ? num(today.low) : null, high: today ? num(today.high) : null,
          /* NULL, NEVER ZERO. A grade that did not sell yesterday has no price
             and no change — and a change of nought is a real and different
             thing, which `Number('') === 0` has turned into a lie six times in
             this repo already. */
          onDay: now != null && yday && num(yday.ave) != null ? round2(now - num(yday.ave)) : null,
          onAvg: now != null && avg != null ? round2(now - avg) : null,
          avg,
          days: window.length,
        }
      }),
    })
  }
  return { day: latest, previous, from, rows: out }
}

/** What a fleet landed this year, shaped for `dashboardSpecies`. */
export function landedThisYear(rows = [], { year } = {}) {
  const y = year || new Date().getUTCFullYear()
  const by = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const d = day(r.landing_date)
    if (!d || Number(d.slice(0, 4)) !== y) continue
    const s = r.species_canon || r.species
    if (!s) continue
    const cur = by.get(s) || { species: s, value: 0, weight: 0 }
    cur.value += num(r.value) || 0
    cur.weight += num(r.weight_kg) || 0
    by.set(s, cur)
  }
  return [...by.values()]
}

/* ==== 2. YOUR BOAT ======================================================== */

/**
 * Each block, with `has` saying whether there is anything in it.
 *
 * A BLOCK WITH NOTHING IN IT IS ABSENT, NOT EMPTY. Twelve of thirteen fleets
 * were being shown a quota heading over nothing; a heading with no figure under
 * it reads as broken rather than as not-applicable.
 */
export function boatBlocks({ landings = [], quota = null, expiring = [], books = [], asOf } = {}) {
  const today = day(asOf) || new Date().toISOString().slice(0, 10)
  const sorted = [...(Array.isArray(landings) ? landings : [])]
    .filter((l) => day(l.landing_date))
    .sort((a, b) => day(b.landing_date).localeCompare(day(a.landing_date)))

  const last = sorted[0] || null
  const thisMonth = sorted.filter((l) => day(l.landing_date).slice(0, 7) === today.slice(0, 7))
  /* The SAME month last year, not last month — a boat's year is seasonal and
     comparing September with August says nothing. */
  const lastYear = sorted.filter((l) => day(l.landing_date).slice(0, 7)
    === `${Number(today.slice(0, 4)) - 1}-${today.slice(5, 7)}`)

  return {
    lastTrip: last ? {
      has: true, date: day(last.landing_date), vessel: last.vessel,
      gross: num(last.value), boxes: num(last.boxes), kg: num(last.weight_kg),
      ppk: num(last.weight_kg) ? round2(num(last.value) / num(last.weight_kg)) : null,
      /* A landing that did not reconcile cannot be trusted for its figures, and
         the front page must say so rather than quietly printing them. */
      reconciled: last.reconcile_ok,
    } : { has: false },

    month: thisMonth.length ? {
      has: true,
      trips: thisMonth.length,
      gross: sum(thisMonth.map((l) => num(l.value))),
      /* NO COMPARISON WHERE THERE IS NOTHING TO COMPARE WITH. A boat in her
         first year gets the figure and no percentage — nothing to something is
         not a change, it is a start. */
      lastYear: lastYear.length ? sum(lastYear.map((l) => num(l.value))) : null,
      lastYearTrips: lastYear.length || null,
    } : { has: false },

    /* QUOTA IS NOW A BLOCK LIKE ANY OTHER, and absent for the twelve fleets
       that have none. It was the headline. */
    quota: quota?.lines?.length
      ? { has: true, asAt: quota.snapshot?.last_landing_date || null, lines: quota.lines }
      : { has: false },

    expiring: expiring.length
      ? { has: true, items: [...expiring].sort((a, b) => day(a.expiry_date).localeCompare(day(b.expiry_date))) }
      : { has: false },

    books: books.length ? { has: true, items: books } : { has: false },
  }
}

/* ==== 3. WHAT TO DO NEXT ================================================== */

/**
 * Things already sitting in the app waiting on a decision.
 *
 * ONLY WHAT A PERSON CAN ACT ON TODAY, and each one says what and where. A list
 * that includes things nobody can do anything about is the alerts page, and the
 * alerts page is why this exists: 6,236 unread alerts across the fleets, of
 * which 6,126 are market price alerts raised for everyone. A fleet that has
 * never uploaded anything is carrying more than a thousand of them, so the
 * badge means nothing and nobody reads it.
 */
export function toDo({ unreconciled = 0, unreadBundles = 0, unfiledFirms = 0,
                       undecidedVessels = 0, expiredCount = 0 } = {}) {
  const out = []
  if (expiredCount > 0) {
    out.push({ key: 'expired', to: '/vessel-certs', urgent: true,
      says: `${expiredCount} certificate${expiredCount === 1 ? ' has' : 's have'} expired` })
  }
  if (unreconciled > 0) {
    out.push({ key: 'reconcile', to: '/sales',
      says: `${unreconciled} sales note${unreconciled === 1 ? '' : 's'} did not add up to `
        + `${unreconciled === 1 ? 'its' : 'their'} own printed total` })
  }
  if (unreadBundles > 0) {
    out.push({ key: 'bundles', to: '/invoices',
      says: `${unreadBundles} invoice bundle${unreadBundles === 1 ? '' : 's'} not read yet` })
  }
  if (unfiledFirms > 0) {
    out.push({ key: 'firms', to: '/invoices',
      says: `${unfiledFirms} firm${unfiledFirms === 1 ? '' : 's'} not filed to a trade` })
  }
  if (undecidedVessels > 0) {
    out.push({ key: 'vessels', to: '/invoices',
      says: `${undecidedVessels} invoice${undecidedVessels === 1 ? '' : 's'} could belong to either boat` })
  }
  return out
}

/**
 * What a boat with nothing on record should be told to do.
 *
 * SIX OF THIRTEEN FLEETS HAVE UPLOADED NOTHING AT ALL, and they were getting a
 * blank page. The market band fills it on its own, and this says what would
 * fill the rest — three things, each one click, rather than an empty shell that
 * reads as broken.
 */
export const FIRST_STEPS = [
  { to: '/sales', says: 'Drop a sales note in', then: 'the trip, the buyers and the prices you got' },
  { to: '/vessel', says: "Fill in the boat's particulars", then: 'her length and tonnage decide which rules apply to her' },
  { to: '/crew', says: 'Add the crew', then: 'tickets and passports, and what is running out' },
]

export const isNewBoat = (blocks) =>
  !blocks.lastTrip.has && !blocks.quota.has && !blocks.expiring.has && !blocks.books.has

/* ---- helpers ------------------------------------------------------------ */
const gradeKey = (r) => [r.grade, r.subgrade].filter(Boolean).join(' ')
const day = (d) => {
  const s = String(d || '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}
function shiftDays(d, n) {
  const t = new Date(d + 'T00:00:00Z')
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}
function num(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const sum = (a) => a.reduce((t, x) => t + (x || 0), 0)
function mean(a) {
  const ok = a.filter((x) => x != null)
  return ok.length ? round2(sum(ok) / ok.length) : null
}
const round2 = (n) => Math.round(n * 100) / 100
