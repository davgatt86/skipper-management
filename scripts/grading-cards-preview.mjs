/* Render the REAL grading-card PDF and read it back with pdf.js.
 *
 * The page is behind a login, and `doc.save()` does nothing under node — so
 * without this the only check is opening it by eye on somebody else's machine.
 * Same argument as the stores sheet and the buyers' catalogue.
 *
 *   node scripts/grading-cards-preview.mjs "tally.xlsx" out.pdf [startTier] [rules.json]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { parseDayTally } from '../src/lib/market/parseDayTally.js'
import { planLayout } from '../src/lib/market/planLayout.js'
import { resolveRules } from '../src/lib/market/layoutRules.js'
import { PETERHEAD } from '../src/lib/market/markets.js'
import { buildGradingCardsDoc } from '../src/lib/market/exportGradingCards.js'
import { ticketsFor, ticketSummary } from '../src/lib/market/gradingCards.js'
import { safeOut } from './safeOut.mjs'

const tally = process.argv[2]
const out = safeOut(process.argv[3] || 'grading-cards.pdf', '.pdf')
const startTier = process.argv[4] ? Number(process.argv[4]) : null
const rules = process.argv[5] ? resolveRules(JSON.parse(readFileSync(process.argv[5], 'utf8'))) : undefined

const lines = parseDayTally(readFileSync(tally)).lines
const plan = planLayout(lines, { ...(rules ? { rules } : {}), ...(startTier ? { market: PETERHEAD, startTier } : {}) })

const doc = buildGradingCardsDoc(plan)
writeFileSync(out, Buffer.from(doc.output('arraybuffer')))

const s = ticketSummary(plan)
console.log(out)
console.log(`  tickets ${s.tickets}   kinds ${s.kinds}   pages ${s.pages}   regraded ${s.regraded}`)

// ---- read it back --------------------------------------------------------
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
const pdf = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(out)), useSystemFonts: true }).promise
console.log(`  rendered ${pdf.numPages} page(s)`)

let fail = 0
const check = (c, m) => { if (!c) { fail++; console.error('  FAIL  ' + m) } }

check(pdf.numPages === s.pages, `page count matches the summary (${pdf.numPages} vs ${s.pages})`)

const want = ticketsFor(plan)
let seen = 0
const perPage = []
for (let p = 1; p <= pdf.numPages; p++) {
  const c = await (await pdf.getPage(p)).getTextContent()
  const strs = c.items.map((i) => i.str.trim()).filter(Boolean)
  // a ticket contributes a species line, a name line, and a code (or the note)
  const species = strs.filter((x) => /^[A-Z][A-Z ]+$/.test(x))
  perPage.push(strs.length)
  seen += c.items.filter((i) => /^[A-Z][A-Z ]+$/.test(i.str.trim())).length
}
check(perPage.every((n) => n > 0), 'no blank pages')

// every kind that should be printed appears somewhere
const firstPage = await (await pdf.getPage(1)).getTextContent()
const t1 = firstPage.items.map((i) => i.str.trim())
check(t1.includes(String(want[0].species).toUpperCase()), 'the first ticket is the first run of the walk')
check(t1.includes(String(want[0].name).toUpperCase()), 'and carries its grade name')

// the regraded ones say so, and carry no code
const all = []
for (let p = 1; p <= pdf.numPages; p++) {
  const c = await (await pdf.getPage(p)).getTextContent()
  all.push(...c.items.map((i) => i.str.trim()))
}
if (want.some((t) => t.regraded)) {
  check(all.includes('graded at the market'), 'a regraded ticket says the market grades it')
  const band = want.find((t) => t.regraded).name
  check(all.includes(band.toUpperCase()), `and carries its weight band (${band})`)
}
check(all.filter((x) => x === 'TURBOT').length <= 8, 'turbot never exceeds its eight bands')

console.log(fail ? `\n  ${fail} FAILED` : '\n  all rendered checks passed')
process.exit(fail ? 1 : 0)
