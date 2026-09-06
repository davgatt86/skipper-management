/* THE ANNUAL SELF-CERTIFICATION — what the app may say, and what only the skipper may.
 *
 * The wizard walks MSF 5550 (see msf5550.js). This file is the judgement around
 * it, and there is one rule it exists to hold:
 *
 *   EVIDENCE INFORMS AN ITEM. IT NEVER ANSWERS ONE.
 *
 * The app knows a great deal — whether a liferaft service certificate is in date,
 * whether every crewman's tickets are valid, when the garbage book was last
 * written in. It knows NOTHING about the condition of the bulwarks, the freeing
 * ports or the stern gear, and it never will. If it pre-ticked the items it
 * thinks it can answer, a self-certification would become a thing the software
 * did, and the declaration is the skipper's. So nothing is ever pre-answered.
 *
 * WHAT THE EVIDENCE IS ACTUALLY FOR IS CONTRADICTION. If the record says the
 * liferaft service ran out in July and the skipper ticks "yes" against item 10,
 * that is worth saying out loud before he signs. Reported, never resolved — the
 * same rule as the settlement totals and the net/VAT check. He may have the paper
 * in his hand and the app may simply be out of date; what he must not do is sign
 * it without being told.
 *
 * AND A DECLARATION IS NOT A TICK. `no` and `na` are first-class answers. An item
 * that does not apply to this boat is answered `na` and says why; an item that is
 * NOT complied with is answered `no` and BLOCKS completion, because the whole
 * point of a self-certificate is that it is a statement of compliance.
 */

import { FORM, SECTIONS } from './msf5550.js'

export { FORM, SECTIONS }

/** Every item, flat, in the order the form runs. */
export function allItems() {
  return SECTIONS.flatMap((s) => s.items.map((i) => ({ ...i, section: s.key, sectionTitle: s.title })))
}

/* ---- WHICH CODE THIS VESSEL IS UNDER ------------------------------------
 *
 * Decided on REGISTERED length, not length overall, and the two are far apart:
 * Audacious is 29.80 m LOA and 23.96 m RL. Reading the wrong one would put her
 * in the 24 m-and-over band and have the page demand an International Fishing
 * Vessel Certificate and an annual class survey she does not need.
 *
 * UNKNOWN IS ITS OWN ANSWER. A vessel with no registered length on file is not
 * assumed into a band — the page says the figure is missing and stops, because
 * guessing here decides which law the boat is checked against.
 */
export function bandFor(details) {
  const loa = num(details?.length_overall ?? details?.length_m)
  const rl = num(details?.length_registered)
  if (rl == null && loa == null) return { band: null, why: 'no length on file' }
  if (rl == null) return { band: null, why: 'no registered length on file — only length overall' }
  if (rl >= 24) return { band: '24plus', why: null, rl, loa }
  if (loa != null && loa < 15) return { band: 'under15', why: null, rl, loa }
  if (loa == null) return { band: null, why: 'no length overall on file', rl }
  return { band: '15to24', why: null, rl, loa }
}

/** Does the shipped checklist apply to this vessel at all? */
export function checklistApplies(details) {
  return bandFor(details).band === '15to24'
}

/* ---- WHAT THE APP CAN SHOW AGAINST AN ITEM -------------------------------
 *
 * DELIBERATELY SHORT. Only items where the app holds the actual fact appear
 * here; a mapping that stretched to "well, sort of" would put the app's word
 * behind a check it cannot see, which is the failure this whole file guards.
 *
 * `kind` names the record it comes from so the page can link straight to it —
 * the point of the evidence is to save the hunt, and a figure with no way
 * through to the thing it came from is just another number to distrust.
 */
export const EVIDENCE = {
  1: { kind: 'vesselCerts', match: 'registry', label: 'Certificate of Registry' },
  7: { kind: 'previousSelfCert', label: 'Last self-certification' },
  10: { kind: 'vesselCerts', match: 'servicing', label: 'Fire appliance and liferaft servicing' },
  20: { kind: 'drills', label: 'Drill records' },
  23: { kind: 'crewList', label: 'Crew list' },
  24: { kind: 'familiarisation', label: 'Induction records' },
  25: { kind: 'familiarisation', label: 'On board training records' },
  28: { kind: 'crewCerts', match: 'competency', label: 'Certificates of competency' },
  29: { kind: 'crewCerts', match: 'training', label: 'Crew training certificates' },
  77: { kind: 'garbage', label: 'Garbage record book' },
  100: { kind: 'oily', label: 'Oily water disposal' },
  116: { kind: 'vesselCerts', match: 'epirb', label: 'EPIRB annual test' },
  136: { kind: 'vesselCerts', match: 'stability', label: 'Stability book' },
  148: { kind: 'vesselCerts', match: 'ukfvc', label: 'UK Fishing Vessel Certificate' },
}

