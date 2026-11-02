/* Render the "what changed" panel against the REAL sample note.
 *
 *   node scripts/upload-panel-preview.mjs [out.html]
 *
 * The page is behind a login and a file picker, so checking the panel through
 * the app means doing it by hand every time. This bundles the actual component
 * with esbuild and server-renders it against the document a visitor is
 * genuinely handed — so what is looked at is what the app produces, not a copy
 * that can drift. Same reason `sheet-preview.mjs` and `stores-preview.mjs`
 * exist.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import esbuild from 'esbuild'
import { safeOut } from './safeOut.mjs'
import { summariseNote } from '../src/lib/salesChange.js'

const require = createRequire(import.meta.url)
const out = safeOut(process.argv[2] || 'upload-panel-preview.html', '.html')

const ParseCore = require('../src/lib/parse-core.cjs')
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
const buf = readFileSync('public/samples/sample-sales-note.pdf')
const res = await ParseCore.parsePdf(new Uint8Array(buf), pdfjs, 'sample-sales-note.pdf')

/* Three notes, so every state the panel can be in is on the page at once: a
 * clean new landing, a re-read that replaced one already on file, and one whose
 * figures do not tie. A preview that only shows the happy case is how the other
 * two ship broken. */
const priorLandings = [
  { id: 'a', landing_date: '2026-01-06', value: 61240.5 },
  { id: 'b', landing_date: '2026-02-14', value: 88120.25 },
]
const items = [
  summariseNote(res, {
    isNew: true, landings: priorLandings,
    knownBuyers: new Set(['Harbour Fish Co', 'Blue Water Seafoods']),
  }),
  summariseNote(res, { isNew: false, replacedId: 'b', landings: priorLandings }),
  summariseNote({
    ...res,
    reconcile: {
      found: true, ok: false,
      expected: { boxes: 770, weight: 27874, value: 111_950.76 },
      diffs: { boxes: -2, weight: 0, value: -150 },
    },
  }, { isNew: true, landings: priorLandings, knownBuyers: new Set() }),
  /* THE 02-11-2026 SHAPE: Don printed the note with its LANDING DATE box
     blank, so the date shown is DATE SOLD standing in. The panel has to say
     so — it is the one figure on the card not read straight off the note. */
  summariseNote({
    ...res,
    meta: { ...res.meta, isoDate: '2026-11-02', dateBasis: 'sold' },
  }, { isNew: true, landings: priorLandings, knownBuyers: new Set() }),
]

/* Bundle the component itself rather than reimplementing it here — the point
 * is to look at what the app renders, not at a second drawing of it. It has to
 * land inside the project or node cannot resolve react from it. */
const dir = 'node_modules/.cache'
mkdirSync(dir, { recursive: true })
const bundle = join(dir, 'upload-panel-preview.mjs')
await esbuild.build({
  entryPoints: ['src/UploadSummary.jsx'],
  bundle: true, format: 'esm', outfile: bundle,
  jsx: 'automatic', platform: 'node',
  external: ['react', 'react-dom', 'react-dom/*', 'react/*'],
  logLevel: 'warning',
})

const { default: UploadSummary } = await import(pathToFileURL(bundle).href)
const { renderToStaticMarkup } = await import('react-dom/server')
const { createElement } = await import('react')

const body = renderToStaticMarkup(createElement(UploadSummary, { items }))
writeFileSync(out, `<!doctype html><meta charset="utf-8">
<title>Upload panel preview</title>
<link rel="stylesheet" href="../../src/index.css">
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; max-width: 46rem;
         background: var(--paper, #ECEFEE); color: var(--ink, #0A1D26); }
  .card { background: #fff; border: 1px solid #d7dcda; border-radius: 6px;
          padding: 0.9rem 1rem; }
  .muted { color: #5d6b70; }
</style>
<h1 style="font-size:1.1rem">What the note just changed</h1>
<p class="muted" style="font-size:.85rem">Rendered from the real sample note — a new landing,
a re-read that replaced one, one whose figures do not tie, and one dated off DATE SOLD
because the note's landing-date box was blank.</p>
${body}`)

console.log(out)
for (const s of items) {
  console.log(`  ${s.isNew ? 'new     ' : 'replaced'} · ${s.checked.padEnd(7)}`
    + ` · ${s.rows} rows · £${s.value.toLocaleString('en-GB')}`
    + ` · ${s.before.landings}→${s.after.landings} landings`
    + ` · fresh buyers ${s.fresh === null ? '(not looked up)' : s.fresh.length}`
    + ` · date ${s.dateBasis || '(basis not stated)'}`)
}

/* READ THE MARKUP BACK. A preview that only renders proves the component did
   not throw; what matters here is that the substituted date is MARKED and —
   just as much — that the other three are not. A mark that appears on every
   card is one nobody reads. */
const cards = body.split('class="card"').slice(1)
let bad = 0
const check = (label, got, want) => {
  const ok = got === want
  if (!ok) bad++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}` + (ok ? '' : `  got ${got} want ${want}`))
}
check('four cards rendered', cards.length, 4)
const says = cards.map((c) => c.includes('the landing-date box was blank'))
check('the substituted date is marked', says[3], true)
check('a note read off its own landing date is not', says[0], false)
check('nor a re-read', says[1], false)
check('nor one whose figures do not tie', says[2], false)
check('and the marked one shows the date it stood in', cards[3].includes('2026-11-02'), true)
if (bad) { console.error(`\n${bad} check(s) failed`); process.exit(1) }
console.log('\nall passed')
