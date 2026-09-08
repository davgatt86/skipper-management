/* THE OFFICIAL LOG BOOK.
 *
 * David, Sep 2026, listing what the boat keeps: "offical logbook keeps a record
 * of drills, emergency steering tests, checks of accomdation areas for
 * cleanliness, when new provsions/food is taken onboard, when new fresh water
 * is taken (which port, date, quantity, etc), record of accidents."
 *
 * ALL FIVE OF THOSE ARE ONE BOOK. He named them as separate records because on
 * paper they are separate pages, but drills (7), steering gear tests (21),
 * accommodation inspections (17), provisions and water (18, 22, 27) and
 * casualties and injuries (9, 32) are all numbered entries in the SAME
 * prescribed book.
 *
 * THE FORM IS PRESCRIBED, NOT OURS TO DESIGN. The Merchant Shipping (Official
 * Log Books) (Fishing Vessels) Regulations 1981, SI 1981/570, Schedule: 33
 * numbered entries, each with the person who must SIGN it and, for most of
 * them, a person who must WITNESS it. Required of every UK fishing vessel of
 * 55 feet and over. AUDACIOUS BF83 is 29.80 m — about 98 feet — so she must
 * keep one.
 *
 * The list below is transcribed from the Schedule and should be checked against
 * the book aboard before it is relied on.
 *
 * FOUR RULES OUT OF THE REGULATIONS, and they are what shape the schema:
 *
 *   1. NOTHING IS EVER ERASED. Reg 9: where an entry "is inaccurate or
 *      incomplete" the skipper "shall ... make and sign a FURTHER ENTRY
 *      referring to the entry and amending or cancelling it". Same discipline
 *      as the Oil Record Book, and the same answer: no update policy and no
 *      delete policy at all.
 *
 *   2. SOME ENTRIES MUST BE SIGNED BY THE SKIPPER IN PERSON. Ordinarily "an
 *      entry which is to be signed by the skipper may ... be signed by an
 *      officer authorised by the skipper" — but seven of the thirty-three say
 *      "in person", and for those the authority cannot be delegated. A death,
 *      a birth, a refusal to assist a vessel in distress, a doubt about an
 *      officer's fitness. This is the book's distinctive rule and nothing else
 *      in the app has anything like it.
 *
 *   3. MOST ENTRIES NEED A WITNESS, and which witness is prescribed: usually a
 *      member of the crew, an OFFICER for the two testing entries (20, 21),
 *      the seaman himself for a personal complaint, and — for a birth — the
 *      mother of the child.
 *
 *   4. THE BOOK IS OPENED AND CLOSED, and delivered to the superintendent or
 *      proper officer within 48 hours. "No entry shall be made in an official
 *      log book after" that point.
 *
 * AND IT IS STILL THE PAPER BOOK THAT COUNTS. MGN 690 is the electronic
 * record book route and it covers ONLY the SOLAS V/Reg 28 deck logbook — it
 * says in terms that "the requirement to maintain other logbooks such as the
 * Official Logbook shall be in accordance with their applicable legislation".
 * There is no approval route for this one today, so what is here is a working
 * copy that keeps the record in the prescribed shape and shows what is
 * missing. The page says so, on every state where the book is drawn.
 */

/** Reg 3: not required of a fishing vessel under 55 feet. */
const FEET_PER_METRE = 3.28084
export const OLB_MIN_FEET = 55

export function olbRequired(details) {
  const m = num(details?.length_overall ?? details?.length_m)
  if (m == null) return { required: null, why: 'no length overall on file' }
  const feet = m * FEET_PER_METRE
  return { required: feet >= OLB_MIN_FEET, metres: m, feet: Math.round(feet * 10) / 10 }
}

/* ---- The Schedule: 33 entries, their signatory and their witness ---------
 *
 * `inPerson` marks the seven the skipper may not delegate.
 * `witness` is null where the Schedule prescribes none.
 * `recurring` marks the ones that happen on a rhythm rather than on an event,
 * which is what the page can chase; everything else is an occurrence and
 * cannot be predicted, only recorded.
 */
