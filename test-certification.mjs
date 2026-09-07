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

console.log('certification: ' + n + ' checks passed')
