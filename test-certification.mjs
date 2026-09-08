import assert from 'node:assert'
import {
  FORM, SECTIONS, allItems, bandFor, checklistApplies, progress, blockers,
  contradictions, periodFor, certYear, EVIDENCE, EVIDENCED, isAnswered,
} from './src/lib/certification/selfCert.js'

let n = 0
const ok = (c, why) => { assert.ok(c, why); n++ }
const eq = (a, b, why) => { assert.deepStrictEqual(a, b, why); n++ }

/* ---- THE FORM ITSELF ------------------------------------------------------
 * Transcribed from MSF 5550 rev 09.24, not written from memory. If the MCA
 * revises it, these numbers change and they should change deliberately. */
{
  const items = allItems()
  eq(items.length, 148, 'MSF 5550 rev 09.24 carries 148 numbered checks')
  eq(SECTIONS.length, 16, 'in 16 sections')
  eq(FORM.code, 'MSF 5550', 'the form is named')
  eq(FORM.revision, '09.24', 'and so is the revision, because the answer means nothing without it')
  eq(FORM.basis, ['MSN 1872', 'MSN 1885'], 'and what it is based on')

  const ns = items.map((i) => i.n)
  eq(new Set(ns).size, ns.length, 'no item number appears twice')
  eq(Math.min(...ns), 1, 'they start at 1')
  eq(Math.max(...ns), 148, 'and run to 148')
  eq(ns.slice().sort((a, b) => a - b), ns, 'and are in the order the form runs')

  ok(items.every((i) => i.text.trim().length > 3), 'every item carries its text')
  /* THE ODT LOST SPACES BETWEEN STYLED RUNS and they were put back by hand.
     A word this long is almost certainly two run together, and shipping one
     would put a garbled checklist in front of a surveyor. */
  const KNOWN = /^(certificates?|arrangements?|extinguishers?|accommodation|instructions?|requirements?|identification|compartments?|unauthorised|watertight|competency|maintenance|independent|ventilation|reflective|revolutions?|modifications|certification|extinguishing|automatically)$/i
  const runOn = items.flatMap((i) => i.text.split(/[^A-Za-z]+/)
    .filter((t) => t.length >= 13 && !KNOWN.test(t)).map((t) => `${i.n}:${t}`))
  eq(runOn, [], 'no two words are run together')

  /* The first and last are load-bearing: item 7 is the previous year's self
     certificate, item 148 is the certificate being issued or endorsed. */
  ok(items.find((i) => i.n === 7).text.includes('Annual Self Certification'), 'item 7 is the self-certification itself')
  ok(items.find((i) => i.n === 148).text.includes('Certificate Issued'), 'item 148 closes the loop')
}

/* ---- WHICH CODE THE VESSEL IS UNDER — decided by four centimetres ---------
 * Audacious is 29.80 m LOA and 23.96 m REGISTERED. Reading the wrong one puts
 * her in the 24 m band and demands an IFVC and an annual class survey. */
{
  const aud = { length_overall: 29.8, length_registered: 23.96 }
  eq(bandFor(aud).band, '15to24', 'Audacious is in the 15-24 m band on REGISTERED length')
  ok(checklistApplies(aud), 'so the checklist applies to her')

  eq(bandFor({ length_overall: 29.8, length_registered: 24.0 }).band, '24plus',
     '24.00 m registered is a different code — four centimetres decides it')
  ok(!checklistApplies({ length_overall: 29.8, length_registered: 24.0 }),
     'and the checklist must refuse to draw for her')

  eq(bandFor({ length_overall: 12, length_registered: 11 }).band, 'under15', 'under 15 m LOA is a third code')

  /* LENGTH OVERALL IS NOT THE TEST, and using it would be wrong by six metres
     on this very boat. A vessel with only LOA on file gets no band at all. */
  eq(bandFor({ length_overall: 29.8 }).band, null, 'length overall alone decides nothing')
  ok(bandFor({ length_overall: 29.8 }).why.includes('registered'), 'and it says which figure is missing')
  eq(bandFor({}).band, null, 'no lengths at all is unknown, never assumed')
  eq(bandFor(null).band, null, 'and so is no particulars')
  ok(!checklistApplies({ length_overall: 29.8 }), 'an unknown band never gets the checklist')

  /* Number('') === 0 has bitten this codebase five times. A blank length must
     not become a zero-metre boat, which would sort into "under 15". */
  eq(bandFor({ length_overall: '', length_registered: '' }).band, null, 'blank lengths are not zero')
}

/* ---- NOTHING IS EVER PRE-ANSWERED ----------------------------------------
 * The app knows about 14 of the 148. It must not answer even those. */
{
  eq(EVIDENCED.length, 14, 'the app can speak to 14 of the 148')
  ok(EVIDENCED.every((k) => allItems().some((i) => i.n === k)), 'and every one is a real item number')
  const p = progress({})
  eq(p.done, 0, 'a fresh certification has nothing answered, including the evidenced ones')
  eq(p.total, 148, 'against all 148')
  ok(!isAnswered(undefined), 'no row means unanswered')
  ok(!isAnswered({ state: 'maybe' }), 'and so does a state that is not one of the three')
  ok(isAnswered({ state: 'na' }), 'but not applicable IS an answer')
}

