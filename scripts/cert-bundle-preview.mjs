/* Render the REAL certificate-bundle review and read the markup back.
 *
 *   node scripts/cert-bundle-preview.mjs [out.html]
 *
 * The review sits behind a login and a real scan, so it cannot be checked by
 * looking at it. A build passing proves nothing: an undefined identifier is
 * valid JavaScript right up until it runs, and this repo has shipped eight.
 *
 * THREE STATES, because a preview that only shows the happy one is how the
 * other two ship broken:
 *
 *   1  the real L.S.A Certs.pdf against the real record — half of it last year's
 *   2  a bundle with a certificate not on file, one already expired, one read
 *      twice and a page nothing was read off
 *   3  a document the reader found no certificates in
 */
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import esbuild from 'esbuild'
import { safeOut } from './safeOut.mjs'

const out = safeOut(process.argv[2] || 'cert-bundle-preview.html', '.html')

mkdirSync('node_modules/.cache', { recursive: true })
const bundlePath = join('node_modules/.cache', 'cert-bundle-review.mjs')
await esbuild.build({
  entryPoints: ['src/components/CertBundleReview.jsx'],
  bundle: true, format: 'esm', outfile: bundlePath, platform: 'node', jsx: 'automatic',
  external: ['react', 'react-dom', 'react-dom/*', 'react/*'],
  logLevel: 'warning',
})
const Review = (await import(pathToFileURL(bundlePath).href)).default
const { renderToStaticMarkup } = await import('react-dom/server')
const React = await import('react')
const { mapBundle, matchBundle, defaultPick } = await import(pathToFileURL('src/lib/certs/bundle.js').href)

const FIX = JSON.parse(readFileSync('scripts/fixtures/lsa-bundle.json', 'utf8'))

const stateOf = (data, pageCount, fileName) => {
  const match = matchBundle(mapBundle(data, pageCount), FIX.onFile, { asOf: FIX.asOf })
  return { fileName, pageCount, match, picks: new Set(match.rows.filter(defaultPick).map((r) => r.idx)) }
}

const states = [
  ['The real L.S.A Certs.pdf, against the real record', stateOf(FIX.read, FIX.pageCount, 'L.S.A Certs.pdf')],
  /* THE FIRST VERSION OF THIS FIXTURE COULD NOT REACH TWO OF ITS OWN STATES.
     Its "unknown kind" row was titled "Pyrotechnics Stock Record", which the
     flares family recognises, so it HAD a kind; and the read-twice copy sat on
     page 5 beside the original, so three pages went unread rather than one. The
     assertions failed, correctly — and in failing showed that an undated or
     unrecognised certificate was being ticked to add, which was the real bug. */
  ['New, expired, read twice, unrecognised, and a page with nothing on it', stateOf({ certificates: [
    { cert_type: 'EPIRB Shore Based Maintenance Certificate', cert_number: 'EP-1001', issuer: 'Marasafe Ltd', issue_date: '2026-06-01', expiry_date: '2027-06-01', category: 'LSA', page_from: 1, page_to: 1 },
    { cert_type: 'Immersion Suit Service Certificate', cert_number: null, issuer: 'Marasafe Ltd', issue_date: '2025-01-10', expiry_date: '2026-01-10', category: 'LSA', item_serial: 'IS-44', page_from: 2, page_to: 3 },
    FIX.read.certificates[4],
    { ...FIX.read.certificates[4], page_from: 6, page_to: 6 },
    { cert_type: 'Fish Hold Stability Booklet Approval', cert_number: null, issuer: 'MCA', issue_date: '2026-06-01', expiry_date: '2031-06-01', category: 'Statutory', page_from: null, page_to: null },
    { cert_type: '', cert_number: null, issuer: null, issue_date: null, expiry_date: null, category: 'Other', page_from: null, page_to: null },
  ] }, 6, 'LSA 2027 renewals.pdf')],
  ['A document with no certificates in it', stateOf({ certificates: [] }, 2, 'covering letter.pdf')],
]

