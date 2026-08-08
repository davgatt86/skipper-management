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

/* --------------------------------------------------------------------------
 * A4 haddock split by MANUAL trip totals (item 1).
 * The skipper keys the boxes of Mini Metro / Metro / Chipper landed that trip;
 * we allocate them across the landing's Haddock A4 rows by price rank — the
 * cheapest boxes are Mini, the dearest are Chipper, the middle (and any
 * residual when the totals don't quite match the landed A4 boxes) is Metro.
 * Whole rows are assigned by where their box-midpoint falls, so a row never
 * gets two labels. Returns { updates:[{id,sub_grade}], actual, entered, diff,
 * flag } where flag=true when entered vs landed differs by > 3 boxes.
 * ------------------------------------------------------------------------ */
export function splitA4ByTotals(rows, totals) {
  const tgt = rows.filter(r => (r.species_canon || r.species) === 'Haddock' && r.grade === 'A4')
  if (!tgt.length) return { error: 'No Haddock A4 rows in this landing.' }
  const mini = Math.max(0, Number(totals.mini) || 0)
  const metro = Math.max(0, Number(totals.metro) || 0)
  const chipper = Math.max(0, Number(totals.chipper) || 0)
  const px = r => Number(r.price_per_kg || 0) || Number(r.price_per_box || 0)
  const sorted = [...tgt].sort((a, b) => px(a) - px(b))            // cheapest first
  const total = sorted.reduce((s, r) => s + Number(r.boxes || 0), 0)
  const actual = r2(total)
  const entered = r2(mini + metro + chipper)
  const miniCut = mini                  // boxes up to here (cheapest) = Mini
  const chipperStart = total - chipper  // boxes beyond here (dearest) = Chipper
  let cum = 0
  const updates = sorted.map(r => {
    const b = Number(r.boxes || 0)
    const mid = cum + b / 2
    cum += b
    let sub
    if (mid <= miniCut) sub = 'Mini Metro'
    else if (mid >= chipperStart) sub = 'Chipper'
    else sub = 'Metro'                   // middle band absorbs any residual
    return { id: r.id, sub_grade: sub }
  })
  const diff = r2(entered - actual)
  return { updates, actual, entered, diff, flag: Math.abs(diff) > 3 }
}

/* Best-paying buyer per species + grade (item 2). For each species/grade
 * (grade includes any A4 sub-grade via gradeLabel), buyers ranked by £/kg.
 * Returns [{ species, grade, buyers:[{buyer,pkg,boxes,value,kg}], best }]. */
export function bestBuyerByGrade(rows) {
  const g = {}
  for (const r of rows) {
    const sp = r.species_canon || r.species || '?'
    const gr = gradeLabel(r)
    const key = sp + '||' + gr
    const o = (g[key] = g[key] || { species: sp, grade: gr, buyers: {} })
    const b = r.buyer || '?'
    const bo = (o.buyers[b] = o.buyers[b] || { buyer: b, value: 0, kg: 0, boxes: 0 })
    bo.value += Number(r.value || 0); bo.kg += Number(r.weight_kg || 0); bo.boxes += Number(r.boxes || 0)
  }
  return Object.values(g).map(o => {
    const buyers = Object.values(o.buyers)
      .map(b => ({ ...b, value: r2(b.value), kg: r2(b.kg), boxes: r2(b.boxes), pkg: b.kg ? r2(b.value / b.kg) : 0 }))
      .sort((a, b) => b.pkg - a.pkg)
    return { species: o.species, grade: o.grade, buyers, best: buyers[0] }
  }).sort((a, b) => a.species.localeCompare(b.species) || gradeSortKey(a.grade).localeCompare(gradeSortKey(b.grade)))
}

/* Price-trend series for the vessel's own sales (item 3). Plots one line per
 * selected grade over time. metric: 'pkg' (£/kg) or 'box' (£/box). period:
 * 'month' (YYYY-MM buckets) or 'year' (YYYY). Returns { data, keys } shaped
 * for Recharts (data rows keyed by grade label, x = bucket). */