export const OLB_ENTRIES = [
  { n: 1, text: 'Name of the vessel, port of registry, official letters and number, and length', signer: 'skipper', witness: null, when: 'opening' },
  { n: 2, text: 'The registered owner, managing owner, vessel’s husband or manager', signer: 'skipper', witness: null, when: 'opening' },
  { n: 3, text: 'Name of the skipper and the number of his certificate of competency', signer: 'skipper', witness: null, when: 'opening' },
  { n: 4, text: 'Change of skipper during a voyage — handover of the vessel and crew documents', signer: 'skipper and the former skipper', witness: null, inPerson: true },
  { n: 5, text: 'The date on and place at which the official log book is opened', signer: 'skipper', witness: null, when: 'opening' },
  { n: 6, text: 'The date on and place at which the official log book is closed', signer: 'skipper', witness: null, when: 'closing' },
  { n: 7, text: 'Musters, drills, safety training and inspections of life saving and fire appliances', signer: 'skipper', witness: 'a member of the crew', recurring: true },
  { n: 8, text: 'The reason a muster, drill or inspection was NOT held when it should have been', signer: 'skipper', witness: 'a member of the crew' },
  { n: 9, text: 'Casualty — loss, stranding or damage to the vessel, or a death from fire or accident', signer: 'skipper', witness: 'a member of the crew' },
  { n: 10, text: 'Every distress signal, or message that a vessel, aircraft or person is in distress', signer: 'skipper', witness: 'a member of the crew' },
  { n: 11, text: 'The skipper’s reasons for not going to the assistance of persons in distress', signer: 'skipper', witness: 'a member of the crew', inPerson: true },
  { n: 12, text: 'A wage dispute submitted to a superintendent or proper officer, and its outcome', signer: 'the superintendent or proper officer', witness: null },
  { n: 13, text: 'Every seaman discharged from the vessel, with the details of his discharge', signer: 'the person present at the discharge, or the skipper', witness: 'a member of the crew' },
  { n: 14, text: 'Consent of the proper officer to a discharge outside the United Kingdom', signer: 'the proper officer, or the skipper', witness: 'a member of the crew where the skipper signs', inPerson: true },
  { n: 15, text: 'A seaman left behind or shipwrecked — name, date, place, reason and arrangements', signer: 'skipper', witness: 'a member of the crew' },
  { n: 16, text: 'Property of a seaman left behind — held, sold, destroyed or delivered', signer: 'skipper', witness: 'a member of the crew' },
  { n: 17, text: 'Inspection of crew accommodation — time, date, who inspected, and anything not complied with', signer: 'skipper', witness: 'a member of the crew', recurring: true },
  { n: 18, text: 'Inspection of provisions and water, and the result of it', signer: 'the person making the inspection', witness: null, recurring: true },
  { n: 19, text: 'Inspection of anchors and chain cables by a person appointed by the Secretary of State', signer: 'the person making the inspection', witness: null },
  { n: 20, text: 'Testing of hoist rigging and the load test (150 kg minimum)', signer: 'skipper', witness: 'an officer' },
  { n: 21, text: 'Steering gear drills, checks and tests', signer: 'skipper', witness: 'an officer', recurring: true },
  { n: 22, text: 'Complaint by three or more seamen about the quality or quantity of provisions or water', signer: 'skipper, and the superintendent or proper officer', witness: 'one of the seamen' },
  { n: 23, text: 'Complaint by a seaman about the skipper, the crew or conditions on board', signer: 'skipper, and the proper officer', witness: 'the seaman' },
  { n: 24, text: 'Incompetence, misconduct or negligence of an officer, or failure in a collision duty', signer: 'skipper', witness: 'a member of the crew', inPerson: true },
  { n: 25, text: 'Conviction of a seaman of an offence, and the punishment, during the voyage', signer: 'skipper', witness: 'a member of the crew' },
  { n: 26, text: 'Anything occurring on board which appears to warrant a prosecution', signer: 'skipper', witness: 'a member of the crew' },
  { n: 27, text: 'A reduction in the scale of provisions or water — what, why and for how long', signer: 'skipper', witness: 'a member of the crew' },
  { n: 28, text: 'A birth on board — the child, the parents, and the notification of the return', signer: 'skipper', witness: 'the mother of the child', inPerson: true },
  { n: 29, text: 'A death on board, or the loss of a person, or a crew member’s death abroad', signer: 'skipper', witness: 'a member of the crew', inPerson: true },
  { n: 30, text: 'Property of a deceased seaman — held, sold, destroyed or delivered', signer: 'skipper', witness: 'a member of the crew', inPerson: true },
  { n: 31, text: 'Record of an inquiry into a death', signer: 'the superintendent or proper officer, or the skipper', witness: null },
  { n: 32, text: 'Illness or injury — the circumstances, the treatment given and how it progressed', signer: 'skipper', witness: 'a member of the crew' },
  { n: 33, text: 'Record of an inquiry into an occurrence', signer: 'the superintendent', witness: null },
]

export const entryOf = (n) => OLB_ENTRIES.find((e) => e.n === Number(n)) || null

/** The seven the skipper may not delegate. */
export const IN_PERSON = OLB_ENTRIES.filter((e) => e.inPerson).map((e) => e.n)

/** The ones that happen on a rhythm and so can be chased. */
export const RECURRING = OLB_ENTRIES.filter((e) => e.recurring).map((e) => e.n)

/**
 * Is this a numbered entry the Schedule actually has?
 *
 * REFUSED, NEVER CORRECTED — the same rule as the Oil Record Book. Quietly
 * moving an entry to the nearest valid number would put something in a
 * statutory book that nobody chose.
 */
export function validEntry(n) {
  const e = entryOf(n)
  if (!e) return { ok: false, why: `the Schedule has no entry ${n}` }
  return { ok: true }
}

