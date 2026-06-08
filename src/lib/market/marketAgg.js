// Pure aggregation for the Daily Prices page: period keys, board deltas,
// price/volume trend series, and month insights. No I/O, easy to reason about.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function isoWeek(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z')
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day + 3)
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round(((d - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7)
  return { year: d.getUTCFullYear(), week }
}

// Period bucket for a date. gran: 'week' | 'month'.
// Returns { full, label, year, oy }  (oy = ordinal-within-year for compare mode)
export function periodKey(dateStr, gran) {
  const y = dateStr.slice(0, 4)
  if (gran === 'week') {
    const { year, week } = isoWeek(dateStr)
    const w = String(week).padStart(2, '0')
    return { full: `${year}-W${w}`, label: `${year} W${w}`, year: String(year), oy: `W${w}` }
  }
  const m = dateStr.slice(5, 7)
  return { full: `${y}-${m}`, label: `${MONTHS[+m - 1]} ${y}`, year: y, oy: MONTHS[+m - 1] }
}

const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null
const r2 = n => n == null ? null : Math.round(n * 100) / 100

export function speciesFor(prices, source) {
  const set = new Set()
  for (const p of prices) if (source === 'Combined' || p.source === source) set.add(p.species)
  return [...set].sort()
}

export function gradesFor(prices, source, species) {
  const set = new Set()
  for (const p of prices) {
    if (source !== 'Combined' && p.source !== source) continue
    if (p.species !== species) continue
    set.add(p.subgrade ? `${p.grade} ${p.subgrade}` : p.grade)
  }
  // natural-ish sort: A1, A2, ... then others
  return [...set].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
}

const gradeKey = p => (p.subgrade ? `${p.grade} ${p.subgrade}` : p.grade)

// Board: latest day per source, each row with Δ vs previous day and vs 4-wk avg.
export function buildBoard(prices, source) {
  const rows = prices.filter(p => p.source === source)
  if (!rows.length) return { date: null, items: [] }
  const dates = [...new Set(rows.map(p => p.price_date))].sort()
  const latest = dates[dates.length - 1]
  const prev = dates[dates.length - 2]
  const cutoff28 = latest ? new Date(new Date(latest).getTime() - 28 * 86400000).toISOString().slice(0, 10) : null
  const keyOf = p => `${p.species}|${gradeKey(p)}`
  const byKeyDate = {}
  for (const p of rows) (byKeyDate[keyOf(p)] = byKeyDate[keyOf(p)] || {})[p.price_date] = p
  const items = []
  for (const p of rows.filter(p => p.price_date === latest)) {
    const hist = byKeyDate[keyOf(p)]
    const prevP = prev ? hist[prev] : null
    const recent = Object.entries(hist).filter(([d]) => d > cutoff28 && d < latest).map(([, v]) => v.ave).filter(v => v != null)
    const avg4 = mean(recent)
    items.push({
      species: p.species, grade: gradeKey(p),
      low: p.low, high: p.high, ave: p.ave,
      dDay: prevP && prevP.ave != null && p.ave != null ? r2(p.ave - prevP.ave) : null,
      d4wk: avg4 != null && p.ave != null ? r2(p.ave - avg4) : null,
    })
  }
  items.sort((a, b) => a.species.localeCompare(b.species) || a.grade.localeCompare(b.grade, 'en', { numeric: true }))
  return { date: latest, items }
}

// Price trend series — one line per species+grade (grades are toggled on/off).
// source: 'PD'|'DK'|'Combined' (Combined splits each line by market).
// metric 'ave'|'high'|'low'. compareYears -> x = ordinal-within-year, one
// series per year.
export function buildPriceSeries(prices, { selections, source, gran, metric, compareYears, years }) {
  const buckets = {}
  const xset = new Set()
  const selMap = {}
  for (const s of selections) selMap[s.species] = s.grades
  for (const p of prices) {
    if (source !== 'Combined' && p.source !== source) continue
    const grades = selMap[p.species]
    if (!grades || !grades.has(gradeKey(p))) continue
    const v = p[metric]
    if (v == null) continue
    const pk = periodKey(p.price_date, gran)
    if (compareYears && years.length && !years.includes(pk.year)) continue
    let key = `${p.species} ${gradeKey(p)}`
    if (source === 'Combined') key += ` ${p.source}`
    if (compareYears) key += ` ${pk.year}`
    const x = compareYears ? pk.oy : pk.full
    xset.add(x)
    const b = buckets[key] = buckets[key] || {}
    ;(b[x] = b[x] || []).push(v)
  }
  return assemble(buckets, xset, compareYears, gran)
}

// Volume trend series. labels selected; PD->boxes, DK->kg.
export function buildVolumeSeries(volumes, { labels, source, gran, compareYears, years }) {
  const buckets = {}
  const xset = new Set()
  for (const v of volumes) {
    if (source !== 'Combined' && v.source !== source) continue
    if (labels.length && !labels.includes(v.label)) continue
    const val = v.source === 'PD' ? v.boxes : v.kg
    if (val == null) continue
    const pk = periodKey(v.price_date, gran)
    if (compareYears && years.length && !years.includes(pk.year)) continue
    const key = source === 'Combined' ? `${v.label} ${v.source}` : v.label
    const fullKey = compareYears ? `${key} ${pk.year}` : key
    const x = compareYears ? pk.oy : pk.full
    xset.add(x)
    const b = buckets[fullKey] = buckets[fullKey] || {}
    ;(b[x] = b[x] || []).push(val)
  }
  return assemble(buckets, xset, compareYears, gran, true)
}

function assemble(buckets, xset, compareYears, gran, sum = false) {
  const xs = [...xset].sort((a, b) =>
    compareYears
      ? (gran === 'month' ? MONTHS.indexOf(a) - MONTHS.indexOf(b) : a.localeCompare(b))
      : a.localeCompare(b))
  const keys = Object.keys(buckets).sort()
  const data = xs.map(x => {
    const row = { x }
    for (const k of keys) {
      const vals = buckets[k][x]
      row[k] = vals ? r2(sum ? vals.reduce((s, v) => s + v, 0) : mean(vals)) : null
    }
    return row
  })
  return { data, keys }
}

// Month insights for a species: best/worst avg-price month, most/least volume month.
export function monthInsights(prices, volumes, species, source) {
  const pr = prices.filter(p => p.species === species && (source === 'Combined' || p.source === source) && p.ave != null)
  const byMonth = {}
  for (const p of pr) {
    const k = p.price_date.slice(0, 7)
    ;(byMonth[k] = byMonth[k] || []).push(p.ave)
  }
  const priceMonths = Object.entries(byMonth).map(([m, a]) => ({ m, ave: r2(mean(a)) }))
  const vol = volumes.filter(v => (source === 'Combined' || v.source === source) &&
    v.label.toLowerCase().includes(species.toLowerCase()))
  const byMonthV = {}
  for (const v of vol) {
    const k = v.price_date.slice(0, 7)
    const val = v.source === 'PD' ? v.boxes : v.kg
    if (val != null) byMonthV[k] = (byMonthV[k] || 0) + val
  }
  const volMonths = Object.entries(byMonthV).map(([m, t]) => ({ m, total: r2(t) }))
  const top = (arr, k) => arr.length ? arr.reduce((a, b) => b[k] > a[k] ? b : a) : null
  const bot = (arr, k) => arr.length ? arr.reduce((a, b) => b[k] < a[k] ? b : a) : null
  return {
    bestPrice: top(priceMonths, 'ave'), worstPrice: bot(priceMonths, 'ave'),
    mostVol: top(volMonths, 'total'), leastVol: bot(volMonths, 'total'),
    scatter: priceMonths.map(p => ({ m: p.m, ave: p.ave, vol: byMonthV[p.m] ?? null })).filter(d => d.vol != null),
  }
}

export function monthLabel(m) {
  if (!m) return '—'
  return `${MONTHS[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`
}