export function priceTrendSeries(rows, landingById, opts) {
  const { species, grades, metric = 'pkg', period = 'month' } = opts || {}
  const sel = new Set(grades || [])
  const buckets = {}
  for (const r of rows) {
    const sp = r.species_canon || r.species || '?'
    if (species && sp !== species) continue
    const gl = gradeLabel(r)
    if (sel.size && !sel.has(gl)) continue
    const d = landingById[r.landing_id]?.landing_date
    if (!d) continue
    const bk = period === 'year' ? d.slice(0, 4) : d.slice(0, 7)
    const bb = (buckets[bk] = buckets[bk] || {})
    const o = (bb[gl] = bb[gl] || { value: 0, kg: 0, boxes: 0 })
    o.value += Number(r.value || 0); o.kg += Number(r.weight_kg || 0); o.boxes += Number(r.boxes || 0)
  }
  const keys = sel.size ? sortGrades([...sel].map(g => ({ grade: g })), x => x.grade).map(x => x.grade) : []
  const data = Object.keys(buckets).sort().map(bk => {
    const row = { x: bk }
    for (const g of keys) {
      const o = buckets[bk][g]
      row[g] = o ? (metric === 'box' ? (o.boxes ? r2(o.value / o.boxes) : null) : (o.kg ? r2(o.value / o.kg) : null)) : null
    }
    return row
  })
  return { data, keys }
}

/* Seasonality grid (species × calendar month). Pools all rows in scope by
 * month-of-year (so "All" shows true seasonality across years). metric:
 * 'pkg' (£/kg), 'kg' (tonnes), 'boxes', or 'value' (£). Returns
 * { species:[…ordered by total value], cells:{species:{1..12:val|null}}, max }. */
export function seasonalityGrid(rows, landingById, metric = 'pkg') {
  const sp = {}
  for (const r of rows) {
    const d = landingById[r.landing_id]?.landing_date
    if (!d) continue
    const mo = Number(d.slice(5, 7))
    if (!mo) continue
    const s = r.species_canon || r.species || '?'
    const o = (sp[s] = sp[s] || { species: s, months: {}, total: 0 })
    const c = (o.months[mo] = o.months[mo] || { value: 0, kg: 0, boxes: 0 })
    c.value += Number(r.value || 0); c.kg += Number(r.weight_kg || 0); c.boxes += Number(r.boxes || 0)
    o.total += Number(r.value || 0)
  }
  const val = c => metric === 'pkg' ? (c.kg ? c.value / c.kg : null)
    : metric === 'kg' ? c.kg / 1000
      : metric === 'boxes' ? c.boxes
        : c.value
  const species = Object.values(sp).sort((a, b) => b.total - a.total).map(o => o.species)
  const cells = {}; let max = 0
  for (const o of Object.values(sp)) {
    cells[o.species] = {}
    for (let m = 1; m <= 12; m++) {
      const c = o.months[m]; const v = c ? val(c) : null
      cells[o.species][m] = v == null ? null : r2(v)
      if (v != null && v > max) max = v
    }
  }
  return { species, cells, max: r2(max), metric }
}

/* Buyer league nested species -> grades -> buyers, every level ranked by
 * average £/kg (highest first), NOT alphabetically (Sales Insights upgrade).
 * Returns [{ species, pkg, boxes, value, kg,
 *            grades:[{ grade, pkg, boxes, best, buyers:[…by £/kg] }] }]. */
export function buyerLeague(rows) {
  const fin = o => ({ ...o, value: r2(o.value), kg: r2(o.kg), boxes: r2(o.boxes), pkg: o.kg ? r2(o.value / o.kg) : 0 })
  const sp = {}
  for (const r of rows) {
    const s = r.species_canon || r.species || '?'
    const gl = gradeLabel(r)
    const b = r.buyer || '?'
    const o = (sp[s] = sp[s] || { species: s, value: 0, kg: 0, boxes: 0, grades: {} })
    o.value += Number(r.value || 0); o.kg += Number(r.weight_kg || 0); o.boxes += Number(r.boxes || 0)
    const g = (o.grades[gl] = o.grades[gl] || { grade: gl, value: 0, kg: 0, boxes: 0, buyers: {} })
    g.value += Number(r.value || 0); g.kg += Number(r.weight_kg || 0); g.boxes += Number(r.boxes || 0)
    const bo = (g.buyers[b] = g.buyers[b] || { buyer: b, value: 0, kg: 0, boxes: 0 })
    bo.value += Number(r.value || 0); bo.kg += Number(r.weight_kg || 0); bo.boxes += Number(r.boxes || 0)
  }
  return Object.values(sp).map(o => {
    const grades = Object.values(o.grades).map(g => {
      const buyers = Object.values(g.buyers).map(fin).sort((a, b) => b.pkg - a.pkg)
      return { ...fin(g), buyers, best: buyers[0] }
    }).sort((a, b) => b.pkg - a.pkg)
    return { ...fin(o), grades }
  }).sort((a, b) => b.pkg - a.pkg)
}

