/* Render the radio log and read the markup back.
 *
 *   node scripts/radio-preview.mjs [out.html]
 *
 * SIX STATES:
 *   1  a Part II boat (Audacious) — distress only, a day unsigned
 *   2  a Part I boat — urgency, safety, incidents and a daily position
 *   3  Part I with days missing their position
 *   4  everything signed, nothing outstanding
 *   5  the mate's view — he keeps it, the skipper signs
 *   6  a boat whose length cannot settle which Part applies — must refuse
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import esbuild from 'esbuild'
import { safeOut } from './safeOut.mjs'

const out = safeOut(process.argv[2] || 'radio-preview.html', '.html')

mkdirSync('node_modules/.cache', { recursive: true })
const bundle = join('node_modules/.cache', 'radio-preview.mjs')
await esbuild.build({
  entryPoints: ['src/pages/certification/RadioBody.jsx'],
  bundle: true, format: 'esm', outfile: bundle, platform: 'node',
  jsx: 'automatic', external: ['react', 'react-dom', 'react-dom/*', 'react/*'],
  logLevel: 'warning',
})
const RadioBody = (await import(pathToFileURL(bundle).href)).default
const { renderToStaticMarkup } = await import('react-dom/server')
const React = await import('react')
const { radioPart, KINDS } = await import(pathToFileURL('src/lib/certification/radio.js').href)

const today = '2026-09-08'
const vessel = { label: 'AUDACIOUS BF83' }
/* Her real particulars: 23.96 m registered, built 2022. Four centimetres put
   her on the simplified log. */
const partII = radioPart({ length_registered: 23.96, length_overall: 29.8, year_built: 2022 })
const partI = radioPart({ length_registered: 26.4, length_overall: 31, year_built: 2020 })
/* Only a length overall on file — the test is a rule length, so it must refuse. */
const unknown = radioPart({ length_overall: 29.8 })

const e = (o) => ({ log_date: '2026-09-07', ...o })
const simple = [
  e({ id: 'r1', occurred_at: '08:14:00', kind: 'distress',
      summary: 'DSC distress alert received from FV Ocean Harvest, relayed to Aberdeen Coastguard',
      station: 'MMSI 232001234' }),
  /* Beyond Part II. NOT a fault — worth keeping, and it says so. */
  e({ id: 'r2', occurred_at: '11:02:00', kind: 'safety',
      summary: 'Navtex gale warning, Forties, southwesterly 8 imminent' }),
  e({ id: 'r3', log_date: '2026-09-06', occurred_at: '09:00:00', kind: 'test',
      summary: 'DSC test call to Aberdeen Coastguard, acknowledged' }),
]
const full = [
  e({ id: 'f1', occurred_at: '06:00:00', kind: 'position',
      summary: 'Noon position', position_text: '57 30.2N 001 46.8W' }),
  e({ id: 'f2', occurred_at: '08:14:00', kind: 'urgency',
      summary: 'PAN PAN relayed, man overboard search coordinated by Aberdeen' }),
  e({ id: 'f3', occurred_at: '13:40:00', kind: 'incident',
      summary: 'VHF DSC unit reset after loss of GPS input, working again at 1355' }),
  e({ id: 'f4', log_date: '2026-09-06', occurred_at: '10:00:00', kind: 'safety',
      summary: 'Navtex received, no traffic for this area' }),
]
const days = [{ log_date: '2026-09-06', signed_name: 'David Gatt' }]
const allSigned = [{ log_date: '2026-09-07', signed_name: 'David Gatt' },
                   { log_date: '2026-09-06', signed_name: 'David Gatt' }]

const panes = [
  ['Part II — the simplified log, one day unsigned',
   { vessel, part: partII, entries: simple, days, canSign: true, canWrite: true, today }],
  ['Part I — a Directive vessel, everything Schedule 3 asks for',
   { vessel: { label: 'A BIGGER BOAT' }, part: partI, entries: full, days, canSign: true, canWrite: true, today }],
  ['Part I — days with no position',
   { vessel: { label: 'A BIGGER BOAT' }, part: partI,
     entries: full.filter((x) => x.kind !== 'position'), days, canSign: true, canWrite: true, today }],
  ['Nothing outstanding',
   { vessel, part: partII, entries: simple, days: allSigned, canSign: true, canWrite: true, today }],
  ['The mate keeps it but does not sign it',
   { vessel, part: partII, entries: simple, days, canSign: false, canWrite: true, today }],
  ['Length cannot settle which Part — must refuse',
   { vessel, part: unknown, entries: [], days: [], canSign: true, canWrite: true, today }],
]

