// Quota position maths.
//
// Two sources, one engine — every row is an anchor figure plus the
// catch that's come off since the anchor's date:
//   AFPO row    anchor = statement balance, as of last-landing date
//   Manual row  anchor = the PO's figure typed in, as of its own date
//               (a season-start allocation is just an anchor dated 1 Jan)
//
// Estimated now = anchor, minus logbook catch from trips that LANDED
// after the anchor date (catch rows year-filtered by catch_date, so
// year-straddling trips book to both years correctly), minus typed
// catches, plus/minus typed leases, plus what-if adjustments.
// Trip arrival (not catch date) decides whether the PO has seen the
// trip, because POs book per landing — a trip landed after the
// statement may still hold catches dated before it.
import { mapStock, FAO_NAMES } from './stockMap.js'
import { sectionOfStock } from './stockMaster.js'

export const r3 = n => Math.round(Number(n || 0) * 1000) / 1000

// snapshots (rows with lines attached) -> latest per year
export function latestSnapshotByYear(snapshots) {
  const out = {}
  for (const s of snapshots) {
    const cur = out[s.year]
    if (!cur || String(s.last_updated || '') > String(cur.last_updated || '')) out[s.year] = s
  }
  return out
}

// Build the position table for one year.
// trips: [{...trip, catches:[...]}]
// adjustments: what-if swaps & rentals [{stock, direction:'in'|'out', tonnes}]
// manualStocks: [{id, year, stock, section, anchor_t, anchor_date}]
// manualEntries: [{manual_stock_id, entry_date, kind, tonnes}]
export function buildPosition({ snapshot, trips, year, adjustments = [], manualStocks = [], manualEntries = [] }) {
  const cutoff = snapshot?.last_landing_date || null // 'YYYY-MM-DD'
  const byStock = {}   // stock -> { list: [{arrDate, eez, kg}], total_year_kg }
  const nonquota = {}  // species -> { kg, sinceKg }
  const unmapped = {}  // 'SPP / area' -> kg
  let sinceTrips = 0

  for (const t of trips || []) {
    const arrDate = (t.arrival_at || '').slice(0, 10)
    const afterStatement = cutoff ? arrDate > cutoff : true
    let touches = false
    for (const c of t.catches || []) {
      if ((c.catch_date || '').slice(0, 4) !== String(year)) continue
      const m = mapStock(c.species_fao, c.fao_area)
      if (m.kind === 'ignore') continue
      if (m.kind === 'nonquota') {
        const k = c.species_fao
        nonquota[k] = nonquota[k] || { kg: 0, sinceKg: 0 }
        nonquota[k].kg += c.live_kg
        if (afterStatement) nonquota[k].sinceKg += c.live_kg
        continue
      }
      if (m.kind === 'unmapped') {
        const k = `${c.species_fao} / ${c.fao_area}`
        unmapped[k] = (unmapped[k] || 0) + c.live_kg
        continue
      }
      touches = true
      const s = byStock[m.stock] = byStock[m.stock] || { list: [], total_year_kg: 0 }
      s.total_year_kg += c.live_kg
      s.list.push({ arrDate, eez: c.eez, kg: c.live_kg })
    }
    if (afterStatement && touches) sinceTrips++
  }

  // Logbook kg landed after a given cutoff date (null cutoff = all year)
  const sinceFor = (stock, cut) => {
    const s = byStock[stock]
    const out = { uk: 0, nor: 0 }
    if (!s) return out
    for (const c of s.list) {
      if (cut && !(c.arrDate > cut)) continue
      if (c.eez === 'NOR') out.nor += c.kg
      else out.uk += c.kg
    }
    return out
  }

  // Net what-if adjustment per stock (IN positive, OUT negative, tonnes)
  const adjByStock = {}
  for (const a of adjustments) {
    if (Number(a.year) !== Number(year)) continue
    adjByStock[a.stock] = (adjByStock[a.stock] || 0) + (a.direction === 'in' ? 1 : -1) * Number(a.tonnes || 0)
  }

  // Typed ledger per manual stock (tonnes), entries on/before anchor ignored
  const entriesByMs = {}
  for (const e of manualEntries) (entriesByMs[e.manual_stock_id] = entriesByMs[e.manual_stock_id] || []).push(e)
  const ledgerFor = (ms) => {
    const out = { catch_t: 0, lease_in_t: 0, lease_out_t: 0, counted: 0, total: 0 }
    for (const e of entriesByMs[ms.id] || []) {
      out.total++
      if (ms.anchor_date && !((e.entry_date || '') > ms.anchor_date)) continue
      out.counted++
      const t = Number(e.tonnes || 0)
      if (e.kind === 'catch') out.catch_t += t
      else if (e.kind === 'lease_in') out.lease_in_t += t
      else if (e.kind === 'lease_out') out.lease_out_t += t
    }
    return out
  }

  const rows = []
  const seen = new Set()
  const conflicts = []
  const afpoStocks = new Set((snapshot?.lines || []).map(l => l.stock))

  // 1. AFPO lines — authoritative where present
  for (const l of snapshot?.lines || []) {
    const s = sinceFor(l.stock, cutoff)
    seen.add(l.stock)
    const sinceT = (s.uk + s.nor) / 1000
    const adjT = adjByStock[l.stock] || 0
    rows.push({
      source: 'afpo',
      section: l.section,
      stock: l.stock,
      allocation: l.allocation,
      catch_uk: l.catch_uk,
      catch_nor: l.catch_nor,
      catch_total: l.catch_total,
      balance: l.balance,
      anchor_date: cutoff,
      since_uk_t: r3(s.uk / 1000),
      since_nor_t: r3(s.nor / 1000),
      since_t: r3(sinceT),
      man_t: 0,
      adj_t: r3(adjT),
      est_balance: l.balance != null ? r3(l.balance - sinceT + adjT) : null,
      fqa_units: l.fqa_units,
      total_year_kg: byStock[l.stock]?.total_year_kg || 0,
    })
  }

  // 2. Manual stocks — used where AFPO has no line for the year
  for (const ms of manualStocks) {
    if (Number(ms.year) !== Number(year)) continue
    if (afpoStocks.has(ms.stock)) { conflicts.push(ms.stock); continue }
    seen.add(ms.stock)
    const s = sinceFor(ms.stock, ms.anchor_date || null)
    const sinceT = (s.uk + s.nor) / 1000
    const led = ledgerFor(ms)
    const manT = led.lease_in_t - led.lease_out_t - led.catch_t
    const adjT = adjByStock[ms.stock] || 0
    const hasAnchor = ms.anchor_t != null && ms.anchor_t !== ''
    rows.push({
      source: 'manual',
      manual_id: ms.id,
      section: ms.section || sectionOfStock(ms.stock),
      stock: ms.stock,
      allocation: null,
      catch_uk: null,
      catch_nor: null,
      catch_total: null,
      balance: hasAnchor ? Number(ms.anchor_t) : null,
      anchor_date: ms.anchor_date || null,
      since_uk_t: r3(s.uk / 1000),
      since_nor_t: r3(s.nor / 1000),
      since_t: r3(sinceT),
      man_t: r3(manT),
      man_catch_t: r3(led.catch_t),
      adj_t: r3(adjT),
      est_balance: hasAnchor ? r3(Number(ms.anchor_t) - sinceT + manT + adjT) : null,
      fqa_units: null,
      total_year_kg: byStock[ms.stock]?.total_year_kg || 0,
      double_count_risk: led.catch_t > 0 && sinceT > 0,
    })
  }

  // 3. Logbook stocks tracked nowhere — never hide fish, offer to track
  for (const [stock, s] of Object.entries(byStock)) {
    if (seen.has(stock)) continue
    const sin = sinceFor(stock, null)
    const sinceT = (sin.uk + sin.nor) / 1000
    rows.push({
      source: 'untracked',
      section: sectionOfStock(stock) || '(no AFPO line)',
      stock,
      allocation: null, catch_uk: null, catch_nor: null, catch_total: null, balance: null,
      anchor_date: null,
      since_uk_t: r3(sin.uk / 1000), since_nor_t: r3(sin.nor / 1000),
      since_t: r3(sinceT), man_t: 0, adj_t: r3(adjByStock[stock] || 0),
      est_balance: null, fqa_units: null,
      total_year_kg: s.total_year_kg,
    })
  }

  const nonquotaRows = Object.entries(nonquota)
    .map(([fao, v]) => ({ fao, name: FAO_NAMES[fao] || fao, kg: r3(v.kg), sinceKg: r3(v.sinceKg) }))
    .sort((a, b) => b.kg - a.kg)
  const unmappedRows = Object.entries(unmapped)
    .map(([key, kg]) => ({ key, kg: r3(kg) }))
    .sort((a, b) => b.kg - a.kg)

  return { rows, nonquotaRows, unmappedRows, cutoff, sinceTrips, conflicts }
}

