/* Render the REAL inspection pack and read it back.
 *
 *   node scripts/inspection-pack-preview.mjs [out.pdf]
 *
 * THIS IS THE DOCUMENT A SURVEYOR IS HANDED, so it cannot be checked by eye on
 * somebody else's device once and then trusted. It calls `buildPackDoc` — the
 * real one — writes the PDF, extracts its text with pdf.js and asserts the
 * things that must be true of every pack.
 *
 * `buildPackDoc` is split from `exportPackPdf` for exactly this: `doc.save()`
 * reaches for a browser and does NOTHING under node, no error and no file.
 *
 * THE FIXTURE IS THE REAL BOAT'S SHAPE, measured off the database the day this
 * was written — 17 vessel certificates and 12 risk assessments populated, and
 * the Official Log Book, the Oil Record Book, the briefings and the lifting
 * register all EMPTY. That lopsidedness is the case the pack exists to handle
 * honestly, so a fixture where everything is filled in would prove nothing.
 */
import { writeFileSync } from 'node:fs'
import { inspectionPack } from '../src/lib/certification/inspectionPack.js'
import { buildPackDoc } from '../src/lib/certification/exportPack.js'
import { safeOut } from './safeOut.mjs'

const out = process.argv[2] || 'inspection-pack-preview.pdf'
safeOut(out, '.pdf')

const FROM = '2026-01-01', TO = '2026-08-31'

const certTypes = [
  ['UK Fishing Vessel Certificate', 'Statutory', '2030-03-05', true],
  ['Record of Particulars of a Fishing Vessel', 'Statutory', null, true],
  ['Certificate of Measurement', 'Statutory', null, false],
  ['ILO 188 Work in Fishing', 'Statutory', '2027-04-01', false],
  ['Radio Installation', 'Radio', '2027-01-15', false],
  ['Inflatable Liferaft Service', 'LSA', '2026-07-24', false],
  ['Liferaft Inspection', 'LSA', '2026-07-31', false],
  ['Lifejacket Service', 'LSA', '2027-02-01', false],
  ['Gaseous Fire Suppression', 'FFA', '2026-07-20', false],
  ['Portable Fire Extinguishers', 'FFA', '2026-08-26', false],
  ['Certificate of Insurance', 'Insurance', '2026-03-31', false],
  ['Wreck Removal Cover', 'Insurance', '2026-03-31', false],
  ['Medical Stores', 'Medical', '2027-06-01', false],
  ['TBT-Free Antifouling', 'Pollution', '2028-01-01', false],
]
const vesselCerts = certTypes.map(([cert_type, category, expiry_date, file], i) => ({
  id: 'vc' + i, cert_type, category, expiry_date,
  cert_number: 'CM' + (64280 + i), issuer: 'Maritime & Coastguard Agency',
  file_path: file ? `fleet/${i}.pdf` : null,
}))

const NAMES = [
  ['David Gatt', 'master', 'British'], ['Barry Reid', 'master', 'British'],
  ['David Henderson', 'chief_engineer', 'British'], ['Andrejs Gundarovs', 'chief_engineer', 'Russian'],
  ['Jackson Gatt', 'cook', 'British'], ['Gregor Smith', 'deckhand', 'British'],
  ['Andrew Smith', 'deckhand', 'British'], ['James Napier', 'deckhand', 'British'],
  ['Elizer Tano', 'deckhand', 'Filipino'], ['Christopher Catam', 'deckhand', 'Filipino'],
  ['Lorenzo Rusiana', 'deckhand', 'Filipino'],
]
const crew = NAMES.map(([full_name, rank_code, nationality], i) => ({
  id: 'c' + i, full_name, rank_code, nationality, status: 'on_boat',
  passport_number: 'P' + (100000 + i),
  // One expired on purpose — Andrew Smith's, which is real test data on the boat.
  passport_expiry: full_name === 'Andrew Smith' ? '2026-02-25' : '2029-06-01',
}))
// Plus a man who has left, who must NOT appear however bad his tickets are.
crew.push({ id: 'gone', full_name: 'Arnel Nobel', rank_code: 'deckhand',
  status: 'former', archived_at: '2025-06-01', passport_expiry: '2019-01-01' })

