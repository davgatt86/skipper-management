import { CERT_LEAD_DAYS } from '../certs/certStatus.js'
import { assessmentState, withLineage, rating, equipmentState } from './safety.js'

/* THE INSPECTION PACK — what the records hold for a period, in one document.
 *
 * David, Sep 2026: "build inspection pack." It was on the explicitly-not-wanted
 * list, then "let's keep the inspection pack in mind. we can build towards it",
 * and now it is asked for outright.
 *
 * IT REPORTS THE RECORDS. IT NEVER CERTIFIES THE VESSEL.
 * Same rule as the pre-departure check refusing to say she is ready to sail and
 * the self-certification refusing to pre-tick an item. There is no score, no
 * percentage and no word like "compliant" anywhere in it. What a surveyor is
 * handed is a statement of what this app was told, which is a different thing
 * from a statement about the boat — and the difference is the whole document.
 *
 * WHICH IS WHY THE FIRST SECTION IS WHAT THE PACK DOES *NOT* COVER.
 * Measured on the real fleet the day this was built: the Official Log Book has
 * ZERO entries, the Oil Record Book ZERO, the radio log ONE, risk-assessment
 * briefings ZERO, and lifting equipment does not exist at all. Meanwhile 17
 * vessel certificates, 113 crew tickets and 12 risk assessments are fully
 * populated. A pack that printed the full half and silently omitted the empty
 * half would read as a complete record of a compliant vessel, and it would be
 * the most damaging document this app has ever produced. So the holes are
 * named, first, before anything that looks like evidence.
 *
 * THREE KINDS OF HOLE, AND THEY MUST NOT READ ALIKE:
 *
 *   empty     the book is here and nothing has ever been written in it
 *   paper     the book is kept on paper and this app is not it (ORB, OLB)
 *   nofile    the certificate is listed but its document is held elsewhere
 *
 * The second is not a failing at all — MIN 644 requires a Recognised
 * Organisation to approve an electronic record book against MEPC.312(74), and
 * no such declaration exists, so the paper book IS the record and the pack must
 * say so or a surveyor will assume otherwise. The first is a real gap. Rolling
 * them together would turn a correct state of affairs into an accusation and an
 * accusation into background noise.
 *
 * TWO KINDS OF CONTENT, FILTERED TWO DIFFERENT WAYS.
 * A certificate is a STATE — what was valid as at a date. A log entry is an
 * EVENT — what happened between two dates. Filtering a certificate into a
 * window would drop every one that was issued before it, which is most of them;
 * filtering an event as at a date is meaningless. They are kept apart
 * throughout, and the pack labels which it is showing.
 */

const iso = (d) => (d ? String(d).slice(0, 10) : null)

/* AS AT A DATE, NOT AS AT TODAY — and that is why `certStatus` is not reused
   here, though it is the helper every other page uses. It reads `new Date()`
   internally, so a pack run for a period that closed in June would score every
   certificate against today and quietly answer a different question from the
   one printed at the top of its own page. Same 60-day lead, same three words,
   so "expired" means on this page what it means everywhere else. */
export function stateAsOf(expiry, on, lead = CERT_LEAD_DAYS) {
  const e = iso(expiry)
  if (!e) return 'noexpiry'
  const d = iso(on) || iso(new Date().toISOString())
  if (e < d) return 'expired'
  const days = Math.round(
    (new Date(e + 'T00:00:00') - new Date(d + 'T00:00:00')) / 86400000)
  return days <= lead ? 'due' : 'valid'
}

/** Is an event inside the period? Both ends inclusive — a thing done on the
 *  closing day happened in the period. */
export function inWindow(date, from, to) {
  const d = iso(date)
  if (!d) return false
  if (from && d < iso(from)) return false
  if (to && d > iso(to)) return false
  return true
}

