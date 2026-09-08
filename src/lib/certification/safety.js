/* RISK ASSESSMENTS, AND LIFTING AND WORK EQUIPMENT.
 *
 * David, Sep 2026: "do risk assesments and lolar/pular next. risk assesments
 * require annual reviewing."
 *
 * THESE ARE THE FIRST CERTIFICATION RECORDS THE APP CAN ACTUALLY BE, and that
 * is worth saying out loud because it is the opposite of the last two. The Oil
 * Record Book and the Official Log Book are prescribed statutory books with no
 * approval route, so both pages tell the skipper the paper is still the record.
 * Here:
 *
 *   - reg 7 of the Merchant Shipping and Fishing Vessels (Health and Safety at
 *     Work) Regulations 1997 prescribes NO FORM at all; and
 *   - MGN 332 says a thorough examination report may be held "electronically
 *     or on computer disc, provided that the information is in a form which is
 *     usable by the shipowner and employer or master".
 *
 * No paper twin, nothing to keep in step, no warning banner.
 */

/* ==== RISK ASSESSMENTS ==================================================== */

/**
 * THE STATUTE'S TRIGGERS ARE EVENTS; THE ANNUAL CYCLE IS THE BOAT'S.
 *
 * Reg 7(3): an assessment is reviewed where "there is reason to suspect that it
 * is no longer valid" or "there has been a significant change in the matters to
 * which it relates". Neither is a date, and neither can be scheduled.
 *
 * David reviews annually. That is his regime, and it is a good one — but it is
 * not what the regulation says, and the two must not be presented as one thing.
 * The same distinction the Official Log Book draws between what the Schedule
 * prescribes and how often this boat holds a drill.
 */
export const DEFAULT_REVIEW_MONTHS = 12

export const REVIEW_TRIGGERS = [
  'the assessment may no longer be valid',
  'something has significantly changed — new gear, new method, new crew',
  'an accident or near miss on the thing assessed',
]