const TICKETS = ['ENG 1 Medical', 'Sea Survival', 'Fire Fighting', 'First Aid', 'Deck Safety']
const crewCerts = []
crew.forEach((c, ci) => {
  TICKETS.forEach((cert_type, ti) => {
    if (c.id === 'gone' && ti > 0) return
    crewCerts.push({
      id: `t${ci}-${ti}`, crew_id: c.id, cert_type,
      // Elizer's ENG 1 falls due inside the window, which is the live case.
      expiry_date: c.full_name === 'Elizer Tano' && ti === 0 ? '2026-09-19'
        : c.full_name === 'Andrew Smith' && ti === 1 ? '2026-04-02'
          : '2028-05-01',
    })
  })
})

const RA = [
  'Shooting and Hauling', 'Engine Room', 'Trawling and Seining', 'Landing Operations',
  'Vessel Safety', 'General Working Onboard', 'Guard Boat Duty', 'Young Persons',
  'Maintenance Work', 'Handling the Catch', 'Shore-side Activities', 'Boarding and Leaving',
]
const assessments = RA.map((title, i) => ({
  id: 'ra' + i, title, ref: 'RA-' + (i + 1), area: null,
  assessed_on: '2023-07-18', assessed_by: 'D Gatt',
  // Imported unrated and with no review date — which is the real position.
  review_due: null,
}))
// One superseded pair, so the lineage rule is exercised rather than assumed.
assessments.push({ id: 'ra-new', title: 'Engine Room', ref: 'RA-2',
  assessed_on: '2026-02-01', assessed_by: 'D Gatt', review_due: '2027-02-01',
  supersedes_id: 'ra1' })

const hazards = []
assessments.forEach((a, i) => {
  const n = [9, 7, 6, 8, 5, 9, 4, 3, 7, 6, 8, 8, 4][i] || 5
  for (let h = 0; h < n; h++) {
    hazards.push({
      id: `h${i}-${h}`, assessment_id: a.id, hazard: 'Hazard ' + (h + 1),
      // Left unrated, exactly as the twelve imported ones are.
      likelihood: a.id === 'ra-new' ? 3 : null,
      severity: a.id === 'ra-new' ? 3 : null,
    })
  }
})

const tasks = [
  { id: 'k1', name: 'Main engine oil and filter', component: 'Main engine', active: true },
  { id: 'k2', name: 'Gearbox oil sample', component: 'Gearbox 1', active: true },
  { id: 'k3', name: 'Generator 1 service', component: 'Generator 1', active: true },
]
const events = [
  { id: 'e1', task_id: 'k1', done_on: '2026-03-04', done_by: 'N Wood', running_hours: 66500 },
  { id: 'e2', task_id: 'k3', done_on: '2026-06-19', done_by: 'D Henderson', running_hours: 8900 },
  { id: 'e3', task_id: 'k1', done_on: '2025-11-02', done_by: 'N Wood' },   // before the window
]

const dates = (n, start) => Array.from({ length: n }, (_, i) => {
  const d = new Date(start); d.setDate(d.getDate() + i * 4)
  return d.toISOString().slice(0, 10)
})

const pack = inspectionPack({
  from: FROM, to: TO,
  vessel: { id: 'v1', label: 'AUDACIOUS BF83' },
  details: { pln: 'BF83', gross_tonnage: 498, length_registered: 23.96, flag_state: 'United Kingdom' },
  vesselCerts, crew, crewCerts,
  assessments, hazards,
  briefings: [],          // ZERO on the real boat — reg 7(3) duty unrecorded
  equipment: [],          // ZERO — no LOLER/PUWER register at all
  examinations: [],
  tasks, events,
  selfCerts: [{ period: '2026/27', form_code: 'MSF 5550', form_revision: '09.24',
    completed_at: null, declared_name: null }],
  crewLists: dates(5, '2026-05-01').map((d, i) => ({ id: 'cl' + i, departure_date: d })),
  familiarisation: [{ id: 'f1', completed_at: '2026-04-01' }, { id: 'f2', completed_at: null }],
  books: {
    olb: [],                                        // ZERO
    orb: [],                                        // ZERO
    radio: [{ log_date: '2026-09-09' }],            // one, and OUTSIDE the window
    garbage: dates(8, '2026-08-05').map((d) => ({ entry_date: d })),
    fuel: dates(45, '2025-12-29').map((d) => ({ entry_date: d })),
    engine: dates(23, '2026-05-22').map((d) => ({ log_date: d })),
  },
})

