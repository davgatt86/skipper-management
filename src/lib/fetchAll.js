import { supabase } from '../supabaseClient'

/* Read a whole table, not the first page of it.
 *
 * SUPABASE CAPS A SINGLE REST RESPONSE AT 1,000 ROWS, and it does not report
 * that it has done so — you get 1,000 rows and no error. On a table with 8,067
 * sales rows that is a silently wrong answer, which is the worst kind.
 *
 * It has bitten twice already. Buyer League showed a single buyer because there
 * were too few complete species/grade/days left in the truncated set to find a
 * market, and Landings vs Settlements showed nothing at all because each
 * landing's value came out a fraction of its real size and the solver rejected
 * every arrangement as implausible. Neither page raised an error.
 *
 * Sales.jsx, SalesCompare.jsx and SalesInsights.jsx each carry their own copy
 * of this loop. This is the shared one; prefer it for anything new.
 *
 * `build` receives a fresh query builder so filters and ordering are applied to
 * every page, not just the first.
 */
const PAGE = 1000

export async function fetchAll(table, select = '*', build) {
  const out = []
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(table).select(select)
    if (build) q = build(q)
    const { data, error } = await q.range(from, from + PAGE - 1)
    if (error) return { data: null, error }
    out.push(...(data || []))
    // A short page means the end. An exactly-full page might be the end too,
    // so the next round trip returning nothing is what actually stops it.
    if (!data || data.length < PAGE) break
    // A runaway guard: something is wrong if a fleet has this many rows, and
    // an infinite loop on a boat's phone is worse than a truncated answer.
    if (out.length > 500000) break
  }
  return { data: out, error: null }
}
