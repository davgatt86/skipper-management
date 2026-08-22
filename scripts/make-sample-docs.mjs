/* THE SAMPLE DOCUMENTS — the ones a demo visitor uploads.
 *
 *   node scripts/make-sample-docs.mjs
 *
 * A demo you can only look at is a slideshow. The thing worth showing is a man
 * dropping a sales note onto the page and watching 800 rows, a buyer league and
 * a quota position come out of it — so these files have to go through the REAL
 * parsers, not look as though they would.
 *
 * SO EVERY FILE IS PARSED BACK BEFORE IT IS WRITTEN. `parse-core` and
 * `parseDayTally` are imported here and run against the bytes just generated.
 * If a document does not parse, the script fails and nothing is written. That
 * is the whole design: a sample note that quietly stopped parsing after a
 * parser change would be discovered by a prospect, in front of David.
 *
 * They are written to `public/samples/`, so the app serves them itself and the
 * demo page can hand them over without a second host.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ParseCore = require('../src/lib/parse-core.cjs')
const { jsPDF } = require('jspdf')
const XLSX = require('xlsx')

/* The page's OWN reader, not a copy of it: a sample checked against a second
 * implementation proves only that the two agree with each other. */
const { parseBoatText } = await import('../src/lib/estimator/parseBoatText.js')

const OUT = 'public/samples'
mkdirSync(OUT, { recursive: true })

const VESSEL = 'NORTH WIND BCK500'
const money = (n) => n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/* Deterministic, so the sample note is the same file every time it is built —
 * a document that changed on every run would make "did this change break it?"
 * unanswerable. */
let seed = 20260810
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
const pick = (a) => a[Math.floor(rnd() * a.length)]
const between = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1))

// ---------------------------------------------------------------------------
// 1. THE SALES NOTE
//
// The format is fixed-width and the parser anchors on it:
//
//   <buyer> <Species>/<PRES>/<GRADE> <boxes> <box kg> <£/box> <total kg> <£>
//
// and reconciles against a printed  TOTAL <boxes> <kg> <£>  line. The
// arithmetic has to tie exactly — total kg = boxes x box kg, £ = boxes x £/box
// — because that is what the note is checked against, and a sample that failed
// its own reconciliation would open the demo on a warning banner.
// ---------------------------------------------------------------------------

const SPECIES = [
  ['Cod', 'A1', 5.10], ['Cod', 'A2', 4.35], ['Cod', 'A3', 3.60],
  ['Haddock', 'A2', 2.45], ['Haddock', 'A3', 2.05], ['Haddock', 'A4', 1.55],
  ['Whiting', 'A3', 1.35], ['Whiting', 'A4', 1.05],
  ['Monks', 'U9', 5.60], ['Ling', 'A2', 2.55], ['Ling', 'A3', 2.20],
  ['Saithe', 'A3', 1.95], ['Saithe', 'A4', 1.60],
  ['Hake', 'A2', 6.70], ['Hake', 'A3', 5.90],
  ['Lemon Sole', 'A2', 6.10], ['Megrim', 'A2', 3.85],
  ['Plaice', 'A3', 2.30], ['Witch', 'A3', 3.20], ['Halibut', 'U9', 9.80],
]
const BUYERS = [
  'Harbour Fish Co', 'Blue Water Seafoods', 'Kirkbay Fish Ltd',
  'Northline Fish', 'Baytree Seafoods', 'Merrick Fish Ltd',
]

