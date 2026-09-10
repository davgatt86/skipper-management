import { toLitres, fmtCubic, fmtLitres } from '../units.js'

/* THE OIL RECORD BOOK PART I — machinery space operations.
 *
 * David, Sep 2026: "do ORB."
 *
 * SHE NEEDS ONE. Regulation 20 of the Merchant Shipping (Prevention of Oil
 * Pollution) Regulations 2019: "Every oil tanker of 150 GT and above, and every
 * ship of 400 GT and above other than an oil tanker" must be provided with an
 * Oil Record Book Part I. Audacious is 498 GT. The Fuel & Oil Log already in
 * this app is NOT one — it is a bunkering record, with no codes, no officer's
 * signature and no master's signature.
 *
 * THE FORM IS PRESCRIBED, NOT OURS TO DESIGN. Reg 20: the book "must be in the
 * form specified in Appendix III to Annex I". Every entry is a CODE LETTER and
 * an ITEM NUMBER; free text belongs in code (I) and nowhere else. The list below
 * is transcribed from the US Coast Guard's Oil Record Book form, OMB No.
 * 1625-0009 — a US Government work, which reproduces the Appendix III list —
 * and should be checked against the book aboard before this is relied on.
 *
 * FOUR RULES OUT OF THE REGULATION, and they are what make this different from
 * every other book in this app:
 *
 *   1. Each entry is "signed-off by the officer or officers in charge of that
 *      operation".
 *   2. "Each completed PAGE must be signed by the master." So the book has
 *      pages, and a page is a real unit that gets closed and signed. Software
 *      would not invent that; the law requires it.
 *   3. "Preserved for a period of three years after the last entry has been
 *      made." Not three years per entry — three years after the LAST one, so
 *      the retention date of every entry moves whenever a new one is made.
 *   4. Kept aboard, "readily available for inspection at all reasonable times",
 *      and an inspector may require the master to certify a copy a true copy.
 *
 * NOTHING IS EVER EDITED OR DELETED. On paper a wrong entry is struck through
 * and initialled, never erased; in an electronic book it is corrected by a
 * FURTHER ENTRY that refers to it. The schema has no update and no delete policy
 * on entries at all — which is the strongest form of MEPC.312(74)'s requirement
 * that entries be protected from deletion, and the reason to keep this in the
 * app rather than a spreadsheet.
 *
 * AND IT IS NOT AN APPROVED ELECTRONIC RECORD BOOK YET. MARPOL was amended by
 * MEPC.314(74) to allow an electronic ORB, and the UK gives effect to that — but
 * MIN 644 requires the system to be approved against the MEPC.312(74) Guidelines
 * by a Recognised Organisation, which then issues a "Declaration of MARPOL
 * electronic record book" to be kept aboard. UNTIL THAT DECLARATION EXISTS THE
 * PAPER BOOK IS THE RECORD and this is a working copy. The page says so.
 */

/** Regulation 20(1): 400 GT and above, other than an oil tanker. */
export function orbRequired(details) {
  const gt = num(details?.gross_tonnage)
  if (gt == null) return { required: null, why: 'no gross tonnage on file' }
  return { required: gt >= 400, gt }
}