/**
 * What is missing before an entry is properly made.
 *
 * THREE DIFFERENT FAULTS, NOT ONE, because they are put right by different
 * people: a signature the skipper has to give himself, a witness who has to be
 * found, and an entry made on a book that is already closed.
 */
export function entryProblems(entry, book) {
  const e = entryOf(entry?.entry_n)
  const out = []
  if (!e) return [{ kind: 'unknown', says: `the Schedule has no entry ${entry?.entry_n}` }]

  if (!String(entry.signed_name || '').trim()) {
    out.push({ kind: 'unsigned', says: `must be signed by ${e.signer}` })
  }
  /* THE DELEGATION RULE, and it only bites on seven entries. An officer may
     sign for the skipper ordinarily; on these he may not, and an entry signed
     by anyone else is not the entry the regulation asks for. */
  if (e.inPerson && entry.signed_by_officer) {
    out.push({ kind: 'not-in-person', says: `entry ${e.n} must be signed by the skipper IN PERSON — it cannot be signed by an authorised officer` })
  }
  if (e.witness && !String(entry.witness_name || '').trim()) {
    out.push({ kind: 'no-witness', says: `must be witnessed by ${e.witness}` })
  }
  /* Reg 8: "no entry shall be made in an official log book after" it is
     delivered. A closed book is closed.

     `closed_on`, not `closed_at` — the Oil Record Book closes a PAGE with a
     timestamp and this closes a BOOK with a date, and the ORB's name came
     across with the rest of the shape. It read as working and checked a column
     that does not exist, so it could never have fired. Found by test. */
  if (book?.closed_on && entry.occurred_on && String(entry.occurred_on) > String(book.closed_on).slice(0, 10)) {
    out.push({ kind: 'after-close', says: 'the book was closed before this happened — it belongs in the next book' })
  }
  return out
}

/* ---- WHAT HAS NOT BEEN WRITTEN DOWN --------------------------------------
 * Only the recurring entries can be chased: a death cannot be predicted and a
 * missing one is not evidence of anything. Drills, accommodation inspections,
 * provisions and water, and steering gear all happen on a rhythm.
 *
 * REPORTED, NEVER FILLED IN. And the regulation agrees — entry 8 exists
 * precisely so that a drill that did NOT happen is recorded with its reason,
 * which is the same discipline this app follows everywhere else, written into
 * the statute.
 */
export function overdue(entries = [], { asOf, intervals = DEFAULT_INTERVALS } = {}) {
  const today = String(asOf || new Date().toISOString().slice(0, 10)).slice(0, 10)
  const last = new Map()
  for (const e of entries) {
    const d = String(e.occurred_on || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue
    const cur = last.get(e.entry_n)
    if (!cur || d > cur) last.set(e.entry_n, d)
  }
  const out = []
  for (const n of RECURRING) {
    const days = intervals[n]
    if (!days) continue
    const seen = last.get(n) || null
    const since = seen ? daysBetween(seen, today) : null
    /* NEVER WRITTEN IN AT ALL is a different fact from OVERDUE, and it says so
       rather than reporting a made-up number of days. */
    if (seen == null) out.push({ n, entry: entryOf(n), last: null, days: null, every: days, never: true })
    else if (since > days) out.push({ n, entry: entryOf(n), last: seen, days: since, every: days, never: false })
  }
  return out.sort((a, b) => (b.days ?? Infinity) - (a.days ?? Infinity))
}

/* THE INTERVALS ARE THIS BOAT'S, NOT THE STATUTE'S, and that distinction
   matters. SI 1981/570 says WHAT must be recorded and who signs it; how often a
   drill is held comes from the safety rules and from the skipper's own regime.
   So these are a starting point to be set, not a rule to be enforced — the same
   reasoning as the engine limits, where a figure derived from history alone
   would have flagged the correct readings. */
export const DEFAULT_INTERVALS = {
  7: 30,    // musters, drills and appliance inspections — monthly
  17: 30,   // crew accommodation inspection — monthly
  18: 30,   // provisions and water — monthly
  21: 90,   // steering gear drills and tests — quarterly
}

/** Entries that have been superseded by a later correcting entry. */
export function correctionsOf(entries = []) {
  const by = new Map()
  for (const e of entries) {
    if (!e.corrects_entry_id) continue
    if (!by.has(e.corrects_entry_id)) by.set(e.corrects_entry_id, [])
    by.get(e.corrects_entry_id).push(e)
  }
  return by
}

/** The one book entries may be made in: open, not yet closed.
 *
 *  `closed_on`. The second place the Oil Record Book's `closed_at` came across
 *  with the shape, and the worse of the two: every book would have looked open,
 *  so the page would have offered entries on one already delivered to the
 *  superintendent. The database refuses that, so it would have surfaced as a
 *  save that failed for no visible reason. Found by test. */
export const openBook = (books = []) => books.find((b) => !b.closed_on) || null

function daysBetween(a, b) {
  const x = Date.parse(a + 'T00:00:00Z'), y = Date.parse(b + 'T00:00:00Z')
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return Math.round((y - x) / 86400000)
}

function num(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