// Forecast: project each stock's estimated balance to year-end using the catch
// taken in the SAME remaining-months window in prior years (averaged across
// whatever prior years are on file). Driven by dated trip catch, so it gets
// sharper as more history is loaded. asOf 'YYYY-MM-DD' sets the window start.
export function buildForecast({ rows = [], trips = [], year, asOf, selectedYears = null }) {
  const md = String(asOf || '').slice(5) || '01-01'   // 'MM-DD' window start
  const yr = Number(year)
  const sel = (selectedYears && selectedYears.length) ? new Set(selectedYears.map(Number)) : null
  const byStockYear = {}                                // stock -> { year -> kg } in window
  const availableYears = new Set()                      // every prior year with windowed quota catch
  const yearsUsed = new Set()                           // prior years actually fed into the average
  for (const t of trips) {
    for (const c of t.catches || []) {
      const cd = c.catch_date || ''
      const cy = Number(cd.slice(0, 4))
      if (!cy || cy >= yr) continue                     // prior years only
      if (cd.slice(5) < md) continue                    // remaining-months window only
      const m = mapStock(c.species_fao, c.fao_area)
      if (m.kind !== 'quota') continue
      availableYears.add(cy)                            // counted before the selection filter, so the picker sees every year
      if (sel && !sel.has(cy)) continue                 // year deselected -> don't fold it into the average
      yearsUsed.add(cy)
      const e = (byStockYear[m.stock] = byStockYear[m.stock] || {})
      e[cy] = (e[cy] || 0) + c.live_kg
    }
  }
  const out = []
  for (const r of rows) {
    if (r.est_balance == null) continue                 // no balance -> can't forecast
    const per = byStockYear[r.stock] || {}
    const yrs = Object.keys(per)
    const avgT = yrs.length ? yrs.reduce((a, y) => a + per[y], 0) / yrs.length / 1000 : null
    // skip dormant zero-TAC lines (no balance, no catch this year, no history, no allocation)
    const active = r.est_balance > 0 || (r.total_year_kg || 0) > 0 || avgT != null || (r.allocation || 0) > 0
    if (!active) continue
    const projected = avgT == null ? null : r3(r.est_balance - avgT)
    let status
    if (r.est_balance <= 0) status = 'over'
    else if (avgT == null) status = 'nodata'
    else if (projected < 0) status = 'short'
    else if (projected < r.est_balance * 0.15) status = 'tight'
    else status = 'ok'
    out.push({
      section: r.section, stock: r.stock,
      est_balance: r.est_balance,
      prior_years: yrs.map(Number).sort((a, b) => a - b),
      avg_prior_t: avgT == null ? null : r3(avgT),
      projected_t: projected,
      status,
    })
  }
  const rank = { over: 0, short: 1, tight: 2, ok: 3, nodata: 4 }
  out.sort((a, b) => (rank[a.status] - rank[b.status]) || ((a.projected_t ?? 1e9) - (b.projected_t ?? 1e9)))
  return { rows: out, years_present: [...yearsUsed].sort(), available_years: [...availableYears].sort((a, b) => a - b), window_from: md }
}
