/* THE INVOICE REPORT, RUN AGAINST THE BOAT'S REAL INVOICES.
 *
 * The page is behind a login and a fleet, so the only honest way to check what
 * it will say is to run the real functions over the real rows. These four are
 * the invoices actually in `su_invoices` — Audacious, July 2026 — read out of
 * the database rather than invented, plus a second year so the annual view has
 * something to compare.
 *
 * Usage: node scripts/invoices-preview.mjs
 */
import { build } from 'esbuild'
import { rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(root, 'node_modules', '.cache', 'invoices.cjs')

await build({
  entryPoints: [path.join(root, 'scripts', '_invoicesEntry.jsx')],
  bundle: true, format: 'cjs', platform: 'node', outfile: OUT,
  jsx: 'automatic', logLevel: 'silent',
  external: ['react', 'react-dom', 'react-dom/server'],
})
const { match, totals, addsWrong } = require(OUT)

let n = 0, bad = 0
const check = (c, m) => { n++; if (!c) { bad++; console.error('  FAIL  ' + m) } }
const money = (v) => '£' + Number(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/* ---- THE REAL FOUR, out of su_invoices ---------------------------------- */
const real = [
  { supplier: 'John A Smith & Sons', invoice_no: '0000820305', invoice_date: '2026-07-10',
    net: 191.33, vat: 27.07, total: 218.40, supplier_id: null,
    description: 'Gloves, wellingtons, oilskin bib, barkie - ship chandlery supplies' },
  { supplier: 'AFPO (Aberdeen Fish Producers Organisation)', invoice_no: '2042',
    invoice_date: '2026-07-15', net: 364.50, vat: 72.90, total: 437.40, supplier_id: null,
    description: 'Lease of quota from AFPO - 81t NS Whiting @ £4.50 per tonne' },
  { supplier: 'Jackson Trawls Ltd', invoice_no: 'TPSI028816', invoice_date: '2026-07-15',
    net: 5200, vat: 0, total: 5200, supplier_id: null,
    description: '4 x 59ftms x 60mm VCU SROE alloy clamps' },
  { supplier: 'Seagate Fabrication Ltd', invoice_no: '22883', invoice_date: '2026-07-16',
    net: 1272.25, vat: 0, total: 1272.25, supplier_id: null,
    description: 'Fabricate 3x SS sensor brackets, labour, materials, 2x chain lifter complete sets' },
]

/* ---- NOBODY FILED YET: what the review screen asks first ----------------- */
{
  const m = match(real, [])
  console.log('\n--- FIRMS TO FILE, from the four real invoices ---')
  for (const u of m.unknown) console.log(`  ${u.name.padEnd(46)} ${u.count}  ${money(u.total)}`)

  check(m.unknown.length === 4, 'with nothing filed, all four firms are asked about')
  check(m.unknown[0].name === 'Jackson Trawls Ltd',
        'and the biggest by value is first — file the one that matters before the small one')
  check(m.rows.every((r) => r.supplier_id === null), 'no row is matched to a supplier that does not exist')
}

/* ---- THE FIRM THAT IS ALREADY EIGHT SPELLINGS DEEP ----------------------- */
{
  /* "John A Smith & Sons" on this invoice is the SAME firm as the seven
   * spellings in the fuel log. Filing it once has to catch the lot. */
  const filed = [{ id: 'smith', name: 'John A Smith & Sons',
                   aliases: ["Smith's", 'Smiths &sons', 'Smith & Sons', 'John a smith &sons'] }]
  const m = match(real, filed)
  check(m.rows[0].supplier_id === 'smith', 'the chandlery invoice lands on the filed firm')
  check(m.unknown.length === 3, 'and only the other three are still to file')

  /* Every fuel-log spelling reaches it too, once filed. */
  const fuel = ["Smith's", 'Smith & sons', 'Smiths &sons', "Smith's & Sons",
                'John a smith &sons', 'JOHN A SMITH AND SONS LTD']
    .map((s) => ({ supplier: s, total: 100 }))
  const fm = match(fuel, filed)
  check(fm.rows.every((r) => r.supplier_id === 'smith'),
        'and EVERY fuel-log spelling of that firm reaches it once filed')
  check(fm.unknown.length === 0, 'so nothing is left asking about a firm already on the list')
}

/* ---- THE ANNUAL VIEW, which is the one David said matters ---------------- */
{
  const suppliers = [
    { id: 'smith', name: 'John A Smith & Sons', aliases: [] },
    { id: 'afpo', name: 'AFPO', aliases: ['AFPO (Aberdeen Fish Producers Organisation)'] },
    { id: 'jackson', name: 'Jackson Trawls Ltd', aliases: [] },
    { id: 'seagate', name: 'Seagate Fabrication Ltd', aliases: [] },
  ]
  const m = match(real, suppliers)
  check(m.unknown.length === 0, 'with all four filed, the review asks nothing')

  // A second year, so the annual view has two to show.
  const withPrior = [
    ...m.rows,
    { supplier_id: 'jackson', supplier: 'Jackson Trawls Ltd', invoice_date: '2025-09-02', net: 3000, total: 3600 },
    { supplier_id: 'smith', supplier: 'John A Smith & Sons', invoice_date: '2025-03-11', net: 140, total: 168 },
    // One the reader could not date — must be counted and named, never dropped.
    { supplier_id: 'smith', supplier: 'John A Smith & Sons', invoice_date: null, net: 50, total: 60 },
  ]

  const t = totals(withPrior, suppliers, { grain: 'year' })
  console.log('\n--- WHAT IT COST, BY YEAR ---')
  for (const p of t.periods) {
    console.log(`  ${p.label}  ${money(p.total).padStart(12)}   ${p.count} invoices`)
    for (const s of p.suppliers) {
      console.log(`      ${s.name.padEnd(40)} ${money(s.total).padStart(11)}  ${Math.round(s.total / p.total * 100)}%`)
    }
  }
  console.log(`  undated: ${t.undated.count} carrying ${money(t.undated.total)}`)

  check(t.periods.map((p) => p.label).join(',') === '2026,2025', 'newest year first')
  check(Math.abs(t.periods[0].total - 7128.05) < 0.005,
        "2026 totals the boat's four real invoices to £7,128.05")
  check(t.periods[0].suppliers[0].name === 'Jackson Trawls Ltd',
        'and Jackson Trawls is the biggest cost of the year')
  check(t.undated.count === 1 && t.undated.total === 60,
        'THE UNDATED INVOICE IS COUNTED AND NAMED — a report quietly missing costs is worse than one that says so')

  /* NET AND GROSS DIFFER BY THE VAT, which is real money. */
  const net = totals(withPrior, suppliers, { grain: 'year', basis: 'net' })
  check(Math.abs(net.periods[0].total - 7028.08) < 0.005, 'net totals the net column, not the gross')
  check(net.periods[0].total !== t.periods[0].total, 'and the two genuinely differ, so the basis has to be stated')

  /* THE YEAR IS A SETTING. The office closes this boat's quarters on 30 June,
     so a July-start year splits these invoices differently — and says which
     years it spans rather than calling itself a bare 2026. */
  const fy = totals(withPrior, suppliers, { grain: 'year', fyStartMonth: 7 })
  console.log('\n--- THE SAME COSTS ON A JULY YEAR ---')
  for (const p of fy.periods) console.log(`  ${p.label}  ${money(p.total)}`)
  check(fy.periods.some((p) => p.label === '2026/27'), 'a July year names both years it spans')
  check(fy.periods.find((p) => p.label === '2026/27').count === 4,
        'and the four July invoices fall in the year that starts that month')
}

/* ---- WHAT THE REVIEW SCREEN PULLS TO THE TOP ----------------------------
 *
 * Reading thirty-four bundles at once only stays honest if the doubtful rows
 * are found FOR the reader. Scrolling past two hundred correct ones to find
 * three wrong ones is not checking, it is hoping.
 */
check(addsWrong({ net: 191.33, vat: 27.07, total: 218.40 }) === false,
      "the real chandlery invoice adds up and is NOT flagged")
check(addsWrong({ net: 5200, vat: 0, total: 5200 }) === false,
      'nor a zero-VAT invoice, which is ordinary on these')
check(addsWrong({ net: 100, vat: 20, total: 125 }) === true,
      'a sum that does not come to its total IS flagged — one of the three is misread')
check(addsWrong({ net: 100, vat: 20, total: 120.004 }) === false,
      'and a rounding crumb under a penny is not worth stopping a man for')

/* A FIGURE THE READER COULD NOT MAKE OUT IS NOT A DISAGREEMENT. Flagging a
   blank as "does not add up" would put a red mark on every row the model was
   honest about, which is how a warning stops being read. */
check(addsWrong({ net: 100, vat: null, total: 120 }) === false,
      'a missing VAT is not called a disagreement')
check(addsWrong({ net: '', vat: '', total: '' }) === false,
      'nor a row with nothing on it at all')

await rm(OUT, { force: true })
console.log('\n' + (bad ? bad + ' of ' + n + ' checks FAILED' : n + ' checks passed'))
process.exit(bad ? 1 : 0)
