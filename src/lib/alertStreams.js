/* Which of the two alert streams a row belongs to.
 *
 * There are two, and the split is the whole reason the Alerts page is usable:
 * measured Aug 2026 there were 4,781 live price alerts against 2 expiries. In
 * one feed a passport expiry is buried by lunchtime.
 *
 * DEFINED AS AN ALLOW-LIST OF MARKET TYPES, deliberately — everything else is
 * vessel & crew. The other way round is exactly how this went wrong once
 * already: the stream test was a list of the three COMPLIANCE types, the
 * activity alerts (log_engine, log_garbage, log_fuel, log_crewlist) were added
 * to the database months later, matched nothing, and fell through to Market.
 * "Clear price alerts" would then have swept a quiet Garbage Record Book away
 * with the board prices — and a Garbage Record Book entry is a legal record.
 *
 * So an alert type nobody has classified lands in the stream that is never
 * bulk-cleared. Same principle as accessForPath in nav.js: an unlisted thing
 * fails towards the safer side.
 */

export const MARKET_TYPES = ['daily', 'fourweek', 'pd_dk', 'own_spike', 'forecast']

export const isMarket = (a) => MARKET_TYPES.includes(a?.type)
export const isCompliance = (a) => !isMarket(a)

export function splitStreams(rows) {
  const all = rows || []
  return { compliance: all.filter(isCompliance), market: all.filter(isMarket) }
}