/* The books this pack reports on.
 *
 * `paper` marks the two that are prescribed statutory books with no approval
 * route taken, so the electronic copy is a convenience and the paper one is the
 * record. `source` is the regulation, transcribed rather than remembered —
 * the same standard the ORB item list and the OLB entries were held to. */
export const BOOKS = [
  {
    key: 'olb', label: 'Official Log Book', table: 'official_log_book_entries',
    date: 'occurred_on', paper: true,
    source: 'SI 1981/570. 33 numbered entries.',
  },
  {
    key: 'orb', label: 'Oil Record Book Part I', table: 'oil_record_book_entries',
    date: 'entry_date', paper: true,
    source: 'Reg 20, MS (Prevention of Oil Pollution) Regs 2019. Required at 400 GT.',
  },
  {
    key: 'radio', label: 'Radio log', table: 'radio_log_entries',
    date: 'log_date', paper: false,
    source: 'Sch 3, SI 1999/3210.',
  },
  {
    key: 'garbage', label: 'Garbage Record Book', table: 'garbage_log',
    date: 'entry_date', paper: false,
    source: 'MARPOL Annex V.',
  },
  {
    key: 'fuel', label: 'Fuel and oil log', table: 'vessel_fuel_log',
    date: 'entry_date', paper: false,
    source: "The boat's own working record. Not a prescribed book.",
  },
  {
    key: 'engine', label: 'Engine log', table: 'engine_logs',
    date: 'log_date', paper: false,
    source: "The boat's own working record. Not a prescribed book.",
  },
]

/** One book's activity in the period, and over its whole life.
 *
 *  BOTH FIGURES ARE GIVEN ON PURPOSE. A book with nothing in the period may be
 *  a book nobody wrote in, or a book that has never been started at all, and
 *  those want different answers from the skipper. */
export function bookActivity(book, rows = [], { from, to } = {}) {
  const dates = (rows || []).map((r) => iso(r[book.date])).filter(Boolean).sort()
  const within = dates.filter((d) => inWindow(d, from, to))
  return {
    ...book,
    total: dates.length,
    n: within.length,
    first: within[0] || null,
    last: within[within.length - 1] || null,
    everFirst: dates[0] || null,
    everLast: dates[dates.length - 1] || null,
    /* NEVER STARTED and NOTHING THIS PERIOD are different facts. The first is a
       book that does not exist in practice; the second is a quiet spell in one
       that does. */
    never: dates.length === 0,
  }
}

/* ---- certificates: a STATE, as at the closing date --------------------- */

/** Certificates as they stood at the end of the period, plus the ones that
 *  lapsed DURING it.
 *
 *  A LAPSE INSIDE THE WINDOW IS THE INTERESTING ONE and it disappears from a
 *  plain as-at-today list the moment it is renewed. It is the thing a surveyor
 *  asks about and the thing the boat wants to have an answer ready for. */
export function certificateState(rows = [], { from, to } = {}) {
  const on = iso(to) || iso(new Date().toISOString())
  const held = (rows || []).map((c) => {
    return {
      ...c,
      state: stateAsOf(c.expiry_date, on),
      /* Whether the DOCUMENT is in the app, which is not the same as whether
         the certificate exists. A surveyor asking to see one needs to know
         which he can be shown here and which has to be fetched. */
      hasFile: Boolean(c.file_path),
      lapsedInPeriod: Boolean(
        c.expiry_date && from && inWindow(c.expiry_date, from, to) && iso(c.expiry_date) < iso(to)),
    }
  })
  const by = (s) => held.filter((c) => c.state === s)
  return {
    asOf: on,
    all: held,
    expired: by('expired'),
    due: by('due'),
    valid: by('valid'),
    noExpiry: by('noexpiry'),
    lapsed: held.filter((c) => c.lapsedInPeriod),
    withoutFile: held.filter((c) => !c.hasFile),
  }
}

/* ---- what the pack does NOT cover -------------------------------------- */