/* ---- Appendix III, Part I: the list of items to be recorded --------------- */
export const CODES = [
  {
    code: 'A',
    title: 'Ballasting or cleaning of oil fuel tanks',
    items: [
      { n: '1', text: 'Identity of tank(s) ballasted' },
      { n: '2', text: 'Whether cleaned since they last contained oil and, if not, type of oil previously carried' },
      { n: '3.1', text: 'Cleaning process: position of ship and time at the start and completion of cleaning' },
      { n: '3.2', text: 'Cleaning process: identity of tank(s) in which one or another method has been employed (rinsing through, steaming, cleaning with chemicals; type and quantity of chemicals used)' },
      { n: '3.3', text: 'Cleaning process: identity of tank(s) into which cleaning water was transferred and the quantity' },
      { n: '4.1', text: 'Ballasting: position of ship and time at start and end of ballasting' },
      { n: '4.2', text: 'Ballasting: quantity of ballast if tanks are not cleaned' },
    ],
  },
  {
    code: 'B',
    title: 'Discharge of dirty ballast or cleaning water from oil fuel tanks referred to under section (A)',
    items: [
      { n: '5', text: 'Identity of tank(s)' },
      { n: '6', text: 'Position of ship at start of discharge' },
      { n: '7', text: 'Position of ship on completion of discharge' },
      { n: '8', text: "Ship's speed(s) during discharge" },
      { n: '9.1', text: 'Method of discharge: through 15 ppm equipment' },
      { n: '9.2', text: 'Method of discharge: to reception facilities' },
      { n: '10', text: 'Quantity discharged' },
    ],
  },
  {
    code: 'C',
    title: 'Collection, transfer and disposal of oil residues (sludge and other oil residues)',
    items: [
      { n: '11.1', text: 'Collection of oil residues (sludge): identity of tank(s)' },
      { n: '11.2', text: 'Collection of oil residues (sludge): capacity of tank(s)' },
      { n: '11.3', text: 'Collection of oil residues (sludge): total quantity of retention' },
      { n: '11.4', text: 'Collection of oil residues (sludge): quantity of residue collected by manual operation' },
      { n: '12.1', text: 'Transfer or disposal of oil residues (sludge): to reception facilities (identify port)' },
      { n: '12.2', text: 'Transfer or disposal of oil residues (sludge): to another (other) tank(s) (indicate tank(s) and the total content of tank(s))' },
      { n: '12.3', text: 'Transfer or disposal of oil residues (sludge): incinerated (indicate total time of operation with time of start and stop)' },
      { n: '12.4', text: 'Transfer or disposal of oil residues (sludge): other method (state which)' },
    ],
    /* WEEKLY, EVEN ON A LONG TRIP. The form says the quantity retained on board
       "should be recorded weekly ... even if the voyage lasts more than one
       week", and a gap in the weekly 11.3 is the first thing a PSC inspector
       counts. The page reports the gap; it does not invent an entry. */
    weekly: ['11.1', '11.2', '11.3'],
  },
  {
    code: 'D',
    title: 'Non-automatic starting of discharge overboard, transfer or disposal otherwise of bilge water which has accumulated in machinery spaces',
    items: [
      { n: '13', text: 'Quantity discharged, transferred or disposed of' },
      { n: '14', text: 'Time of discharge, transfer or disposal (start and stop)' },
      { n: '15.1', text: 'Method: through 15 ppm equipment (state position at start and end)' },
      { n: '15.2', text: 'Method: to reception facilities (identify port)' },
      { n: '15.3', text: 'Method: to slop tank or holding tank or other tank(s) (indicate tank(s); state quantity retained)' },
    ],
  },
  {
    code: 'E',
    title: 'Automatic starting of discharge overboard, transfer or disposal otherwise of bilge water which has accumulated in machinery spaces',
    items: [
      { n: '16', text: 'Time and position of ship at which the system has been put into automatic mode of operation for discharge overboard, through 15 ppm equipment' },
      { n: '17', text: 'Time when the system has been put into automatic mode of operation for transfer of bilge water to holding tank (identify tank)' },
      { n: '18', text: 'Time when the system has been put into manual operation' },
    ],
  },
  {
    code: 'F',
    title: 'Condition of the oil filtering equipment',
    items: [
      { n: '19', text: 'Time of system failure' },
      { n: '20', text: 'Time when system has been made operational' },
      { n: '21', text: 'Reasons for failure' },
    ],
    /* THE FORM ITSELF SAYS SO: a failure needs a code (I) entry recording that
       the overboard valve was sealed shut, and another when it is unsealed. */
    pairsWithRemark: true,
  },
  {
    code: 'G',
    title: 'Accidental or other exceptional discharges of oil',
    items: [
      { n: '22', text: 'Time of occurrence' },
      { n: '23', text: 'Place or position of ship at time of occurrence' },
      { n: '24', text: 'Approximate quantity and type of oil' },
      { n: '25', text: 'Circumstances of discharge or escape, the reasons therefor and general remarks' },
    ],
  },
  {
    code: 'H',
    title: 'Bunkering of fuel or bulk lubricating oil',
    items: [
      { n: '26.1', text: 'Bunkering: place of bunkering' },
      { n: '26.2', text: 'Bunkering: start and stop date and time of bunkering' },
      { n: '26.3', text: 'Bunkering: type and quantity of fuel oil and identity of tank(s) (state quantity added and total content of tank(s))' },
      { n: '26.4', text: 'Bunkering: type and quantity of lubricating oil and identity of tank(s) (state quantity added and total content of tank(s))' },
    ],
  },
  {
    code: 'I',
    title: 'Additional operational procedures and general remarks',
    /* The ONLY code with no numbered items, and therefore the only place free
       text belongs. Everything else is a code and an item number. */
    items: [],
    freeText: true,
  },
]

