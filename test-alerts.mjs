/* The alert page's two streams.
 *
 * Worth a test of its own because the classification had a real bug in it: it
 * listed the three COMPLIANCE types and treated everything else as market, so
 * the activity alerts added months later (log_engine, log_garbage, log_fuel,
 * log_crewlist) fell into the price stream — where "Clear price alerts" would
 * have dismissed a quiet Garbage Record Book along with the board prices.
 */
import { splitStreams, isMarket, isCompliance, MARKET_TYPES } from './src/lib/alertStreams.js'

let fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

// Every type currently in the alerts table, plus one that does not exist yet.
const rows = [
  { id: 1, type: 'daily' }, { id: 2, type: 'fourweek' }, { id: 3, type: 'pd_dk' },
  { id: 4, type: 'own_spike' }, { id: 5, type: 'forecast' },
  { id: 6, type: 'crew_passport' }, { id: 7, type: 'crew_cert' }, { id: 8, type: 'vessel_cert' },
  { id: 9, type: 'crew_bonus' },
  { id: 10, type: 'log_engine' }, { id: 11, type: 'log_fuel' },
  { id: 12, type: 'log_garbage' }, { id: 13, type: 'log_crewlist' },
  { id: 14, type: 'something_invented_next_year' },
]
const { compliance, market } = splitStreams(rows)

eq('the five price types are the market stream', market.map(r => r.type), MARKET_TYPES)
eq('and nothing else is', market.length, 5)

// The bug, asserted directly: these are legal records and operational chases,
// and they must never sit where a bulk clear can reach them.
for (const t of ['log_engine', 'log_fuel', 'log_garbage', 'log_crewlist']) {
  eq(`${t} is NOT a price alert`, isMarket({ type: t }), false)
}
eq('a bonus falling due is not a price alert', isMarket({ type: 'crew_bonus' }), false)
eq('expiries are vessel & crew', compliance.map(r => r.type).includes('vessel_cert'), true)

// The direction an unknown type fails in is the point of the allow-list.
eq('an alert type nobody has classified yet is NOT swept up by "clear prices"',
  isCompliance({ type: 'something_invented_next_year' }), true)
eq('a missing type is handled', [isMarket({}), isMarket(null)], [false, false])

// Clearing one stream must never touch the other.
const afterClear = rows.filter(isCompliance)
eq('clearing prices leaves every expiry and logbook standing', afterClear.length, 9)
eq('and takes exactly the five price rows', rows.length - afterClear.length, 5)

eq('an empty table is handled', splitStreams([]).market.length, 0)
eq('and so is nothing at all', splitStreams(null).compliance.length, 0)

console.log('')
console.log(fail === 0 ? 'all passed' : `${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
