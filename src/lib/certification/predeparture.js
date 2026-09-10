/* THE PRE-DEPARTURE CHECK — one screen, and every entry lands in its own book.
 *
 * David, Sep 2026: *"to keep up with this book keeping we should have a pre
 * departure check list which gets all the entries done and logs into their own
 * separate pages ... when a crew list is lodged/saved, should the page direct
 * the person to do the rest of the entries?"*
 *
 * YES — AND THE CHECKLIST IS NOT A PLACE WHERE ANYTHING IS KEPT. Every one of
 * the eight things he named already has a book, and each is a legal record in
 * its own right. A checklist that stored its own copy would be a second version
 * of the truth — the failure this codebase has already had twice, with the two
 * parse-core copies and the two buyer leagues. So this READS the books and says
 * what is done; the entry itself is made where it belongs and nowhere else.
 *
 * NO NEW TABLE FOR THE DEPARTURE EITHER. `quota_trips.departure_at` comes
 * straight off the logbook export and is already the record of when she sailed.
 * Inventing a `departures` table would be a second copy of that too.
 *
 * ---- THE THREE CLASSES, AND WHY THEY ARE NOT ONE -------------------------
 *
 * The whole thing turns on this. A checklist that demanded all eight every trip
 * would fire on the ordinary case and stop being read within a fortnight, which
 * is the fault this file records against the 6,236 unread alerts and the engine
 * limits alike.
 *
 *   every       done before EVERY departure — the crew list, the radio checks.
 *   due         on its OWN clock, and a drill done last week is not outstanding
 *               because she happens to be sailing today. OLB 7, 17, 18 and 21
 *               run to 30, 30, 30 and 90 days.
 *   ifHappened  only where something occurred. There is no missing garbage
 *               entry when nothing went ashore, and demanding one would be
 *               asking for an entry about nothing.
 *
 * ---- AND IT NEVER SAYS SHE IS READY TO SAIL ------------------------------
 *
 * It reports what is done and what is not. "Ready" is a claim about a vessel
 * and her crew that no software can make from four database tables, and a green
 * tick against a departure is exactly the sort of thing that gets read back in
 * an inquiry.
 */

/* Fresh water and provisions are ONE entry, not two. David listed them
   separately and SI 1981/570 puts them together at 18: "Inspection of
   provisions and water, and the result of it". Splitting them here would make
   the app ask for two entries where the book has one. */
export const ITEMS = [
  {
    key: 'crew_list',
    label: 'Crew list',
    why: 'Who is aboard changes every trip, and it is a border document.',
    cls: 'every',
    to: '/crew-list',
    book: 'crew_lists',
  },
  {
    key: 'radio_tests',
    label: 'Radio checks — EPIRB, handheld VHF, VHF DSC, MF DSC, batteries',
    /* Schedule 3 does not require a test log at all; it requires distress,
       urgency, safety, incidents and a daily position. The tests are the boat's
       own practice, which is why the cadence is hers and not the regulation's. */
    why: 'Not required by Schedule 3 — this is the boat’s own practice.',
    cls: 'every',
    to: '/radio-log',
    book: 'radio_log_entries',
  },
  {
    key: 'olb_drills',
    label: 'Musters, drills and appliance inspections',
    why: 'Official Log Book entry 7.',
    cls: 'due',
    olb: 7,
    to: '/official-log-book',
  },
  {
    key: 'olb_accommodation',
    label: 'Inspection of crew accommodation',
    why: 'Official Log Book entry 17.',
    cls: 'due',
    olb: 17,
    to: '/official-log-book',
  },
  {
    key: 'olb_provisions_water',
    label: 'Inspection of provisions and fresh water',
    why: 'Official Log Book entry 18 — the book treats them as one inspection.',
    cls: 'due',
    olb: 18,
    to: '/official-log-book',
  },
  {
    key: 'olb_steering',
    label: 'Steering gear drills, checks and tests',
    why: 'Official Log Book entry 21.',
    cls: 'due',
    olb: 21,
    to: '/official-log-book',
  },
  {
    key: 'bunkering',
    label: 'Bunkering, and the Oil Record Book entry for it',
    why: 'Only where fuel or oil moved — and then the book wants it.',
    cls: 'ifHappened',
    to: '/oil-record-book',
  },
  {
    key: 'garbage',
    label: 'Garbage Record Book',
    why: 'Only where something went ashore.',
    cls: 'ifHappened',
    to: '/garbage-log',
  },
]

export const itemOf = (key) => ITEMS.find((i) => i.key === key) || null

