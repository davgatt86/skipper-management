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

console.log('certification: ' + n + ' checks passed')
