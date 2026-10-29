/* Server-renders the REAL TallyCheck panel against the REAL pair — trip 72's
 * tally beside the note of 28-10-2026 — and reads the markup back.
 *
 * `Sales.jsx` cannot be rendered (it drags the supabase client in), so this is
 * the only thing in the repo that executes this panel. A build passing proves
 * nothing here: an undefined identifier is valid JavaScript right up until the
 * line runs, and this repo has shipped eleven of them.
 *
 *   node scripts/tally-check-preview.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { parseDayTally } from '../src/lib/market/parseDayTally.js'
import { compareLadder, downgradeCandidates } from '../src/lib/tallyVsNote.js'
import { parseCatchOverviewPages } from '../src/lib/market/parseCatchOverview.js'

const TALLY = 'C:/Users/davga/OneDrive/Desktop/Day Totals/day tally trip 72.xlsx'
const NOTE = 'C:/Users/davga/Downloads/AUDACIOUS BF83 (2).pdf'

/* The real note's haddock, by A-number — the figures the parser returns. */
const NOTE_ROWS = [
  ['A+1', 1], ['A1', 16], ['A+2', 23], ['A2', 44],
  ['A+3', 31], ['A3', 18], ['A+4', 123], ['A4', 24],
].map(([grade, boxes], i) => ({ id: 'n' + i, species_canon: 'Haddock', grade, boxes }))

let tallyLines
try {
  const b = readFileSync(TALLY)
  tallyLines = (await parseDayTally(new Uint8Array(b))).lines
} catch {
  console.log(`(${TALLY} not on this machine — using its measured figures)`)
  tallyLines = [
    ['Chat (1b)', 8], ['Pinger (1c)', 16], ['Good Seed (1d)', 20], ['Seed (2a)', 25],
    ['Chipper (2b)', 28], ['Metro (3)', 57], ['M Metro (4)', 151],
  ].map(([grade, boxes]) => ({ species: 'HADDOCK', grade, boxes }))
}

const real = compareLadder(tallyLines, NOTE_ROWS)
const cands = downgradeCandidates(real)

/* A tally whose shape agrees with the note — the quiet case, which has to read
 * as an answer rather than an empty panel. */
const agreeTally = [
  ['Chat (1b)', 4], ['Pinger (1c)', 13], ['Seed (2a)', 40], ['Chipper (2b)', 27],
  ['Metro (3)', 49], ['M Metro (4)', 147],
].map(([grade, boxes]) => ({ species: 'HADDOCK', grade, boxes }))
const clean = compareLadder(agreeTally, NOTE_ROWS)

/* The catch overview — the scales, compared on WEIGHT because its box column
   is an OCR casualty while its weights reconcile to the printed total. */
const co = parseCatchOverviewPages(
  JSON.parse(readFileSync('scripts/fixtures/catch-overview-trip72.json', 'utf8')))
const NOTE_KG = [
  ['A+1', 1, 40], ['A1', 16, 613], ['A+2', 23, 896], ['A2', 44, 1746],
  ['A+3', 31, 1214], ['A3', 18, 720], ['A+4', 123, 4907], ['A4', 24, 960],
].map(([grade, boxes, total_weight], i) => ({ id: 'k' + i, species_canon: 'Haddock', grade, boxes, total_weight }))
const coCmp = compareLadder(co.lines, NOTE_KG, { measure: 'kg' })

const PANES = [
  { title: 'Nothing uploaded yet', props: { ladder: null, downgrades: [], loaded: false } },
  { title: 'The real pair — Good Seed offered', props: { ladder: real, downgrades: cands, loaded: true } },
  { title: 'The same, with Good Seed added', props: { ladder: real, downgrades: cands, loaded: true, addedBand: 'Good Seed' } },
  { title: 'The catch overview — compared on weight', props: { ladder: coCmp, downgrades: downgradeCandidates(coCmp), loaded: true, kind: 'catch overview' } },
  { title: 'A tally that agrees — nothing offered', props: { ladder: clean, downgrades: downgradeCandidates(clean), loaded: true } },
  {
    title: 'A rung with no code, and one too small to explain the gap',
    props: (() => {
      const t = [
        { species: 'HADDOCK', grade: 'XL (1a)', boxes: 90 },
        { species: 'HADDOCK', grade: 'Good Seed (1d)', boxes: 2 },
        { species: 'HADDOCK', grade: 'Seed (2a)', boxes: 8 },
        { species: 'HADDOCK', grade: 'Odds', boxes: 5 },
      ]
      const nn = [{ species_canon: 'Haddock', grade: 'A1', boxes: 50 }, { species_canon: 'Haddock', grade: 'A2', boxes: 50 }]
      const c = compareLadder(t, nn)
      return { ladder: c, downgrades: downgradeCandidates(c), loaded: true }
    })(),
  },
]