/** When a review falls due under the boat's own cycle. */
export function reviewDue(assessedOn, months = DEFAULT_REVIEW_MONTHS) {
  const d = String(assessedOn || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null
  const t = new Date(d + 'T00:00:00Z')
  t.setUTCMonth(t.getUTCMonth() + Number(months || DEFAULT_REVIEW_MONTHS))
  return t.toISOString().slice(0, 10)
}

/**
 * Where each assessment stands.
 *
 * `state` is one of: current · due · overdue · superseded · withdrawn · undated.
 *
 * SUPERSEDED IS NOT OVERDUE. An assessment that has been reviewed and replaced
 * has done its job — chasing it would put the whole history of the boat on the
 * outstanding list, and a list that is mostly noise stops being read.
 */
export function assessmentState(a, { asOf, soonDays = 30 } = {}) {
  const today = String(asOf || new Date().toISOString().slice(0, 10)).slice(0, 10)
  if (a?.withdrawn_on) return { state: 'withdrawn', days: null }
  if (a?.replaced_by) return { state: 'superseded', days: null }
  const due = a?.review_due ? String(a.review_due).slice(0, 10) : null
  /* NO REVIEW DATE IS NOT "IN DATE". An assessment with nothing set is not
     compliant-by-omission, and calling it current would be the quiet lie. */
  if (!due) return { state: 'undated', days: null }
  const days = daysBetween(today, due)
  if (days < 0) return { state: 'overdue', days: -days }
  if (days <= soonDays) return { state: 'due', days }
  return { state: 'current', days }
}

/**
 * Which assessments have been replaced by a later one.
 *
 * A REVIEW MAKES A NEW ASSESSMENT AND POINTS BACK. Nothing is edited in place:
 * what the crew were briefed on last year is what they were briefed on, and an
 * assessment quietly rewritten afterwards cannot be relied on to say what was
 * in force at the time of an accident.
 */
export function withLineage(assessments = []) {
  const replacedBy = new Map()
  for (const a of assessments) {
    if (a.supersedes_id) replacedBy.set(a.supersedes_id, a.id)
  }
  return assessments.map((a) => ({ ...a, replaced_by: replacedBy.get(a.id) || null }))
}

/**
 * The risk rating — likelihood x severity, and NOT stored anywhere.
 *
 * Storing it would let the product and its two factors drift apart, which is
 * the same reason the parts ledger has no `on_hand` column. Null where either
 * factor is missing: a rating of nothing is not a rating of nought.
 */
export function rating(hazard) {
  const l = int(hazard?.likelihood), s = int(hazard?.severity)
  if (l == null || s == null) return null
  const score = l * s
  return { score, band: score >= 15 ? 'high' : score >= 8 ? 'medium' : 'low' }
}

/**
 * What is outstanding on an assessment.
 *
 * FOUR SEPARATE FACTS, because they are put right by different people: an
 * action nobody has closed, a hazard nobody has rated, a review that has come
 * round, and — the one nothing else in this app records — an assessment the
 * crew have never been told about.
 */
export function assessmentGaps(a, hazards = [], briefings = [], opts = {}) {
  const today = String(opts.asOf || new Date().toISOString().slice(0, 10)).slice(0, 10)
  const st = assessmentState(a, opts)
  const mine = hazards.filter((h) => h.assessment_id === a.id)
  const told = briefings.filter((b) => b.assessment_id === a.id)

  return {
    state: st.state,
    days: st.days,
    openActions: mine.filter((h) => String(h.further_action || '').trim() && !h.done_on),
    lateActions: mine.filter((h) => String(h.further_action || '').trim() && !h.done_on
      && h.action_due && String(h.action_due).slice(0, 10) < today),
    unrated: mine.filter((h) => rating(h) == null),
    /* "The significant findings ... shall be brought to the notice of workers."
       A duty in its own right, and an assessment nobody was told about is not
       compliance however well it is written. */
    briefed: told.length,
    neverBriefed: told.length === 0,
  }
}

/* ==== LIFTING AND WORK EQUIPMENT ========================================== */

/**
 * WHAT IT IS DECIDES HOW OFTEN IT IS EXAMINED.
 *
 * LOLER reg 12(2), word for word: at least every SIX months for lifting
 * equipment used for lifting PERSONS and for lifting ACCESSORIES, at least
 * every TWELVE for other lifting equipment — or in accordance with an
 * examination scheme drawn up by a competent person.
 *
 * Six against twelve is the thing people get the wrong way round, and it is a
 * real failure rather than a cosmetic one, so it is written here once and
 * derived everywhere.
 *
 * PUWER prescribes NO interval. Reg 6 requires inspection where safety depends
 * on the installation or on deterioration, "at suitable intervals" — so there
 * is no statutory figure to default to, and inventing one would dress a guess
 * as a duty. A PUWER item is chased only where the boat has set a scheme.
 */
export const KINDS = [
  { key: 'loler_persons', label: 'Lifting equipment used to lift PERSONS', months: 6, reg: 'LOLER reg 12(2)(a)' },
  { key: 'loler_accessory', label: 'Lifting accessory — sling, shackle, eyebolt, hook', months: 6, reg: 'LOLER reg 12(2)(a)' },
  { key: 'loler_other', label: 'Other lifting equipment — crane, winch, derrick, block', months: 12, reg: 'LOLER reg 12(2)(b)' },
  { key: 'puwer', label: 'Work equipment (PUWER) — not lifting', months: null, reg: 'PUWER reg 6' },
]

export const kindOf = (key) => KINDS.find((k) => k.key === key) || null

/** The interval that actually applies: the boat's scheme, else the statutory one. */
export function intervalMonths(equipment) {
  const scheme = int(equipment?.scheme_months)
  if (scheme) return { months: scheme, from: 'scheme' }
  const k = kindOf(equipment?.kind)
  if (k?.months) return { months: k.months, from: 'statute', reg: k.reg }
  /* PUWER with no scheme. NOT a number — the regulation gives none, and a
     default here would present a guess as a duty. */
  return { months: null, from: null }
}

/** The latest date the statute (or the scheme) allows the next examination. */
export function latestNext(examinedOn, equipment) {
  const { months } = intervalMonths(equipment)
  if (!months) return null
  const d = String(examinedOn || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null
  const t = new Date(d + 'T00:00:00Z')
  t.setUTCMonth(t.getUTCMonth() + months)
  return t.toISOString().slice(0, 10)
}

/**
 * Where a piece of equipment stands.
 *
 * TWO DATES, AND THEY CAN DISAGREE. The competent person states when the next
 * examination is due; the statute states the latest it may be. A report giving
 * a longer gap than the regulation allows is REPORTED, never quietly shortened
 * — the same rule as net + VAT against a printed total, and for the same
 * reason: which of the two is wrong is not ours to decide.
 */
export function equipmentState(equipment, examinations = [], { asOf, soonDays = 30 } = {}) {
  const today = String(asOf || new Date().toISOString().slice(0, 10)).slice(0, 10)
  if (equipment?.out_of_service_on) return { state: 'out-of-service' }

  const mine = examinations
    .filter((e) => e.equipment_id === equipment.id)
    .sort((a, b) => String(b.examined_on).localeCompare(String(a.examined_on)))
  const last = mine[0] || null
  const { months, from, reg } = intervalMonths(equipment)

  if (!last) {
    return {
      state: 'never', last: null, months, from, reg,
      /* NEVER EXAMINED is not "overdue by N days" — there is no date to count
         from, and a number would be invented. */
      unsafe: false, days: null, due: null, overrun: null,
    }
  }

  const stated = last.next_due ? String(last.next_due).slice(0, 10) : null
  const latest = latestNext(last.examined_on, equipment)
  /* The earlier of the two governs: a competent person may examine more often
     than the statute demands, never less. */
  const due = stated && latest ? (stated < latest ? stated : latest) : (stated || latest)
  const overrun = stated && latest && stated > latest ? { stated, latest } : null

  const days = due ? daysBetween(today, due) : null
  const state = last.result === 'unsafe' ? 'unsafe'
    : !due ? 'no-interval'
      : days < 0 ? 'overdue'
        : days <= soonDays ? 'due' : 'current'

  return { state, last, due, days: days == null ? null : Math.abs(days), months, from, reg, overrun,
    unsafe: last.result === 'unsafe', defects: last.result === 'defects' }
}

/**
 * Everything wanting attention, worst first.
 *
 * UNSAFE COMES ABOVE OVERDUE. A report saying the gear is unsafe is not a
 * paperwork gap; it is a thing that must not be used, and it must never sort
 * below a sling whose certificate lapsed last week.
 */
const RANK = { unsafe: 0, overdue: 1, never: 2, due: 3, 'no-interval': 4 }

export function equipmentOutstanding(equipment = [], examinations = [], opts = {}) {
  return equipment
    .map((e) => ({ equipment: e, ...equipmentState(e, examinations, opts) }))
    .filter((x) => x.state in RANK)
    .sort((a, b) => (RANK[a.state] - RANK[b.state]) || ((b.days || 0) - (a.days || 0)))
}

/* ---- helpers ------------------------------------------------------------ */
function daysBetween(from, to) {
  const a = Date.parse(from + 'T00:00:00Z'), b = Date.parse(to + 'T00:00:00Z')
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.round((b - a) / 86400000)
}
function int(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isInteger(n) ? n : null
}