export const CODE_LETTERS = CODES.map((c) => c.code)
export const codeFor = (letter) => CODES.find((c) => c.code === letter) || null

/** Every item, flat, as `A/3.1`. */
export function allEntries() {
  return CODES.flatMap((c) => c.items.map((i) => ({ ...i, code: c.code, codeTitle: c.title })))
}

/**
 * Is this a code and item the form actually has?
 *
 * REFUSED RATHER THAN CORRECTED. A wrongly coded entry is a deficiency, and
 * quietly moving one to the nearest valid item would put a figure in the book
 * that nobody chose.
 */
export function validEntry(code, itemN) {
  const c = codeFor(code)
  if (!c) return { ok: false, why: `there is no code (${code}) in Part I` }
  if (c.freeText) return itemN ? { ok: false, why: 'code (I) carries no item number — it is the remarks code' } : { ok: true }
  if (!itemN) return { ok: false, why: `code (${code}) needs an item number` }
  if (!c.items.some((i) => i.n === itemN)) return { ok: false, why: `code (${code}) has no item ${itemN}` }
  return { ok: true }
}

/* ---- RETENTION: three years after the LAST entry, not after each one -------
 * Reg 20: "preserved for a period of three years after the last entry has been
 * made". So the date the whole book may be let go moves every time anybody
 * writes in it — which is the opposite of a per-row retention and the sort of
 * thing that gets implemented backwards.
 */
export function keepUntil(entries = []) {
  const last = entries.reduce((m, e) => {
    const d = new Date(e.entry_date || e.recorded_at || 0)
    return Number.isNaN(d.getTime()) ? m : (m == null || d > m ? d : m)
  }, null)
  if (!last) return null
  const d = new Date(last)
  d.setUTCFullYear(d.getUTCFullYear() + 3)
  return d.toISOString().slice(0, 10)
}

/* ---- WHAT IS NOT SIGNED --------------------------------------------------
 * Two different signatures, and they are not interchangeable: the officer signs
 * the OPERATION, the master signs the PAGE. Reported separately because they
 * are chased from different people.
 */
export function unsigned(entries = [], pages = []) {
  const byPage = new Map(pages.map((p) => [p.id, p]))
  return {
    noOfficer: entries.filter((e) => !String(e.officer_name || '').trim()),
    openPages: pages.filter((p) => !p.master_signed_at),
    /* An entry on a page the master has signed is settled; one on an open page
       is simply not finished yet, which is not a fault. */
    onSignedPage: entries.filter((e) => byPage.get(e.page_id)?.master_signed_at),
  }
}

/* ---- THE WEEKLY SLUDGE READING -------------------------------------------
 * Code C item 11.3 is required weekly even on a long trip, and a gap in it is
 * the first thing a port state inspector counts. REPORTED, NEVER FILLED IN:
 * inventing a sludge quantity nobody measured would be the worst thing this
 * app could do.
 */
export function weeklyGaps(entries = [], from, to) {
  const start = new Date(from), end = new Date(to)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return []
  const weeks = []
  const seen = entries
    .filter((e) => e.code === 'C' && e.item_n === '11.3')
    .map((e) => weekKey(new Date(e.entry_date)))
  const set = new Set(seen)
  for (let d = mondayOf(start); d <= end; d = new Date(d.getTime() + 7 * 864e5)) {
    const k = weekKey(d)
    if (!set.has(k)) weeks.push({ week: k, from: d.toISOString().slice(0, 10) })
  }
  return weeks
}

function mondayOf(d) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = (x.getUTCDay() + 6) % 7
  x.setUTCDate(x.getUTCDate() - day)
  return x
}
function weekKey(d) {
  if (Number.isNaN(d?.getTime?.())) return 'x'
  const m = mondayOf(d)
  return m.toISOString().slice(0, 10)
}