/** Item numbers the app can say anything at all about. */
export const EVIDENCED = Object.keys(EVIDENCE).map(Number)

/* ---- ANSWERS -------------------------------------------------------------
 *
 * `yes` complied · `no` not complied · `na` does not apply to this vessel.
 * Anything else — including undefined — is UNANSWERED, and unanswered is not a
 * state the skipper chose. It is the difference between "I looked and it is
 * fine" and "nobody has been there yet", and they must never render alike.
 */
export const ANSWERS = ['yes', 'no', 'na']
export const isAnswered = (a) => ANSWERS.includes(a?.state)

/** How far through, per section and overall. */
export function progress(answers = {}) {
  const items = allItems()
  const done = items.filter((i) => isAnswered(answers[i.n]))
  const bySection = SECTIONS.map((s) => ({
    key: s.key,
    title: s.title,
    total: s.items.length,
    done: s.items.filter((i) => isAnswered(answers[i.n])).length,
  }))
  return { total: items.length, done: done.length, bySection }
}

/* ---- WHAT STOPS A SELF-CERTIFICATION BEING SIGNED ------------------------
 *
 * Three things, and they are three different facts rather than one count:
 *
 *   `unanswered`  nobody has been there yet
 *   `notComplied` answered `no` — a self-certificate is a statement of
 *                 compliance, so this is not something to sign around
 *   `naNoReason`  answered `na` with nothing said. "Does not apply" is a
 *                 judgement and it has to carry its reason, or a year later
 *                 nobody can tell a considered exemption from a shrug.
 *
 * Reported as lists, not as a number: "37 outstanding" sends nobody anywhere.
 */
export function blockers(answers = {}) {
  const items = allItems()
  const unanswered = items.filter((i) => !isAnswered(answers[i.n]))
  const notComplied = items.filter((i) => answers[i.n]?.state === 'no')
  const naNoReason = items.filter((i) => answers[i.n]?.state === 'na' && !String(answers[i.n]?.note || '').trim())
  return {
    unanswered, notComplied, naNoReason,
    ok: !unanswered.length && !notComplied.length && !naNoReason.length,
  }
}

/* ---- THE CONTRADICTIONS, which is what the evidence is really for ---------
 *
 * An item answered `yes` where the app's own record says otherwise. It does not
 * change the answer and it does not block the sign-off: the skipper may be
 * holding a certificate the app has never been told about, and software that
 * overruled him on that would be wrong more often than he is.
 *
 * `state: 'attention'` on the evidence is what raises it. `unknown` never does —
 * the app not knowing is not evidence of anything, and a warning that fires
 * whenever a record is thin is a warning nobody reads.
 */
export function contradictions(answers = {}, evidence = {}) {
  return allItems()
    .filter((i) => answers[i.n]?.state === 'yes' && evidence[i.n]?.state === 'attention')
    .map((i) => ({ n: i.n, text: i.text, section: i.sectionTitle, says: evidence[i.n].detail }))
}

/* ---- THE PERIOD ----------------------------------------------------------
 *
 * A self-certification belongs to a certificate year, not a calendar one. The
 * anniversary of the UKFVC is what it hangs off, so the period is named by the
 * anniversary it follows — "2026/27" for the year beginning on the 2026
 * anniversary — and a certificate with no issue date on file gets no period at
 * all rather than a guessed one.
 */
export function periodFor(certIssued, on = new Date()) {
  const iss = certIssued ? new Date(certIssued) : null
  if (!iss || Number.isNaN(iss.getTime())) return null
  const d = on instanceof Date ? on : new Date(on)
  if (Number.isNaN(d.getTime())) return null
  let year = d.getUTCFullYear()
  const anniv = new Date(Date.UTC(year, iss.getUTCMonth(), iss.getUTCDate()))
  if (d < anniv) year -= 1
  return `${year}/${String((year + 1) % 100).padStart(2, '0')}`
}

/** Whole years since the certificate was issued, or null. Year 1 needs no self-
 *  certificate — the survey that issued the certificate was the check. */
export function certYear(certIssued, on = new Date()) {
  const iss = certIssued ? new Date(certIssued) : null
  if (!iss || Number.isNaN(iss.getTime())) return null
  const d = on instanceof Date ? on : new Date(on)
  if (Number.isNaN(d.getTime())) return null
  let y = d.getUTCFullYear() - iss.getUTCFullYear()
  const anniv = new Date(Date.UTC(d.getUTCFullYear(), iss.getUTCMonth(), iss.getUTCDate()))
  if (d < anniv) y -= 1
  return y
}

function num(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
