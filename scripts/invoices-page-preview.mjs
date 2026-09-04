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

const { YearDashboard, AllYears, FindInvoices, Arrivals, Review, resolveCategories, resolveEras } =
  await import(pathToFileURL(bundle).href)
const { renderToStaticMarkup } = await import('react-dom/server')
const { createElement: h } = await import('react')

const cats = resolveCategories(null)
const eras = resolveEras(null)
const noop = () => {}

/* 364 bundles back to 2017 is what this tab really holds, and the reason it
   needed a way in at all. Two of them unread, one of them old — an unread
   bundle is a job rather than a record and must show however far back it is. */
const batches = []
for (let y = 2017; y <= 2026; y++) {
  for (let m = 1; m <= (y === 2026 ? 8 : 12); m += (y < 2024 ? 3 : 1)) {
    const d = `${y}-${String(m).padStart(2, '0')}-13`
    batches.push({
      id: `b-${y}-${m}`, received_at: d + 'T09:00:00Z',
      filename: `${d} ${y}${String(m).padStart(2, '0')}13091108402.pdf`,
      subject: 'Audacious invoices for approval', from_email: 'denise.nicolson@donfishing.com',
      page_count: 8, status: 'filed', invoiceCount: 7,
    })
  }
}
batches.reverse()
batches[0].status = 'new'; batches[0].invoiceCount = 0
/* An OLD unread one, buried past the recent cut. */
batches[batches.length - 6].status = 'new'; batches[batches.length - 6].invoiceCount = 0

/* THE REAL DUPLICATE. Inverboyndie INV-0114, £34,971.60 dated 19 May 2023, is
   in the bundles of 6 June, 13 June AND 19 June — three consecutive Mondays,
   because the office re-sends an invoice until it has been approved. Ten years
   of that put £240,015.96 into the record twice. */
const alreadyFiled = [
  { id: 'f1', batch_id: 'jun06', supplier: 'Inverboyndie Trawls LLP', invoice_no: 'INV-0114',
    invoice_date: '2023-05-19', total: 34971.60 },
  { id: 'f2', batch_id: 'jun13', supplier: 'Inverboyndie Trawls LLP', invoice_no: 'INV-0114',
    invoice_date: '2023-05-19', total: 34971.60 },
  { id: 'f3', batch_id: 'jun13', supplier: 'Inverboyndie Trawls LLP', invoice_no: 'INV-0115',
    invoice_date: '2023-05-19', total: 8100.00 },
]
const reviewItems = [{
  batch: { id: 'jun19', received_at: '2023-06-19T09:00:00Z', page_count: 9,
           file_path: 'x/y.pdf' },
  rows: [
    /* the third copy */
    { supplier: 'Inverboyndie Trawls LLP', supplier_id: 'inv', invoice_no: 'INV-0114',
      invoice_date: '2023-05-19', description: 'Twine, nylon, needles',
      net: 34971.60, vat: 0, total: 34971.60, page_from: 1, page_to: 2 },
    /* a corrected reissue — same number, different money, the 3098/3098b shape */
    { supplier: 'INVERBOYNDIE TRAWLS', supplier_id: 'inv', invoice_no: 'inv/0115',
      invoice_date: '2023-05-19', description: 'Twine, nylon, needles (revised)',
      net: 29781.60, vat: 0, total: 29781.60, page_from: 3, page_to: 4 },
    /* genuinely new, and must not be flagged */
    { supplier: 'Jackson Trawls Ltd', supplier_id: 'jt', invoice_no: 'TPSI099',
      invoice_date: '2023-06-14', description: 'Trawl repairs',
      net: 4200, vat: 840, total: 5040, page_from: 5, page_to: 5 },
    /* the same bundle carrying one twice, which checking the database alone
       would miss — nothing is on file yet */
    { supplier: 'Jackson Trawls Ltd', supplier_id: 'jt', invoice_no: 'TPSI099',
      invoice_date: '2023-06-14', description: 'Trawl repairs',
      net: 4200, vat: 840, total: 5040, page_from: 6, page_to: 6 },
  ],
}]