/* ---- WHAT STOPS A SIGN-OFF, as three facts rather than one count ---------- */
{
  const all = allItems()
  const yes = Object.fromEntries(all.map((i) => [i.n, { state: 'yes' }]))
  ok(blockers(yes).ok, 'everything complied is ready to sign')

  const withNo = { ...yes, 31: { state: 'no', note: 'bulwark wasted' } }
  const b1 = blockers(withNo)
  ok(!b1.ok, 'an item not complied with stops it')
  eq(b1.notComplied.length, 1, 'and is counted on its own')
  eq(b1.unanswered.length, 0, 'not lumped in with the unanswered')

  /* "Does not apply" is a judgement and has to carry its reason, or a year
     later nobody can tell a considered exemption from a shrug. */
  const bareNa = { ...yes, 30: { state: 'na' } }
  ok(!blockers(bareNa).ok, 'a bare "not applicable" stops it too')
  eq(blockers(bareNa).naNoReason.length, 1, 'and is its own kind of outstanding')
  ok(blockers({ ...yes, 30: { state: 'na', note: 'none held' } }).ok, 'with a reason it is fine')
  ok(!blockers({ ...yes, 30: { state: 'na', note: '   ' } }).ok, 'whitespace is not a reason')

  const empty = blockers({})
  eq(empty.unanswered.length, 148, 'a fresh one has everything outstanding')
  eq(empty.notComplied.length, 0, 'and nothing failed — which is not the same thing')
}

/* ---- THE CONTRADICTIONS, which is what the evidence is actually for -------
 * It never changes an answer and never blocks the sign-off: the skipper may be
 * holding a certificate the app has never been told about. */
{
  const answers = { 10: { state: 'yes' }, 23: { state: 'yes' }, 29: { state: 'no' }, 77: { state: 'na', note: 'x' } }
  const ev = {
    10: { state: 'attention', detail: 'liferaft service expired 24-07-2026' },
    23: { state: 'ok', detail: '11 aboard' },
    29: { state: 'attention', detail: 'a passport expired' },
    77: { state: 'attention', detail: 'never written in' },
  }
  const c = contradictions(answers, ev)
  eq(c.length, 1, 'only an item answered COMPLIED against a record that disagrees')
  eq(c[0].n, 10, 'and it names which')
  ok(c[0].says.includes('liferaft'), 'and quotes what the record actually says')

  ok(!blockers({ ...Object.fromEntries(allItems().map((i) => [i.n, { state: 'yes' }])) }).notComplied.length,
     'a contradiction does not become a failure')

  /* THE APP NOT KNOWING IS NOT EVIDENCE OF ANYTHING. A warning that fires
     whenever a record is thin is a warning nobody reads. */
  eq(contradictions({ 10: { state: 'yes' } }, { 10: { state: 'unknown', detail: 'nothing on file' } }).length, 0,
     'an unknown never raises a contradiction')
  eq(contradictions({ 10: { state: 'yes' } }, {}).length, 0, 'and neither does no evidence at all')
}

/* ---- THE PERIOD hangs off the certificate, not the calendar ---------------
 * Audacious's UKFVC was issued 19-07-2022, so her year turns on 19 July. */
{
  eq(periodFor('2022-07-19', '2026-09-06'), '2026/27', 'after the anniversary, the new certificate year')
  eq(periodFor('2022-07-19', '2026-07-18'), '2025/26', 'the day before it, still the old one')
  eq(periodFor('2022-07-19', '2026-07-19'), '2026/27', 'and on the day itself, the new one')
  eq(periodFor(null), null, 'no certificate date means no period, rather than a guessed one')
  eq(periodFor('not a date'), null, 'and neither does a bad one')

  eq(certYear('2022-07-19', '2026-09-06'), 4, 'four whole years since issue')
  eq(certYear('2022-07-19', '2022-08-01'), 0, 'the year the certificate was issued is year 0 — the survey was the check')
  eq(certYear(null), null, 'and unknown stays unknown')
}

/* ---- THE SHIPPED LIST IS A BASELINE, not a copy to be edited ------------- */
{
  const before = JSON.stringify(SECTIONS)
  progress({}); blockers({}); contradictions({}, {}); allItems()
  eq(JSON.stringify(SECTIONS), before, 'nothing here mutates the shipped checklist')
  const a = allItems(), b = allItems()
  ok(a !== b, 'and each caller gets its own copy to render')
}

/* ==== THE OIL RECORD BOOK PART I ==========================================
 * Reg 20 of the Merchant Shipping (Prevention of Oil Pollution) Regulations
 * 2019. Audacious is 498 GT, so she must have one. The list below is the form
 * itself and is not ours to design.
 */
const orb = await import('./src/lib/certification/orb.js')
const {
  CODES, CODE_LETTERS, allEntries, validEntry, orbRequired, keepUntil, unsigned,
  weeklyGaps, nextPageNo, openPageOf, entriesByPage, correctionsOf, describeEntry,
  entryRef, itemText,
} = orb