/** The holes, named, in the order a reader should meet them.
 *
 *  THIS IS THE MOST IMPORTANT FUNCTION IN THE FILE. Everything else assembles
 *  evidence; this one says where there is none, and without it the evidence
 *  reads as the whole picture. */
export function notCovered({ books = [], certs = null, briefings = 0, equipment = 0 } = {}) {
  const out = []

  for (const b of books) {
    if (b.never) {
      out.push({
        kind: 'empty', key: b.key, label: b.label,
        why: `No entry has ever been made in this book in the app. ${b.source}`,
      })
    }
  }

  /* Reported even when the book HAS entries: it is a statement about which
     copy is the record, not about how well it is kept. */
  for (const b of books) {
    if (b.paper && !b.never) {
      out.push({
        kind: 'paper', key: b.key, label: b.label,
        why: 'Kept on paper. This app holds no MIN 644 declaration of an '
           + 'approved electronic record book, so the paper book is the record '
           + 'and this pack is a copy of what was entered here.',
      })
    }
  }

  if (!briefings) {
    out.push({
      kind: 'empty', key: 'briefings', label: 'Risk assessment briefings',
      why: 'No record of any assessment being brought to the notice of the crew. '
         + 'Reg 7(3) of SI 1997/2962 makes that a duty in its own right — an '
         + 'assessment nobody was told about is not evidence of anything.',
    })
  }

  if (!equipment) {
    out.push({
      kind: 'empty', key: 'equipment', label: 'Lifting and work equipment',
      why: 'No equipment and no thorough examinations are on record. LOLER '
         + '(SI 2006/2184) and PUWER (SI 2006/2183) both apply to a fishing '
         + 'vessel; this pack can say nothing about either.',
    })
  }

  if (certs && certs.withoutFile.length) {
    out.push({
      kind: 'nofile', key: 'certfiles', label: 'Certificate documents',
      why: `${certs.withoutFile.length} of ${certs.all.length} certificates are `
         + 'recorded here without the document itself. The dates and numbers '
         + 'below come off the record, not off a scan held in this app.',
    })
  }

  return out
}

/* ---- the pack ---------------------------------------------------------- */

/**
 * Assemble everything the document needs. PURE — no queries, no rendering, so
 * the selection can be tested without a database and the same object can be
 * put on a screen or into a PDF without the two drifting apart.
 */
