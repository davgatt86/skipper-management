import {
  inspectionPack, notCovered, bookActivity, certificateState, stateAsOf, inWindow, BOOKS,
} from './src/lib/certification/inspectionPack.js'

/* THE FIXTURES ARE SHAPED LIKE THE TABLES, not like the module.
 *
 * Third time this file has had to be said in this repo: the quota fixture
 * invented a `remaining` column, the pre-departure fixtures read `entry_date`
 * off two books that call it `occurred_on` and `log_date`, and both suites
 * passed while the page was wrong. Column names below are copied out of
 * information_schema, not out of the code under test.
 */

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++ } else { fail++; console.log('  FAIL ' + m) } }
const eq = (a, b, m) => ok(a === b, `${m} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`)

/* ---- the window ------------------------------------------------------- */
ok(inWindow('2026-06-15', '2026-01-01', '2026-12-31'), 'a date inside the period is in')
ok(inWindow('2026-01-01', '2026-01-01', '2026-12-31'), 'the opening day is in — both ends inclusive')
ok(inWindow('2026-12-31', '2026-01-01', '2026-12-31'), 'and so is the closing day')
ok(!inWindow('2025-12-31', '2026-01-01', '2026-12-31'), 'the day before is out')
ok(!inWindow(null, '2026-01-01', '2026-12-31'), 'no date is never in the window')
ok(inWindow('2026-06-15T09:30:00Z', '2026-01-01', '2026-12-31'), 'a timestamp is read as its date')

/* ---- as at a date, NOT as at today ------------------------------------ */
/* This is the whole reason certStatus is not reused. */
eq(stateAsOf('2026-03-01', '2026-06-30'), 'expired', 'expired against the closing date, not today')
eq(stateAsOf('2027-06-30', '2026-06-30'), 'valid', 'a year out is valid')
eq(stateAsOf('2026-07-20', '2026-06-30'), 'due', '20 days out is due at a 60-day lead')
/* The boundary itself, both sides, since 60 is the number the whole app warns
   on and an off-by-one here moves every amber row on the page. */
eq(stateAsOf('2026-08-29', '2026-06-30'), 'due', 'exactly 60 days out is due')
eq(stateAsOf('2026-08-30', '2026-06-30'), 'valid', 'and 61 days out is not')
eq(stateAsOf('2026-09-30', '2026-06-30'), 'valid', 'three months out certainly is not')
eq(stateAsOf(null, '2026-06-30'), 'noexpiry', 'no expiry is its own answer, never "valid"')
/* A certificate expiring ON the closing date has not expired that day. */
eq(stateAsOf('2026-06-30', '2026-06-30'), 'due', 'expiring on the day itself is due, not expired')

/* ---- books ------------------------------------------------------------- */
const olb = BOOKS.find((b) => b.key === 'olb')
const garbage = BOOKS.find((b) => b.key === 'garbage')

const empty = bookActivity(olb, [], { from: '2026-01-01', to: '2026-12-31' })
ok(empty.never, 'a book with no rows at all reads as never started')
eq(empty.n, 0, 'and nothing in the period')

/* NEVER STARTED and NOTHING THIS PERIOD must not read alike — the whole point
   of carrying both figures. */
const quiet = bookActivity(garbage,
  [{ entry_date: '2025-03-04' }],
  { from: '2026-01-01', to: '2026-12-31' })
ok(!quiet.never, 'a book written in before the period has been started')
eq(quiet.n, 0, 'even though it has nothing in the period')
eq(quiet.total, 1, 'and its lifetime count says so')
eq(quiet.everLast, '2025-03-04', 'naming when it was last used')

const busy = bookActivity(garbage, [
  { entry_date: '2026-08-05' }, { entry_date: '2026-08-28' }, { entry_date: '2025-01-01' },
], { from: '2026-01-01', to: '2026-12-31' })
eq(busy.n, 2, 'only entries inside the period are counted')
eq(busy.first, '2026-08-05', 'first in the period')
eq(busy.last, '2026-08-28', 'last in the period')
eq(busy.total, 3, 'while the lifetime figure keeps the lot')

/* THE COLUMN NAME IS PER BOOK. The Official Log Book uses occurred_on and the
   radio log log_date; reading entry_date off either gives every book "never". */
eq(bookActivity(olb, [{ occurred_on: '2026-05-05' }], { from: '2026-01-01', to: '2026-12-31' }).n,
  1, 'the OLB is read on occurred_on')
eq(BOOKS.find((b) => b.key === 'radio').date, 'log_date', 'and the radio log on log_date')
eq(bookActivity(olb, [{ entry_date: '2026-05-05' }], { from: '2026-01-01', to: '2026-12-31' }).n,
  0, 'so entry_date on the OLB finds nothing, which is what the bug looked like')