const html = states.map(([title, s]) =>
  `<h2 class="pv">${title}</h2>`
  + renderToStaticMarkup(React.createElement(Review, {
    ...s, onToggle() {}, onOpenPage() {}, onSave() {}, onDiscard() {},
  }))).join('\n')

const appCss = readFileSync('src/index.css', 'utf8')
writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>Certificate bundle review</title>
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
const panes = html.split('<h2 class="pv">').slice(1).map(decode)
const count = (i, s) => panes[i - 1].split(s).length - 1
let bad = 0
const has = (i, s, why) => {
  if (panes[i - 1]?.includes(s)) console.log('  ok    ' + why)
  else { console.log('  FAIL  ' + why + ' — expected ' + JSON.stringify(s)); bad++ }
}
const hasnt = (i, s, why) => {
  if (!panes[i - 1]?.includes(s)) console.log('  ok    ' + why)
  else { console.log('  FAIL  ' + why + ' — did not expect ' + JSON.stringify(s)); bad++ }
}
const is = (got, want, why) => {
  if (got === want) console.log('  ok    ' + why)
  else { console.log(`  FAIL  ${why} — got ${got}, wanted ${want}`); bad++ }
}

/* 1 — THE REAL BUNDLE. */
has(1, '6 certificates read from 6 pages', 'the count is stated against the page count')
is(count(1, '>link this page<'), 2, 'two pages link to certificates missing their scan')
is(count(1, '>older copy<'), 3, 'three are last year\'s, marked as older copies')
is(count(1, '>already held<'), 1, 'one is already held with its own scan')
hasnt(1, '>not on file<', 'nothing in the real bundle is offered as new')
has(1, 'SHIPS MEDICAL STORES CERTIFICATE', 'the medical stores page names the record it links to')
has(1, 'its dates and number stay as filed', 'and says linking does not touch the filing')
has(1, 'Not added — the renewal is the current certificate', 'an older copy says why it is not added')
hasnt(1, 'may not have been renewed', 'two rafts with two renewals are not flagged as shared')
is(count(1, 'type="checkbox"'), 2, 'only the two links carry a tick box')
is(count(1, 'checked=""'), 2, 'and both are ticked')
has(1, 'Link 2 pages', 'the save button says exactly what it will do')
has(1, 'serial 24A(I)12012', 'a raft page shows its serial, which tells one raft from the other')
has(1, '>p. 3<', 'each row opens its own page')
hasnt(1, 'No certificate was read off page', 'every page of the six had a certificate')
has(1, 'never by the reader', 'the review says who decides what is current')

/* 2 — THE AWKWARD ONES. */
is(count(2, '>not on file<'), 4, 'the EPIRB, the lapsed immersion suits, the stability booklet and the untitled one are not on file')
has(2, 'Title not read', 'an untitled certificate says so rather than rendering a blank')
has(2, 'It expired 10-01-2026', 'the expired one says when')
has(2, 'nothing on file replaces it', 'and that nothing replaces it')
has(2, '>read twice<', 'a certificate returned twice is reported')
has(2, 'No certificate was read off page 4', 'the page nothing was read off is named')
has(2, '>pp. 2–3<', 'a two-page certificate opens across both pages')
has(2, 'page not known', 'a certificate with no page says so rather than pointing somewhere')
has(2, 'could not tell what kind of certificate', 'an unknown kind says it could not be checked for other copies')
is(count(2, 'checked=""'), 1, 'only the EPIRB is ticked — not the expired one, the unrecognised one or the untitled one')
has(2, 'Add 1', 'and the button says one will be added')

/* 3 — NOTHING READ. */
has(3, 'No certificate was read off this document', 'an empty read says so')
has(3, 'open it and check before discarding', 'and does not call itself clean')
has(3, 'Nothing ticked', 'the save button is not offering to file nothing')
has(3, 'disabled=""', 'and cannot be pressed')

console.log(out)
console.log(`  ${states.length} states rendered`)
if (bad) { console.log(`  ${bad} PROBLEM${bad === 1 ? '' : 'S'}`); process.exit(1) }
console.log('  every state says what it has to')
