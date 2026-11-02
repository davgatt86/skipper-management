/* UK QUOTA SWAPS — the pure half of /quota-swaps.
 *
 * The data is the Marine Directorate's weekly quota uptake report (forwarded by
 * the SWFPA), worked into weekly swaps by the Claude scheduled task and loaded
 * into `quota_swaps_data` one (dataset, year) at a time. Nothing here touches
 * the database; the page fetches, these functions shape.
 *
 * THE REPORT NEVER SAYS WHO TRADED WITH WHOM. It gives each group's net change
 * in "Change in year" each week. The `pairs` dataset is therefore an INFERENCE,
 * and every row carries how sure it is:
 *   Certain  — one side of that stock-week had a single group
 *   Likely   — a giver's and a receiver's tonnage matched exactly
 *   Estimate — the rest, split in proportion
 * "International" is the UK TOTAL line: the UK's net swap with other countries.
 * The page must never show an Estimate as if it were a fact, so the confidence
 * travels with every figure built from pairs.
 */

export const ALL = 'All'
export const isAll = (v) => v == null || v === '' || v === ALL

export const CONFIDENCE = ['Certain', 'Likely', 'Estimate']
// The "show" filter on the PO-to-PO grid: how sure a match has to be to count.
export const SHOW = {
  all: ['Certain', 'Likely', 'Estimate'],
  sure: ['Certain', 'Likely'],
  certain: ['Certain'],
}

/* The year/month/stock/po filter shared by every tab. A dataset that has no
 * `month` (balances, run-out, flex) is not narrowed by month — those are
 * positions at the latest report, not weekly rows. */
export function applyFilters(rows, { month, stock, po } = {}, opts = {}) {
  if (!Array.isArray(rows)) return []
  return rows.filter((r) =>
    (opts.month === false || isAll(month) || r.month == null || r.month === month)
    && (opts.stock === false || isAll(stock) || r.stock === stock)
    && (opts.po === false || isAll(po) || r.po === po))
}

/* Sort a copy. Nulls last whichever way, so a stock with no quota never floats
 * to the top of a "most used" sort. */
export function sortRows(rows, key, dir = 1) {
  return rows.slice().sort((a, b) => {
    const x = a[key], y = b[key]
    if (x == null && y == null) return 0
    if (x == null) return 1
    if (y == null) return -1
    return (x < y ? -1 : x > y ? 1 : 0) * dir
  })
}

/* WHO GAVE TO WHOM. Sums the inferred deals into a giver x receiver grid for
 * the month/stock picked, counting only the confidence levels asked for.
 * With a PO picked, only that PO's row and column are kept: what it gave and
 * who to, what it got and who from. */
export function pairMatrix(pairs, { month, stock, po, show = 'all' } = {}) {
  const allow = SHOW[show] || SHOW.all
  const cell = new Map(), given = new Map(), got = new Map()
  for (const p of pairs || []) {
    if (!allow.includes(p.confidence)) continue
    if (!isAll(month) && p.month !== month) continue
    if (!isAll(stock) && p.stock !== stock) continue
    if (!isAll(po) && p.from_po !== po && p.to_po !== po) continue
    const k = p.from_po + '\u0000' + p.to_po
    cell.set(k, (cell.get(k) || 0) + p.tonnes)
    given.set(p.from_po, (given.get(p.from_po) || 0) + p.tonnes)
    got.set(p.to_po, (got.get(p.to_po) || 0) + p.tonnes)
  }
  const byDesc = (m) => [...m.keys()].sort((a, b) => m.get(b) - m.get(a))
  const givers = byDesc(given), receivers = byDesc(got)
  let max = 0
  for (const v of cell.values()) if (v > max) max = v
  return {
    givers, receivers, max,
    at: (g, r) => cell.get(g + '\u0000' + r) || 0,
    given: (g) => given.get(g) || 0,
    got: (r) => got.get(r) || 0,
    total: [...given.values()].reduce((a, b) => a + b, 0),
  }
}

/* The deals behind one box of the grid, newest first. */
export function dealsFor(pairs, { month, stock, po, from, to, show = 'all' } = {}) {
  const allow = SHOW[show] || SHOW.all
  return (pairs || []).filter((p) => allow.includes(p.confidence)
    && (isAll(month) || p.month === month)
    && (isAll(stock) || p.stock === stock)
    && (isAll(po) || p.from_po === po || p.to_po === po)
    && (!from || p.from_po === from)
    && (!to || p.to_po === to))
}

/* HOW EACH GROUP'S SWAPS BUILT UP THROUGH THE YEAR, for one stock.
 *
 * `weekly` rows carry `ytd_t` — the group's net swaps so far — at every report
 * where it CHANGED, so the line is a step: flat until the next change. The UK
 * line comes from `intl_weekly.intl_ytd_t` the same way. Every report date of
 * the year is a point, with the last known value carried forward, so lines that
 * change in different weeks still share one x-axis.
 *
 * Only the `top` groups by largest swing are kept — fifteen lines is a hairball.
 */
export function stockSeries({ weekly, intlWeekly, periods, stock, top = 8 }) {
  const dates = [...new Set((periods || []).map((p) => p.date))].sort()
  if (!stock || isAll(stock) || !dates.length) return { data: [], keys: [] }
  const byPo = new Map()
  for (const r of weekly || []) {
    if (r.stock !== stock) continue
    if (!byPo.has(r.po)) byPo.set(r.po, new Map())
    byPo.get(r.po).set(r.date, r.ytd_t)
  }
  const swing = (m) => Math.max(...[...m.values()].map((v) => Math.abs(v)))
  const keys = [...byPo.keys()].sort((a, b) => swing(byPo.get(b)) - swing(byPo.get(a))).slice(0, top)
  const uk = new Map()
  for (const r of intlWeekly || []) if (r.stock === stock) uk.set(r.date, r.intl_ytd_t)
  const hasUk = uk.size > 0
  const last = Object.fromEntries(keys.map((k) => [k, 0]))
  let lastUk = 0
  const data = dates.map((d) => {
    const row = { date: d }
    for (const k of keys) {
      const v = byPo.get(k).get(d)
      if (v != null) last[k] = v
      row[k] = last[k]
    }
    if (hasUk) { const v = uk.get(d); if (v != null) lastUk = v; row['UK international'] = lastUk }
    return row
  })
  return { data, keys, hasUk }
}

/* Used share of quota → the app's three signal colours. */
export function usedTone(u) {
  if (u == null) return null
  if (u > 0.9) return 'rust'
  if (u >= 0.75) return 'brass'
  return 'kelp'
}

/* Run-out status order for sorting: the short ones first. */
export const STATUS_ORDER = { Short: 0, Tight: 1, OK: 2 }

/* Every report month of a year, newest first, for the Month filter. */
export function monthsOf(periods, year) {
  return [...new Set((periods || []).filter((p) => p.year === year).map((p) => p.month))].sort().reverse()
}

export const t1 = (v) => (v == null || Number.isNaN(v) ? '—'
  : Number(v).toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 }))
export const t2 = (v) => (v == null || Number.isNaN(v) ? '—'
  : Number(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
export const pct = (v) => (v == null ? '' : Math.round(v * 100) + '%')
export const fmtDay = (iso) => {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00Z')
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}
export const fmtMonth = (ym) => {
  if (!ym || isAll(ym)) return 'All months'
  const d = new Date(ym + '-01T00:00:00Z')
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}
