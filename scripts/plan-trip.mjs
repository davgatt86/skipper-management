/* End-to-end: a real day tally through the real parser and the real allocator,
 * printed as the market plan. Nothing here is a mock — if this looks wrong, the
 * page will be wrong in the same way.
 *
 *   node scripts/plan-trip.mjs "path/to/day tally.xlsx"
 */
import { readFileSync } from 'node:fs'
import { parseDayTally } from '../src/lib/market/parseDayTally.js'
import { planLayout } from '../src/lib/market/planLayout.js'
import { TOP_ROW, BOTTOM_ROW } from '../src/lib/market/layoutRules.js'

const file = process.argv[2]
const parsed = parseDayTally(readFileSync(file))
if (parsed.error) { console.error(parsed.error); process.exit(1) }

console.log(`sheet            ${parsed.sheetName}`)
console.log(`port / gear      ${parsed.meta.port || '?'} / ${parsed.meta.gear || '?'} (${parsed.meta.kind || '?'})`)
console.log(`days on the tag  ${parsed.days.join(', ')}`)
console.log(`boxes parsed     ${parsed.total}`)
console.log(`sheet's own total${parsed.printedTotal == null ? '  (not printed)' : ' ' + parsed.printedTotal +
  (parsed.reconciles ? '  ✓ agrees' : '  ✗ DOES NOT AGREE')}`)
console.log('')

const plan = planLayout(parsed.lines)
console.log(`tiers needed     ${plan.tiers}`)
console.log(`÷94 rule asks    ${plan.ruleOfThumb}`)
console.log(`footprints       ${plan.footprints}   of ${plan.tiers * (TOP_ROW + BOTTOM_ROW)} available`)
console.log(`top row used     ${plan.rows.top.length} / ${plan.tiers * TOP_ROW}`)
console.log(`bottom row used  ${plan.rows.bottom.length} / ${plan.tiers * BOTTOM_ROW}`)
console.log('')
console.log('auctions:')
for (const a of plan.auctionSpans) {
  console.log(`  ${a.n}. ${a.label.padEnd(18)} ${String(a.boxes).padStart(4)} boxes   tiers ${a.from}–${a.to}`)
}
if (plan.warnings.length) { console.log(''); for (const w of plan.warnings) console.log('  ! ' + w) }

console.log('')
console.log('first three tiers:')
const label = (s) => `${s.species} ${s.grade} d${s.parts.map((p) => p.day).join('/')} x${s.boxes}`
for (const t of plan.byTier.slice(0, 3)) {
  console.log(`  TIER ${t.tier}`)
  console.log(`    top   (${t.top.length}/${TOP_ROW})  ` + (t.top.slice(0, 4).map(label).join(' | ') || '—') + (t.top.length > 4 ? ' …' : ''))
  console.log(`    bottom(${t.bottom.length}/${BOTTOM_ROW})  ` + (t.bottom.slice(0, 4).map(label).join(' | ') || '—') + (t.bottom.length > 4 ? ' …' : ''))
}

// The check that matters: nothing lost, nothing over-stacked.
const placed = [...plan.rows.top, ...plan.rows.bottom]
const boxesPlaced = placed.reduce((s, x) => s + x.boxes, 0)
console.log('')
console.log(`boxes placed     ${boxesPlaced}  ${boxesPlaced === parsed.total ? '✓ matches the tally' : '✗ LOST BOXES'}`)
console.log(`over-stacked     ${placed.filter((s) => s.boxes > s.height).length}  (must be 0)`)
