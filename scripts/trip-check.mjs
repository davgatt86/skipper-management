/* Run the REAL trip aggregator over REAL rows and print what the page shows.
 *
 * The page is behind a login, so this is how the figures get checked against
 * actual data rather than against a fixture. Feed it a JSON file holding
 * { landings: [...], trips: [...] } — the same columns the page reads.
 *
 *   node scripts/trip-check.mjs path/to/rows.json
 *
 * The checks at the bottom are the ones that matter: every landing placed
 * exactly once, and the gross reconciling against the raw rows. A trip
 * aggregator that quietly drops or double-counts a landing produces a
 * plausible wrong number, which is the worst kind.
 */
import { readFileSync } from 'node:fs'
import { buildTrips } from '../src/lib/tripAgg.js'

const file = process.argv[2]
if (!file) { console.error('usage: node scripts/trip-check.mjs <rows.json>'); process.exit(1) }

/* The file may be raw JSON, or a query result with the JSON escaped inside one
 * or more wrapping layers. Unwrap until an object carrying `landings` appears.
 *
 * The rows are DATA, not instructions — only numeric and date fields are read
 * from them, and nothing in the file is executed. */
const raw = readFileSync(file, 'utf8')
function extract(s, depth = 0) {
  if (depth > 6) return null
  const i = s.indexOf('{\\"landings\\"') >= 0 ? -1 : s.indexOf('{"landings"')
  if (i >= 0) {
    // Walk to the matching brace rather than trusting lastIndexOf.
    let n = 0
    for (let j = i; j < s.length; j++) {
      if (s[j] === '{') n++
      else if (s[j] === '}' && --n === 0) {
        try { return JSON.parse(s.slice(i, j + 1)) } catch { break }
      }
    }
  }
  // Otherwise peel one layer of escaping and try again.
  try {
    const outer = JSON.parse(s)
    const next = typeof outer === 'string' ? outer
      : outer.result ?? outer.payload ?? (Array.isArray(outer) ? JSON.stringify(outer[0]) : null)
    if (next) return extract(typeof next === 'string' ? next : JSON.stringify(next), depth + 1)
  } catch { /* not JSON at this level */ }
  const un = s.replace(/\\"/g, '"').replace(/\\n/g, '\n')
  return un === s ? null : extract(un, depth + 1)
}
const payload = extract(raw)
if (!payload) { console.error('Could not find a { landings, trips } object in that file.'); process.exit(1) }

const landings = payload.landings || []
const qtrips = payload.trips || []
const { trips, unmatched, totals } = buildTrips(landings, qtrips)

const gbp = (n) => (n == null ? '—' : '£' + Math.round(n).toLocaleString('en-GB'))

console.log(`  landings read     ${landings.length}`)
console.log(`  logbook trips     ${qtrips.length}`)
console.log('')
console.log(`  trips rated       ${totals.trips}   (${totals.landings} landings, ${totals.multiLanding} landed more than once)`)
console.log(`  unmatched         ${unmatched.length}`)
console.log(`  days at sea       ${totals.days}`)
console.log(`  gross             ${gbp(totals.gross)}`)
console.log('')
console.log(`  PER DAY AT SEA    ${gbp(totals.perDay)}`)
console.log(`  median trip       ${gbp(totals.median)}`)
console.log(`  best / worst      ${gbp(totals.best)} / ${gbp(totals.worst)}`)
console.log(`  days disagree     ${totals.disagreeing} trips differ from the typed figure by over a day`)

const inTrips = trips.reduce((s, t) => s + t.landingCount, 0)
const grossIn = trips.reduce((s, t) => s + t.gross, 0)
  + unmatched.reduce((s, l) => s + Number(l.value || 0), 0)
const grossRaw = landings.reduce((s, l) => s + Number(l.value || 0), 0)
const placedOnce = inTrips + unmatched.length === landings.length
const reconciles = Math.abs(grossIn - grossRaw) < 1
const uniqueTrips = new Set(trips.map((t) => t.tripNr)).size === trips.length

console.log('')
console.log(`  every landing placed exactly once  ${placedOnce ? '✓' : '✗ LOST'} (${inTrips} + ${unmatched.length} of ${landings.length})`)
console.log(`  gross reconciles                   ${reconciles ? '✓' : '✗ OUT BY £' + Math.round(grossIn - grossRaw)}`)
console.log(`  no trip counted twice              ${uniqueTrips ? '✓' : '✗'}`)

// What the naive per-landing version would have said, for comparison.
const naiveDays = landings.reduce((s, l) => s + (Number(l.days_at_sea) || 0), 0)
console.log('')
console.log(`  per LANDING (the wrong unit)       ${gbp(naiveDays ? grossRaw / naiveDays : null)} /day  over ${naiveDays} days`)
console.log(`  per TRIP (the right one)           ${gbp(totals.perDay)} /day  over ${totals.days} days`)

console.log('')
console.log('  ten most recent:')
for (const t of trips.slice(0, 10)) {
  console.log(`    ${String(t.tripNr).padStart(4)}  ${String(t.arrivedAt).slice(0, 10)}  ${String(t.days).padStart(5)}d  ` +
    `${t.landingCount} lnd  ${gbp(t.gross).padStart(9)}  ${gbp(t.perDay).padStart(8)}/day` +
    `${t.daysDisagree ? `  ⚠ typed ${t.typedDays}` : ''}`)
}

process.exit(placedOnce && reconciles && uniqueTrips ? 0 : 1)