/* ---- The prescribed list -------------------------------------------------
 * ONE OF THESE TWO LISTS IS A COPY, and this repo has been bitten by that
 * before. `supabase/oil_record_book.sql` seeds `orb_items` with the same 41
 * pairs and the database now refuses anything else, so editing one without
 * the other has to fail here rather than at save time on a boat.
 */
{
  eq(CODE_LETTERS, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'], 'nine codes, A to I')
  const items = allEntries()
  eq(items.length, 41, '41 numbered items across the eight coded sections')

  /* The exact pairs seeded into public.orb_items. If this fails, the migration
     and the JS have drifted and one of them is now wrong. */
  const SEEDED = [
    'A/1', 'A/2', 'A/3.1', 'A/3.2', 'A/3.3', 'A/4.1', 'A/4.2',
    'B/5', 'B/6', 'B/7', 'B/8', 'B/9.1', 'B/9.2', 'B/10',
    'C/11.1', 'C/11.2', 'C/11.3', 'C/11.4', 'C/12.1', 'C/12.2', 'C/12.3', 'C/12.4',
    'D/13', 'D/14', 'D/15.1', 'D/15.2', 'D/15.3',
    'E/16', 'E/17', 'E/18',
    'F/19', 'F/20', 'F/21',
    'G/22', 'G/23', 'G/24', 'G/25',
    'H/26.1', 'H/26.2', 'H/26.3', 'H/26.4',
  ]
  eq(items.map((i) => `${i.code}/${i.n}`), SEEDED, 'the JS list is exactly what the database holds')
  ok(items.every((i) => i.text.trim().length > 8), 'every item carries the wording off the form')

  /* CODE (I) IS THE ONLY PLACE FREE TEXT BELONGS, and it is the only code with
     no numbered items. Give it one and the whole discipline goes. */
  eq(CODES.find((c) => c.code === 'I').items.length, 0, 'code (I) has no numbered items')
  ok(CODES.find((c) => c.code === 'I').freeText, 'and is the remarks code')
  ok(CODES.filter((c) => c.code !== 'I').every((c) => !c.freeText), 'no other code takes free text')
}

/* ---- REFUSED, NEVER CORRECTED -------------------------------------------
 * A wrongly coded entry is a deficiency. Quietly moving one to the nearest
 * valid item would put a figure in this book that nobody chose.
 */
{
  ok(validEntry('C', '11.3').ok, 'a real code and item is accepted')
  ok(!validEntry('C', '99.9').ok, 'an item the form does not have is refused')
  ok(!validEntry('C', '99.9').why.includes('11.3'), 'and it is not nudged towards the nearest one')
  ok(!validEntry('Z', '1').ok, 'so is a code that does not exist')
  ok(!validEntry('C').ok, 'a coded entry needs its item number')
  ok(validEntry('I').ok, 'code (I) needs none')
  ok(!validEntry('I', '1').ok, 'and must not carry one')
  /* `A/11.3` is the shape this catches: both halves are real, the pair is not.
     It is also exactly what the composite FK in the migration refuses. */
  ok(!validEntry('A', '11.3').ok, 'a real item under the wrong code is still refused')
}

/* ---- WHO NEEDS ONE ------------------------------------------------------- */
{
  eq(orbRequired({ gross_tonnage: 498 }).required, true, 'Audacious at 498 GT must have one')
  eq(orbRequired({ gross_tonnage: 400 }).required, true, '400 GT is the line, and it is inclusive')
  eq(orbRequired({ gross_tonnage: 399 }).required, false, 'below it, none is required')
  /* NOT REQUIRED AND NOT KNOWN MUST NOT READ ALIKE. `null` is not `false`. */
  eq(orbRequired({}).required, null, 'no tonnage on file is unknown, never "not required"')
  eq(orbRequired(null).required, null, 'and neither is no particulars')
  eq(orbRequired({ gross_tonnage: '' }).required, null, 'a blank tonnage is not a zero-ton ship')
}

/* ---- THREE YEARS AFTER THE LAST ENTRY, not three years per entry ---------
 * Reg 20. The date the whole book may be let go MOVES every time anybody
 * writes in it, which is the opposite of a per-row retention.
 */
{
  const e = [{ entry_date: '2023-01-04' }, { entry_date: '2026-09-01' }, { entry_date: '2024-06-06' }]
  eq(keepUntil(e), '2029-09-01', 'three years after the LAST entry, not the first')
  eq(keepUntil([{ entry_date: '2023-01-04' }]), '2026-01-04', 'one entry sets it on its own')
  eq(keepUntil([]), null, 'an empty book has no retention date to state')
  eq(keepUntil([{ entry_date: 'rubbish' }]), null, 'and an unreadable date is not a date')
}

/* ---- TWO SIGNATURES, and they are not interchangeable --------------------
 * The officer signs the OPERATION, the master signs the PAGE, and they are
 * chased from different people.
 */
{
  const pages = [
    { id: 'p1', page_no: 1, closed_at: '2026-08-01', master_signed_at: '2026-08-02' },
    { id: 'p2', page_no: 2, closed_at: '2026-09-01', master_signed_at: null },
    { id: 'p3', page_no: 3, closed_at: null, master_signed_at: null },
  ]
  const entries = [
    { id: 'a', page_id: 'p1', officer_name: 'D Henderson', entry_date: '2026-08-01' },
    { id: 'b', page_id: 'p2', officer_name: 'N Wood', entry_date: '2026-09-01' },
    { id: 'c', page_id: 'p3', officer_name: '', entry_date: '2026-09-05' },
  ]
  const u = unsigned(entries, pages)
  eq(u.noOfficer.map((x) => x.id), ['c'], 'an entry with no officer named is its own outstanding thing')
  eq(u.openPages.map((p) => p.page_no), [2, 3], 'and a page the master has not signed is another')
  eq(u.onSignedPage.map((x) => x.id), ['a'], 'an entry on a signed page is settled')

  /* THE OPEN PAGE IS THE ONE ENTRIES GO ON: open, unsigned, highest numbered. */
  eq(openPageOf(pages).page_no, 3, 'the open page is the unclosed one')
  eq(openPageOf(pages.slice(0, 2)), null, 'with everything closed there is no page to write on')
  /* THE NUMBER IS THE BOAT OWN RECORD, NOT A COUNT OF ROWS — a book started at
     40 because thirty-nine are on paper carries on from there. */
  eq(nextPageNo(pages), 4, 'the next page follows the highest on record')
  eq(nextPageNo([]), 1, 'an empty book starts at one')
  eq(nextPageNo([], 40), 40, 'or wherever the paper book has reached')
  eq(nextPageNo([{ page_no: 39 }]), 40, 'and never at the row count')
}

/* ---- THE WEEKLY SLUDGE READING ------------------------------------------
 * Code C item 11.3 is required weekly even on a voyage longer than a week, and
 * a gap in it is the first thing a port state inspector counts. REPORTED,
 * NEVER FILLED IN.
 */
{
  const wk = (d) => ({ code: 'C', item_n: '11.3', entry_date: d })
  const four = weeklyGaps([], '2026-08-03', '2026-08-30')
  eq(four.length, 4, 'four weeks with nothing recorded are four gaps')
  eq(four[0].from, '2026-08-03', 'each named by the Monday it begins')

  const some = weeklyGaps([wk('2026-08-05'), wk('2026-08-20')], '2026-08-03', '2026-08-30')
  eq(some.map((g) => g.from), ['2026-08-10', '2026-08-24'], 'only the weeks actually missing')
  eq(weeklyGaps([wk('2026-08-05')], '2026-08-03', '2026-08-09').length, 0, 'a week with a reading is not a gap')

  /* ONLY 11.3 COUNTS. A sludge disposal is not a sludge reading, and the two
     are different items for a reason. */
  eq(weeklyGaps([{ code: 'C', item_n: '12.1', entry_date: '2026-08-05' }], '2026-08-03', '2026-08-09').length, 1,
     'a disposal under 12.1 does not answer the weekly 11.3')
  eq(weeklyGaps([{ code: 'H', item_n: '26.3', entry_date: '2026-08-05' }], '2026-08-03', '2026-08-09').length, 1,
     'and neither does a bunkering')
  eq(weeklyGaps([], '2026-08-30', '2026-08-03'), [], 'a backwards window asks nothing')
}

/* ---- A CORRECTION IS A FURTHER ENTRY, never an edit ---------------------- */
{
  const entries = [
    { id: 'a', page_id: 'p1', entry_date: '2026-08-01', recorded_at: '2026-08-01T09:00:00Z' },
    { id: 'b', page_id: 'p1', entry_date: '2026-08-03', recorded_at: '2026-08-03T09:00:00Z', corrects_entry_id: 'a' },
    { id: 'c', page_id: 'p2', entry_date: '2026-08-02', recorded_at: '2026-08-02T09:00:00Z' },
  ]
  const by = entriesByPage(entries)
  eq([...by.keys()].sort(), ['p1', 'p2'], 'entries group onto their page')
  eq(by.get('p1').map((e) => e.id), ['a', 'b'], 'oldest first — a record book is read forwards')

  const cor = correctionsOf(entries)
  eq(cor.get('a').map((e) => e.id), ['b'], 'the correction is filed against what it corrects')
  eq(cor.has('b'), false, 'and the correction itself is not superseded')
  /* THE ORIGINAL STAYS. Nothing here removes it, and nothing may. */
  eq(entries.filter((e) => e.id === 'a').length, 1, 'the corrected entry is still in the book')
}

/* ---- IT NEVER INVENTS A FIGURE ------------------------------------------ */
{
  eq(describeEntry({ tank: 'Sludge tank', quantity: 3.4, unit: 'm3' }), 'Sludge tank · 3.4 m3', 'what was written')
  eq(describeEntry({ tank: 'Sludge tank' }), 'Sludge tank', 'a missing quantity shows nothing at all')
  /* A QUANTITY OF NOUGHT IS A REAL READING, and Number('') === 0 has bitten
     this repo five times. Nought must print; blank must not. */
  eq(describeEntry({ quantity: 0, unit: 'm3' }), '0 m3', 'nought is a reading and is printed')
  eq(describeEntry({ quantity: '' }), '', 'a blank is not nought')
  eq(describeEntry(null), '', 'and nothing at all is nothing at all')

  eq(entryRef({ code: 'C', item_n: '11.3' }), '(C) 11.3', 'written the way it is read out of the book')
  eq(entryRef({ code: 'I' }), '(I)', 'and the remarks code carries no number')
  ok(itemText('C', '11.3').includes('total quantity of retention'), 'the prescribed wording is available')
  eq(itemText('C', '99'), null, 'and an item that does not exist has none')
  eq(itemText('Z', '1'), null, 'nor does a code that does not exist')
}

/* ==== THE OFFICIAL LOG BOOK ==============================================
 * The Merchant Shipping (Official Log Books) (Fishing Vessels) Regulations
 * 1981, SI 1981/570. Required of every UK fishing vessel of 55 feet and over.
 *
 * FIVE OF THE SEVEN RECORDS DAVID LISTED ARE THIS ONE BOOK -- drills, steering
 * gear tests, accommodation inspections, provisions and water, and accidents
 * are all numbered entries in the same Schedule.
 */
const olb = await import('./src/lib/certification/olb.js')
const {
  OLB_ENTRIES, IN_PERSON, RECURRING, entryOf, olbRequired,
  entryProblems, overdue, openBook, DEFAULT_INTERVALS,
  /* Aliased: the Oil Record Book exports its own validEntry and
     correctionsOf, and both books are asserted in this one file. */
  validEntry: validOlbEntry, correctionsOf: olbCorrections,
} = olb

/* ---- The Schedule -------------------------------------------------------
 * ONE OF THESE TWO LISTS IS A COPY. `supabase/official_log_book.sql` seeds
 * `olb_items` with the same 33 and the database refuses anything else, so
 * editing one without the other has to fail HERE rather than at save time on
 * a boat. Same guard as the ORB's `orb_items`, which exists because the first
 * probe of that schema wrote an item the form does not have straight into the
 * book.
 */
{
  eq(OLB_ENTRIES.length, 33, 'the Schedule has 33 numbered entries')
  eq(OLB_ENTRIES.map((e) => e.n), Array.from({ length: 33 }, (_, i) => i + 1),
     'numbered 1 to 33 with none missing and none twice')
  ok(OLB_ENTRIES.every((e) => e.text.trim().length > 10), 'every one carries its subject')
  ok(OLB_ENTRIES.every((e) => String(e.signer || '').trim()), 'and the person who must sign it')

  /* THE SEVEN THE SKIPPER MAY NOT DELEGATE, seeded identically in olb_items.
     A death, a birth, a refusal to assist a vessel in distress, a doubt about
     an officer's fitness, a handover of command. */
  eq(IN_PERSON, [4, 11, 14, 24, 28, 29, 30], 'seven entries must be signed by the skipper in person')

  /* The witnesses the Schedule prescribes, and they are not all the same
     person -- an OFFICER for the two testing entries, the seaman himself for
     his own complaint, and the mother of the child for a birth. */
  eq(entryOf(20).witness, 'an officer', 'hoist testing is witnessed by an officer')
  eq(entryOf(21).witness, 'an officer', 'and so is the steering gear')
  eq(entryOf(23).witness, 'the seaman', 'a seaman witnesses his own complaint')
  eq(entryOf(28).witness, 'the mother of the child', 'and a birth is witnessed by the mother')
  eq(entryOf(1).witness, null, 'the opening entries need no witness')
  eq(entryOf(18).witness, null, 'nor does the provisions and water inspection')
}

/* ---- WHO MUST HAVE ONE -------------------------------------------------- */
{
  /* 55 FEET, NOT METRES. The regulation is written in feet and the boat is on
     record in metres, so the conversion is the test. 29.80 m is about 98 ft. */
  eq(olbRequired({ length_overall: 29.8 }).required, true, 'Audacious at 29.8 m must keep one')
  eq(olbRequired({ length_overall: 16 }).required, false, 'a 16 m boat is under 55 feet and need not')
  eq(olbRequired({ length_overall: 16.764 }).required, true, 'and 55 feet exactly is inside it')
  /* NOT REQUIRED AND NOT KNOWN MUST NOT READ ALIKE. */
  eq(olbRequired({}).required, null, 'no length on file is unknown, never "not required"')
  eq(olbRequired(null).required, null, 'and neither is no particulars')
  eq(olbRequired({ length_overall: '' }).required, null, 'a blank length is not a zero-length boat')
}

/* ---- REFUSED, NEVER CORRECTED ------------------------------------------- */
{
  ok(validOlbEntry(7).ok, 'a real entry number is accepted')
  ok(!validOlbEntry(34).ok, 'one past the end of the Schedule is refused')
  ok(!validOlbEntry(0).ok, 'and so is nought')
  ok(!validOlbEntry('rubbish').ok, 'and so is something that is not a number')
}

/* ---- WHAT IS MISSING BEFORE AN ENTRY IS COMPLETE ------------------------
 * Three different faults, because they are put right by different people: a
 * signature, a witness who has to be found, and an entry made after the book
 * was closed.
 */
{
  eq(entryProblems({ entry_n: 7, signed_name: 'D Gatt', witness_name: 'B Reid' }, {}), [],
     'signed and witnessed is complete')

  const noSig = entryProblems({ entry_n: 7, witness_name: 'B Reid' }, {})
  eq(noSig.map((p) => p.kind), ['unsigned'], 'an unsigned entry says so')
  const noWit = entryProblems({ entry_n: 7, signed_name: 'D Gatt' }, {})
  eq(noWit.map((p) => p.kind), ['no-witness'], 'and one without its witness says so')
  ok(noWit[0].says.includes('a member of the crew'), 'naming WHICH witness the Schedule wants')

  /* An entry the Schedule gives no witness needs none, and must not be nagged
     about -- a warning that fires on the ordinary case stops being read. */
  eq(entryProblems({ entry_n: 1, signed_name: 'D Gatt' }, {}), [],
     'an entry needing no witness is complete without one')

  /* THE DELEGATION RULE, the book's distinctive one. An officer may sign for
     the skipper on twenty-six of the thirty-three; on the other seven the
     regulation says IN PERSON. */
  const del = entryProblems(
    { entry_n: 29, signed_name: 'N Wood', signed_by_officer: true, witness_name: 'B Reid' }, {})
  eq(del.map((p) => p.kind), ['not-in-person'], 'one of the seven signed by an officer is caught')
  eq(entryProblems(
    { entry_n: 9, signed_name: 'N Wood', signed_by_officer: true, witness_name: 'B Reid' }, {}), [],
     'while an ordinary entry may be signed by an authorised officer')

  /* Reg 8: "no entry shall be made in an official log book after" it is
     delivered. A closed book is closed. */
  const late = entryProblems(
    { entry_n: 7, occurred_on: '2026-09-05', signed_name: 'D Gatt', witness_name: 'B Reid' },
    { closed_on: '2026-09-01' })
  eq(late.map((p) => p.kind), ['after-close'], 'something that happened after the book closed is flagged')
  eq(entryProblems(
    { entry_n: 7, occurred_on: '2026-08-30', signed_name: 'D Gatt', witness_name: 'B Reid' },
    { closed_on: '2026-09-01' }), [], 'and something before it is fine')

  eq(entryProblems({ entry_n: 99, signed_name: 'x' }, {})[0].kind, 'unknown',
     'an entry number the Schedule does not have is its own fault')
}

/* ---- WHAT HAS NOT BEEN WRITTEN DOWN ------------------------------------
 * ONLY THE RECURRING ENTRIES CAN BE CHASED. A death cannot be predicted and a
 * missing one is not evidence of anything -- reporting entry 29 as "overdue"
 * would be the worst thing this page could say.
 */
{
  eq(RECURRING, [7, 17, 18, 21], 'four entries happen on a rhythm: drills, accommodation, provisions, steering')

  const none = overdue([], { asOf: '2026-09-08' })
  eq(none.length, 4, 'an empty book has all four outstanding')
  ok(none.every((o) => o.never), 'and every one says it has NEVER been written in')
  /* NEVER WRITTEN IN IS NOT THE SAME AS OVERDUE BY N DAYS, and reporting a
     number there would be inventing a date the book does not have. */
  ok(none.every((o) => o.days === null), 'rather than a made-up number of days')

  const some = overdue([
    { entry_n: 7, occurred_on: '2026-05-02' },
    { entry_n: 17, occurred_on: '2026-09-01' },
    { entry_n: 18, occurred_on: '2026-09-01' },
    { entry_n: 21, occurred_on: '2026-08-14' },
    /* A one-off entry, recorded. It must never appear as overdue. */
    { entry_n: 29, occurred_on: '2020-01-01' },
  ], { asOf: '2026-09-08' })
  eq(some.map((o) => o.n), [7], 'only the drill is actually late')
  eq(some[0].days, 129, 'and it says by how long')
  ok(!some.some((o) => o.n === 29), 'a death is never reported as overdue')

  /* THE LAST ONE COUNTS, not the first. */
  const latest = overdue([
    { entry_n: 7, occurred_on: '2026-01-01' },
    { entry_n: 7, occurred_on: '2026-09-01' },
  ], { asOf: '2026-09-08' })
  ok(!latest.some((o) => o.n === 7), 'the most recent drill is the one that matters')

  /* THE INTERVALS ARE THE BOAT'S, NOT THE STATUTE'S. SI 1981/570 says what
     must be recorded and who signs it, not how often a drill is held -- so
     they are a setting, the same reasoning as the engine limits. */
  eq(DEFAULT_INTERVALS[21], 90, 'steering gear is offered quarterly')
  eq(overdue([{ entry_n: 7, occurred_on: '2026-08-01' }],
             { asOf: '2026-09-08', intervals: { 7: 7 } }).length, 1,
     'and a shorter interval set by the boat makes the same entry late')
  eq(overdue([{ entry_n: 7, occurred_on: '2026-05-02' }],
             { asOf: '2026-09-08', intervals: {} }).length, 0,
     'while an entry with no interval set is never chased')

  eq(overdue([{ entry_n: 7, occurred_on: 'rubbish' }], { asOf: '2026-09-08' })
     .find((o) => o.n === 7).never, true, 'an unreadable date is no date at all')
}

/* ---- AN AMENDMENT IS A FURTHER ENTRY, never an edit --------------------
 * Reg 9 word for word: "make and sign a further entry referring to the entry
 * and amending or cancelling it".
 */
{
  const entries = [
    { id: 'a', entry_n: 32, occurred_on: '2026-08-30' },
    { id: 'b', entry_n: 32, occurred_on: '2026-09-02', corrects_entry_id: 'a' },
  ]
  const cor = olbCorrections(entries)
  eq(cor.get('a').map((x) => x.id), ['b'], 'the amendment is filed against what it amends')
  eq(cor.has('b'), false, 'and the amendment itself is not amended')
  eq(entries.filter((x) => x.id === 'a').length, 1, 'the original stays in the book')
}

/* ---- THE OPEN BOOK ------------------------------------------------------ */
{
  const books = [
    { id: 'b0', opened_on: '2025-01-07', closed_on: '2026-01-05' },
    { id: 'b1', opened_on: '2026-01-06', closed_on: null },
  ]
  eq(openBook(books).id, 'b1', 'the open book is the one not yet closed')
  eq(openBook([books[0]]), null, 'with everything closed there is no book to write in')
  eq(openBook([]), null, 'and none at all is none')
}

/* ==== RISK ASSESSMENTS, AND LIFTING AND WORK EQUIPMENT ===================
 * The first two certification records with NO PAPER TWIN. Reg 7 of the
 * MS&FV (Health and Safety at Work) Regulations 1997 prescribes no form at
 * all, and MGN 332 says a thorough examination report may be held
 * "electronically or on computer disc". So unlike the ORB and the OLB, the
 * app IS the record here.
 */
const safety = await import('./src/lib/certification/safety.js')
const {
  DEFAULT_REVIEW_MONTHS, REVIEW_TRIGGERS, KINDS, kindOf, reviewDue,
  assessmentState, assessmentGaps, withLineage, rating,
  intervalMonths, latestNext, equipmentState, equipmentOutstanding,
} = safety

/* ---- THE STATUTE'S TRIGGERS ARE EVENTS; THE CYCLE IS THE BOAT'S ---------
 * Reg 7(3) reviews an assessment where "there is reason to suspect that it is
 * no longer valid" or "there has been a significant change". Neither is a
 * date. The annual cycle is David's, and presenting the two as one thing
 * would be wrong about the law — the same distinction the Official Log Book
 * draws between the Schedule and how often this boat holds a drill.
 */
{
  eq(DEFAULT_REVIEW_MONTHS, 12, 'the boat reviews annually')
  ok(REVIEW_TRIGGERS.length >= 2, 'and the statutory triggers are carried separately')
  ok(REVIEW_TRIGGERS.some((t) => /no longer be valid/.test(t)), 'including "no longer valid"')

  eq(reviewDue('2026-01-15'), '2027-01-15', 'a year on from the assessment')
  eq(reviewDue('2026-01-15', 6), '2026-07-15', 'or whatever the boat sets')
  eq(reviewDue(''), null, 'and no date in means no date out')
  eq(reviewDue('rubbish'), null, 'and an unreadable one is not a date')
}

/* ---- WHERE AN ASSESSMENT STANDS ---------------------------------------- */
{
  const at = { asOf: '2026-09-08' }
  eq(assessmentState({ review_due: '2027-01-01' }, at).state, 'current', 'in date is current')
  eq(assessmentState({ review_due: '2026-09-20' }, at).state, 'due', 'and inside a month is due')
  eq(assessmentState({ review_due: '2026-06-01' }, at).state, 'overdue', 'past it is overdue')
  eq(assessmentState({ review_due: '2026-06-01' }, at).days, 99, 'by a stated number of days')

  /* NO REVIEW DATE IS NOT "IN DATE". Calling it current would be the quiet
     lie — nothing is chasing it and the page has to say so. */
  eq(assessmentState({}, at).state, 'undated', 'no review date is its own state')
  eq(assessmentState({ review_due: null }, at).state, 'undated', 'and not "current"')

  eq(assessmentState({ review_due: '2026-06-01', withdrawn_on: '2026-07-01' }, at).state, 'withdrawn',
     'a withdrawn assessment is not chased')
  /* SUPERSEDED IS NOT OVERDUE. An assessment reviewed and replaced has done
     its job; chasing it would put the whole history of the boat on the
     outstanding list, and a list that is mostly noise stops being read. */
  eq(assessmentState({ review_due: '2024-01-01', replaced_by: 'x' }, at).state, 'superseded',
     'and neither is one that has been reviewed and replaced')
}

/* ---- A REVIEW MAKES A NEW ONE AND POINTS BACK -------------------------- */
{
  const rows = withLineage([
    { id: 'old', title: 'Galley' },
    { id: 'new', title: 'Galley', supersedes_id: 'old' },
    { id: 'lone', title: 'Working aloft' },
  ])
  eq(rows.find((r) => r.id === 'old').replaced_by, 'new', 'the old one knows what replaced it')
  eq(rows.find((r) => r.id === 'new').replaced_by, null, 'the new one is current')
  eq(rows.find((r) => r.id === 'lone').replaced_by, null, 'and one never reviewed is untouched')
  /* THE OLD ROW IS NOT REMOVED. It is what the crew were briefed on, and an
     assessment rewritten in place cannot say afterwards what was in force at
     the time of an accident — the only moment anybody will ever ask. */
  eq(rows.length, 3, 'nothing is dropped by working out the lineage')
}

/* ---- THE RATING IS DERIVED, NEVER STORED ------------------------------- */
{
  eq(rating({ likelihood: 4, severity: 5 }), { score: 20, band: 'high' }, 'likelihood times severity')
  eq(rating({ likelihood: 3, severity: 3 }), { score: 9, band: 'medium' }, 'and the band comes off the score')
  eq(rating({ likelihood: 1, severity: 3 }), { score: 3, band: 'low' }, 'low is low')
  /* A RATING OF NOTHING IS NOT A RATING OF NOUGHT, and `Number('') === 0` has
     bitten this repo six times. An unrated hazard must read as unrated. */
  eq(rating({ likelihood: 4 }), null, 'a hazard rated on one axis only is not rated')
  eq(rating({}), null, 'nor is one rated on neither')
  eq(rating({ likelihood: '', severity: '' }), null, 'and blank is not nought')
  eq(rating(null), null, 'and nothing at all is nothing')
}

/* ---- WHAT IS OUTSTANDING ON AN ASSESSMENT ------------------------------ */
{
  const a = { id: 'a1', review_due: '2026-06-01' }
  const hazards = [
    { assessment_id: 'a1', hazard: 'Wire parting', likelihood: 4, severity: 5,
      further_action: 'Renew the gilson wire', action_due: '2026-07-01' },
    { assessment_id: 'a1', hazard: 'Slipping', likelihood: 3, severity: 3 },
    { assessment_id: 'a1', hazard: 'Chemicals' },
    { assessment_id: 'a1', hazard: 'Old one', further_action: 'Done already', done_on: '2026-02-01' },
    { assessment_id: 'other', hazard: 'Not this one', likelihood: 1, severity: 1 },
  ]
  const g = assessmentGaps(a, hazards, [], { asOf: '2026-09-08' })
  eq(g.state, 'overdue', 'the review state comes through')
  eq(g.openActions.length, 1, 'one action is still open')
  eq(g.lateActions.length, 1, 'and it is past its date')
  eq(g.unrated.length, 2, 'two hazards are unrated')
  /* "The significant findings ... shall be brought to the notice of workers."
     A duty in its own right, and nothing else in this app records it. */
  ok(g.neverBriefed, 'and nobody has been told')

  const told = assessmentGaps(a, hazards, [{ assessment_id: 'a1' }], { asOf: '2026-09-08' })
  eq(told.briefed, 1, 'a briefing is counted')
  ok(!told.neverBriefed, 'and stops the never-briefed flag')
  /* Another assessment's hazards must never be counted here. */
  ok(!g.unrated.some((h) => h.assessment_id === 'other'), 'hazards belong to their own assessment')
}

/* ---- SIX AGAINST TWELVE, and it is a real failure to get backwards -----
 * LOLER reg 12(2): at least every SIX months for lifting equipment used to
 * lift PERSONS and for lifting ACCESSORIES; at least every TWELVE for other
 * lifting equipment.
 */
{
  eq(kindOf('loler_persons').months, 6, 'equipment lifting persons is six months')
  eq(kindOf('loler_accessory').months, 6, 'a lifting ACCESSORY is six months too')
  eq(kindOf('loler_other').months, 12, 'other lifting equipment is twelve')
  /* PUWER PRESCRIBES NO INTERVAL. Reg 6 says "at suitable intervals", so
     there is no statutory figure and defaulting to one would dress a guess as
     a duty. */
  eq(kindOf('puwer').months, null, 'and PUWER prescribes none at all')
  eq(KINDS.length, 4, 'four kinds, and no fifth invented')

  eq(intervalMonths({ kind: 'loler_accessory' }).months, 6, 'the statutory interval applies by default')
  eq(intervalMonths({ kind: 'loler_accessory' }).from, 'statute', 'and says where it came from')
  /* An examination scheme drawn up by a competent person may set another. */
  eq(intervalMonths({ kind: 'loler_other', scheme_months: 6 }),
     { months: 6, from: 'scheme' }, 'a scheme overrides the statutory interval')
  eq(intervalMonths({ kind: 'puwer' }).months, null, 'PUWER with no scheme has no interval')
  eq(intervalMonths({ kind: 'puwer', scheme_months: 12 }).months, 12, 'and with one, it has')
  /* Null, never 0 — a scheme of nought months makes everything permanently
     overdue, and `Number('') === 0` is how that happens. */
  eq(intervalMonths({ kind: 'loler_other', scheme_months: 0 }).months, 12,
     'a scheme of nought falls back to the statute rather than to nought')

  eq(latestNext('2026-03-01', { kind: 'loler_accessory' }), '2026-09-01', 'six months on')
  eq(latestNext('2026-03-01', { kind: 'loler_other' }), '2027-03-01', 'twelve months on')
  eq(latestNext('2026-03-01', { kind: 'puwer' }), null, 'and nothing where nothing is prescribed')
}

/* ---- THE REPORT AND THE STATUTE CAN DISAGREE --------------------------
 * The competent person states when the next examination is due; the statute
 * states the latest it may be. A report giving a longer gap is REPORTED and
 * never quietly shortened — the same rule as net + VAT against a printed
 * total, and for the same reason: which one is wrong is not ours to decide.
 */
{
  const at = { asOf: '2026-09-08' }
  const acc = { id: 'q2', kind: 'loler_accessory' }
  const ex = [{ equipment_id: 'q2', examined_on: '2026-03-01', next_due: '2027-03-01', result: 'satisfactory' }]
  const st = equipmentState(acc, ex, at)
  eq(st.overrun, { stated: '2027-03-01', latest: '2026-09-01' }, 'the disagreement is reported')
  eq(st.due, '2026-09-01', 'and the EARLIER of the two governs')
  eq(st.state, 'overdue', 'so it reads as overdue rather than in date')

  /* Where they agree, nothing is said. */
  const ok2 = equipmentState(acc, [{ equipment_id: 'q2', examined_on: '2026-08-01', next_due: '2027-02-01', result: 'satisfactory' }], at)
  eq(ok2.overrun, null, 'a report inside the statutory interval raises nothing')
  eq(ok2.state, 'current', 'and reads as current')

  /* An examiner may examine MORE often than the statute demands. */
  const early = equipmentState({ id: 'q1', kind: 'loler_other' },
    [{ equipment_id: 'q1', examined_on: '2026-06-01', next_due: '2026-09-01', result: 'satisfactory' }], at)
  eq(early.overrun, null, 'a shorter interval than the statute is not an overrun')
  eq(early.due, '2026-09-01', 'and the examiner s earlier date is the one used')
}

/* ---- NEVER EXAMINED, AND UNSAFE --------------------------------------- */
{
  const at = { asOf: '2026-09-08' }
  const never = equipmentState({ id: 'q9', kind: 'loler_other' }, [], at)
  eq(never.state, 'never', 'equipment never examined says so')
  /* NOT "overdue by N days" — there is no date to count from and a number
     would be invented. */
  eq(never.days, null, 'without inventing a number of days')

  const unsafe = equipmentState({ id: 'q3', kind: 'loler_persons' },
    [{ equipment_id: 'q3', examined_on: '2026-01-05', next_due: '2026-07-05', result: 'unsafe' }], at)
  eq(unsafe.state, 'unsafe', 'a report saying unsafe outranks the dates')
  ok(unsafe.unsafe, 'and is flagged as such')

  eq(equipmentState({ id: 'q4', kind: 'puwer' }, [{ equipment_id: 'q4', examined_on: '2026-01-01', result: 'satisfactory' }], at).state,
     'no-interval', 'a PUWER item with no scheme has no interval to be late against')
  eq(equipmentState({ id: 'q5', kind: 'loler_other', out_of_service_on: '2026-02-01' }, [], at).state,
     'out-of-service', 'and equipment taken out of service is not chased')
}

/* ---- UNSAFE SORTS ABOVE EVERYTHING ------------------------------------
 * A report saying the gear is unsafe is not a paperwork gap; it is a thing
 * that must not be used, and it must never sort below a sling whose
 * certificate lapsed last week.
 */
{
  const at = { asOf: '2026-09-08' }
  const equipment = [
    { id: 'late', kind: 'loler_accessory' },
    { id: 'unsafe', kind: 'loler_persons' },
    { id: 'never', kind: 'loler_other' },
    { id: 'fine', kind: 'loler_other' },
  ]
  const exams = [
    { equipment_id: 'late', examined_on: '2025-01-01', result: 'satisfactory' },
    { equipment_id: 'unsafe', examined_on: '2026-08-01', result: 'unsafe' },
    { equipment_id: 'fine', examined_on: '2026-08-01', result: 'satisfactory' },
  ]
  const list = equipmentOutstanding(equipment, exams, at)
  eq(list[0].equipment.id, 'unsafe', 'unsafe comes first')
  ok(list.map((x) => x.equipment.id).includes('late'), 'an overdue one is listed')
  ok(list.map((x) => x.equipment.id).includes('never'), 'and one never examined')
  ok(!list.map((x) => x.equipment.id).includes('fine'), 'while one in date is not')
  eq(list.map((x) => x.state).indexOf('unsafe'), 0, 'and nothing sorts above it')
}

console.log('certification: ' + n + ' checks passed')
