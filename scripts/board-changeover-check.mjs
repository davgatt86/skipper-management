/* DOES THE BOARD STILL READ ACROSS THE LADDER CHANGE? Run against the REAL
 * Peterhead rows, 15-09 to 21-10-2026, straight out of `market_prices`.
 *
 * The page is behind a login and nothing in the repo tested `marketAgg` at
 * all, so this is the only thing that proves the day-on-day and four-week
 * columns survived 21 October. Before the bridge every new-ladder row had
 * both of them null, because its key did not exist the day before.
 *
 *   node scripts/board-changeover-check.mjs <rows.json|tool-result.txt>
 */
import { readFileSync } from 'node:fs'
import { buildBoard } from '../src/lib/market/marketAgg.js'
import { seriesFit } from '../src/lib/market/legacyGrades.js'

/* UNWRAPPING WHATEVER THE ROWS ARRIVED IN. A plain `[...]` of rows works, and
 * so does a saved MCP tool result — which is a JSON object whose `result` is a
 * STRING of prose with the real JSON inside it, itself wrapped in the query's
 * own column. Each layer is peeled rather than pattern-matched out, so a
 * change in the prose cannot quietly produce the wrong array. */
function loadRows(path) {
  let text = readFileSync(path, 'utf8')
  try {
    const outer = JSON.parse(text)
    if (outer && typeof outer.result === 'string') text = outer.result
  } catch { /* not a tool result; treat as plain JSON below */ }
  const open = text.indexOf('[')
  const close = text.lastIndexOf(']')
  if (open < 0 || close < open) throw new Error('no JSON array in ' + path)
  let data = JSON.parse(text.slice(open, close + 1))
  /* `json_agg(...) as rows` lands as [{ rows: [...] }]. */
  if (data.length === 1 && !data[0].species) {
    const inner = Object.values(data[0]).find((v) => Array.isArray(v))
    if (inner) data = inner
  }
  if (!data.length || !data[0].species) throw new Error('no board rows in ' + path)
  return data
}
const rows = loadRows(process.argv[2])

const board = buildBoard(rows, 'PD')
console.log(`rows ${rows.length} · board date ${board.date} · lines ${board.items.length}\n`)

const w = (s, n) => String(s ?? '').padEnd(n)
const f = (v) => (v == null ? '  —  ' : (v > 0 ? '+' : '') + v.toFixed(2))
console.log(`${w('species', 10)}${w('grade', 16)}${w('ave', 8)}${w('vs day', 8)}${w('vs 4wk', 8)}join`)
for (const it of board.items)
  console.log(`${w(it.species, 10)}${w(it.grade, 16)}${w(it.ave?.toFixed(2), 8)}${w(f(it.dDay), 8)}${w(f(it.d4wk), 8)}${it.fit}`)

const lost = board.items.filter((i) => i.dDay == null)
const blind = board.items.filter((i) => i.d4wk == null)
console.log(`\nno day-on-day: ${lost.length} of ${board.items.length}`
  + (lost.length ? ' — ' + lost.map((i) => `${i.species} ${i.grade}`).join(', ') : ''))
console.log(`no four-week : ${blind.length} of ${board.items.length}`
  + (blind.length ? ' — ' + blind.map((i) => `${i.species} ${i.grade}`).join(', ') : ''))

/* What the old key would have managed, for comparison — this is the number
   the bridge exists to move. */
const naive = new Set(rows.filter((r) => r.price_date < board.date)
  .map((r) => `${r.species}|${r.grade}${r.subgrade ? ' ' + r.subgrade : ''}`))
const wouldHave = board.items.filter((i) => {
  const today = rows.filter((r) => r.price_date === board.date && r.species === i.species)
  return today.some((r) => naive.has(`${r.species}|${r.grade}${r.subgrade ? ' ' + r.subgrade : ''}`))
})
console.log(`\nkeyed the old way, ${wouldHave.length} of ${board.items.length} lines`
  + ' would have had any history at all')

const byFit = {}
for (const i of board.items) byFit[i.fit] = (byFit[i.fit] || 0) + 1
console.log('joins:', JSON.stringify(byFit))