/* ---- what is NOT covered ---------------------------------------------- */
const books = [
  bookActivity(olb, [], {}),
  bookActivity(garbage, [{ entry_date: '2026-08-05' }], {}),
]
const gaps = notCovered({ books, briefings: 0, equipment: 0 })

ok(gaps.some((g) => g.kind === 'empty' && g.key === 'olb'),
  'an empty statutory book is named')
ok(!gaps.some((g) => g.kind === 'empty' && g.key === 'garbage'),
  'a book with entries is not')
ok(gaps.some((g) => g.kind === 'empty' && g.key === 'briefings'),
  'no briefing record is a hole in its own right — reg 7(3) is a separate duty')
ok(gaps.some((g) => g.kind === 'empty' && g.key === 'equipment'),
  'and no lifting equipment at all is another')

/* AN EMPTY BOOK AND A PAPER BOOK ARE NOT THE SAME FINDING. The ORB being kept
   on paper is correct; the OLB having no entries is not. Rolling them into one
   kind would turn a correct state of affairs into an accusation. */
const paperOnly = notCovered({
  books: [bookActivity(BOOKS.find((b) => b.key === 'orb'), [{ entry_date: '2026-05-01' }], {})],
  briefings: 1, equipment: 1,
})
eq(paperOnly.length, 1, 'a used ORB raises exactly one note')
eq(paperOnly[0].kind, 'paper', 'and it is the paper-is-the-record note, not a gap')
ok(/MIN 644/.test(paperOnly[0].why), 'which cites why there is no electronic record book')

/* A book that is BOTH empty and paper is reported as EMPTY, once. Saying "kept
   on paper" about a book nobody has opened would excuse the hole. */
const emptyOrb = notCovered({
  books: [bookActivity(BOOKS.find((b) => b.key === 'orb'), [], {})],
  briefings: 1, equipment: 1,
})
eq(emptyOrb.length, 1, 'an empty ORB raises one note, not two')
eq(emptyOrb[0].kind, 'empty', 'and it is the hole, not the excuse')

/* ---- certificates ------------------------------------------------------ */
const certs = certificateState([
  { id: 'a', cert_type: 'UKFVC', expiry_date: '2030-03-05', file_path: 'x/y.pdf' },
  { id: 'b', cert_type: 'Liferaft', expiry_date: '2026-04-01', file_path: null },
  { id: 'c', cert_type: 'Measurement', expiry_date: null, file_path: null },
  { id: 'd', cert_type: 'Insurance', expiry_date: '2026-07-20', file_path: null },
], { from: '2026-01-01', to: '2026-06-30' })

eq(certs.asOf, '2026-06-30', 'certificates are stated as at the closing date')
eq(certs.expired.length, 1, 'one had run out by then')
eq(certs.due.length, 1, 'one was inside the lead')
eq(certs.valid.length, 1, 'one was good')
eq(certs.noExpiry.length, 1, 'and one carries no expiry at all')

/* A LAPSE INSIDE THE WINDOW is the interesting one, and it vanishes from a
   plain as-at-today list the moment it is renewed. */
eq(certs.lapsed.length, 1, 'the certificate that ran out during the period is called out')
eq(certs.lapsed[0].id, 'b', 'and it is the right one')

/* WHETHER THE DOCUMENT IS HELD is not whether the certificate exists. */
eq(certs.withoutFile.length, 3, 'certificates with no document in the app are counted')
ok(certs.all.find((c) => c.id === 'a').hasFile, 'and one with a file says so')

const fileGap = notCovered({ books: [], certs, briefings: 1, equipment: 1 })
ok(fileGap.some((g) => g.kind === 'nofile'), 'missing documents are their own kind of note')
ok(!fileGap.some((g) => g.kind === 'empty'), 'and are never confused with an empty book')