function num(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/* ---- Pages ---------------------------------------------------------------
 * THE PAGE NUMBER IS THE BOAT'S, NOT A COUNT OF ROWS. A boat with thirty-nine
 * pages on paper starts this book at 40 and the numbering has to carry on from
 * there, or the electronic book and the paper one disagree about which page a
 * surveyor is being shown.
 */
export function nextPageNo(pages = [], startAt = 1) {
  const ns = pages.map((p) => Number(p?.page_no)).filter(Number.isFinite)
  return ns.length ? Math.max(...ns) + 1 : startAt
}

/** The one page entries may be made on: open, unsigned, highest numbered. */
export function openPageOf(pages = []) {
  const open = pages.filter((p) => !p.closed_at && !p.master_signed_at)
  if (!open.length) return null
  return open.reduce((a, b) => (Number(b.page_no) > Number(a.page_no) ? b : a))
}

/** Entries grouped onto their page, each page's own oldest first. */
export function entriesByPage(entries = []) {
  const by = new Map()
  for (const e of entries) {
    if (!by.has(e.page_id)) by.set(e.page_id, [])
    by.get(e.page_id).push(e)
  }
  for (const list of by.values()) list.sort(byDate)
  return by
}

/**
 * WHICH ENTRIES HAVE BEEN SUPERSEDED, and by what.
 *
 * A corrected entry is never removed and never struck out on screen either --
 * it is what the book says happened, and the correction is a second fact about
 * it. Both are shown; the older one is marked with the date of the entry that
 * put it right.
 */
export function correctionsOf(entries = []) {
  const by = new Map()
  for (const e of entries) {
    if (!e.corrects_entry_id) continue
    if (!by.has(e.corrects_entry_id)) by.set(e.corrects_entry_id, [])
    by.get(e.corrects_entry_id).push(e)
  }
  for (const list of by.values()) list.sort(byDate)
  return by
}

/**
 * One line describing an entry, for a list.
 *
 * IT NEVER INVENTS A FIGURE AND NEVER FILLS A BLANK. An entry with no quantity
 * shows no quantity: on this book of all books, a plausible-looking number
 * nobody wrote down is the worst thing the software could produce.
 */
export function describeEntry(entry) {
  if (!entry) return ''
  const bits = []
  if (entry.tank) bits.push(entry.tank)
  if (entry.quantity != null && entry.quantity !== '') {
    /* BOTH UNITS, AND WHY THAT IS NOT WRONG.
 *
       David: "would it be wrong to have both in the ORB too?" — no. What
       WOULD be wrong is two numbers in the prescribed QUANTITY COLUMN, which
       is an ambiguity a surveyor has to resolve. The column carries one
       figure in one unit; the second sits beside it in words, where it ties
       the entry to the delivery note the fuel came off.

       Cubic metres lead, because that is the unit this book is kept in. The
       fuel log does it the other way round, because that is the unit its own
       reader works in.

       ONLY FOR m³. An entry written in any other unit is shown exactly as it
       was written — converting a unit nobody declared would be inventing one.
       1 m³ = 1000 L is exact and needs no source; see src/lib/units.js. */
    const isCubic = String(entry.unit || '').toLowerCase() === 'm3'
    const litres = isCubic ? toLitres(entry.quantity) : null
    bits.push(isCubic && litres != null
      ? `${fmtCubic(entry.quantity)} (${fmtLitres(litres)})`
      : `${entry.quantity}${entry.unit ? ` ${entry.unit}` : ''}`)
  }
  if (entry.port) bits.push(entry.port)
  if (entry.position_text) bits.push(entry.position_text)
  if (entry.narrative) bits.push(entry.narrative)
  return bits.join(' · ')
}

/** `A/3.1` -- the way an entry is written in the book and read out of it. */
export const entryRef = (e) => (e?.code === 'I' || !e?.item_n ? `(${e?.code})` : `(${e.code}) ${e.item_n}`)

/** The text of the prescribed item, or null where there is none. */
export function itemText(code, itemN) {
  const c = codeFor(code)
  if (!c) return null
  if (c.freeText) return c.title
  return c.items.find((i) => i.n === itemN)?.text || null
}

function byDate(a, b) {
  const d = String(a.entry_date || '').localeCompare(String(b.entry_date || ''))
  return d !== 0 ? d : String(a.recorded_at || '').localeCompare(String(b.recorded_at || ''))
}
