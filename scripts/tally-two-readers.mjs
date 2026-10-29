/* THE TWO TALLY READERS, RUN AGAINST THE SAME TRIP.
 *
 * `test-tally-pdf.mjs` pins the PDF reader against a frozen extraction and the
 * figures measured off the workbook. This runs the real pair end to end:
 *
 *   node scripts/tally-two-readers.mjs "<trip NN day tally.pdf>" "<...xlsx>"
 *
 * WHY IT EXISTS. Taking the tally as a PDF reverses a decision this repo wrote
 * down — *"two readers for one document is the parse-core failure again"* —
 * and the parse-core failure was two copies of one READER drifting apart, one
 * on 1.2.1 and the other on 1.3.2, for months, because the copy that mattered
 * lived on a server nobody looked at. One reader per FORMAT is a different
 * thing, but only while somebody can show they still agree. This is that.
 *
 * The workbooks live on the boat's OneDrive rather than in the repo, so it is a
 * script rather than a suite — the same arrangement as the market previews.
 */
import { readFileSync, existsSync } from 'node:fs'
import { parseTallyPdfPages } from '../src/lib/market/parseTallyPdf.js'
import { parseDayTally } from '../src/lib/market/parseDayTally.js'

const [pdfPath, xlsxPath] = process.argv.slice(2)
if (!pdfPath || !xlsxPath) {
  console.error('usage: node scripts/tally-two-readers.mjs <tally.pdf> <tally.xlsx>')
  process.exit(2)
}
for (const f of [pdfPath, xlsxPath]) {
  if (!existsSync(f)) { console.error(`not found: ${f}`); process.exit(2) }
}

/* The legacy build, because this runs under node rather than in the app. */
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(pdfPath)), verbosity: 0 }).promise
const pages = []
for (let p = 1; p <= doc.numPages; p++) {
  const tc = await (await doc.getPage(p)).getTextContent()
  pages.push(tc.items.map(i => ({ x: i.transform[4], y: i.transform[5], s: i.str })))
}

const fromPdf = parseTallyPdfPages(pages)
const fromXlsx = await parseDayTally(new Uint8Array(readFileSync(xlsxPath)))

let fails = 0
const must = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++ }

console.log(`PDF  : ${fromPdf.lines.length} lines · ${fromPdf.total} boxes · printed ${fromPdf.printedTotal} · reconciles ${fromPdf.reconciles}`)
console.log(`XLSX : ${fromXlsx.lines.length} lines · ${fromXlsx.total} boxes · printed ${fromXlsx.printedTotal} · reconciles ${fromXlsx.reconciles}\n`)

must(fromPdf.reconciles, 'the PDF reconciles to its own grand total')
must(fromXlsx.reconciles, 'and so does the workbook')
must(fromPdf.total === fromXlsx.total, `both read ${fromPdf.total} boxes`)

/* KEYED ON SPECIES + GRADE + DAY BAND, which is what a line IS. Comparing the
   arrays in order would fail on a difference in row ordering that means
   nothing, and pass over a figure on the wrong rung, which means everything. */
const index = (ls) => {
  const m = new Map()
  for (const l of ls) {
    const k = `${l.species}|${l.grade}|${l.dayLabel}`
    m.set(k, (m.get(k) || 0) + l.boxes)
  }
  return m
}
const A = index(fromPdf.lines), B = index(fromXlsx.lines)
const keys = [...new Set([...A.keys(), ...B.keys()])].sort()
const bad = keys.filter(k => (A.get(k) || 0) !== (B.get(k) || 0))
must(bad.length === 0, `all ${keys.length} species/grade/day keys agree`)
for (const k of bad.slice(0, 20)) console.log(`       ${k}  pdf=${A.get(k) ?? '-'}  xlsx=${B.get(k) ?? '-'}`)

/* The tag colour is read off each document rather than derived from the day
   number — day 4 is ORANGE in the old ten-colour table and PURPLE in the four
   PPA bands, so deriving it mis-colours three bands in four. */
const tags = (ls) => Object.fromEntries([...new Set(ls.map(l => l.dayLabel))]
  .map(d => [d, ls.find(l => l.dayLabel === d)?.tagName]))
const ta = tags(fromPdf.lines), tb = tags(fromXlsx.lines)
must(JSON.stringify(ta) === JSON.stringify(tb),
  `the tag colours agree: ${Object.entries(ta).map(([d, t]) => `${d}=${t}`).join(' ')}`)

console.log(`\n${fails ? `${fails} CHECK(S) FAILED` : 'the two readers agree'}`)
process.exit(fails ? 1 : 0)
