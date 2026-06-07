// Quota position maths.
// Official = latest AFPO snapshot for the year (tonnes).
// Estimated now = official balance minus logbook catch from trips that
// LANDED after the statement's last-landing date (catch rows year-filtered
// by catch_date, so year-straddling trips book to both years correctly).
// Trip arrival (not catch date) decides whether AFPO has seen the trip,
// because AFPO books per landing — a trip landed after the statement may
// still hold catches dated before it.
import { mapStock, FAO_NAMES } from './stockMap.js'

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
export function buildPosition({ snapshot, trips, year }) {
  const cutoff = snapshot?.last_landing_date || null // 'YYYY-MM-DD'
  const byStock = {}   // stock -> { since_uk_kg, since_nor_kg, total_year_kg }
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
      const s = byStock[m.stock] = byStock[m.stock] || { since_uk_kg: 0, since_nor_kg: 0, total_year_kg: 0 }
      s.total_year_kg += c.live_kg
      if (afterStatement) {
        if (c.eez === 'NOR') s.since_nor_kg += c.live_kg
        else s.since_uk_kg += c.live_kg
      }
    }
    if (afterStatement && touches) sinceTrips++
  }

  // Merge with snapshot lines (tonnes)
  const rows = []
  const seen = new Set()
  for (const l of snapshot?.lines || []) {
    const s = byStock[l.stock] || { since_uk_kg: 0, since_nor_kg: 0, total_year_kg: 0 }
    seen.add(l.stock)
    const sinceT = (s.since_uk_kg + s.since_nor_kg) / 1000
    rows.push({
      section: l.section,
      stock: l.stock,
      allocation: l.allocation,
      catch_uk: l.catch_uk,
      catch_nor: l.catch_nor,
      catch_total: l.catch_total,
      balance: l.balance,
      since_uk_t: r3(s.since_uk_kg / 1000),
      since_nor_t: r3(s.since_nor_kg / 1000),
      since_t: r3(sinceT),
      est_balance: l.balance != null ? r3(l.balance - sinceT) : null,
      fqa_units: l.fqa_units,
    })
  }
  // Logbook stocks with no AFPO line (shouldn't happen, but never hide fish)
  for (const [stock, s] of Object.entries(byStock)) {
    if (seen.has(stock)) continue
    const sinceT = (s.since_uk_kg + s.since_nor_kg) / 1000
    rows.push({
      section: '(no AFPO line)', stock,
      allocation: null, catch_uk: null, catch_nor: null, catch_total: null, balance: null,
      since_uk_t: r3(s.since_uk_kg / 1000), since_nor_t: r3(s.since_nor_kg / 1000),
      since_t: r3(sinceT), est_balance: null, fqa_units: null,
    })
  }

  const nonquotaRows = Object.entries(nonquota)
    .map(([fao, v]) => ({ fao, name: FAO_NAMES[fao] || fao, kg: r3(v.kg), sinceKg: r3(v.sinceKg) }))
    .sort((a, b) => b.kg - a.kg)
  const unmappedRows = Object.entries(unmapped)
    .map(([key, kg]) => ({ key, kg: r3(kg) }))
    .sort((a, b) => b.kg - a.kg)

  return { rows, nonquotaRows, unmappedRows, cutoff, sinceTrips }
}
