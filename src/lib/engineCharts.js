/* Deciding how many charts a selection needs, and which series go on each.
 *
 * THE PROBLEM: a group like Main Engine 1 carries RPM around 750, exhaust
 * temperatures around 400, pressures between 2 and 6, and running hours in the
 * tens of thousands. Drawn on one axis, the pressures are a flat line on the
 * floor and the whole chart is really just a picture of running hours. That is
 * worse than no chart, because it looks like information.
 *
 * THE RULE, in two steps:
 *   1. Split by UNIT first. Bar and °C do not belong on the same axis whatever
 *      their numbers say, and the unit is the engineer's own way of grouping.
 *   2. Then split again inside a unit when the magnitudes are far apart — a
 *      20°C intake and a 400°C exhaust are both °C and still cannot share an
 *      axis usefully.
 *
 * Series with no readings at all are dropped and reported separately, so the
 * picker can grey them out rather than drawing an empty chart.
 */

// How many times bigger the largest typical value may be than the smallest
// before they are pulled apart. Set from the real case that prompted this: a
// 22°C intake against a 400°C exhaust is 18x and unreadable together, while a
// 90°C jacket against the same exhaust is 4.4x and perfectly fine. 10x sits
// between them, so it splits the first and keeps the second.
export const SPREAD_LIMIT = 10

const median = (xs) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/* Typical magnitude of each series, ignoring blanks. Median rather than mean so
 * one mis-keyed reading — and this data has them, a Charge Air Pressure of 175
 * where the series runs 1.8–2.3 — cannot drag a series into its own chart. */
export function seriesMagnitudes(keys, rows) {
  const out = {}
  for (const k of keys) {
    const vals = (rows || [])
      .map((r) => Number(r[k]))
      .filter((n) => Number.isFinite(n))
    out[k] = { n: vals.length, median: median(vals.map(Math.abs).filter((v) => v > 0)) }
  }
  return out
}

/* → { charts: [{ id, unit, band, keys }], empty: [keys with no data] } */
export function splitCharts(params, rows, opts = {}) {
  const spread = opts.spreadLimit || SPREAD_LIMIT
  const mags = seriesMagnitudes(params.map((p) => p.key), rows)

  const withData = params.filter((p) => mags[p.key].n > 0)
  const empty = params.filter((p) => mags[p.key].n === 0).map((p) => p.key)

  // 1. by unit — an unlabelled unit is its own bucket rather than being lumped
  //    in with something it has no relation to.
  const byUnit = new Map()
  for (const p of withData) {
    const u = p.unit || ''
    if (!byUnit.has(u)) byUnit.set(u, [])
    byUnit.get(u).push(p)
  }

  const charts = []
  for (const [unit, group] of byUnit) {
    // A series whose median is zero or unknown carries no scale information;
    // keep it with the smallest band rather than giving it a chart of its own.
    const scaled = group.map((p) => ({ p, m: mags[p.key].median || 0 }))
    const positive = scaled.filter((x) => x.m > 0).map((x) => x.m)

    if (positive.length < 2 || Math.max(...positive) / Math.min(...positive) <= spread) {
      charts.push({ id: `${unit || 'plain'}`, unit, band: null, keys: group.map((p) => p.key) })
      continue
    }

    // 2. same unit, magnitudes too far apart: band by order of magnitude, then
    //    merge neighbouring bands that are actually close, so 380°C and 420°C
    //    do not end up on separate charts just for straddling a power of ten.
    const bands = new Map()
    for (const { p, m } of scaled) {
      const b = m > 0 ? Math.floor(Math.log10(m)) : -Infinity
      if (!bands.has(b)) bands.set(b, [])
      bands.get(b).push(p)
    }
    const ordered = [...bands.entries()].sort((a, b) => a[0] - b[0])
    let run = null
    for (const [b, ps] of ordered) {
      if (run && b - run.hi <= 0) run.keys.push(...ps.map((p) => p.key))
      else if (run && b - run.hi === 1 && spreadOf(run.keys.concat(ps.map((p) => p.key)), mags) <= spread) {
        run.keys.push(...ps.map((p) => p.key)); run.hi = b
      } else {
        run = { id: `${unit || 'plain'}-${b}`, unit, band: b, hi: b, keys: ps.map((p) => p.key) }
        charts.push(run)
      }
    }
  }

  // Biggest charts first — the one with most series is usually the one wanted.
  charts.sort((a, b) => b.keys.length - a.keys.length)
  return { charts: charts.map(({ id, unit, band, keys }) => ({ id, unit, band, keys })), empty }
}

function spreadOf(keys, mags) {
  const ms = keys.map((k) => mags[k]?.median).filter((m) => m > 0)
  if (ms.length < 2) return 1
  return Math.max(...ms) / Math.min(...ms)
}

/* A title that says what the chart holds without repeating the series names
 * already in the legend. */
export function chartTitle(chart, labelFor) {
  const unit = chart.unit ? chart.unit : 'unitless'
  if (chart.band === null) return unit === 'unitless' ? 'Readings' : `Readings in ${unit}`
  const lo = Math.pow(10, chart.band)
  return `${unit === 'unitless' ? 'Readings' : unit} — around ${lo >= 1 ? lo.toLocaleString('en-GB') : lo}${labelFor ? '' : ''}`
}