/* Grade-level seasonality for ONE species (species × month drill-down).
 * Same shape as seasonalityGrid but keyed by grade label. */
export function gradeSeasonality(rows, landingById, species, metric = 'pkg') {
  const gr = {}
  for (const r of rows) {
    if ((r.species_canon || r.species) !== species) continue
    const d = landingById[r.landing_id]?.landing_date
    if (!d) continue
    const mo = Number(d.slice(5, 7)); if (!mo) continue
    const g = gradeLabel(r)
    const o = (gr[g] = gr[g] || { grade: g, months: {}, total: 0 })
    const c = (o.months[mo] = o.months[mo] || { value: 0, kg: 0, boxes: 0 })
    c.value += Number(r.value || 0); c.kg += Number(r.weight_kg || 0); c.boxes += Number(r.boxes || 0)
    o.total += Number(r.value || 0)
  }
  const val = c => metric === 'pkg' ? (c.kg ? c.value / c.kg : null)
    : metric === 'kg' ? c.kg / 1000 : metric === 'boxes' ? c.boxes : c.value
  const grades = sortGrades(Object.values(gr)).map(o => o.grade)
  const cells = {}; let max = 0
  for (const o of Object.values(gr)) {
    cells[o.grade] = {}
    for (let m = 1; m <= 12; m++) {
      const c = o.months[m]; const v = c ? val(c) : null
      cells[o.grade][m] = v == null ? null : r2(v)
      if (v != null && v > max) max = v
    }
  }
  return { grades, cells, max: r2(max), metric }
}

/* ---------------- shares ----------------
 * Percentages answer "what drove the gross". They are always computed against
 * the rows actually in scope, so a % is a share of what you are looking at —
 * change the scope and the denominator changes with it. That is the point.
 *
 * basis: 'value' (£ — what drove the gross), 'kg', or 'boxes'.
 */
export function withShares(list, basis = 'value') {
  const total = list.reduce((s, o) => s + Number(o[basis] || 0), 0)
  return list.map((o) => ({
    ...o,
    share: total ? r2((Number(o[basis] || 0) / total) * 100) : 0,
    shareBasis: basis,
    shareTotal: r2(total),
  }))
}

/* ---------------- UK / Denmark scope ----------------
 * Danish sales come through Hanstholm with no buyer names and in DKK, so
 * mixing them into a buyer breakdown is misleading and mixing them into a
 * species one is only sometimes wanted. The scope is explicit rather than
 * assumed either way.
 */
export const SALES_SCOPES = [
  { id: 'all', label: 'All landings' },
  { id: 'uk', label: 'UK only' },
  { id: 'dk', label: 'Denmark only' },
]

const isDanish = (l) => !!l && (l.market === 'Hanstholm' || l.currency === 'DKK')

export function scopeRows(rows, landingById, scope) {
  if (!scope || scope === 'all') return rows
  return rows.filter((r) => {
    const l = landingById?.[r.landing_id]
    return scope === 'dk' ? isDanish(l) : !isDanish(l)
  })
}

export function scopeLandingIds(landings, scope) {
  if (!scope || scope === 'all') return landings
  return landings.filter((l) => (scope === 'dk' ? isDanish(l) : !isDanish(l)))
}

/* ---------------- per vessel ----------------
 * A pair team is two boats in ONE fleet, told apart by the vessel label on the
 * landing — not two fleets, and not something that needs a vessels table.
 * Sum gross and boxes; never sum days at sea, because both boats fished the
 * same days.
 */
export function byVessel(rows, landingById) {
  const m = {}
  for (const r of rows) {
    const l = landingById?.[r.landing_id]
    const k = l?.vessel || '?'
    const o = (m[k] = m[k] || { vessel: k, value: 0, kg: 0, boxes: 0, landings: new Set() })
    o.value += Number(r.value || 0); o.kg += Number(r.weight_kg || 0); o.boxes += Number(r.boxes || 0)
    if (r.landing_id) o.landings.add(r.landing_id)
  }
  return Object.values(m).map((o) => ({
    ...o, value: r2(o.value), kg: r2(o.kg), boxes: r2(o.boxes),
    landings: o.landings.size, pkg: o.kg ? r2(o.value / o.kg) : 0,
  })).sort((a, b) => b.value - a.value)
}

