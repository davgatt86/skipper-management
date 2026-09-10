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

/* THE COLUMN NAMES ARE THE TABLES', NOT ONES THAT READ WELL.
   The first cut of this read `entry_date` off the Official Log Book and the
   radio log. Both are wrong — they are `occurred_on` and `log_date` — and
   because a missing column reads as undefined rather than throwing, every OLB
   item would have come out 'never' and the radio check 'outstanding' for ever.
   A checklist that says everything is outstanding is exactly as useless as one
   that says nothing is.

   The tests did not catch it because the fixtures were written from this file
   rather than from the tables. Same shape as the quota fixture that invented a
   `remaining` column: A FIXTURE THAT IS NOT SHAPED LIKE THE TABLE PROVES
   NOTHING ABOUT THE PAGE. They are shaped like the real rows now. */

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
    /* A NEW MAN HAS NOT DONE THE BOAT’S DRILL. This is the one where a change
       of crew is a reason in itself, not just the calendar. */
    crewSensitive: true,
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

/* TWO CLOCKS, AND THE FIRST IS THE LAW.

   David, Sep 2026: *"i didn't mean to put the reporting periods as guides. i
   was just pointing out that we can log in periods less than the minimum
   stautuary recquirement."*

   I had over-read him and thrown the statutory interval away, leaving only a
   cadence the boat set for itself — which would have let a genuine breach
   pass as a matter of preference. It is the other way round:

     THE STATUTORY INTERVAL IS A MAXIMUM. Going past it is a breach, and the
     page says overdue and means it.
     THE BOAT'S OWN CADENCE IS SHORTER, if she wants one. Going past that and
     not the statutory is a watch — her own standard, not the law's.

   The two are compared independently, so a cadence longer than the statutory
   cannot hide a breach: the statutory check fires regardless of what is set.

   WHERE THE FIGURES COME FROM IS RECORDED, because they are not all the same
   kind of thing. The ORB items were TRANSCRIBED from Appendix III and the OLB
   entries from SI 1981/570; these are the SKIPPER'S OWN READING of what his
   boat is held to — David, Sep 2026: *"i believe most are monthly"* — which is
   the best authority available and is not a citation. `basis` says which, so
   nobody later mistakes one for the other. */
export const STATUTORY = {
  7: { days: 30, basis: 'skipper',
    source: 'Monthly — the skipper’s reading. Not transcribed from the instrument.' },
  17: { days: 30, basis: 'skipper',
    source: 'Monthly — the skipper’s reading. Not transcribed from the instrument.' },
  18: { days: 30, basis: 'skipper',
    source: 'Monthly — the skipper’s reading. Not transcribed from the instrument.' },
  /* NOT CONFIRMED. David said "most are monthly" and did not name this one, so
     it keeps the quarterly it had and keeps saying it is unchecked. Reading
     "most" as "all" would be putting a figure in his mouth. */
  21: { days: 90, basis: 'unchecked',
    source: 'Steering gear — believed quarterly where SOLAS V/26 applies. Still to be confirmed.' },
}

export const statutoryFor = (olbN) => STATUTORY[olbN] || null

/* HOW OFTEN THE BOAT CHOOSES TO DO THEM, which may be oftener than the law
   asks and never less often. */
export const GUIDES = [
  { key: 'weekly', label: 'Weekly', days: 7 },
  { key: 'fortnightly', label: 'Fortnightly', days: 14 },
  { key: 'monthly', label: 'Monthly', days: 30 },
  { key: 'quarterly', label: 'Quarterly', days: 90 },
  /* NOT A NUMBER OF DAYS. David: "it's good practice to do drills and tests
     every time a voyage starts esp when there has been a change in the crew."
     A boat in port every trip can hold them every trip, and counting days
     would call a drill held last voyage "done" on this one. */
  { key: 'voyage', label: 'Every voyage', days: 'voyage' },
  { key: 'statutory', label: 'The statutory interval', days: null },
]

/** The guides worth offering for an entry: never one LONGER than the law. */
export function guidesFor(olbN) {
  const st = statutoryFor(olbN)
  if (!st) return GUIDES
  /* OFFERING A LONGER ONE WOULD BE OFFERING TO BREACH. `null` is "keep to the
     statutory", which is always available. */
  return GUIDES.filter((g) => g.days == null || g.days === 'voyage' || g.days <= st.days)
}

/* Shipped defaults. A fleet stores only what DIFFERS, so a later correction
   here reaches every boat that has not deliberately changed it — the same
   reasoning as the market rules and the stores catalogue. */
export const DEFAULT_GUIDES = { 7: 30, 17: 30, 18: 30, 21: 90 }

