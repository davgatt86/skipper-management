/* Render the self-certification wizard and read the markup back.
 *
 *   node scripts/self-cert-preview.mjs [out.html]
 *
 * THE PAGE IS BEHIND A LOGIN, so the only way to see what it produces is to
 * bundle the real component and server-render it. A build passing proves
 * nothing: an undefined identifier is valid JavaScript, and this repo has
 * already shipped a commit where two pages called a function they never
 * imported.
 *
 * FIVE STATES, because the wrong ones are the ones that ship broken:
 *   1  a fresh certification, nothing answered
 *   2  part done, with a "not applicable" carrying no reason
 *   3  ready to sign, everything answered
 *   4  signed off and locked
 *   5  a 24 m boat, where the checklist must refuse to draw at all
 *   6  a boat with no registered length on file, where it must also refuse
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import esbuild from 'esbuild'
import { safeOut } from './safeOut.mjs'

const out = safeOut(process.argv[2] || 'self-cert-preview.html', '.html')

/* Bundled to a FILE, not a data: URL — node resolves a data URL's bare
   specifiers against nothing, so "react" cannot be found from one. */
mkdirSync('node_modules/.cache', { recursive: true })
const bundle = join('node_modules/.cache', 'selfcert-preview.mjs')
await esbuild.build({
  entryPoints: ['src/pages/certification/SelfCertBody.jsx'],
  bundle: true, format: 'esm', outfile: bundle, platform: 'node',
  jsx: 'automatic', external: ['react', 'react-dom', 'react-dom/*', 'react/*'],
  logLevel: 'warning',
})
const SelfCertBody = (await import(pathToFileURL(bundle).href)).default
const { renderToStaticMarkup } = await import('react-dom/server')
const React = await import('react')
const { FORM, SECTIONS, allItems } = await import(pathToFileURL('src/lib/certification/selfCert.js').href)

const items = allItems()
const vessel = { label: 'AUDACIOUS BF83' }
const band = { band: '15to24', rl: 23.96, loa: 29.8, why: null }
const cert = { period: '2026/27', form_code: FORM.code, form_revision: FORM.revision, completed_at: null }

/* Answers shaped like a real run rather than a happy path. */
const answerAll = (state = 'yes', note = null) =>
  Object.fromEntries(items.map((i) => [i.n, { state, note }]))

const partly = {}
for (const i of items.slice(0, 40)) partly[i.n] = { state: 'yes' }
partly[10] = { state: 'yes' }                         // clashes with the evidence below
partly[30] = { state: 'na', note: null }              // not applicable, no reason given
partly[31] = { state: 'no', note: 'Bulwark plate wasted at frame 14, yard booked' }
/* Answered NOT complied, with a record that also says something is wrong. It is
   already a blocker; it must not ALSO be listed as a contradiction. */
partly[29] = { state: 'no', note: 'Two tickets out of date, both booked' }

const ready = answerAll('yes')
ready[30] = { state: 'na', note: 'No voluntary certificates held' }

/* What the app can say. `attention` is what raises a contradiction; `unknown`
   never does, because the app not knowing is not evidence of anything. */
const evidence = {
  10: { state: 'attention', detail: 'Inflatable Liferaft Service Certificate expired 24-07-2026' },
  23: { state: 'ok', detail: '11 aboard, crew list saved 12-08-2026' },
  28: { state: 'ok', detail: '20 crew, no expired certificates of competency' },
  29: { state: 'attention', detail: "Andrew Smith's passport expired 25-02-2026" },
  77: { state: 'ok', detail: 'Garbage record book last written in 21-08-2026' },
  148: { state: 'ok', detail: 'UKFVC valid to 19-07-2027' },
}

const panes = [
  ['Fresh — nothing answered', { form: FORM, vessel, band, cert, answers: {}, evidence, canSign: true }],
  ['Part done, with a bare "not applicable"', { form: FORM, vessel, band, cert, answers: partly, evidence, canSign: true }],
  ['Ready to sign', { form: FORM, vessel, band, cert, answers: ready, evidence, canSign: true }],
  ['Signed off and locked', {
    form: FORM, vessel, band, evidence, answers: ready, canSign: true,
    cert: { ...cert, completed_at: '2026-09-06T10:00:00Z', declared_name: 'David Gatt' },
  }],
  ['Worked through by the mate — cannot sign', { form: FORM, vessel, band, cert, answers: partly, evidence, canSign: false }],
  ['A 24 m boat — must refuse', {
    form: FORM, vessel: { label: 'SOMEONE ELSE PD100' }, cert, answers: {}, evidence,
    band: { band: '24plus', rl: 24.6, loa: 31.2, why: null },
  }],
  ['No registered length on file — must refuse', {
    form: FORM, vessel: { label: 'A THIRD BOAT' }, cert, answers: {}, evidence,
    band: { band: null, why: 'no registered length on file — only length overall', loa: 26 },
  }],
]

