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

/* The row that started this: Macduff 30543, the GBP 287,874 stage payment
   filed twice off the same scan saved under a (1) suffix. */
const stage = {
  id: 'stage', supplier: 'Macduff Shipyards Limited', invoice_no: '30543',
  invoice_date: '2017-10-31', net: 287874.10, vat: 0, total: 287874.10,
  currency: 'GBP', page_from: 2, page_to: 2,
  description: 'Stage payment due when hull is 100% completed - Yard 680',
}

/* THE TWO PAIRS THIS BOAT ACTUALLY STILL HAS, and they are opposites.
   Baird's Pharmacy is one chemist spelled two ways. Macduff Shipyards against
   its crane hire arm is one firm and two trades, £1.34m apart, and David
   settled months ago that it must NOT be merged. Only what each side sold
   tells them apart, which is why the panel prints that. */
const mergeFirms = [
  { id: 'm1', name: 'Macduff Shipyards Ltd', category: 'shipyard', aliases: [], not_same_as: [] },
  { id: 'm2', name: 'Macduff Shipyards Limited (Macduff Crane Hire)', category: 'plant', aliases: [], not_same_as: [] },
  { id: 'm3', name: "Baird's Pharmacy", category: 'medical', aliases: [], not_same_as: [] },
  { id: 'm4', name: "Baird's Pharmacy (RMB Retail Limited)", category: 'medical', aliases: [], not_same_as: [] },
  /* Already answered, so it must not appear at all. */
  { id: 'm5', name: 'Ocean Blue Quota', category: 'quota', aliases: [], not_same_as: ['m6'] },
  { id: 'm6', name: 'Ocean Blue Quota Company Holdings', category: 'quota', aliases: [], not_same_as: ['m5'] },
]
const mergeInvoices = [
  { id: 'x1', supplier_id: 'm1', total: 1346921, invoice_date: '2019-03-04', description: 'Annual dry docking, hull blasting and paint' },
  { id: 'x2', supplier_id: 'm1', total: 287874, invoice_date: '2017-10-31', description: 'Stage payment due when hull is 100% completed' },
  { id: 'x3', supplier_id: 'm2', total: 4121, invoice_date: '2021-05-06', description: 'Crane hire, 40t mobile, lifting nets to quay' },
  { id: 'x4', supplier_id: 'm3', total: 557, invoice_date: '2022-02-01', description: 'Ship medical stores, category A' },
  { id: 'x5', supplier_id: 'm4', total: 687, invoice_date: '2024-06-11', description: 'Medical stores top-up and controlled drugs' },
  { id: 'x6', supplier_id: 'm5', total: 7980, invoice_date: '2023-01-09', description: 'Lease 20tn North Sea cod' },
  { id: 'x7', supplier_id: 'm6', total: 6000, invoice_date: '2024-01-09', description: 'Lease 15tn North Sea haddock' },
]

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

const { YearDashboard, AllYears, FindInvoices, CorrectFigures, RemoveInvoice, MergeFirms, Arrivals, Review, resolveCategories, resolveEras } =
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
  /* THE TWO PANELS THAT CAN CHANGE THE RECORD. Rendered directly, because they
     sit behind row state and a server render of the list can never reach them.
     The row used here is the real shape of the one that started all this:
     Macduff 30543, the £287,874 stage payment filed twice off the same scan. */
  ['Correct the figures — what the reader took off the scan',
   h(CorrectFigures, {
     inv: stage,
     val: (k) => ({ ...stage, total: '187874.10' })[k] ?? '',
     put: () => noop, changed: ['total'],
     why: 'read the scan again — page 2 says 187,874.10',
     setWhy: noop, onSave: noop,
   })],
  ['Correct the figures — net and VAT do not add to the total',
   h(CorrectFigures, {
     inv: stage,
     val: (k) => ({ ...stage, net: '100', vat: '20', total: '600' })[k] ?? '',
     put: () => noop, changed: [], why: '', setWhy: noop, onSave: noop,
   })],
  ['Remove an invoice — no reason given yet',
   h(RemoveInvoice, {
     inv: stage, supplier: { name: 'Macduff Shipyards Limited' },
     why: '', setWhy: noop, onRemove: noop,
   })],
  ['Remove an invoice — reason given',
   h(RemoveInvoice, {
     inv: stage, supplier: { name: 'Macduff Shipyards Limited' },
     why: 'the same scan was loaded twice, this is the copy from the (1) file',
     setWhy: noop, onRemove: noop,
   })],
  /* MERGING TWO SPELLINGS OF ONE FIRM. The fixture is the two real pairs this
     boat still has: one that plainly should merge, and one that plainly should
     NOT — same shipyard, different trade, and only what each side sold tells
     them apart. */
  ['Merge firms — a real pair and a pair that must stay apart',
   h(MergeFirms, { suppliers: mergeFirms, invoices: mergeInvoices, onMerge: noop, onNotSame: noop })],
  ['Merge firms — nothing to ask about',
   h(MergeFirms, { suppliers: [mergeFirms[0]], invoices: mergeInvoices, onMerge: noop, onNotSame: noop })],
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

