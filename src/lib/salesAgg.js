// Aggregation helpers for the Fish Sales Analyser. Pure functions over
// sales_rows records (joined with their landing where needed).

export const r2 = (n) => Math.round(n * 100) / 100

export function kpis(rows, landingCount) {
  const value = rows.reduce((s, r) => s + Number(r.value || 0), 0)
  const kg = rows.reduce((s, r) => s + Number(r.weight_kg || 0), 0)
  const boxes = rows.reduce((s, r) => s + Number(r.boxes || 0), 0)
  return { value: r2(value), kg: r2(kg), boxes: r2(boxes), pkg: kg ? r2(value / kg) : 0, landings: landingCount }
}

// species_canon -> { value, kg, boxes, pkg }
export function bySpecies(rows) {
  const m = {}
  for (const r of rows) {
    const k = r.species_canon || r.species || '?'
    const o = (m[k] = m[k] || { species: k, value: 0, kg: 0, boxes: 0 })
    o.value += Number(r.value || 0); o.kg += Number(r.weight_kg || 0); o.boxes += Number(r.boxes || 0)
  }
  return Object.values(m).map(o => ({ ...o, value: r2(o.value), kg: r2(o.kg), boxes: r2(o.boxes), pkg: o.kg ? r2(o.value / o.kg) : 0 }))
    .sort((a, b) => b.value - a.value)
}

// grade label including the haddock sub-grade split when present
export function gradeLabel(r) {
  return (r.grade || '?') + (r.sub_grade ? ' · ' + r.sub_grade : '')
}

/* Grade ordering: biggest fish first = lowest grade number.
 * A0, A+1, A1, A+2, A2 ... then Sort 1, Sort 2 ... then everything else
 * alphabetically. A4 haddock sub-grades order Chipper > Metro > Mini Metro. */
const SUB_ORDER = { 'Chipper': 1, 'Metro': 2, 'Mini Metro': 3 }
export function gradeSortKey(label) {
  const [g, sub] = String(label).split(' \u00b7 ').map(s => s.trim())
  let major = 900, minor = 5
  const m = g.match(/^A(\+)?(\d+)/i)
  if (m) { major = Number(m[2]); minor = m[1] ? 0 : 1 } // A+n sits just before An
  else {
    const s = g.match(/^Sort\s*(\d+)/i)
    if (s) { major = 500 + Number(s[1]); minor = 0 }
  }
  const subOrd = sub ? (SUB_ORDER[sub] || 9) : 0
  return String(major).padStart(3, '0') + minor + String(subOrd) + g
}
export const sortGrades = (list, get = x => x.grade) =>
  [...list].sort((x, y) => gradeSortKey(get(x)).localeCompare(gradeSortKey(get(y))))

// grade(+sub) breakdown for one species
export function gradesFor(rows, species) {
  const m = {}
  for (const r of rows) {
    if ((r.species_canon || r.species) !== species) continue
    const k = gradeLabel(r)
    const o = (m[k] = m[k] || { grade: k, value: 0, kg: 0, boxes: 0 })
    o.value += Number(r.value || 0); o.kg += Number(r.weight_kg || 0); o.boxes += Number(r.boxes || 0)
  }
  return sortGrades(Object.values(m).map(o => ({ ...o, value: r2(o.value), kg: r2(o.kg), boxes: r2(o.boxes), pkg: o.kg ? r2(o.value / o.kg) : 0 })))
}

// buyer -> totals + top species by value
export function byBuyer(rows) {
  const m = {}
  for (const r of rows) {
    const k = r.buyer || '?'
    const o = (m[k] = m[k] || { buyer: k, value: 0, kg: 0, boxes: 0, sp: {} })
    o.value += Number(r.value || 0); o.kg += Number(r.weight_kg || 0); o.boxes += Number(r.boxes || 0)
    const s = r.species_canon || r.species || '?'
    o.sp[s] = (o.sp[s] || 0) + Number(r.value || 0)
  }
  return Object.values(m).map(o => {
    const top = Object.entries(o.sp).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s]) => s).join(', ')
    return { buyer: o.buyer, value: r2(o.value), kg: r2(o.kg), boxes: r2(o.boxes), pkg: o.kg ? r2(o.value / o.kg) : 0, top }
  }).sort((a, b) => b.value - a.value)
}