const html = panes.map(([title, props]) =>
  `<h2 style="font:600 15px system-ui;background:#0A1D26;color:#fff;padding:8px 12px;margin:28px 0 0">${title}</h2>`
  + renderToStaticMarkup(React.createElement(RadioBody, props))).join('\n')

writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>Radio log preview</title>
<style>
 body{font:14px/1.45 system-ui;margin:0;padding:0 16px 40px;background:#ECEFEE;color:#0A1D26}
 .card{background:#fff;border:1px solid #d7dcda;border-radius:6px;padding:12px 14px;margin:10px 0}
 .muted{color:#5d6b70} h3{font-size:0.95rem}
 button{cursor:pointer;border:1px solid #b9c2c0;background:#fff;border-radius:4px;padding:3px 8px}
 input,select{border:1px solid #b9c2c0;border-radius:4px;padding:3px 6px}
 :root{--kelp:#26654F;--rust:#C2342A;--brass:#A97614;--line:#d7dcda;--mute:#5d6b70}
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

/* WHICH PART APPLIES IS THE WHOLE PAGE, and it turns on four centimetres. */
has(1, 'Simplified FV GMDSS', 'a 23.96 m boat gets the simplified log')
has(1, 'Part II', 'named as Schedule 3 Part II')
has(1, 'reg 25', 'under the right regulation')
has(1, 'threshold for a new one is 24 m', 'and says what put her there')
has(1, 'distress traffic', 'the only thing Part II asks for')
has(1, 'and nothing else', 'said in as many words')
/* PART II OWES NO POSITION AND NO URGENCY. Offering them as duties would be
   telling a skipper he owes something he does not. */
hasnt(1, 'asks for her position at least once a day', 'and no position duty is implied')

has(1, "inspects and signs each day's entries", 'the daily signature rule is stated')
has(1, '1 day not signed', 'an unsigned day with entries is chased')
has(1, 'Sign 07-09-2026 as skipper', 'and offered for signing')
/* A DAY WITH NO ENTRIES NEEDS NO SIGNATURE — the duty is to sign "each day's
   ENTRIES", and chasing every quiet day is how a warning stops being read. */
hasnt(1, '2026-09-05', 'a day with nothing logged is never chased')

/* MORE THAN THE MINIMUM IS NOT A FAULT. */
has(1, 'beyond what Schedule 3', 'entries past the minimum are noted')
has(1, 'That is not a fault', 'and explicitly not called wrong')
has(1, 'Navtex gale warning', 'and are kept in full')

has(2, 'GMDSS Radio Log', 'a Directive vessel gets the full log')
has(2, 'reg 19', 'under the right regulation')
has(2, 'position', 'and owes a daily position')
has(2, 'PAN PAN relayed', 'urgency traffic is drawn')
has(2, '57 30.2N', 'and a position carries its position')

has(3, 'no position', 'Part I days missing a position are chased')
has(3, 'at least once a day', 'quoting what the Schedule asks')
has(3, 'Nothing has been filled in for them', 'and nothing is invented')

has(4, 'signed by David Gatt', 'a signed day names who signed it')
hasnt(4, 'Outstanding', 'and a tidy log lists nothing')
hasnt(4, 'Sign 07-09-2026', 'nor offers to sign again')

has(5, 'Only the skipper signs the day', 'the mate is told he cannot sign')
has(5, 'does not stand in for him', 'and why')
has(5, 'Log something', 'but he still keeps the log')

/* IT REFUSES RATHER THAN GUESSES. A page that guessed would tell a skipper he
   need only log distress traffic when he owes four more things. */
has(6, 'cannot be worked out', 'an unsettleable length refuses')
has(6, 'rule length', 'and says which length the regulations mean')
has(6, 'nothing like the length overall', 'and that LOA is the wrong one')
hasnt(6, 'Log something', 'and no log is drawn at all')

console.log(out)
console.log(`  ${KINDS.length} kinds · ${panes.length} states rendered`)
if (bad) { console.log(`  ${bad} PROBLEM${bad === 1 ? '' : 'S'}`); process.exit(1) }
console.log('  every state says what it has to')