/* ---- THE TWO PANELS THAT CAN CHANGE THE RECORD -------------------------
 * Rendered on their own because they sit behind row state and a server render
 * of the list can never reach them. Extracting them caught a real fault the
 * build was perfectly happy with: the bodies still referred to `killWhy` from
 * the closure they had been lifted out of. An undefined identifier is valid
 * JavaScript right up until it runs, which is the third time this repo has
 * been told that.
 */
has(7, 'Correct the figures', 'the correction panel is headed as a correction')
has(7, '30543', 'and carries the invoice number to be corrected')
has(7, 'Save 1 change', 'it counts what has actually been altered')
has(7, 'so a year from now this reads as a decision', 'and asks why before it will save')
has(7, 'what it says now is kept either way', 'and says the old reading is kept')
/* THE FIGURES ARE CORRECTABLE; THE DECISIONS ARE NOT HERE. Which boat, what
   trade and when the work was done are answers to questions the invoice cannot
   answer, and folding them in would put "I decided this" and "the reader got
   this wrong" into one record. */
hasnt(7, 'Which boat', 'the boat is not corrected here — it is decided elsewhere')
hasnt(7, 'Work done from', 'and neither are the work dates')

/* NET + VAT AGAINST THE TOTAL IS REPORTED, NEVER RESOLVED — the same rule as
   the review screen, and this record measured it: 26 disagreements in 27 were
   the invoice rather than the reading. */
has(8, 'Net and VAT come to', 'a split that does not add up is reported')
has(8, 'Often the invoice rather than the reading', 'in the words the sweep proved')
has(8, 'The <b>total</b> is the figure that counts', 'and it points at the figure that counts')
hasnt(8, 'is misread', 'never accusing one of the three of being wrong')

has(9, 'out of the record?', 'removing one asks first')
has(9, 'comes off every total on this page', 'and says what leaves the totals')
has(9, '287,874.10', 'naming the money, because that is what is going')
has(9, 'check which copy carries the page number', 'and which copy of a pair to keep')
/* THE REASON IS REQUIRED. It is the only thing that will ever say why this row
   went: su_* has no audit trail of its own, so without it a delete leaves no
   trace whatever that it happened. */
has(9, 'say why first', 'with no reason typed, it will not go')
has(10, 'kept on record, so it can be put back', 'with one, it says the row survives the delete')

/* ---- MERGING TWO SPELLINGS OF ONE FIRM ---------------------------------
 * SUGGESTED, NEVER APPLIED. Two of the five pairs on this boat are
 * deliberately not merges, and the panel cannot tell which is which — only
 * what each side sold can, which is why it prints that.
 */
has(11, '2 pairs worth a look', 'it counts the pairs it can see')
/* THE ALREADY-ANSWERED PAIR IS NOT AMONG THEM. Without `not_same_as` this
   would ask about Macduff and Don Fishing every time the page opened, and the
   one real pair would hide among refusals nobody reads. */
hasnt(11, 'Ocean Blue', 'a pair already told apart is never offered again')
has(11, 'Nothing is merged until you say so', 'and it says it decides nothing')

has(11, 'Macduff Shipyards Ltd', 'the bigger side is offered as the keeper')
has(11, 'keeps its name', 'and is labelled as such')
has(11, 'folds into it', 'with the other side labelled too')
has(11, '£1,634,795.00', 'each side carries its own money')
has(11, 'Annual dry docking', 'and what it actually sold')
/* WHAT TELLS A BRANCH FROM A BUSINESS is the trade, not the name. This is
   exactly the pair David ruled must stay apart. */
has(11, 'filed to different trades', 'a different trade is called out')
has(11, 'shipyard against plant', 'and named on both sides')
has(11, 'Crane hire, 40t mobile', 'so the reason they differ is visible')
has(11, 'macduff crane hire', 'the words one name carries and the other does not')
hasnt(11, 'limited macduff crane hire', 'without a company suffix left stranded in them')

has(11, 'Not the same firm', 'refusing is offered beside merging')
has(11, 'Other way round', 'and which name survives can be turned round')
has(11, 'is kept as a spelling so next', 'the alias half is stated, not just the move')

/* AND IT SAYS WHAT IT CANNOT SEE. Seaway Group against Seaway Net Company was
   a real merge that shares only a first word, so this rule misses it — and a
   suggester that implied it had found everything would be worse than one that
   admits the eye is still needed. Measured before choosing the rule: prefix
   gives 5 pairs on this boat, same-first-word gives 51, one of which matched
   "The Don Fishing Company" against "The Garret Home Furnishings". */
has(12, 'No two firms look like one', 'an empty list says so plainly')
has(12, 'Seaway', 'and names the kind of merge it cannot find')
has(12, 'spotted by eye', 'rather than implying it found everything')

console.log(out)
console.log(`  ${inv.length} invoices · ${suppliers.length} firms · ${panes.length} panes rendered`)
if (bad) { console.log(`  ${bad} PROBLEM${bad === 1 ? '' : 'S'}`); process.exit(1) }
console.log('  every pane says what it has to')