const html = panes.map(([title, props]) =>
  `<h2 style="font:600 15px system-ui;background:#0A1D26;color:#fff;padding:8px 12px;margin:28px 0 0">${title}</h2>`
  + renderToStaticMarkup(React.createElement(SelfCertBody, props))).join('\n')

writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>Self-certification preview</title>
<style>
 body{font:14px/1.45 system-ui;margin:0;padding:0 16px 40px;background:#ECEFEE;color:#0A1D26}
 .card{background:#fff;border:1px solid #d7dcda;border-radius:6px;padding:12px 14px;margin:10px 0}
 .muted{color:#5d6b70} h3{font-size:0.95rem} button{cursor:pointer;border:1px solid #b9c2c0;background:#fff;border-radius:4px;padding:3px 8px}
 input{border:1px solid #b9c2c0;border-radius:4px;padding:3px 6px}
 :root{--kelp:#26654F;--rust:#C2342A;--brass:#A97614;--line:#d7dcda;--mute:#5d6b70}
</style>${html}`)

/* ---- read it back ------------------------------------------------------- */
const decode = (t) => t
  .replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
const panesOut = html.split('<h2 ').slice(1).map(decode)
let bad = 0
const has = (i, s, why) => {
  if (panesOut[i - 1]?.includes(s)) console.log(`  ok    ${why}`)
  else { console.log(`  FAIL  ${why} — expected ${JSON.stringify(s)}`); bad++ }
}
const hasnt = (i, s, why) => {
  if (!panesOut[i - 1]?.includes(s)) console.log(`  ok    ${why}`)
  else { console.log(`  FAIL  ${why} — did not expect ${JSON.stringify(s)}`); bad++ }
}

has(1, `0 of ${items.length}`, 'a fresh sheet says nothing is answered')
has(1, 'rev 09.24', 'and names the revision it is working from')
has(1, 'not the MCA', 'and says plainly it is not the MCA form')
has(1, `${items.length} not answered yet`, 'everything outstanding')
hasnt(1, 'Every check answered', 'and it is not claiming to be finished')

has(2, 'marked not applicable with no reason', 'a bare "not applicable" blocks the sign-off')
has(2, 'not complied with', 'and so does an item answered no')
has(2, 'Bulwark plate wasted', 'the reason given is kept')
has(2, 'the record disagrees with', 'the contradiction panel appears')
has(2, 'Liferaft Service Certificate expired', 'and quotes what the record says')
/* ONE, not two: item 10 is answered complied against a record that disagrees,
   and item 29 is answered NOT complied against a record that also disagrees.
   The second is already a blocker and must not be counted twice. Asserted on
   the COUNT, because the name itself legitimately appears in the evidence line
   under item 29 whatever the answer is. */
has(2, 'One answer the record disagrees with', 'only the complied item is a contradiction')
hasnt(2, 'answers the record disagrees with', 'and it is not counting the failure as one too')
/* The apostrophe is the point: it is escaped in the markup, so this assertion
   is only meaningful because the panes are decoded first. */
has(2, "Andrew Smith's passport", 'the escaped apostrophe survives decoding')

has(3, 'Every check answered', 'a finished sheet says so')
has(3, 'Sign off the self-certification', 'and offers the sign-off')
hasnt(3, 'Not ready to sign', 'with nothing blocking it')

has(4, 'Signed off', 'a signed sheet says when')
has(4, 'David Gatt', 'and by whom')
has(4, 'Answers are locked', 'and that it is locked')
hasnt(4, 'Sign off the self-certification', 'and offers no second signing')

has(5, 'only the skipper can sign', 'a mate is told why he cannot sign')
has(5, 'kept as you go', 'but that his work is kept')

has(6, 'does not apply to', 'a 24 m boat is refused the checklist')
has(6, '24.60 m registered length', 'and told her measured length')
has(6, 'International Fishing Vessel Certificate', 'and which regime she is in instead')
hasnt(6, 'CERTIFICATES AND RECORDS', 'and no part of the checklist is drawn')

has(7, 'no registered length on file', 'a vessel with no RL is refused too')
has(7, 'it is not length overall', 'and told which figure decides it')
hasnt(7, 'CERTIFICATES AND RECORDS', 'and no checklist is drawn')

console.log(out)
console.log(`  ${FORM.code} rev ${FORM.revision} · ${SECTIONS.length} sections · ${items.length} items · ${panes.length} states rendered`)
if (bad) { console.log(`  ${bad} PROBLEM${bad === 1 ? '' : 'S'}`); process.exit(1) }
console.log('  every state says what it has to')