function buildSalesNote() {
  const rows = []
  for (const [sp, grade, base] of SPECIES) {
    for (let k = 0; k < between(2, 4); k++) {
      const boxes = between(2, 26)
      const boxKg = between(30, 42)
      const ppk = +(base * (0.9 + rnd() * 0.24)).toFixed(2)
      const perBox = +(ppk * boxKg).toFixed(2)
      rows.push({
        buyer: pick(BUYERS), sp, grade,
        boxes, boxKg,
        perBox,
        totKg: boxes * boxKg,
        value: +(perBox * boxes).toFixed(2),
      })
    }
  }
  const tot = rows.reduce((a, r) => ({
    boxes: a.boxes + r.boxes, kg: a.kg + r.totKg, value: +(a.value + r.value).toFixed(2),
  }), { boxes: 0, kg: 0, value: 0 })

  /* Courier, and one draw call per row. pdf.js groups text items by their y
   * position, so a row drawn as a single string comes back as a single line —
   * which is what the parser's line regex expects. Drawing the columns
   * separately would hand it a row in pieces. */
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  doc.setFont('courier', 'normal')

  let y = 0
  const head = () => {
    y = 42
    doc.setFontSize(13)
    doc.text('SAMPLE FISH SELLING CO', 40, y); y += 16
    doc.setFontSize(9)
    doc.text('SALES NOTE   Peterhead', 40, y); y += 12
    // The parser reads the sale number as 33xxxxx and the date as dd-MMM-yy.
    doc.text('Sale No 3390001        10-Aug-26', 40, y); y += 12
    doc.text(`Vessel  ${VESSEL}`, 40, y); y += 12
    doc.setFontSize(8)
    doc.text('*** SAMPLE DOCUMENT — DEMONSTRATION DATA ONLY — NOT A REAL SALES NOTE ***', 40, y)
    y += 16
    doc.setFontSize(8)
    doc.text('Buyer / Species          Boxes   Kg   Price   Total Kg      Value', 40, y)
    y += 12
  }
  head()

  for (const r of rows) {
    if (y > 780) { doc.addPage(); doc.setFont('courier', 'normal'); head() }
    doc.text(
      `${r.buyer} ${r.sp}/GUT/${r.grade} ${r.boxes}.00 ${r.boxKg} `
      + `${money(r.perBox)} ${r.totKg} ${money(r.value)}`,
      40, y)
    y += 10
  }
  y += 8
  doc.text(`TOTAL ${money(tot.boxes)} ${tot.kg} ${money(tot.value)}`, 40, y)

  return { bytes: Buffer.from(doc.output('arraybuffer')), rows, tot }
}

// ---------------------------------------------------------------------------
// 2. THE DAY TALLY
//
// Drives Market Layout, the chalk sheet and the buyers' catalogue. The parser
// wants a SPECIES header with DAY n columns under it, so the shape matters more
// than the numbers.
// ---------------------------------------------------------------------------

/* The volumes are weighted like a REAL trip, not spread evenly.
 *
 * The first cut gave every grade the same 1–34 boxes a day, which came out at
 * 1,711 boxes needing THIRTY tiers — against a rule of thumb of 19. A real
 * Peterhead trip of that size takes 16 to 18. The reason is that an even spread
 * is mostly premium flat fish, and flat fish costs a footprint a box: Trip 63
 * put 1,424 boxes into 737 footprints, mine into 1,400.
 *
 * So each grade carries the daily range it actually lands in — hundreds of
 * boxes of haddock metro, a handful of turbot — and the sheet comes out the
 * shape a skipper would recognise. A demo whose market layout asks for a third
 * more floor than the trip needs is a demo of the wrong thing.
 */
const TALLY = [
  ['COD', 'Large (1b)', 4, 14], ['COD', 'Med (2)', 6, 18],
  ['COD', 'Sprag (3)', 5, 16], ['COD', 'Baby (5a)', 2, 8],
  ['HADDOCK', 'Seed (2a)', 10, 30], ['HADDOCK', 'Chipper (2b)', 20, 55],
  ['HADDOCK', 'Metro (3)', 45, 95], ['HADDOCK', 'M Metro (4)', 35, 80],
  ['WHITING', 'Med (1b)', 3, 12], ['WHITING', 'Sma (3)', 2, 10],
  ['MONKS', 'Large', 2, 8], ['MONKS', 'Med', 3, 10],
  ['LING', 'Large', 5, 16], ['LING', 'Med', 4, 14],
  ['LYTHE', 'Large (1)', 4, 13], ['LYTHE', 'Sel (3)', 3, 11],
  ['BLACK', 'Large (1)', 12, 35], ['BLACK', 'Sma (4a)', 18, 45],
  ['CAT', 'Large', 5, 16], ['CAT', 'Small (U9b)', 3, 12],
  ['HAKE', 'Sel (2)', 4, 14], ['HAKE', 'X Sma (4)', 2, 9],
  ['LEMONS', 'Sma (3a)', 2, 7], ['MEGS', 'Large (1)', 1, 5],
  ['MEGS', 'Med (2)', 1, 6], ['PLAICE', 'Large (1b)', 0, 3],
  ['WITCH', 'Small (U9b)', 0, 2], ['HALIBUT', 'Large (U9a)', 0, 3],
  ['TURBOT', 'Small (U9b)', 0, 2],
]