export function inspectionPack({
  from, to, vessel, details,
  vesselCerts = [], crew = [], crewCerts = [],
  assessments = [], hazards = [], briefings = [],
  equipment = [], examinations = [],
  tasks = [], events = [],
  selfCerts = [], crewLists = [], familiarisation = [],
  books = {},
  asOf,
} = {}) {
  const period = { from: iso(from), to: iso(to) }
  const on = iso(asOf) || period.to

  const activity = BOOKS.map((b) => bookActivity(b, books[b.key] || [], period))
  const certs = certificateState(vesselCerts, period)

  /* CREW TICKETS ARE STATE TOO, and they hang off a man rather than the boat.
     Only crew who are actually aboard are reported: a former hand's expired
     ticket is not a finding, and listing it would bury the ones that are. */
  const aboard = (crew || []).filter(
    (c) => c.status === 'on_boat' && !c.archived_at)
  const aboardIds = new Set(aboard.map((c) => c.id))
  const ticketsFor = (id) => (crewCerts || [])
    .filter((t) => t.crew_id === id)
    .map((t) => ({ ...t, state: stateAsOf(t.expiry_date, on) }))

  const crewRows = aboard.map((c) => {
    const tickets = ticketsFor(c.id)
    const passport = c.passport_expiry ? stateAsOf(c.passport_expiry, on) : null
    return {
      id: c.id,
      name: c.full_name || c.name,
      rank: c.rank_code || null,
      nationality: c.nationality || null,
      passportNumber: c.passport_number || null,
      passportExpiry: iso(c.passport_expiry),
      passportState: passport,
      tickets,
      expired: tickets.filter((t) => t.state === 'expired'),
      due: tickets.filter((t) => t.state === 'due'),
    }
  })

  /* SUPERSEDED AND WITHDRAWN ASSESSMENTS ARE NOT IN FORCE and must not be
     listed as though they were — but they are counted, because a surveyor
     asking "how many do you hold" wants a different number from "how many
     apply today". */
  /* `withLineage` marks the replacement as `replaced_by`, not `supersededBy` —
     and reading the wrong name would have listed every superseded assessment as
     though it were still in force, silently, because an absent field is
     `undefined` rather than an error. */
  const lineage = withLineage(assessments)
  const live = lineage.filter((a) => !a.replaced_by && !a.withdrawn_on)
  const raRows = live.map((a) => {
    const mine = (hazards || []).filter((h) => h.assessment_id === a.id)
    const rated = mine.filter((h) => rating(h) != null)
    return {
      id: a.id,
      ref: a.ref || null,
      title: a.title,
      area: a.area || null,
      assessedOn: iso(a.assessed_on),
      assessedBy: a.assessed_by,
      reviewDue: iso(a.review_due),
      state: assessmentState(a, { asOf: on }).state,
      hazards: mine.length,
      rated: rated.length,
      unrated: mine.length - rated.length,
      briefed: (briefings || []).filter((b) => b.assessment_id === a.id).length,
    }
  })

  const equipRows = (equipment || []).map((e) => {
    const mine = (examinations || []).filter((x) => x.equipment_id === e.id)
    /* equipmentState returns `last` (the whole examination row) and `due` —
       not `lastExamined`/`nextDue`. */
    const st = equipmentState(e, mine, { asOf: on })
    return {
      ...e,
      state: st.state,
      lastExamined: iso(st.last?.examined_on),
      nextDue: iso(st.due),
      examinations: mine.length,
    }
  })

  /* MAINTENANCE IS AN EVENT, so it is filtered into the window. A job done
     last year is not evidence about this period. */
  const doneInPeriod = (events || []).filter((e) => inWindow(e.done_on, period.from, period.to))
  const taskById = new Map((tasks || []).map((t) => [t.id, t]))
  const maintRows = doneInPeriod
    .map((e) => ({
      doneOn: iso(e.done_on),
      task: taskById.get(e.task_id)?.name || 'Task no longer on the list',
      component: taskById.get(e.task_id)?.component || null,
      runningHours: e.running_hours ?? null,
      doneBy: e.done_by || null,
      notes: e.notes || null,
    }))
    .sort((a, b) => String(a.doneOn).localeCompare(String(b.doneOn)))

  const gaps = notCovered({
    books: activity,
    certs,
    briefings: (briefings || []).length,
    equipment: (equipment || []).length,
  })

  return {
    period,
    on,
    vessel: vessel || null,
    details: details || null,
    generatedAt: iso(new Date().toISOString()),
    notCovered: gaps,
    books: activity,
    certs,
    crew: crewRows,
    crewAboard: crewRows.length,
    assessments: raRows,
    assessmentsHeld: lineage.length,
    assessmentsLive: live.length,
    hazardsUnrated: raRows.reduce((s, r) => s + r.unrated, 0),
    equipment: equipRows,
    maintenance: maintRows,
    maintenanceTasks: (tasks || []).filter((t) => t.active !== false).length,
    selfCerts: (selfCerts || []).map((s) => ({
      period: s.period,
      form: s.form_code ? `${s.form_code} rev ${s.form_revision || '—'}` : null,
      completedAt: iso(s.completed_at),
      declaredName: s.declared_name || null,
    })),
    crewLists: (crewLists || []).filter((c) => inWindow(c.departure_date, period.from, period.to)).length,
    familiarisation: (familiarisation || []).filter((f) => f.completed_at).length,
    /* Not a score. A count of the holes, so the covering page can say how many
       there are without anybody having to total a list by eye. */
    holes: gaps.filter((g) => g.kind === 'empty').length,
    aboardIds,
  }
}