const panes = [
  ['Check the read — three of the four already on file',
   h(Review, { items: reviewItems, unknown: [], suppliers: [], filed: alreadyFiled,
               progress: null, onStop: noop, onEdit: noop, onDropRow: noop, onFile: noop,
               onSave: noop, onDrop: noop, onOpenScan: noop, onOpenPage: noop })],
  ['+ Invoice batch — 364 bundles, two unread, one of them old',
   h(Arrivals, { batches, loading: false, canUpload: true, fileInput: { current: null },
                 onRead: noop, onReadAll: noop, onUpload: noop, onIgnore: noop,
                 onDelete: noop, reading: false, busy: false })],
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

/* THE DUPLICATE GUARD — the only flag on this screen whose answer is 'leave it
   out' rather than 'correct it', so it is said once at the top before thirteen
   rows of detail. */
has(0, 'already on file', 'the bundle says how many of its invoices it has seen before')
has(0, 'Leave it out', 'and each one can be dropped in a tap')
has(0, 'This bundle carries it twice', 'a bundle carrying one twice is its own case')
has(0, 'possibly a corrected reissue',
    'and a same-number-different-amount is NOT claimed as the same paper')
has(0, 'until it has been approved', 'the panel says why this keeps happening')
/* THE SUMMARY AT THE TOP MUST NOT CONTRADICT THE CARDS BELOW IT. It said
   "Nothing flagged" over a card reporting three duplicates — caught by
   rendering, and the reason nobody would believe the summary again. */
has(0, '3 already on file', 'and the run summary counts them too')
hasnt(0, 'Nothing flagged', 'rather than claiming the run is clean')
/* THE ONE THAT IS GENUINELY NEW MUST NOT BE FLAGGED, or the guard fires on the
   ordinary case and stops being read. */
{
  /* Counted on the thing that appears exactly once per flagged ROW. The first
     version counted every phrase containing "already on file" and was fooled by
     the run summary and the panel heading — a check that cannot tell the page
     being wrong from the page explaining itself is no check. */
  const marks = (html[0].m.match(/Leave it out/g) || []).length
  if (marks !== 3) { console.log('  ' + marks + ' rows flagged, wanted 3'); bad++ }
}

/* The one thing this page must never do. */
has(2, 'not finished', 'the dashboard says 2026 is a part year')
has(2, 'to the same day', 'and that last year is cut at the same point')
has(2, 'Ten years', 'the year strip')

/* THE ARRIVALS TAB HOLDS TEN YEARS NOW, and needed a way into them. */
has(1, 'Find a bundle', 'a ten-year arrivals list can be searched')
has(1, 'bundles on record, back to', 'and says how far back it goes')
has(1, 'older bundle', 'and says how many it is not showing, rather than just stopping')
has(1, 'Read again', 'an already-filed bundle can be read again')
/* An unread bundle is a job rather than a record: it shows however old it is. */
{
  const old = batches[batches.length - 6]
  has(1, old.filename, 'an OLD unread bundle still shows, past the recent cut')
  has(1, '8 pages · ' + old.filename,
     'and the row names the file it came from, since that is what you search')
}
has(2, 'What 2026 went on', 'the per-category read that was asked for')

has(3, 'Which boat', 'the three hulls')
has(3, '/yr over', 'compared per year of service, not by raw total')
has(3, 'distrust', 'and the oldest boat says why hers is the shaky one')
has(3, 'lump billing', 'the lump billings are offered')
has(3, 'not filed to a category', 'and the unfiled firm is named as work to do')
has(3, 'no date', 'the undated invoice has its own column')
has(3, 'Every year, by trade', 'the grid')

/* SPREAD IS REPORTED, NEVER SILENT. */
hasnt(3, 'divided by days rather than read off a date',
      'nothing is spread when the grid is dated by the invoice')
has(4, 'divided by days rather than read off a date',
    'and the work-dated grid says which years hold an apportionment')

has(5, 'Trevor McDonald', 'the drill-through finds the engine invoices')
has(5, 'p. ', 'and offers the scan at its page where one was read')
has(6, 'Nothing matches', 'a term that matches nothing says so')
/* The firm dropdown legitimately lists every firm, so the check has to be on
   something only a RESULT ROW carries — a description. Asserting on the firm
   name failed here and the page was right; the assertion was wrong. */
hasnt(6, 'Trawl repairs and netting', 'and no result row is rendered')
has(6, 'clear the filters', 'with a way back out of an empty answer')

console.log(out)
console.log(`  ${inv.length} invoices · ${suppliers.length} firms · ${panes.length} panes rendered`)
if (bad) { console.log(`  ${bad} PROBLEM${bad === 1 ? '' : 'S'}`); process.exit(1) }
console.log('  every pane says what it has to')