const doc = buildPackDoc(pack)
const bytes = new Uint8Array(doc.output('arraybuffer'))
writeFileSync(out, bytes)

/* ---- read it back ------------------------------------------------------ */
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
const pdf = await pdfjs.getDocument({ data: bytes, useSystemFonts: true }).promise
const pages = []
for (let p = 1; p <= pdf.numPages; p++) {
  const page = await pdf.getPage(p)
  pages.push((await page.getTextContent()).items.map((i) => i.str).join(' ')
    .replace(/\s+/g, ' '))
}
const all = pages.join('\n')

let bad = 0
const has = (s, why) => {
  if (all.includes(s)) console.log('  ok    ' + why)
  else { console.log('  FAIL  ' + why + ' — expected ' + JSON.stringify(s)); bad++ }
}
const hasnt = (s, why) => {
  if (!all.includes(s)) console.log('  ok    ' + why)
  else { console.log('  FAIL  ' + why + ' — did not expect ' + JSON.stringify(s)); bad++ }
}

console.log(`\n${out} — ${pdf.numPages} pages, ${pack.holes} records with no entries\n`)

/* IT NEVER CERTIFIES THE VESSEL. */
has('not a declaration of compliance', 'the cover says what the document is not')
hasnt('fit to sail', 'and never says she is fit to sail')
hasnt('fully compliant', 'nor that she is compliant')

/* THE HOLES COME FIRST, before anything that looks like evidence. */
has('WHAT THIS PACK DOES NOT COVER', 'the holes have their own section')
const holesPage = pages.findIndex((t) => t.includes('WHAT THIS PACK DOES NOT COVER'))
const certsPage = pages.findIndex((t) => t.includes('VESSEL CERTIFICATES'))
if (holesPage >= 0 && holesPage <= certsPage) console.log('  ok    and it is reached before the certificates')
else { console.log('  FAIL  the holes must come before the evidence'); bad++ }

has('Official Log Book', 'the empty Official Log Book is named')
has('Oil Record Book', 'and the empty Oil Record Book')
has('Risk assessment briefings', 'and the absent briefings')
has('Lifting and work equipment', 'and the absent lifting register')

/* AN EMPTY BOOK AND A PAPER BOOK MUST NOT READ ALIKE — and on THIS pack both
   paper books are empty, so they are holes and the paper note must NOT fire.
   Saying "kept on paper" about a book nobody has opened would excuse the hole.
   The second pack below is where that note is checked. */
has('no entries at all', 'a hole is worded as a hole')
hasnt('MIN 644', 'and an empty paper book is not excused as merely being on paper')

/* Certificates are a STATE, as at the closing date. */
has('31/08/2026', 'the closing date is printed')
has('not today', 'and the pack says the certificates are stated as at it, not today')
has('Lapsed during this period', 'a certificate that ran out inside the window is called out')

/* Crew: only who is aboard. */
has('Andrew Smith', 'a man aboard with an expired passport is listed')
hasnt('Arnel Nobel', 'a former hand is not, however bad his tickets')

/* Risk assessments: superseded counted, not listed as live. */
has('in force', 'the live count is distinguished from the held count')
has('no rating', 'and unrated hazards are stated rather than scored')

/* Maintenance is an EVENT. */
has('04/03/2026', 'maintenance inside the window is listed')
hasnt('02/11/2025', 'and a job done before it is not')

/* The footer, once per page. */
let footers = 0
for (const t of pages) if (t.includes('a report of records')) footers++
if (footers === pdf.numPages) console.log(`  ok    the footer is stamped once on each of ${pdf.numPages} pages`)
else { console.log(`  FAIL  footer on ${footers} of ${pdf.numPages} pages`); bad++ }

console.log()
for (let i = 0; i < pages.length; i++) {
  console.log(`  page ${i + 1}  ${pages[i].slice(0, 78)}`)
}

/* ---- SECOND PACK: the books actually being kept -------------------------
 *
 * The pack above is the boat as she stands, and every state in it is a hole.
 * A preview that only ever renders the unhappy case is how the happy one ships
 * broken — so this is the same document once the books are in use, which is
 * also the only place the "kept on paper" note can be reached. */