export function resolveGuides(stored) {
  const out = { ...DEFAULT_GUIDES }
  for (const [k, v] of Object.entries(stored || {})) {
    /* null is a real answer here — "no guide" — so it is kept, and only a
       value that is neither a number nor an explicit null is ignored. */
    if (v === null) out[k] = null
    else if (v === 'voyage') out[k] = 'voyage'
    else if (Number.isFinite(Number(v)) && Number(v) > 0) out[k] = Number(v)
  }
  return out
}

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
  guides = DEFAULT_GUIDES,
  crewChange = null,
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
        : radioEntries.filter((e) => e.kind === 'test' && inWindow(e.log_date))
      return {
        ...it,
        state: rows.length ? 'done' : 'outstanding',
        n: rows.length,
        last: lastDate(rows.map((r) => r.departure_date || r.log_date || r.created_at)),
      }
    }

    if (it.cls === 'due') {
      const mine = olbEntries.filter((e) => Number(e.entry_n) === it.olb)
      const last = lastDate(mine.map((e) => e.occurred_on))
      const st = statutoryFor(it.olb)
      const every = guides[it.olb] ?? null
      /* NEVER DONE IS NOT PAST AN INTERVAL BY A NUMBER OF DAYS. There is no
         date to count from, and reporting one would invent it. */
      /* A DRILL NEVER HELD, WITH A NEW MAN ABOARD, is doubly worth doing — so
         this is worked out BEFORE the early return, and every row in this band
         carries the same shape whatever state it is in. */
      const heldThisVoyage = every === 'voyage' && mine.some((e) => inWindow(e.occurred_on))
      const newCrew = !!(it.crewSensitive && crewChange?.changed && !heldThisVoyage)
      if (!last) {
        return { ...it, state: 'never', every, statutory: st, last: null, n: mine.length,
                 perVoyage: every === 'voyage', thisVoyage: heldThisVoyage,
                 forNewCrew: newCrew, crewChange: newCrew ? crewChange : null }
      }
      const age = daysBetween(last, today)
      /* THE STATUTORY CHECK FIRES FIRST AND INDEPENDENTLY, so a cadence set
         longer than the law — or none at all — cannot hide a breach. */
      const overStatutory = st ? age > st.days : false
      /* EVERY VOYAGE IS NOT A NUMBER OF DAYS. It asks whether one was held in
         THIS departure's window, the same test the crew list gets — counting
         days would call a drill held last voyage "done" on this one. */
      const perVoyage = every === 'voyage'
      const thisVoyage = heldThisVoyage
      const overOwn = perVoyage ? !thisVoyage : (every != null && age > every)
      /* AND A CHANGE OF CREW IS ITS OWN REASON. David: "esp when there has
         been a change in the crew". The app knows who was on the last list
         and who is on this one, so it can say so rather than leaving it to
         somebody to remember. Only ever an ADDITION to why it is worth doing
         — it never turns a done into a not-done on its own. */
      const forNewCrew = newCrew
      return {
        ...it,
        state: overStatutory ? 'overdue' : overOwn ? 'watch' : 'done',
        every, statutory: st, last, age, n: mine.length,
        perVoyage, thisVoyage, forNewCrew: !!forNewCrew,
        crewChange: forNewCrew ? crewChange : null,
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
    /* NOT DONE AND PAST THE GUIDE ARE TWO DIFFERENT FACTS, and rolling them
       together is how a checklist starts crying wolf. A crew list that has not
       been lodged is not done; a drill held 34 days ago against a 30-day guide
       is a judgement for the skipper. `nothing` is neither — it is the
       ordinary case.

       `never` counts as not done, because there is no record that it has ever
       been held — and so does `overdue`, which is past the STATUTORY interval
       and is a breach rather than a matter of the boat's own standard. */
    outstanding: items.filter((i) => ['outstanding', 'never', 'overdue'].includes(i.state)),
    watch: items.filter((i) => i.state === 'watch'),
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

/**
 * Who is on this voyage that was not on the last one.
 *
 * David: "it's good practice to do drills and tests every time a voyage starts
 * esp when there has been a change in the crew."
 *
 * COMPARED BY CREW ID WHERE THERE IS ONE, and by name only where there is not —
 * a man added by hand for one trip has no crew record, and matching him on a
 * name that was typed twice is the least bad option left. Names are compared
 * case- and space-insensitively for the same reason.
 *
 * IT REPORTS WHO JOINED, NOT A COUNT. "Two changed" tells nobody which drill
 * to hold or who to walk round the boat.
 */
export function crewChangeBetween(previousMembers = [], currentMembers = []) {
  const key = (m) => (m?.crew_id ? 'id:' + m.crew_id : 'nm:' + norm(m?.full_name))
  const before = new Set((previousMembers || []).map(key).filter((k) => k !== 'nm:'))
  const now = (currentMembers || []).filter((m) => key(m) !== 'nm:')

  /* NO PREVIOUS LIST IS NOT "EVERYBODY IS NEW". There is nothing to compare
     with, and reporting the whole crew as joiners would fire on the first
     voyage the app ever sees. */
  if (!before.size) return { changed: false, joined: [], known: false }

  const joined = now.filter((m) => !before.has(key(m)))
  return {
    changed: joined.length > 0,
    joined: joined.map((m) => m.full_name).filter(Boolean),
    known: true,
  }
}

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()

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