// Trips the pair fished together — the same day, both boats. This is the unit
// a pair actually works in, and it is what makes a side-by-side fair.
export function pairedDays(landings) {
  const byDate = {}
  for (const l of landings || []) {
    if (!l.landing_date) continue
    ;(byDate[l.landing_date] = byDate[l.landing_date] || new Set()).add(l.vessel)
  }
  const days = Object.entries(byDate).map(([date, set]) => ({ date, vessels: [...set] }))
  return {
    days,
    together: days.filter((d) => d.vessels.length > 1).length,
    alone: days.filter((d) => d.vessels.length === 1).length,
  }
}

/* ---------------- pair analysis ----------------
 * A pair tows one net between two boats, so they land the same fish on the
 * same day. That makes them directly comparable in a way two unrelated boats
 * never are, and it is what these three answer.
 */

// 1. Same-day price gap. Both boats landed the same day — did one get a
//    better £/kg? A persistent gap is grading or a market split, and it is
//    money rather than noise.
export function samedayPriceGap(rows, landingById) {
  const byDay = {}
  for (const r of rows) {
    const l = landingById?.[r.landing_id]
    if (!l?.landing_date || !l.vessel) continue
    const d = (byDay[l.landing_date] = byDay[l.landing_date] || {})
    const v = (d[l.vessel] = d[l.vessel] || { value: 0, kg: 0, markets: new Set() })
    v.value += Number(r.value || 0); v.kg += Number(r.weight_kg || 0)
    if (l.market) v.markets.add(l.market)
  }
  const out = []
  for (const [date, vessels] of Object.entries(byDay)) {
    const names = Object.keys(vessels)
    if (names.length < 2) continue
    const sides = names.map((n) => ({
      vessel: n,
      value: r2(vessels[n].value),
      kg: r2(vessels[n].kg),
      pkg: vessels[n].kg ? r2(vessels[n].value / vessels[n].kg) : 0,
      markets: [...vessels[n].markets],
    })).sort((a, b) => b.pkg - a.pkg)
    const best = sides[0], worst = sides[sides.length - 1]
    const gap = r2(best.pkg - worst.pkg)
    out.push({
      date, sides, gap,
      gapPct: worst.pkg ? r2((gap / worst.pkg) * 100) : 0,
      // Different markets on the same day is a decision, not an accident —
      // worth separating from a gap that happened in one market.
      splitMarket: new Set(sides.flatMap((s) => s.markets)).size > 1,
    })
  }
  return out.sort((a, b) => b.date.localeCompare(a.date))
}

// 2. Species mix divergence. If one boat's share of a species drifts from the
//    other's while towing the same net, that is a gear or stowage question.
export function speciesMixDivergence(rows, landingById, basis = 'value') {
  const per = {}
  const totals = {}
  for (const r of rows) {
    const l = landingById?.[r.landing_id]
    if (!l?.vessel) continue
    const sp = r.species_canon || r.species || '?'
    const amt = Number(r[basis === 'value' ? 'value' : basis === 'kg' ? 'weight_kg' : 'boxes'] || 0)
    per[l.vessel] = per[l.vessel] || {}
    per[l.vessel][sp] = (per[l.vessel][sp] || 0) + amt
    totals[l.vessel] = (totals[l.vessel] || 0) + amt
  }
  const vessels = Object.keys(per)
  if (vessels.length < 2) return []
  const species = [...new Set(vessels.flatMap((v) => Object.keys(per[v])))]
  return species.map((sp) => {
    const shares = vessels.map((v) => ({
      vessel: v,
      share: totals[v] ? r2(((per[v][sp] || 0) / totals[v]) * 100) : 0,
    }))
    const vals = shares.map((s) => s.share)
    return { species: sp, shares, spread: r2(Math.max(...vals) - Math.min(...vals)) }
  }).sort((a, b) => b.spread - a.spread)
}

// 3. Which boat sold where. Splitting a pair's catch across two markets on one
//    day is a decision, and it should be reviewable.
export function vesselMarketSplit(rows, landingById) {
  const m = {}
  for (const r of rows) {
    const l = landingById?.[r.landing_id]
    if (!l?.vessel) continue
    const market = l.market || '?'
    const k = l.vessel + '||' + market
    const o = (m[k] = m[k] || { vessel: l.vessel, market, value: 0, kg: 0, landings: new Set() })
    o.value += Number(r.value || 0); o.kg += Number(r.weight_kg || 0)
    if (r.landing_id) o.landings.add(r.landing_id)
  }
  return Object.values(m).map((o) => ({
    ...o, value: r2(o.value), kg: r2(o.kg),
    landings: o.landings.size, pkg: o.kg ? r2(o.value / o.kg) : 0,
  })).sort((a, b) => a.vessel.localeCompare(b.vessel) || b.value - a.value)
}

