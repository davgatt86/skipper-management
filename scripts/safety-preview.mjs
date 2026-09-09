/* Render the risk assessment and lifting equipment pages and read them back.
 *
 *   node scripts/safety-preview.mjs [out.html]
 *
 * Both pages are behind a login, so the only way to see what they produce is
 * to bundle the real components and server-render them. A build passing proves
 * nothing: an undefined identifier is valid JavaScript, and this repo has now
 * shipped four of them past a clean build.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import esbuild from 'esbuild'
import { safeOut } from './safeOut.mjs'

const out = safeOut(process.argv[2] || 'safety-preview.html', '.html')

mkdirSync('node_modules/.cache', { recursive: true })
const bundle = join('node_modules/.cache', 'safety-preview.mjs')
await esbuild.build({
  entryPoints: ['src/pages/certification/SafetyBody.jsx'],
  bundle: true, format: 'esm', outfile: bundle, platform: 'node',
  jsx: 'automatic', external: ['react', 'react-dom', 'react-dom/*', 'react/*'],
  logLevel: 'warning',
})
/* The forms only render when a handler is given — that IS the wiring, and it
   is what was missing. */
const NOOP = () => {}
const { RiskBody, LiftingBody, NewAssessment, HazardForm, NewEquipment } =
  await import(pathToFileURL(bundle).href)
const { renderToStaticMarkup } = await import('react-dom/server')
const React = await import('react')
const { KINDS } = await import(pathToFileURL('src/lib/certification/safety.js').href)

const vessel = { label: 'AUDACIOUS BF83' }
const today = '2026-09-08'

/* ---- risk assessments ---------------------------------------------------- */
const assessments = [
  { id: 'a1', ref: 'RA-01', title: 'Shooting and hauling the net', area: 'Deck',
    assessed_on: '2025-06-01', assessed_by: 'D Gatt', review_due: '2026-06-01' },
  { id: 'a2', ref: 'RA-02', title: 'Working aloft', area: 'Whole vessel',
    assessed_on: '2026-08-20', assessed_by: 'B Reid', review_due: '2027-08-20' },
  /* No review date at all — NOT the same as in date. */
  { id: 'a3', ref: 'RA-03', title: 'Handling fuel and lubricating oil', area: 'Engine room',
    assessed_on: '2026-01-10', assessed_by: 'N Wood', review_due: null },
  /* Reviewed and replaced: a4 supersedes a0, so a0 must NOT be chased. */
  { id: 'a0', ref: 'RA-04', title: 'Galley and food handling', area: 'Galley',
    assessed_on: '2024-05-01', assessed_by: 'D Gatt', review_due: '2025-05-01' },
  { id: 'a4', ref: 'RA-04', title: 'Galley and food handling', area: 'Galley',
    assessed_on: '2025-05-02', assessed_by: 'D Gatt', review_due: '2027-05-02', supersedes_id: 'a0' },
]
const hazards = [
  { id: 'h1', assessment_id: 'a1', hazard: 'Wire under tension parting', who_at_risk: 'All on deck',
    controls: 'Nobody in the bight, winch stopped before anyone crosses', likelihood: 4, severity: 5,
    further_action: 'Renew the gilson wire', action_by: 'B Reid', action_due: '2026-07-01', sort: 0 },
  { id: 'h2', assessment_id: 'a1', hazard: 'Slipping on a wet deck', who_at_risk: 'All on deck',
    controls: 'Deck kept clear, non-slip boots', likelihood: 3, severity: 3, sort: 1 },
  /* Never rated — must say so rather than score nought. On a1 so it renders
     in the assessment that is open; the same hazard on a closed one taught me
     that a fixture can pass an assertion by never being drawn at all. */
  { id: 'h4', assessment_id: 'a1', hazard: 'Chemical cleaners in the fish room', who_at_risk: 'All hands',
    controls: 'Gloves and eye protection, data sheets in the mess', sort: 2 },
  { id: 'h3', assessment_id: 'a3', hazard: 'Oil on the plates', who_at_risk: 'Engineer',
    controls: 'Absorbent kept at the door', sort: 0 },
]
const briefings = [
  { id: 'b1', assessment_id: 'a1', briefed_on: '2025-06-02', crew_name: 'B Reid', briefed_by: 'D Gatt' },
]