function buildDayTally() {
  const days = [1, 2, 3, 4, 5]
  const aoa = [
    [`${VESSEL} — SAMPLE DAY TALLY (demonstration data only)`],
    [],
    ['SPECIES', 'GRADE', ...days.map((d) => `DAY ${d}`)],
  ]
  let total = 0
  for (const [sp, grade, lo, hi] of TALLY) {
    const row = [sp, grade]
    for (const _ of days) {
      const n = between(lo, hi)
      row.push(n || '')
      total += n
    }
    aoa.push(row)
  }
  aoa.push([])
  /* GRAND TOTAL, and in the LAST column. The parser skips any row whose
   * first cell merely contains TOTAL — those are the per-species subtotals a
   * real tally carries — and reads the figure from the end of the row. Put it
   * in column 3 and the sheet parses with no printed total to check against,
   * which is the one number that proves the upload read the file correctly. */
  aoa.push(['GRAND TOTAL', '', '', '', '', '', total])

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Day Tally')
  return { bytes: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), total }
}


// ---------------------------------------------------------------------------
// 3. THE BOAT TALLY FOR WHERE TO LAND
//
// The Estimator compares what a trip would make at Peterhead against Hanstholm,
// off the real price board — so it needs a catch to price, and until one is
// loaded every figure on the page is £0.00.
//
// ITS FORMAT IS NOT THE DAY TALLY'S. `parseBoatText` wants a species header row
// whose second cell is a bare `*`, then one line per grade with an EMPTY first
// cell: `,size,boxes,kg`. Feeding it the market day tally gets nothing, and it
// falls back to the AI reader, which needs the network — no use for a sample
// whose whole job is to work first time.
//
// THE SPECIES ARE THE BOARD'S OWN NAMES — Monkfish not MONKS, Lemon not LEMONS,
// Pollack not LYTHE — because the page maps a tally line to a price by name. A
// sample that half-maps would open on a list of things it could not price,
// which is precisely the confusing state the page has a "check mapping" step
// for.
// ---------------------------------------------------------------------------

const BOAT = [
  ['COD', [['A1', 18, 690], ['A2', 34, 1290], ['A3', 41, 1560], ['A4', 22, 840]]],
  ['HADDOCK', [['A1', 26, 990], ['A2', 88, 3340], ['A3', 132, 5010], ['A4', 61, 2320]]],
  ['WHITING', [['A2', 14, 530], ['A3', 27, 1030], ['A4', 12, 455]]],
  ['MONKFISH', [['A1', 9, 340], ['A2', 16, 610], ['A3', 11, 420]]],
  ['LING', [['A1', 12, 455], ['A2', 21, 800], ['A3', 9, 340]]],
  ['SAITHE', [['A2', 24, 910], ['A3', 46, 1750], ['A4', 31, 1180]]],
  ['POLLACK', [['A2', 11, 420], ['A3', 17, 645]]],
  ['HAKE', [['A1', 7, 265], ['A2', 19, 720], ['A3', 14, 530]]],
  ['LEMON', [['A1', 6, 230], ['A2', 13, 495], ['A3', 8, 305]]],
  ['MEGRIM', [['A1', 5, 190], ['A2', 12, 455], ['A3', 7, 265]]],
  ['PLAICE', [['A2', 9, 340], ['A3', 15, 570]]],
  ['CATFISH', [['U9', 18, 685]]],
  ['WITCH', [['U9', 6, 230]]],
  ['HALIBUT', [['U9', 4, 155]]],
]

function buildBoatTally() {
  const out = ['NORTH WIND BCK500 - SAMPLE BOAT TALLY (demonstration data only),,,']
  let boxes = 0
  let kg = 0
  for (const [sp, lines] of BOAT) {
    out.push(`${sp},*,,`)
    for (const [size, bx, w] of lines) {
      out.push(`,${size},${bx},${w}`)
      boxes += bx
      kg += w
    }
  }
  out.push(`TOTAL,,${boxes},${kg}`)
  return { text: out.join('\n') + '\n', boxes, kg, lines: BOAT.reduce((n, s) => n + s[1].length, 0) }
}
// ---------------------------------------------------------------------------
// BUILD, THEN PARSE BACK
// ---------------------------------------------------------------------------

