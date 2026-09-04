/* Render the three invoice tabs and read the markup back.
 *
 *   node scripts/invoices-page-preview.mjs [out.html]
 *
 * THE PAGE IS BEHIND A LOGIN AND A FLEET, so the only way to see what it
 * actually produces is to bundle the real components and server-render them.
 * A build passing proves nothing here: an undefined identifier is valid
 * JavaScript, and this repo has already shipped one commit where two pages
 * called a function they had not imported and `npm run build` was perfectly
 * happy about it.
 *
 * The fixture is shaped like the real record rather than like a happy path —
 * three hulls, a lump billing, a job spanning a year end, an unfiled firm, an
 * undated invoice and a part-finished current year — because every one of those
 * is a branch that would otherwise ship unlooked-at.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import esbuild from 'esbuild'
import { safeOut } from './safeOut.mjs'

const out = safeOut(process.argv[2] || 'invoices-page-preview.html', '.html')

/* ---- a record shaped like the real one ---------------------------------- */
const suppliers = [
  { id: 'jt', name: 'Jackson Trawls Ltd', category: 'gear' },
  { id: 'ms', name: 'Macduff Shipyards Ltd', category: 'shipyard' },
  { id: 'tm', name: 'Trevor McDonald (Marine Engine Services) Ltd', category: 'engine' },
  { id: 'wd', name: 'Woodsons of Aberdeen Ltd Marine Electronics', category: 'electronics' },
  { id: 'bp', name: 'Etablissements BOPP Treuils JEB', category: 'newbuild' },
  { id: 'af', name: 'Aberdeen Fish Producers Organisation (AFPO)', category: 'quota' },
  /* A FIRM NOBODY HAS FILED. A third of the money sitting in "Not filed" is the
     state this page has to be able to report on, not a state it hides. */
  { id: 'zz', name: 'Melpass Limited', category: null },
]

const inv = []
let id = 0
const add = (o) => inv.push({ id: 'i' + (++id), status: 'unpaid', file_path: 'x/y.pdf', ...o })

/* Ten ordinary years of running costs. */
for (let y = 2017; y <= 2026; y++) {
  const months = y === 2026 ? 8 : 12          // the record stops in August 2026
  for (let m = 1; m <= months; m++) {
    const d = `${y}-${String(m).padStart(2, '0')}-14`
    add({ supplier_id: 'jt', supplier: 'Jackson Trawls Ltd', invoice_date: d,
          invoice_no: `JT${y}${m}`, description: 'Trawl repairs and netting',
          net: 4200, vat: 840, total: 5040, page_from: (m % 5) + 1 })
    if (m % 3 === 0) {
      add({ supplier_id: 'ms', supplier: 'Macduff Shipyards Ltd', invoice_date: d,
            invoice_no: `MS${y}${m}`, description: 'Slipping, welding and paint',
            net: 9000, vat: 1800, total: 10800 })
    }
    if (m % 4 === 0) {
      add({ supplier_id: 'wd', supplier: 'Woodsons of Aberdeen Ltd Marine Electronics',
            invoice_date: d, invoice_no: `W-${y}${m}`,
            description: 'Scantrol trawl monitoring sensor repair',
            net: 2600, vat: 520, total: 3120 })
    }
  }
}

/* THE NEWBUILD ORDER — £616,200 on one day in May 2018, four months before the
   boat she was for entered service. The single biggest cell in the grid, and
   the reason the heatmap is scaled by square root rather than linearly. */
for (const [no, amt] of [['FA000741', 479750], ['FA000743', 92500], ['FA000742', 16450],
                         ['FA000745', 13800], ['FA000746', 10900], ['FA000747', 2150],
                         ['FA000744', 650]]) {
  add({ supplier_id: 'bp', supplier: 'Etablissements BOPP Treuils JEB',
        invoice_date: '2018-05-28', invoice_no: no,
        description: 'Composants hydro, treuils, guindeau, cablage, Scantrol',
        net: amt, vat: 0, total: amt })
}