/* ---- lifting and work equipment ------------------------------------------ */
const equipment = [
  { id: 'q1', name: 'Deck crane', kind: 'loler_other', identifier: 'EKM-12598', swl: '2.5 t', location: 'Aft deck' },
  { id: 'q2', name: 'Gilson strop', kind: 'loler_accessory', identifier: 'STR-04', swl: '5 t', location: 'Deck locker' },
  { id: 'q3', name: 'Rescue davit', kind: 'loler_persons', identifier: 'DAV-01', location: 'Starboard' },
  { id: 'q4', name: 'Bench grinder', kind: 'puwer', identifier: 'BG-1', location: 'Workshop' },
  { id: 'q5', name: 'Net drum', kind: 'loler_other', identifier: 'ND-1', scheme_months: 6, scheme_by: 'Macduff Shipyards' },
]
const examinations = [
  /* THE REPORT AND THE STATUTE DISAGREE: a lifting ACCESSORY is six months,
     and the examiner has put the next one twelve months out. */
  { id: 'x1', equipment_id: 'q2', examined_on: '2026-03-01', kind: 'thorough',
    competent_person: 'A Munro', organisation: 'Lifting Gear UK', result: 'satisfactory',
    next_due: '2027-03-01', report_ref: 'LG-88213' },
  { id: 'x2', equipment_id: 'q1', examined_on: '2026-06-14', kind: 'thorough',
    competent_person: 'A Munro', organisation: 'Lifting Gear UK', result: 'defects',
    defects: 'Hook latch spring weak, renew at next service', next_due: '2027-06-14' },
  { id: 'x3', equipment_id: 'q3', examined_on: '2026-01-05', kind: 'thorough',
    competent_person: 'A Munro', organisation: 'Lifting Gear UK', result: 'unsafe',
    defects: 'Wire showing broken strands at the sheave', next_due: '2026-07-05' },
  { id: 'x4', equipment_id: 'q5', examined_on: '2026-08-20', kind: 'thorough',
    competent_person: 'J Watt', organisation: 'Macduff Shipyards', result: 'satisfactory',
    next_due: '2027-02-20' },
]

const panes = [
  ['Risk assessments — one overdue, one undated, one never briefed',
   React.createElement(RiskBody, { vessel, assessments, hazards, briefings, canWrite: true, today, selected: 'a1', onSave: NOOP, onSaveHazard: NOOP, onRemoveHazard: NOOP })],
  ['Risk assessments — nothing yet',
   React.createElement(RiskBody, { vessel, assessments: [], hazards: [], briefings: [], canWrite: true, today, onSave: NOOP, onSaveHazard: NOOP })],
  ['Lifting equipment — unsafe, overdue, and a report the statute disagrees with',
   React.createElement(LiftingBody, { vessel, equipment, examinations, canWrite: true, today, selected: 'q2', onSaveEquipment: NOOP })],
  ['Lifting equipment — nothing on the register',
   React.createElement(LiftingBody, { vessel, equipment: [], examinations: [], canWrite: true, today, onSaveEquipment: NOOP })],
  ['The forms, open — where an undefined identifier would hide',
   React.createElement('div', null,
     React.createElement(NewAssessment, { today, reviewMonths: 12, vessel, onSave: NOOP, onCancel: NOOP }),
     React.createElement(NewEquipment, { today, vessel, onSave: NOOP, onCancel: NOOP }),
     React.createElement('div', { className: 'card' },
       React.createElement(HazardForm, { nextSort: 0, onSave: NOOP })))],
]

const html = panes.map(([title, el]) =>
  `<h2 style="font:600 15px system-ui;background:#0A1D26;color:#fff;padding:8px 12px;margin:28px 0 0">${title}</h2>`
  + renderToStaticMarkup(el)).join('\n')

writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>Safety records preview</title>
<style>
 body{font:14px/1.45 system-ui;margin:0;padding:0 16px 40px;background:#ECEFEE;color:#0A1D26}
 .card{background:#fff;border:1px solid #d7dcda;border-radius:6px;padding:12px 14px;margin:10px 0}
 .muted{color:#5d6b70} h3{font-size:0.95rem}
 button{cursor:pointer;border:1px solid #b9c2c0;background:#fff;border-radius:4px;padding:3px 8px}
 :root{--kelp:#26654F;--rust:#C2342A;--brass:#A97614;--line:#d7dcda;--mute:#5d6b70;--hull:#1749A8}
</style>${html}`)

const decode = (t) => t
  .replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
const p = html.split('<h2 ').slice(1).map(decode)
let bad = 0
const has = (i, s, why) => {
  if (p[i - 1]?.includes(s)) console.log(`  ok    ${why}`)
  else { console.log(`  FAIL  ${why} — expected ${JSON.stringify(s)}`); bad++ }
}
const hasnt = (i, s, why) => {
  if (!p[i - 1]?.includes(s)) console.log(`  ok    ${why}`)
  else { console.log(`  FAIL  ${why} — did not expect ${JSON.stringify(s)}`); bad++ }
}

/* ---- NO PAPER TWIN, and that is the point of these two pages -------------
 * The ORB and OLB both have to say the paper is still the record. These do
 * not, and a warning that appears where nothing is wrong is how the ones that
 * matter stop being read. */
for (const i of [1, 2, 3, 4]) {
  hasnt(i, 'The paper book is still the record', `pane ${i} carries no paper-twin warning`)
}
has(3, 'there is no paper twin to keep in step', 'and the lifting page says so in as many words')

/* THE STATUTE'S TRIGGERS ARE EVENTS; THE ANNUAL CYCLE IS THE BOAT'S. */
has(1, 'no form and no calendar', 'the page separates the regulation from the boat s own cycle')
has(1, 'no longer be valid', 'quoting the statutory trigger')
has(1, "this boat's own", 'and saying the annual review is the boat s')
has(1, 'brought to the notice of the crew', 'and names the duty nothing else records')

has(1, 'Shooting and hauling the net', 'the overdue assessment is listed')
has(1, '99 days overdue', 'with how long')
has(1, 'no review date set', 'an undated one says exactly that')
/* NO REVIEW DATE IS NOT IN DATE. */
hasnt(1, 'Handling fuel and lubricating oil</b> — review due in', 'and is never reported as in date')
has(1, "never brought to the crew's notice", 'and one nobody was told about is called out')
/* SUPERSEDED IS NOT OVERDUE. a0 was reviewed and replaced; chasing it would
   put the whole history of the boat on the outstanding list. */
has(1, 'reviewed and replaced', 'a superseded assessment says so')
hasnt(1, 'RA-04</button> — review', 'and is never chased')

has(1, '4 × 5 = 20 high', 'a rated hazard shows its rating')
has(1, 'not rated', 'and an unrated one says so')
/* A RATING OF NOTHING IS NOT A RATING OF NOUGHT. */
hasnt(1, '= 0', 'never scoring an unrated hazard as nought')
has(1, 'Renew the gilson wire', 'an open action is shown')
has(1, 'past)', 'and one past its date says so')
has(1, 'carries the hazards over', 'reviewing explains what it does')

has(2, 'No risk assessments yet', 'an empty page says so')
has(2, 'about a job rather than a boat', 'and what an assessment is for')

/* ---- SIX AGAINST TWELVE, the thing people get the wrong way round -------- */
has(3, 'every 6 months', 'the page states the six-month rule')
has(3, 'lifting accessories', 'and what it applies to')
has(3, 'every 12 months', 'against twelve for other lifting equipment')
has(3, 'PUWER sets no interval at all', 'and that PUWER prescribes none')

/* UNSAFE IS NOT A PAPERWORK GAP and must sort above everything. */
has(3, 'must not be used', 'unsafe gear is worded as gear that must not be used')
const unsafeAt = p[2].indexOf('UNSAFE')
const overdueAt = p[2].indexOf('days overdue')
if (unsafeAt > -1 && (overdueAt === -1 || unsafeAt < overdueAt)) console.log('  ok    and sorts above an overdue examination')
else { console.log('  FAIL  unsafe must sort above overdue'); bad++ }

/* THE REPORT AND THE STATUTE DISAGREEING IS REPORTED, NEVER RESOLVED. */
has(3, 'allows no later than', 'a report giving a longer gap than the statute is reported')
has(3, 'asking the examiner which is right', 'and left to a person to settle')
has(3, 'the earlier of the two is being used', 'while the safer date governs meanwhile')
has(3, 'Hook latch spring weak', 'recorded defects are shown')
has(3, "this boat's examination scheme", 'and a scheme interval says it is the boat s')

has(4, 'Nothing on the register yet', 'an empty register says so')
has(4, 'every six months', 'and warns which way round the intervals go')
has(4, 'not the sling at six', 'in the words that make the mistake hard to repeat')

console.log(out)
console.log(`  ${KINDS.length} kinds of equipment · ${panes.length} states rendered`)
if (bad) { console.log(`  ${bad} PROBLEM${bad === 1 ? '' : 'S'}`); process.exit(1) }
console.log('  every state says what it has to')