const problems = []
const wrote = []

// --- sales note -------------------------------------------------------------
{
  const { bytes, rows, tot } = buildSalesNote()
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const parsed = await ParseCore.parsePdf(new Uint8Array(bytes), pdfjs, 'sample-sales-note.pdf')

  const r = parsed.reconcile
  console.log('sales note   market:', parsed.market)
  console.log('             vessel:', JSON.stringify(parsed.meta.vessel), '· sale', parsed.meta.saleNo,
    '· date', parsed.meta.isoDate, '· port', parsed.meta.port)
  console.log('             built', rows.length, 'rows /', money(tot.value),
    '→ parsed', parsed.rows.length, 'rows /', money(r.actual.value))
  console.log('             reconcile found:', r.found, '· ok:', r.ok, '· diffs:', JSON.stringify(r.diffs))

  if (!parsed.market.startsWith('Don Fishing')) problems.push('sales note: market read as ' + parsed.market)
  if (parsed.rows.length !== rows.length) problems.push(`sales note: ${rows.length} rows built, ${parsed.rows.length} parsed`)
  if (!r.ok) problems.push('sales note: does not reconcile — ' + JSON.stringify(r.diffs))
  if (parsed.meta.vessel !== VESSEL) problems.push('sales note: vessel read as ' + JSON.stringify(parsed.meta.vessel))
  const blanks = parsed.rows.filter((x) => !x.buyer).length
  if (blanks) problems.push(`sales note: ${blanks} rows lost their buyer`)

  if (!problems.length) { writeFileSync(join(OUT, 'sample-sales-note.pdf'), bytes); wrote.push('sample-sales-note.pdf') }
}

// --- day tally --------------------------------------------------------------
{
  const { bytes, total } = buildDayTally()
  const { parseDayTally } = await import('../src/lib/market/parseDayTally.js')
  const { planLayout } = await import('../src/lib/market/planLayout.js')
  const parsed = parseDayTally(bytes)

  console.log('\nday tally    ', parsed.error ? 'ERROR ' + parsed.error
    : `${parsed.lines.length} lines · printed total ${parsed.printedTotal} · built ${total}`)
  if (parsed.error) problems.push('day tally: ' + parsed.error)
  else {
    const plan = planLayout(parsed.lines)
    console.log('             ', plan.totalBoxes, 'boxes ·', plan.tiers, 'tiers · rule of thumb', plan.ruleOfThumb)
    if (plan.totalBoxes !== total) problems.push(`day tally: built ${total} boxes, laid out ${plan.totalBoxes}`)
    /* The printed total is the one figure that proves the upload read the
     * file rather than merely opened it, and it is easy to lose: the parser
     * skips any row whose first cell just contains TOTAL. */
    if (parsed.printedTotal !== total) problems.push(`day tally: printed total ${parsed.printedTotal} against ${total} built`)
    if (!(plan.tiers > 0)) problems.push('day tally: no tiers')
    writeFileSync(join(OUT, 'sample-day-tally.xlsx'), bytes)
    wrote.push('sample-day-tally.xlsx')
  }
}

// --- boat tally for Where to Land ------------------------------------------
{
  const { text, boxes, kg, lines: n } = buildBoatTally()
  /* Checked with the PAGE'S OWN reader, lifted out of Estimator.jsx, rather
   * than a copy of it here: the point of a sample is that it goes through the
   * real thing. */
  const parsed = parseBoatText(text)
  console.log()
  console.log('boat tally    ', parsed.length, 'lines ·', boxes, 'boxes ·', kg, 'kg')
  if (parsed.length !== n) problems.push(`boat tally: ${n} lines built, ${parsed.length} parsed`)
  const pb = parsed.reduce((a, r) => a + r.boxes, 0)
  const pk = parsed.reduce((a, r) => a + r.wt, 0)
  if (pb !== boxes || pk !== kg) problems.push(`boat tally: parsed ${pb} boxes / ${pk} kg`)
  if (!problems.length) { writeFileSync(join(OUT, 'sample-boat-tally.csv'), text); wrote.push('sample-boat-tally.csv') }
}

console.log()
if (problems.length) {
  console.log('NOT WRITTEN — a sample document must parse:')
  for (const p of problems) console.log('  · ' + p)
  process.exit(1)
}
console.log('wrote ' + wrote.map((w) => OUT + '/' + w).join(', '))