/* THE LUMP BILLING — seven engine invoices on two days in October 2025, which
   is 30% of that year from one firm. The case the work dates exist for. */
for (const [no, amt] of [['3095', 70175.39], ['3096', 5234.80], ['3097', 9717.86],
                         ['3098', 147985.99], ['3098b', 142795.99], ['3099', 16403.49]]) {
  add({ supplier_id: 'tm', supplier: 'Trevor McDonald (Marine Engine Services) Ltd',
        invoice_date: '2025-10-05', invoice_no: no,
        description: 'MAK M20 cylinder head and fuel injector overhaul',
        net: amt, vat: 0, total: amt, page_from: 1 + (no.length % 5), page_to: 1 + (no.length % 5) })
}
/* One of them already answered, and it SPANS A YEAR END — so the grid has a
   divided cost in it and has to say so. */
add({ supplier_id: 'tm', supplier: 'Trevor McDonald (Marine Engine Services) Ltd',
      invoice_date: '2025-10-08', invoice_no: '3100',
      description: 'Investigate low exhaust gas cylinder temperature',
      net: 4957.84, vat: 0, total: 4957.84,
      work_from: '2024-12-17', work_to: '2025-01-15' })

/* Quota, so a second big trade sits beside gear. */
for (let y = 2019; y <= 2026; y++) {
  add({ supplier_id: 'af', supplier: 'Aberdeen Fish Producers Organisation (AFPO)',
        invoice_date: `${y}-07-16`, invoice_no: `Q${y}`,
        description: 'Lease of 45 tonnes Rockall haddock',
        net: 38000, vat: 0, total: 38000 })
}

/* A FIRM NOBODY HAS FILED, and an invoice with NO DATE — which belongs to no
   year and to no boat, and must be counted apart rather than dropped. */
add({ supplier_id: 'zz', supplier: 'Melpass Limited', invoice_date: '2023-04-02',
      invoice_no: 'M-1', description: 'DYC bilge clean, super limate',
      net: 900, vat: 180, total: 1080 })
add({ supplier_id: 'zz', supplier: 'Melpass Limited', invoice_date: null,
      invoice_no: null, description: 'Undated, read off a poor scan',
      net: 500, vat: 100, total: 600 })

/* ---- bundle the real components ----------------------------------------- */
const dir = 'node_modules/.cache'
mkdirSync(dir, { recursive: true })
const bundle = join(dir, 'invoices-page-preview.mjs')
await esbuild.build({
  entryPoints: ['scripts/_invoicesPreviewEntry.jsx'],
  bundle: true, format: 'esm', outfile: bundle,
  jsx: 'automatic', platform: 'node',
  external: ['react', 'react-dom', 'react-dom/*', 'react/*'],
  logLevel: 'warning',
})

const { YearDashboard, AllYears, FindInvoices, resolveCategories, resolveEras } =
  await import(pathToFileURL(bundle).href)
const { renderToStaticMarkup } = await import('react-dom/server')
const { createElement: h } = await import('react')

const cats = resolveCategories(null)
const eras = resolveEras(null)
const noop = () => {}

const panes = [
  ['The year — 2026, part finished, against 2025 to the same day',
   h(YearDashboard, { invoices: inv, suppliers, cats, basis: 'total', on: 'invoice',
                      year: 2026, setYear: noop, onDrill: noop, onOpen: noop })],
  ['All years — billed',
   h(AllYears, { invoices: inv, suppliers, cats, eras, basis: 'total', on: 'invoice',
                 onDrill: noop, onFileSupplier: noop, onSuggestAll: noop,
                 onPlaceVessel: noop, onSetWork: noop })],
  ['All years — dated by when the work was done',
   h(AllYears, { invoices: inv, suppliers, cats, eras, basis: 'total', on: 'work',
                 onDrill: noop, onFileSupplier: noop, onSuggestAll: noop,
                 onPlaceVessel: noop, onSetWork: noop })],
  ['Find — drilled into 2025 engine, as a grid cell opens it',
   h(FindInvoices, { invoices: inv, suppliers, cats, eras, basis: 'total', on: 'invoice',
                     filter: { q: '', year: 2025, category: 'engine' }, setFilter: noop,
                     onOpen: noop, onSetWork: noop, onPlaceVessel: noop, onSetCategory: noop })],
  ['Find — a term nothing matches',
   h(FindInvoices, { invoices: inv, suppliers, cats, eras, basis: 'total', on: 'invoice',
                     filter: { q: 'kongsberg' }, setFilter: noop,
                     onOpen: noop, onSetWork: noop, onPlaceVessel: noop, onSetCategory: noop })],
]