/* ---------------- buyer league ----------------
 * "Who pays best for my haddock" cannot be answered by averaging each buyer's
 * £/kg over a year. Prices move week to week, so that mostly measures WHEN a
 * buyer happened to be bidding, not whether they pay well.
 *
 * The fair comparison is against the board on the same day for the same fish:
 * for every (species, grade, day) work out the volume-weighted average price
 * across all buyers, then score each buyer on how far above or below it they
 * bought. A day with only one buyer tells you nothing and is dropped.
 *
 * The result is a premium in £/kg — "this buyer pays 85p a kilo more than the
 * rest of the market did, on the days they were buying".
 */
const isAuctionName = (b) => /auction/i.test(b || '')

export function buyerPremiumLeague(rows, landingById, opts = {}) {
  const minKg = opts.minKg ?? 1000
  const species = opts.species || null      // null = all species together
  const byGrade = !!opts.byGrade

  const usable = rows.filter((r) => {
    if (!r.buyer || isAuctionName(r.buyer)) return false
    if (!(Number(r.weight_kg) > 0) || !(Number(r.value) > 0)) return false
    if (species && (r.species_canon || r.species) !== species) return false
    return !!landingById?.[r.landing_id]?.landing_date
  })

  // Volume-weighted market price per species/grade/day.
  const key = (r) => {
    const sp = r.species_canon || r.species || '?'
    const g = byGrade ? '||' + gradeLabel(r) : ''
    return sp + g + '||' + landingById[r.landing_id].landing_date
  }
  const market = {}
  for (const r of usable) {
    const k = key(r)
    const m = (market[k] = market[k] || { value: 0, kg: 0, buyers: new Set() })
    m.value += Number(r.value); m.kg += Number(r.weight_kg); m.buyers.add(r.buyer)
  }

  const agg = {}
  for (const r of usable) {
    const m = market[key(r)]
    // One buyer on the day is not a market — nothing to compare against.
    if (!m || m.buyers.size < 2 || !m.kg) continue
    const avg = m.value / m.kg
    const kg = Number(r.weight_kg)
    const pkg = Number(r.value) / kg
    const a = (agg[r.buyer] = agg[r.buyer] || {
      buyer: r.buyer, kg: 0, value: 0, weighted: 0, days: new Set(), species: {},
    })
    a.kg += kg
    a.value += Number(r.value)
    a.weighted += (pkg - avg) * kg          // kg-weighted, so a big lift on a
    a.days.add(landingById[r.landing_id].landing_date)   // big parcel counts more
    const sp = r.species_canon || r.species || '?'
    a.species[sp] = (a.species[sp] || 0) + Number(r.value)
  }

  return Object.values(agg)
    .filter((a) => a.kg >= minKg)
    .map((a) => ({
      buyer: a.buyer,
      kg: r2(a.kg),
      value: r2(a.value),
      days: a.days.size,
      pkg: r2(a.value / a.kg),
      premium: r2(a.weighted / a.kg),
      // What the premium is worth on the volume they actually took.
      worth: r2((a.weighted / a.kg) * a.kg),
      top: Object.entries(a.species).sort((x, y) => y[1] - x[1])[0]?.[0] || '',
    }))
    .sort((a, b) => b.premium - a.premium)
}