/**
 * The check for a departure.
 *
 * `since` is the window this departure owns: from the last sailing to this one.
 * An entry made for the PREVIOUS trip must not count for this one, which is the
 * whole reason the window exists rather than "is there an entry at all".
 */
export function predeparture({
  departureAt,
  previousDepartureAt = null,
  crewLists = [],
  radioEntries = [],
  olbEntries = [],
  fuelRows = [],
  orbEntries = [],
  garbageRows = [],
  intervals = { 7: 30, 17: 30, 18: 30, 21: 90 },
  asOf,
} = {}) {
  const dep = day(departureAt)
  if (!dep) {
    /* NO DEPARTURE, NO CHECK. A checklist against no date would measure every
       book from the beginning of time and report everything as outstanding. */
    return { departure: null, items: [], outstanding: [], known: false }
  }
  const from = day(previousDepartureAt)
  const today = day(asOf) || new Date().toISOString().slice(0, 10)

  /* Made for THIS departure: on or after the last sailing, up to this one.
     Where there is no previous sailing on record the window opens at the
     departure itself — an entry from an unknown earlier trip is not evidence
     about this one. */
  const inWindow = (d) => {
    const x = day(d)
    if (!x) return false
    return x <= dep && (from ? x > from : x >= dep)
  }

  const items = ITEMS.map((it) => {
    if (it.cls === 'every') {
      const rows = it.key === 'crew_list'
        ? crewLists.filter((c) => inWindow(c.departure_date || c.created_at))
        : radioEntries.filter((e) => e.kind === 'test' && inWindow(e.entry_date || e.logged_at))
      return {
        ...it,
        state: rows.length ? 'done' : 'outstanding',
        n: rows.length,
        last: lastDate(rows.map((r) => r.departure_date || r.entry_date || r.created_at)),
      }
    }

    if (it.cls === 'due') {
      const mine = olbEntries.filter((e) => Number(e.entry_n) === it.olb)
      const last = lastDate(mine.map((e) => e.entry_date))
      const every = intervals[it.olb]
      /* NEVER DONE IS NOT OVERDUE BY A NUMBER OF DAYS. There is no date to
         count from, and reporting one would invent it. */
      if (!last) return { ...it, state: 'never', every, last: null, n: mine.length }
      const age = daysBetween(last, today)
      return {
        ...it,
        state: age > every ? 'overdue' : age > every - 7 ? 'due' : 'done',
        every, last, age, n: mine.length,
      }
    }

    /* ifHappened. THE ABSENCE OF THE EVENT IS NOT A GAP — what makes it
       outstanding is the event having happened and the book not saying so. */
    if (it.key === 'garbage') {
      const rows = garbageRows.filter((g) => inWindow(g.entry_date))
      return { ...it, state: rows.length ? 'done' : 'nothing', n: rows.length }
    }

    const moved = fuelRows.filter((f) => inWindow(f.entry_date))
    if (!moved.length) return { ...it, state: 'nothing', n: 0 }
    const linked = new Set(orbEntries.map((e) => e.fuel_log_id).filter(Boolean))
    const unrecorded = moved.filter((f) => !linked.has(f.id))
    return {
      ...it,
      state: unrecorded.length ? 'outstanding' : 'done',
      n: moved.length,
      unrecorded: unrecorded.length,
    }
  })

  return {
    departure: dep,
    from,
    items,
    /* WHAT A PERSON CAN ACT ON. `nothing` is not outstanding — it is the
       ordinary case — and neither is a drill inside its interval. */
    outstanding: items.filter((i) => ['outstanding', 'overdue', 'never'].includes(i.state)),
    known: true,
  }
}

/**
 * What to say after a crew list is saved.
 *
 * David asked whether the page should direct the person onward. It should, and
 * the direction is the SAME LIST — so the crew list is one step of the check
 * rather than a page that nags afterwards about things it does not own.
 *
 * IT NAMES THE NEXT THING, NOT ALL OF THEM. A list of seven after saving one is
 * a wall; the next single thing is an instruction.
 */
export function nextAfterCrewList(check) {
  if (!check?.known) return null
  const left = check.outstanding.filter((i) => i.key !== 'crew_list')
  if (!left.length) return null
  return { next: left[0], remaining: left.length }
}

/* ---- helpers ------------------------------------------------------------ */
const day = (d) => {
  const s = String(d || '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}
function lastDate(list = []) {
  const days = list.map(day).filter(Boolean).sort()
  return days.length ? days[days.length - 1] : null
}
function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5)
}