const kept = inspectionPack({
  from: FROM, to: TO,
  vessel: { id: 'v1', label: 'AUDACIOUS BF83' },
  details: { pln: 'BF83', gross_tonnage: 498, length_registered: 23.96, flag_state: 'United Kingdom' },
  vesselCerts: vesselCerts.map((c) => ({ ...c, file_path: `fleet/${c.id}.pdf` })),
  crew, crewCerts,
  assessments, hazards,
  briefings: assessments.map((a, i) => ({
    id: 'b' + i, assessment_id: a.id, briefed_on: '2026-04-01', crew_name: 'Crew' })),
  equipment: [
    { id: 'q1', name: 'Main winch', kind: 'loler_other', identifier: 'W-1', swl: '12 t' },
    { id: 'q2', name: 'Gilson sling', kind: 'loler_accessory', identifier: 'S-4', swl: '2 t' },
  ],
  examinations: [
    { id: 'x1', equipment_id: 'q1', examined_on: '2026-02-10', competent_person: 'A Munro',
      result: 'satisfactory', next_due: '2027-02-10' },
    { id: 'x2', equipment_id: 'q2', examined_on: '2026-02-10', competent_person: 'A Munro',
      result: 'satisfactory', next_due: '2026-08-10' },
  ],
  tasks, events,
  selfCerts: [{ period: '2026/27', form_code: 'MSF 5550', form_revision: '09.24',
    completed_at: '2026-07-19', declared_name: 'David Gatt' }],
  crewLists: dates(5, '2026-05-01').map((d, i) => ({ id: 'cl' + i, departure_date: d })),
  familiarisation: [{ id: 'f1', completed_at: '2026-04-01' }],
  books: {
    olb: dates(9, '2026-02-02').map((d) => ({ occurred_on: d })),
    orb: dates(14, '2026-01-20').map((d) => ({ entry_date: d })),
    radio: dates(9, '2026-02-02').map((d) => ({ log_date: d })),
    garbage: dates(8, '2026-08-05').map((d) => ({ entry_date: d })),
    fuel: dates(45, '2025-12-29').map((d) => ({ entry_date: d })),
    engine: dates(23, '2026-05-22').map((d) => ({ log_date: d })),
  },
})

const out2 = out.replace(/\.pdf$/, '-books-kept.pdf')
const doc2 = buildPackDoc(kept)
const bytes2 = new Uint8Array(doc2.output('arraybuffer'))
writeFileSync(out2, bytes2)
const pdf2 = await pdfjs.getDocument({ data: bytes2, useSystemFonts: true }).promise
const pages2 = []
for (let p = 1; p <= pdf2.numPages; p++) {
  const page = await pdf2.getPage(p)
  pages2.push((await page.getTextContent()).items.map((i) => i.str).join(' ').replace(/\s+/g, ' '))
}
const all2 = pages2.join('\n')
const has2 = (s, why) => {
  if (all2.includes(s)) console.log('  ok    ' + why)
  else { console.log('  FAIL  ' + why + ' — expected ' + JSON.stringify(s)); bad++ }
}
const hasnt2 = (s, why) => {
  if (!all2.includes(s)) console.log('  ok    ' + why)
  else { console.log('  FAIL  ' + why + ' — did not expect ' + JSON.stringify(s)); bad++ }
}

console.log(`\n${out2} — ${pdf2.numPages} pages, ${kept.holes} records with no entries\n`)

has2('MIN 644', 'with the books kept, the paper note fires and cites MIN 644')
has2('Kept on paper', 'under its own heading, apart from the holes')
hasnt2('no entries at all', 'and no book reads as a hole')
has2('Main winch', 'the lifting register is reported when there is one')
has2('Gilson sling', 'including the accessory, which is examined twice as often')

/* AND IT STILL DOES NOT CERTIFY HER, which is the point that must survive
   every book being in order. */
hasnt2('fit to sail', 'a complete set of records still does not make her fit to sail')
has2('not a declaration of compliance', 'and the cover says so on this pack too')

if (bad) { console.log(`\n  ${bad} PROBLEM${bad === 1 ? '' : 'S'}`); process.exit(1) }
console.log('\n  both packs say what they have to, and refuse what they must')