// what a buyer bought, species level (drill further with buyerSpeciesGrades)
export function buyerSpecies(rows, buyer) {
  const m = {}
  for (const r of rows) {
    if ((r.buyer || '?') !== buyer) continue
    const k = r.species_canon || r.species || '?'
    const o = (m[k] = m[k] || { species: k, value: 0, kg: 0, boxes: 0 })
    o.value += Number(r.value || 0); o.kg += Number(r.weight_kg || 0); o.boxes += Number(r.boxes || 0)
  }
  return Object.values(m).map(o => ({ ...o, value: r2(o.value), kg: r2(o.kg), boxes: r2(o.boxes), pkg: o.kg ? r2(o.value / o.kg) : 0 }))
    .sort((a, b) => b.value - a.value)
}

// grade breakdown of one species for one buyer
export function buyerSpeciesGrades(rows, buyer, species) {
  const m = {}
  for (const r of rows) {
    if ((r.buyer || '?') !== buyer) continue
    if ((r.species_canon || r.species || '?') !== species) continue
    const k = gradeLabel(r)
    const o = (m[k] = m[k] || { grade: k, value: 0, kg: 0, boxes: 0 })
    o.value += Number(r.value || 0); o.kg += Number(r.weight_kg || 0); o.boxes += Number(r.boxes || 0)
  }
  return sortGrades(Object.values(m).map(o => ({ ...o, value: r2(o.value), kg: r2(o.kg), boxes: r2(o.boxes), pkg: o.kg ? r2(o.value / o.kg) : 0 })))
}

// monthly series for charts: [{m:'2026-01', label:'Jan', value, kg}]
export function monthlySeries(rows, landingById, year) {
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const out = M.map((label, i) => ({ m: `${year}-${String(i + 1).padStart(2, '0')}`, label, value: 0, kg: 0 }))
  for (const r of rows) {
    const d = landingById[r.landing_id]?.landing_date
    if (!d || !d.startsWith(String(year))) continue
    const i = Number(d.slice(5, 7)) - 1
    out[i].value += Number(r.value || 0); out[i].kg += Number(r.weight_kg || 0)
  }
  return out.map(o => ({ ...o, value: r2(o.value), kg: r2(o.kg / 1000) })) // kg -> tonnes for the chart
}

// per-landing series (month scope): [{label:'03/06 PD', value}]
export function landingSeries(landings) {
  return [...landings].sort((a, b) => (a.landing_date || '').localeCompare(b.landing_date || ''))
    .map(l => ({
      label: (l.landing_date ? l.landing_date.slice(8, 10) + '/' + l.landing_date.slice(5, 7) : '?') +
        ' ' + shortMarket(l.market),
      value: r2(Number(l.value || 0)), kg: r2(Number(l.weight_kg || 0) / 1000), id: l.id
    }))
}

export function shortMarket(m) {
  if (!m) return ''
  if (/Hanstholm/i.test(m)) return 'DK'
  if (/Shetland/i.test(m)) return 'LK'
  if (/Scrabster/i.test(m)) return 'SC'
  if (/Ullapool/i.test(m)) return 'UL'
  if (/Peterhead/i.test(m)) return 'PD'
  return m.slice(0, 4)
}

/* --------------------------------------------------------------------------
 * A4 haddock auto-split by price band (PD notes).
 * Sort the landing's Haddock A4 rows by £/kg, find the 2 largest gaps between
 * distinct price levels -> 3 bands: top = Chipper, middle = Metro,
 * bottom = Mini Metro. Returns [{id, sub_grade}] or {error} when the price
 * spread can't support 3 bands (then it's a manual job).
 * ------------------------------------------------------------------------ */
export function autoSplitA4Haddock(rows) {
  const tgt = rows.filter(r => (r.species_canon || r.species) === 'Haddock' && r.grade === 'A4')
  if (!tgt.length) return { error: 'No Haddock A4 rows in this landing.' }
  const prices = [...new Set(tgt.map(r => r2(Number(r.price_per_kg || 0))))].sort((a, b) => a - b)
  if (prices.length < 3) return { error: `Only ${prices.length} distinct A4 price level(s) — not enough spread to detect bands. Set sub-grades manually.` }
  // gaps between consecutive distinct prices
  const gaps = []
  for (let i = 1; i < prices.length; i++) gaps.push({ at: i, gap: prices[i] - prices[i - 1] })
  gaps.sort((a, b) => b.gap - a.gap)
  const cuts = [gaps[0].at, gaps[1].at].sort((a, b) => a - b) // indices into prices[]
  const lowMax = prices[cuts[0] - 1], midMax = prices[cuts[1] - 1]
  const updates = tgt.map(r => {
    const p = r2(Number(r.price_per_kg || 0))
    const sub = p <= lowMax ? 'Mini Metro' : p <= midMax ? 'Metro' : 'Chipper'
    return { id: r.id, sub_grade: sub }
  })
  return { updates, bands: { miniMax: lowMax, metroMax: midMax } }
}
