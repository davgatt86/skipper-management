/* THE RADIO LOG.
 *
 * The Merchant Shipping (Radio) (Fishing Vessels) Regulations 1999,
 * SI 1999/3210 — regulation 19 for a Directive fishing vessel, regulation 25
 * for a non-Directive one, and what must be recorded is in Schedule 3.
 *
 * WHICH PART APPLIES IS DECIDED ON LENGTH, AND IT IS THE SAME 24 m QUESTION
 * THAT DECIDES THE SELF-CERTIFICATION BAND — the third time that figure has
 * settled something on this boat, and the second time four centimetres do it.
 *
 * A "Directive fishing vessel" is a NEW vessel of 24 m or more in length, or an
 * EXISTING one of 45 m or more. The regulations define length as about 96% of
 * the total length on a waterline at 85% of the least moulded depth — a RULE
 * length, near the registered length and nothing like the length overall.
 * Reading LOA here would put Audacious at 29.8 m and hand her the wrong book.
 *
 * SO IT REFUSES TO ANSWER WHERE THE RECORD CANNOT SETTLE IT, exactly as
 * `bandFor()` does in selfCert.js. A page that guessed would tell a skipper he
 * need only log distress traffic when he owes urgency, safety, incidents and a
 * daily position.
 */

/** New or existing is about when she was built, and the threshold differs. */
export const DIRECTIVE_NEW_M = 24
export const DIRECTIVE_EXISTING_M = 45
/* Council Directive 97/70/EC applied from 1 January 1999; a vessel built on or
   after that is "new" for this purpose. */
export const NEW_FROM_YEAR = 1999

export function radioPart(details) {
  const rl = num(details?.length_registered)
  const loa = num(details?.length_overall ?? details?.length_m)
  const built = num(details?.year_built)

  if (rl == null) {
    return {
      part: null,
      why: loa != null
        ? 'only a length OVERALL is on file, and the test is a rule length — about 96% of the '
          + 'waterline length, which is near the registered length and well short of the overall'
        : 'no length is on file',
    }
  }
  if (built == null) {
    return { part: null, rl, why: 'no year built on file, and the threshold is 24 m for a new vessel and 45 m for an existing one' }
  }
  const isNew = built >= NEW_FROM_YEAR
  const threshold = isNew ? DIRECTIVE_NEW_M : DIRECTIVE_EXISTING_M
  const directive = rl >= threshold
  return {
    part: directive ? 'I' : 'II',
    directive, rl, built, isNew, threshold,
    reg: directive ? 'reg 19' : 'reg 25',
    why: null,
  }
}

/* ---- Schedule 3: what must be recorded ----------------------------------
 * Part I  (GMDSS Radio Log) — distress, urgency AND safety traffic; important
 *         incidents connected with the radio service; and, where appropriate,
 *         the position at least once a day.
 * Part II (Simplified FV GMDSS Radio Log) — distress traffic only.
 *
 * `test` is in neither. Equipment tests and battery checks are good practice
 * and the MCA's own combined log book has room for them, but they are NOT a
 * duty under Schedule 3 — so the page offers them and says plainly that they
 * are the boat's own, rather than dressing practice as law.
 */
export const KINDS = [
  { key: 'distress', label: 'Distress traffic', parts: ['I', 'II'],
    note: 'a summary of the communications and the time they occurred' },
  { key: 'urgency', label: 'Urgency traffic', parts: ['I'] },
  { key: 'safety', label: 'Safety traffic', parts: ['I'] },
  { key: 'incident', label: 'Important incident connected with the radio service', parts: ['I'] },
  { key: 'position', label: "The vessel's position", parts: ['I'],
    note: 'at least once a day, with the time she was at it' },
  { key: 'test', label: 'Equipment test or battery check', parts: [],
    note: 'not required by Schedule 3 — kept by the boat' },
]

export const kindOf = (k) => KINDS.find((x) => x.key === k) || null

/** The kinds Schedule 3 actually asks a vessel of this Part to record. */
export function requiredKinds(part) {
  if (!part) return []
  return KINDS.filter((k) => k.parts.includes(part))
}

/** Everything the page should offer: what is required, plus the boat's own. */
export function offeredKinds(part) {
  if (!part) return KINDS
  return KINDS.filter((k) => k.parts.includes(part) || k.parts.length === 0)
}

/* ---- THE DAILY SIGNATURE, and it is this book's distinctive rule ---------
 * Regs 19(2) and 25(2), word for word: "The skipper shall inspect and sign
 * each day's entries."
 *
 * Not per entry, as in the Oil Record Book. Not per page. Not with a witness,
 * as in the Official Log Book. Per DAY, by the skipper, over whatever was
 * written that day — a third shape again.
 *
 * AND A DAY WITH NO ENTRIES NEEDS NO SIGNATURE. The duty is to sign "each
 * day's ENTRIES"; where there are none there is nothing to attest. Chasing
 * every quiet day would be a warning firing on the ordinary case, and this
 * boat is at sea most of the year.
 */
export function unsignedDays(entries = [], days = []) {
  const signed = new Set(days.map((d) => String(d.log_date).slice(0, 10)))
  const withEntries = new Map()
  for (const e of entries) {
    const d = String(e.log_date || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue
    withEntries.set(d, (withEntries.get(d) || 0) + 1)
  }
  return [...withEntries.entries()]
    .filter(([d]) => !signed.has(d))
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => b.date.localeCompare(a.date))
}

/**
 * Days with no position entry — PART I ONLY.
 *
 * "Where appropriate, the position of the fishing vessel at least once a day."
 * A non-Directive vessel keeping the simplified log owes nothing of the kind,
 * so this returns NOTHING for Part II rather than an empty-looking list that
 * suggests she is behind.
 *
 * And it only looks at days the boat was WRITING IN THE LOG. Inventing a
 * duty for days when she was tied up would be the same failure as chasing an
 * unsigned quiet day.
 */
export function positionGaps(entries = [], part) {
  if (part !== 'I') return []
  const byDay = new Map()
  for (const e of entries) {
    const d = String(e.log_date || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue
    if (!byDay.has(d)) byDay.set(d, [])
    byDay.get(d).push(e)
  }
  return [...byDay.entries()]
    .filter(([, list]) => !list.some((e) => e.kind === 'position'))
    .map(([date]) => date)
    .sort((a, b) => b.localeCompare(a))
}

/** Entries grouped by day, each day's own earliest first. */
export function entriesByDay(entries = []) {
  const by = new Map()
  for (const e of entries) {
    const d = String(e.log_date || '').slice(0, 10)
    if (!by.has(d)) by.set(d, [])
    by.get(d).push(e)
  }
  for (const list of by.values()) {
    list.sort((a, b) => String(a.occurred_at || '').localeCompare(String(b.occurred_at || ''))
      || String(a.recorded_at || '').localeCompare(String(b.recorded_at || '')))
  }
  return by
}

/** Is this day signed, and by whom? */
export function signatureFor(date, days = []) {
  const d = String(date).slice(0, 10)
  return days.find((x) => String(x.log_date).slice(0, 10) === d) || null
}

/**
 * An entry recorded under a kind the vessel's Part does not ask for.
 *
 * REPORTED, NEVER REFUSED. Recording more than the minimum is not a fault —
 * a skipper on the simplified log who writes down a safety broadcast has done
 * something useful, not something wrong. What would be a fault is the app
 * implying Schedule 3 demanded it.
 */
export function beyondSchedule(entries = [], part) {
  const need = new Set(requiredKinds(part).map((k) => k.key))
  return entries.filter((e) => !need.has(e.kind))
}

function num(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