const html = panes.map(([t, el]) => ({ t, m: renderToStaticMarkup(el) }))

writeFileSync(out, `<!doctype html><meta charset="utf-8">
<title>Invoices page preview</title>
<link rel="stylesheet" href="../src/index.css">
<style>
  body { font-family: system-ui, sans-serif; margin: 1.5rem; background: #ECEFEE; color: #0A1D26;
         --hull:#1749A8; --ink:#0A1D26; --paper:#ECEFEE; --line:#d7dcda; --mute:#5d6b70;
         --rust:#C2342A; --brass:#A97614; --kelp:#26654F; }
  .card { background:#fff; border:1px solid #d7dcda; border-radius:6px; padding:0.9rem 1rem;
          margin-bottom:0.8rem; }
  .muted { color:#5d6b70; }
  h2 { font-size:0.95rem; margin:2rem 0 0.6rem; border-bottom:2px solid #1749A8;
       padding-bottom:0.2rem; }
  input, select, button { font: inherit; }
</style>
${html.map(({ t, m }) => `<h2>${t}</h2>${m}`).join('\n')}`)

/* ---- READ THE MARKUP BACK. A preview nobody checks is a screenshot. ------ */
let bad = 0
const has = (i, t, why) => {
  if (!html[i].m.includes(t)) { console.log('  MISSING: ' + why); bad++ }
}
const hasnt = (i, t, why) => {
  if (html[i].m.includes(t)) { console.log('  SHOULD NOT SAY: ' + why); bad++ }
}

/* The one thing this page must never do. */
has(0, 'not finished', 'the dashboard says 2026 is a part year')
has(0, 'to the same day', 'and that last year is cut at the same point')
has(0, 'Ten years', 'the year strip')
has(0, 'What 2026 went on', 'the per-category read that was asked for')

has(1, 'Which boat', 'the three hulls')
has(1, '/yr over', 'compared per year of service, not by raw total')
has(1, 'distrust', 'and the oldest boat says why hers is the shaky one')
has(1, 'lump billing', 'the lump billings are offered')
has(1, 'not filed to a category', 'and the unfiled firm is named as work to do')
has(1, 'no date', 'the undated invoice has its own column')
has(1, 'Every year, by trade', 'the grid')

/* SPREAD IS REPORTED, NEVER SILENT. */
hasnt(1, 'divided by days rather than read off a date',
      'nothing is spread when the grid is dated by the invoice')
has(2, 'divided by days rather than read off a date',
    'and the work-dated grid says which years hold an apportionment')

has(3, 'Trevor McDonald', 'the drill-through finds the engine invoices')
has(3, 'p. ', 'and offers the scan at its page where one was read')
has(4, 'Nothing matches', 'a term that matches nothing says so')
/* The firm dropdown legitimately lists every firm, so the check has to be on
   something only a RESULT ROW carries — a description. Asserting on the firm
   name failed here and the page was right; the assertion was wrong. */
hasnt(4, 'Trawl repairs and netting', 'and no result row is rendered')
has(4, 'clear the filters', 'with a way back out of an empty answer')

console.log(out)
console.log(`  ${inv.length} invoices · ${suppliers.length} firms · ${panes.length} panes rendered`)
if (bad) { console.log(`  ${bad} PROBLEM${bad === 1 ? '' : 'S'}`); process.exit(1) }
console.log('  every pane says what it has to')
