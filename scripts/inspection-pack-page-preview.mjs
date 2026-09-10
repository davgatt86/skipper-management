/* Render the REAL inspection-pack page and read the markup back.
 *
 *   node scripts/inspection-pack-page-preview.mjs [out.html]
 *
 * A BUILD PASSING PROVES NOTHING HERE. An undefined identifier is valid
 * JavaScript right up until it runs, and this repo has shipped eight of them —
 * `saveEquipment` called and never imported, `canWrite` and `fmt` in OrbBody,
 * `VesselProvider` imported and never rendered. Rendering is the only thing
 * that executes the component.
 *
 * Three states, because a preview that only shows the happy one is how the
 * other two ship broken: the boat as she stands (holes everywhere), the same
 * boat with the books kept, and no data at all.
 */
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import esbuild from 'esbuild'
import { safeOut } from './safeOut.mjs'

const out = safeOut(process.argv[2] || 'inspection-pack-page.html', '.html')

mkdirSync('node_modules/.cache', { recursive: true })
const bundle = join('node_modules/.cache', 'inspection-pack-body.mjs')
await esbuild.build({
  entryPoints: ['src/pages/certification/InspectionPackBody.jsx'],
  bundle: true, format: 'esm', outfile: bundle, platform: 'node', jsx: 'automatic',
  external: ['react', 'react-dom', 'react-dom/*', 'react/*', 'react-router-dom', 'react-router-dom/*'],
  logLevel: 'warning',
})
const Body = (await import(pathToFileURL(bundle).href)).default
const { renderToStaticMarkup } = await import('react-dom/server')
const { MemoryRouter } = await import('react-router-dom')
const React = await import('react')
const { inspectionPack } = await import(
  pathToFileURL('src/lib/certification/inspectionPack.js').href)

const vessel = { id: 'v1', label: 'AUDACIOUS BF83' }
const FROM = '2026-01-01', TO = '2026-08-31'
const dates = (n, start) => Array.from({ length: n }, (_, i) => {
  const d = new Date(start); d.setDate(d.getDate() + i * 4)
  return d.toISOString().slice(0, 10)
})

const common = {
  from: FROM, to: TO, vessel,
  details: { pln: 'BF83', gross_tonnage: 498 },
  vesselCerts: [
    { id: 'a', cert_type: 'UK Fishing Vessel Certificate', category: 'Statutory',
      expiry_date: '2030-03-05', file_path: 'x.pdf' },
    { id: 'b', cert_type: 'Inflatable Liferaft Service', category: 'LSA',
      expiry_date: '2026-07-24', file_path: null },
    { id: 'c', cert_type: 'Certificate of Measurement', category: 'Statutory',
      expiry_date: null, file_path: null },
  ],
  crew: [
    { id: 'c1', full_name: 'David Gatt', rank_code: 'master', nationality: 'British',
      status: 'on_boat', passport_number: 'P1', passport_expiry: '2029-01-01' },
    { id: 'c2', full_name: 'Andrew Smith', rank_code: 'deckhand', nationality: 'British',
      status: 'on_boat', passport_number: 'P2', passport_expiry: '2026-02-25' },
    // No passport at all — the crew-list-is-a-border-document case.
    { id: 'c3', full_name: 'Lorenzo Rusiana', rank_code: 'deckhand', nationality: 'Filipino',
      status: 'on_boat', passport_number: null, passport_expiry: null },
  ],
  crewCerts: [
    { id: 't1', crew_id: 'c1', cert_type: 'ENG 1', expiry_date: '2028-01-01' },
    { id: 't2', crew_id: 'c2', cert_type: 'Sea Survival', expiry_date: '2026-04-02' },
  ],
  assessments: [
    { id: 'r1', ref: 'RA-1', title: 'Shooting and Hauling',
      assessed_on: '2023-07-18', assessed_by: 'D Gatt', review_due: null },
  ],
  hazards: [
    { id: 'h1', assessment_id: 'r1', hazard: 'Gear stuck' },
    { id: 'h2', assessment_id: 'r1', hazard: 'Overboard', likelihood: 3, severity: 4 },
  ],
  tasks: [{ id: 'k1', name: 'Main engine oil', component: 'Main engine', active: true }],
  events: [{ id: 'e1', task_id: 'k1', done_on: '2026-03-04', done_by: 'N Wood', running_hours: 66500 }],
  crewLists: dates(4, '2026-05-01').map((d, i) => ({ id: 'cl' + i, departure_date: d })),
  familiarisation: [{ id: 'f1', completed_at: '2026-04-01' }],
  selfCerts: [{ period: '2026/27', form_code: 'MSF 5550', form_revision: '09.24' }],
}

const asStands = inspectionPack({
  ...common,
  briefings: [], equipment: [], examinations: [],
  books: {
    olb: [], orb: [], radio: [{ log_date: '2026-09-09' }],
    garbage: dates(8, '2026-08-05').map((d) => ({ entry_date: d })),
    fuel: dates(45, '2025-12-29').map((d) => ({ entry_date: d })),
    engine: dates(23, '2026-05-22').map((d) => ({ log_date: d })),
  },
})