// Buyers whose names differ only by punctuation, case or a company suffix.
// Same failure as crew ranks, fuel suppliers and vessel labels: buyer names
// come off the sales note as typed, so one firm can appear several ways and
// split its own record.
export function similarBuyers(rows) {
  const strip = (b) => (b || '').toLowerCase()
    .replace(/\b(ltd|limited|co|company|messrs|and|&|the)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
  const g = {}
  for (const r of rows) {
    if (!r.buyer || isAuctionName(r.buyer)) continue
    const k = strip(r.buyer)
    if (!k) continue
    ;(g[k] = g[k] || new Set()).add(r.buyer)
  }
  return Object.values(g).filter((s) => s.size > 1).map((s) => [...s].sort())
}

/* ---------------- settlement ↔ landing boundaries ----------------
 * The office does not say which landings a settlement covers, and that
 * information is not available. But it does not have to be guessed either.
 *
 * Two facts make the boundaries solvable:
 *   · landings and settlements are both in date order, and a settlement
 *     always covers a CONSECUTIVE run of landings
 *   · each settlement states two independent figures — the Fish Sales value
 *     and the weight landed
 *
 * So instead of a fixed date rule, choose the cut points that make both
 * figures agree best across the whole year at once. A cut that fixes one
 * settlement while wrecking the next is rejected automatically, which is
 * exactly the failure a per-settlement date window cannot see.
 *
 * Dynamic programming over cut positions: cost[i][j] = best total error using
 * the first i landings for the first j settlements. Trivial at this size.
 */
export function solveSettlementRuns(landings, settlements) {
  const n = landings.length, m = settlements.length
  if (!n || !m) return []

  // Relative error, so a £600k settlement and a £30k one weigh the same.
  // Value and weight count equally; agreeing on both is the whole point.
  const runCost = (a, b, s) => {
    let v = 0, kg = 0
    for (let i = a; i < b; i++) { v += landings[i].value; kg += landings[i].kg }
    const ev = s.fish ? Math.abs(v - s.fish) / s.fish : 0
    const ew = s.kg ? Math.abs(kg - s.kg) / s.kg : 0
    return { cost: ev + ew, value: v, kg }
  }

  // A run has to be plausible in time as well as in figures: its last landing
  // must fall in the settlement's own period. Without this the solver will
  // happily reach back months to make an arithmetic fit.
  const dayGap = (a, b) => (new Date(a + 'T00:00:00') - new Date(b + 'T00:00:00')) / 86400000
  const feasible = (a, b, s) => {
    const last = landings[b - 1], first = landings[a]
    if (!last || !first) return false
    const endGap = dayGap(last.date, s.settling_date)
    return endGap <= 3 && endGap >= -45 && dayGap(s.settling_date, first.date) <= 60
  }

  const INF = Infinity
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(INF))
  const back = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(-1))
  // Landings BEFORE the first settlement here were settled on a sheet we do
  // not hold, so any leading run may be skipped. Forcing them in was making
  // the first settlements badly wrong.
  for (let i = 0; i <= n; i++) dp[0][i] = 0

  for (let j = 1; j <= m; j++) {
    for (let i = j; i <= n; i++) {            // each settlement needs ≥1 landing
      for (let k = j - 1; k < i; k++) {
        if (dp[j - 1][k] === INF) continue
        if (!feasible(k, i, settlements[j - 1])) continue
        const c = dp[j - 1][k] + runCost(k, i, settlements[j - 1]).cost
        if (c < dp[j][i]) { dp[j][i] = c; back[j][i] = k }
      }
    }
  }

  // Landings after the last settlement are equally not ours to assign, so take
  // the best end point rather than insisting on the final landing.
  let end = -1, best = INF
  for (let i = m; i <= n; i++) if (dp[m][i] < best) { best = dp[m][i]; end = i }
  if (end < 0) return []

  const cuts = new Array(m + 1)
  cuts[m] = end
  for (let j = m; j >= 1; j--) cuts[j - 1] = back[j][cuts[j]]

  return settlements.map((s, j) => {
    const a = cuts[j], b = cuts[j + 1]
    const { value, kg } = runCost(a, b, s)
    return {
      settlement: s,
      landings: landings.slice(a, b),
      value: r2(value),
      kg: r2(kg),
      valueDiff: r2(value - (s.fish || 0)),
      kgDiff: r2(kg - (s.kg || 0)),
    }
  })
}

/* How much to trust a matched run.
 *   confirmed — value AND weight both agree; the run is right, not inferred
 *   value     — value agrees but weight does not, which in this data means the
 *               settlement measures weight differently, NOT a wrong match
 *   weight    — weight agrees but value does not; usually money on the sheet
 *               that did not come from fish
 *   unmatched — neither; the boundary or the paperwork needs looking at
 */
export function matchConfidence(valueDiff, kgDiff, fish, kg) {
  const vOk = fish ? Math.abs(valueDiff) / fish < 0.01 : false
  const wOk = kg ? Math.abs(kgDiff) / kg < 0.01 : false
  if (vOk && wOk) return { key: 'confirmed', label: 'Confirmed', color: 'var(--kelp)' }
  if (vOk) return { key: 'value', label: 'Value agrees', color: 'var(--brass)' }
  if (wOk) return { key: 'weight', label: 'Weight agrees', color: 'var(--brass)' }
  return { key: 'unmatched', label: 'Needs a look', color: 'var(--rust)' }
}