/* ---- the whole pack ---------------------------------------------------- */
const pack = inspectionPack({
  from: '2026-01-01', to: '2026-06-30',
  vessel: { id: 'v1', label: 'AUDACIOUS BF83' },
  details: { pln: 'BF83', gross_tonnage: 498 },
  vesselCerts: [
    { id: 'a', cert_type: 'UKFVC', category: 'Statutory', expiry_date: '2030-03-05', file_path: 'x' },
  ],
  crew: [
    { id: 'c1', full_name: 'David Gatt', status: 'on_boat', rank_code: 'master',
      passport_expiry: '2029-01-01' },
    { id: 'c2', full_name: 'Andrew Smith', status: 'on_boat', rank_code: 'deckhand',
      passport_expiry: '2026-02-25' },
    { id: 'c3', full_name: 'Arnel Nobel', status: 'former', archived_at: '2025-01-01' },
  ],
  crewCerts: [
    { id: 't1', crew_id: 'c1', cert_type: 'ENG 1', expiry_date: '2027-01-01' },
    { id: 't2', crew_id: 'c2', cert_type: 'Sea Survival', expiry_date: '2026-03-01' },
    { id: 't3', crew_id: 'c3', cert_type: 'ENG 1', expiry_date: '2020-01-01' },
  ],
  assessments: [
    { id: 'r1', title: 'Shooting and Hauling', assessed_on: '2023-07-18', assessed_by: 'D Gatt' },
    { id: 'r2', title: 'Engine Room', assessed_on: '2022-01-01', assessed_by: 'D Gatt' },
    { id: 'r3', title: 'Engine Room', assessed_on: '2024-01-01', assessed_by: 'D Gatt',
      supersedes_id: 'r2' },
  ],
  hazards: [
    { id: 'h1', assessment_id: 'r1', hazard: 'Gear stuck', likelihood: 3, severity: 4 },
    { id: 'h2', assessment_id: 'r1', hazard: 'Falling overboard' },
  ],
  briefings: [],
  equipment: [],
  examinations: [],
  tasks: [{ id: 'k1', name: 'Impeller change', component: 'Main engine', active: true }],
  events: [
    { id: 'e1', task_id: 'k1', done_on: '2026-03-04', done_by: 'N Wood', running_hours: 66500 },
    { id: 'e2', task_id: 'k1', done_on: '2025-03-04', done_by: 'N Wood' },
  ],
  books: {
    olb: [], orb: [], radio: [{ log_date: '2026-05-01' }],
    garbage: [{ entry_date: '2026-05-05' }], fuel: [], engine: [],
  },
})

eq(pack.period.from, '2026-01-01', 'the period is carried')
eq(pack.period.to, '2026-06-30', 'both ends')

/* ONLY WHO IS ABOARD. A former hand's expired ticket is not a finding and would
   bury the ones that are. */
eq(pack.crewAboard, 2, 'only crew aboard are reported')
ok(!pack.crew.some((c) => c.name === 'Arnel Nobel'), 'an archived former hand is left out')
eq(pack.crew.find((c) => c.name === 'Andrew Smith').passportState, 'expired',
  'and an expired passport is stated as at the closing date')
eq(pack.crew.find((c) => c.name === 'Andrew Smith').expired.length, 1,
  'as is an expired ticket')

/* A SUPERSEDED ASSESSMENT IS NOT IN FORCE, and reading the wrong lineage field
   would have listed it as though it were — silently. */
eq(pack.assessmentsHeld, 3, 'all three assessments are held')
eq(pack.assessmentsLive, 2, 'but only two are in force')
ok(!pack.assessments.some((a) => a.id === 'r2'), 'the superseded one is not listed as live')

eq(pack.hazardsUnrated, 1, 'an unrated hazard is counted rather than scored')
eq(pack.assessments.find((a) => a.id === 'r1').rated, 1, 'and the rated one is too')

/* MAINTENANCE IS AN EVENT, so last year's job is not evidence about this
   period. */
eq(pack.maintenance.length, 1, 'only maintenance done inside the period is listed')
eq(pack.maintenance[0].doneOn, '2026-03-04', 'and it is the right one')

/* THE HOLES ARE THE HEADLINE. */
ok(pack.notCovered.length > 0, 'the pack says what it does not cover')
ok(pack.notCovered.some((g) => g.key === 'olb'), 'naming the empty Official Log Book')
ok(pack.notCovered.some((g) => g.key === 'orb'), 'and the empty Oil Record Book')
ok(pack.notCovered.some((g) => g.key === 'briefings'), 'and the absent briefings')
ok(pack.notCovered.some((g) => g.key === 'equipment'), 'and the absent lifting register')
eq(pack.holes, 6, 'and counts them — OLB, ORB, fuel, engine, briefings, equipment')

/* IT NEVER CERTIFIES THE VESSEL. No score, no percentage, no verdict. */
const asText = JSON.stringify(pack).toLowerCase()
ok(!/"compliant"|"compliance":\s*true|fit to sail|passes|satisfactory overall/.test(asText),
  'nothing in the pack claims the vessel is compliant')
ok(pack.holes != null && typeof pack.holes === 'number', 'the holes are a count, not a grade')

/* AN EMPTY PACK IS NOT A CLEAN PACK. */
const nothing = inspectionPack({ from: '2026-01-01', to: '2026-06-30' })
eq(nothing.crewAboard, 0, 'a pack with no data reports no crew')
ok(nothing.notCovered.length >= 6,
  'and every book reads as a hole rather than the pack reading as clear')

console.log(`inspection pack: ${pass} checks passed`)
if (fail) { console.log(`${fail} FAILED`); process.exit(1) }