const kept = inspectionPack({
  ...common,
  briefings: [{ id: 'b1', assessment_id: 'r1', briefed_on: '2026-04-01', crew_name: 'Crew' }],
  equipment: [{ id: 'q1', name: 'Main winch', kind: 'loler_other', identifier: 'W-1', swl: '12 t' }],
  examinations: [{ id: 'x1', equipment_id: 'q1', examined_on: '2026-02-10',
    competent_person: 'A Munro', result: 'satisfactory', next_due: '2027-02-10' }],
  books: {
    olb: dates(9, '2026-02-02').map((d) => ({ occurred_on: d })),
    orb: dates(14, '2026-01-20').map((d) => ({ entry_date: d })),
    radio: dates(9, '2026-02-02').map((d) => ({ log_date: d })),
    garbage: dates(8, '2026-08-05').map((d) => ({ entry_date: d })),
    fuel: dates(45, '2025-12-29').map((d) => ({ entry_date: d })),
    engine: dates(23, '2026-05-22').map((d) => ({ log_date: d })),
  },
})

const states = [
  ['The boat as she stands — certificates kept, statutory books empty', asStands],
  ['The same boat with every book kept', kept],
  ['Nothing loaded yet', null],
]

const html = states.map(([title, pack]) =>
  `<h2 class="pv">${title}</h2>`
  + renderToStaticMarkup(React.createElement(MemoryRouter, null,
      React.createElement(Body, {
        pack, vessel, from: FROM, to: TO,
        onFrom() {}, onTo() {}, onExport() {},
      })))).join('\n')

const appCss = readFileSync('src/index.css', 'utf8')
writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>Inspection pack</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@400;600;700&family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@400;600&display=swap">
<style>${appCss}</style>
<style>
 body{margin:0;padding:0 20px 48px;background:var(--paper)}
 .wrap{max-width:980px;margin:0 auto}
 h2.pv{font:600 13px var(--font-mono);letter-spacing:.08em;text-transform:uppercase;
       background:var(--ink);color:#fff;padding:9px 14px;margin:26px 0 0;border-radius:3px}
</style>
<div class="wrap">${html}</div>`)

/* ---- what each state has to say ---------------------------------------- */
const decode = (t) => t.replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#x2014;/g, '—').replace(/&#x2019;/g, '’')
const panes = html.split('<h2 class="pv">').slice(1).map(decode)
let bad = 0
const has = (i, s, why) => {
  if (panes[i - 1]?.includes(s)) console.log('  ok    ' + why)
  else { console.log('  FAIL  ' + why + ' — expected ' + JSON.stringify(s)); bad++ }
}
const hasnt = (i, s, why) => {
  if (!panes[i - 1]?.includes(s)) console.log('  ok    ' + why)
  else { console.log('  FAIL  ' + why + ' — did not expect ' + JSON.stringify(s)); bad++ }
}

/* IT NEVER CERTIFIES THE VESSEL — on every state, including the tidy one. */
for (const i of [1, 2]) {
  has(i, 'not a declaration', `pane ${i} says what the document is not`)
  hasnt(i, 'fit to sail', `pane ${i} never says she is fit to sail`)
}

/* THE HOLES COME FIRST. */
has(1, 'What this pack does not cover', 'the holes have their own heading')
has(1, 'Official Log Book', 'the empty Official Log Book is named')
has(1, 'no entries at all', 'and worded as a hole')
hasnt(1, 'Kept on paper', 'an empty paper book is never excused as merely being on paper')
has(1, 'never started', 'the book row says so too')

/* An empty register is a finding, not a blank section. */
has(1, 'LOLER and PUWER both apply', 'the absent lifting register says why it matters')
has(1, 'No record of the crew being briefed', 'and an unbriefed assessment says so')

/* Certificates are a state as at the closing date. */
has(1, 'not today', 'certificates are stated as at the closing date')
has(1, 'Lapsed during this period', 'and a lapse inside the window is called out')

/* The crew cases. */
has(1, 'Passport expired', 'an expired passport is named')
has(1, 'No passport on file', 'and so is a missing one')
has(1, 'border document', 'with the reason it matters')

/* THE TIDY STATE STILL REFUSES TO BLESS HER. */
has(2, 'Kept on paper', 'with the books kept, the paper note appears')
has(2, 'MIN 644', 'citing why there is no electronic record book')
hasnt(2, 'no entries at all', 'and nothing reads as a hole')
has(2, 'Main winch', 'the lifting register is shown when there is one')

/* NO DATA IS NOT A CLEAN BILL. */
has(3, 'Nothing to report on yet', 'with nothing loaded it says so')
hasnt(3, 'Nothing outstanding', 'and never reads as an all-clear')

console.log(out)
console.log(`  ${states.length} states rendered`)
if (bad) { console.log(`  ${bad} PROBLEM${bad === 1 ? '' : 'S'}`); process.exit(1) }
console.log('  every state says what it has to')