/* ---- bundle the real component, the way every other preview here does ---- */
const outdir = 'node_modules/.cache'
mkdirSync(outdir, { recursive: true })
const bundle = join(outdir, 'tally-check-preview.mjs')
await build({
  entryPoints: ['scripts/_tallyCheckEntry.jsx'],
  bundle: true, format: 'esm', outfile: bundle,
  jsx: 'automatic', platform: 'node',
  external: ['react', 'react-dom', 'react-dom/*', 'react/*'],
  logLevel: 'warning',
})
const { TallyCheck } = await import(pathToFileURL(bundle).href)
const { renderToStaticMarkup } = await import('react-dom/server')
const { createElement: h } = await import('react')

const panes = PANES.map(p => ({ title: p.title, html: renderToStaticMarkup(h(TallyCheck, p.props)) }))

let fails = 0
const must = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++ }
/* Tags become a space so words either side of one do not weld together — then
   the space before punctuation is taken back out, or `</strong>,` reads as
   " ," and every assertion has to be written round the markup. */
const strip = (h) => h
  .replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').replace(/\s+([,.;:%)])/g, '$1').trim()

for (const p of panes) {
  console.log(`\n== ${p.title}`)
  const t = strip(p.html)
  if (p.title.startsWith('Nothing')) {
    must(/Check against the day tally or catch overview/.test(t), 'offers both documents')
    must(!/Share gap/.test(t), 'and draws no table before there is one')
    continue
  }
  must(/Check against a different document/.test(t), 'the button changes once a document is loaded')
  must(/Share gap/.test(t), 'the ladder table is drawn')
  /* THE TOTALS ARE NOT MEANT TO AGREE, and the panel must say so before the
     table or every row reads as an error. */
  must(/compared by SHARE rather than figure for figure/.test(t), 'it says why the totals differ')

  if (p.title.includes('real pair')) {
    must(/Good Seed \(1d\) 20\b/.test(t), 'the crew’s own rungs are named with their codes')
    must(/A1 sold 6.5 points short and A2 the same over/.test(t), 'the offset is stated')
    must(/accounts for 98% of the gap/.test(t), 'and how much the named rung explains')
    must(/Add Good Seed to the A2 split/.test(t), 'the band is OFFERED')
    must(!/is a band in the A2 split/.test(t), 'and not already applied')
  }
  if (p.title.includes('Good Seed added')) {
    must(/Good Seed is a band in the A2 split below/.test(t), 'the applied band says so')
    must(/Take it back out/.test(t), 'and can be undone — it is per trip, not a setting')
    must(!/Add Good Seed to the A2 split/.test(t), 'the offer is gone once taken')
  }
  if (p.title.includes('catch overview')) {
    must(/11,123 kg of haddock/.test(t), 'weights are shown in kilos, never bare numbers')
    must(/its box column does not/.test(t), 'and it says why weight is what is compared')
    must(/Good Seed \(1d\), 732 kg/.test(t), 'the rung is named in the same unit')
    must(/accounts for 97% of the gap/.test(t), 'and finds the same thing boxes did')
    must(!/ bx/.test(t), 'with no box figure anywhere on a weight comparison')
  }
  if (p.title.includes('agrees')) {
    must(/No grade looks to have sold a size down/.test(t), 'nothing found reads as an ANSWER')
    must(!/points short/.test(t), 'and nothing is offered')
  }
  if (p.title.includes('no code')) {
    must(/Not on the ladder, so not compared: Odds 5/.test(t), 'an uncoded rung is named, not dropped')
    must(/Good Seed \(1d\), 2 bx/.test(t), 'the rung is still named')
    must(/accounts for 5% of the gap/.test(t), 'but it is reported as explaining almost none of it')
  }
  /* It must never claim to have decided. */
  must(!/\bwas downgraded\b/i.test(t) && !/\bconfirmed\b/i.test(t),
    'and it never states the downgrade as a fact')
}

const html = `<!doctype html><meta charset="utf-8"><title>Tally check</title>
<style>body{font:14px/1.45 system-ui;margin:2rem;max-width:62rem}
:root{--border:#ccd;--navy:#0A1D26;--brass:#A97614;--grey-400:#667}
h3{margin:2rem 0 .4rem;font:600 13px/1 system-ui;letter-spacing:.08em;text-transform:uppercase;color:#667}
.muted{color:#667}button{font:inherit;padding:.25rem .6rem}</style>
${panes.map(p => `<h3>${p.title}</h3>${p.html}`).join('\n')}`
writeFileSync('tally-check-preview.html', html)

console.log(`\n${fails ? `${fails} CHECK(S) FAILED` : 'all rendered checks passed'} — wrote tally-check-preview.html`)
process.exit(fails ? 1 : 0)
