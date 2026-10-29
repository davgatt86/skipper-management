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
 * A0, A+1, A1, A-1, A+2, A2, A-2 ... then Sort 1, Sort 2 ... then everything
 * else alphabetically. A4 haddock sub-grades order Chipper > Metro > Mini Metro.
 *
 * THE MINUS MARK ARRIVED Oct 2026 and matched nothing here: `A(\+)?(\d+)` fails
 * on `A-2`, so it fell to major 900 and sorted below every real grade, at the
 * foot of the list with the unrecognised labels. The mark decides the order
 * WITHIN a size \u2014 A+ above the plain grade, A- below it \u2014 which is the same
 * reading the A4 split uses: the digit is the size, the mark is the quality. */
const SUB_ORDER = { 'Chipper': 1, 'Metro': 2, 'Mini Metro': 3 }
const MARK_ORDER = { '+': 0, '': 1, '-': 2 }
export function gradeSortKey(label) {
  const [g, sub] = String(label).split(' \u00b7 ').map(s => s.trim())
  let major = 900, minor = 5
  const m = g.match(/^A([+-])?(\d+)/i)
  if (m) { major = Number(m[2]); minor = MARK_ORDER[m[1] || ''] }
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
 * THE HADDOCK SPLIT MOVED FROM A4 TO A2 — Don notes, 20-10-2026
 *
 * David, Oct 2026: *"Good seed on Don Company sales notes from 20/10/26
 * onwards is A1. seed and chippers are A2 (create a new split for these), A3
 * is metro, A4 is mini. do not change sales notes from before 20/10/26 as old
 * split was accurate for older sales note."*
 *
 * So the note's A-number is now the grading code's leading DIGIT:
 *
 *     A1 -> 1a 1b 1c 1d   XL · Chat · Pinger · Good Seed
 *     A2 -> 2a 2b         Seed · Chipper          <- the split lives here now
 *     A3 -> 3             Metro                   <- one grade, nothing to split
 *     A4 -> 4             Mini Metro              <- one grade, nothing to split
 *
 * BEFORE the changeover A4 was Chipper + Metro + Mini together, which is the
 * whole reason a split existed at all. Those notes are untouched — the old
 * three-way split was right for them and re-labelling four years of history on
 * a rule that started in October would be inventing a record.
 *
 * CHIPPER IS THE DEAREST BAND IN A4 AND THE CHEAPEST IN A2, and that is the
 * one thing to get right here. The word has not changed and its company has:
 * inside size 4 (Chipper 2b / Metro 3 / Mini 4) it is the BIGGEST fish, and
 * inside size 2 (Seed 2a / Chipper 2b) it is the smaller of the two. Measured
 * on the board rather than reasoned about — every one of the six days since
 * the ladder changed prints Seed above Chipper:
 *
 *     21-10  Seed 5.68  Chipper 4.74      26-10  Seed 4.64  Chipper 3.21
 *     22-10  Seed 5.39  Chipper 3.44      28-10  Seed 4.91  Chipper 4.43
 *     23-10  Seed 4.95  Chipper 3.46      29-10  Seed 4.57  Chipper 3.90
 *
 * Copying the old split's orientation would have put every label the wrong way
 * round, and the record is what later trips get priced off.
 * ------------------------------------------------------------------------ */
export const LADDER_CHANGEOVER = '2026-10-20'

/* Bands are always CHEAPEST FIRST — that is what makes the price ranking a
   size ranking, and it is the only ordering either split function knows. */
export const SPEC_A4 = { digit: '4', family: 'size-4', bands: ['Mini Metro', 'Metro', 'Chipper'] }
export const SPEC_A2 = { digit: '2', family: 'size-2', bands: ['Chipper', 'Seed'] }

/* --------------------------------------------------------------------------
 * WHICH SPLIT A LANDING GETS — the date decides, and the agent gates it.
 *
 * IT IS DON'S CHANGE, so a P&J note keeps the old ladder whatever the date:
 * 645 size-4 haddock rows in this record came off P&J notes and nothing says
 * that firm has re-cut anything. Hanstholm's A2 is a Danish sort and has
 * nothing to do with Peterhead grading at all.
 *
 * NO DATE MEANS OLD, which is the conservative direction and the one David
 * asked for — a note that cannot be shown to be on or after 20-10 has not been
 * shown to need changing. An undated note is its own fault to fix (the
 * Shetland tally layout filed one with no date at all), not a reason to guess.
 * ------------------------------------------------------------------------ */
export function haddockSpec(market, landingDate) {
  const isDon = /don fishing/i.test(String(market == null ? '' : market))
  if (!isDon) return SPEC_A4
  const d = String(landingDate == null ? '' : landingDate).slice(0, 10)
  return d >= LADDER_CHANGEOVER ? SPEC_A2 : SPEC_A4
}

/* --------------------------------------------------------------------------
 * THE SIZE FAMILY — one size digit, whatever quality mark the office printed.
 *
 * David, Oct 2026: *"fish sold as A4+ not coming through the haddock split
 * part."* Both split functions and the page filtered `grade === 'A4'`, so on
 * the note of 28-10-2026 the split saw 24 boxes of the 147 size-4 haddock
 * actually landed — 123 of them sold as A+4 and were invisible to it.
 *
 * THE DIGIT IS THE SIZE; THE +/-/NOTHING IS THE QUALITY MARK. The sub-grades
 * are a SIZE distinction inside one digit, so they apply to `A+2` and `A-2`
 * exactly as to `A2`. `A-` is new — the note of 28-10 is the first to carry a
 * minus mark at all — and leaving it out is the same bug waiting on one box.
 * ------------------------------------------------------------------------ */
/** The quality mark of a grade at this size digit: '+', '-', '' — else null. */
export function sizeMark(grade, digit) {
  const m = String(grade == null ? '' : grade).trim()
    .match(new RegExp('^A([+-]?)' + digit + '$', 'i'))
  return m ? (m[1] || '') : null
}
/** Every haddock row of a landing at this size digit, any quality mark. */
export function familyRows(rows, digit) {
  return (rows || []).filter(r =>
    (r.species_canon || r.species) === 'Haddock' && sizeMark(r.grade, digit) != null)
}
/* The size-4 pair kept by name, because three callers and the pre-changeover
   path all mean exactly that and a digit argument would read as a choice. */
export const a4Mark = (grade) => sizeMark(grade, '4')
export const a4FamilyRows = (rows) => familyRows(rows, '4')

const markName = (k, digit) => 'A' + k + digit
const noneMsg = (spec) => `No ${spec.family} Haddock rows in this landing (${
  ['', '+', '-'].map(k => markName(k, spec.digit)).join(', ')}).`

/* THE PRICE RANKING HAPPENS WITHIN ONE QUALITY MARK AND NEVER ACROSS IT, and
 * that is the whole care in this area. The split reads SIZE out of the price
 * spread; across marks the spread is partly QUALITY, so a pooled ranking would
 * read the A+ premium as bigger fish. Measured on the real note of 28-10: every
 * A4 row (£2.04–£2.21/kg) is cheaper than every A+4 row (£2.39–£2.66), so one
 * pooled ladder would have labelled all 24 A4 boxes Mini Metro purely for being
 * the A-quality ones. Within a mark, cheapest really does mean smallest. */
const marksOf = (tgt, digit) => {
  const m = new Map()
  for (const r of tgt) {
    const k = sizeMark(r.grade, digit)
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(r)
  }
  return m
}
const pxOf = r => Number(r.price_per_kg || 0) || Number(r.price_per_box || 0)
/* THE SPLIT IS MEASURED IN WHATEVER THE TOTALS ARE MEASURED IN, and the two
 * documents differ. The wheelhouse tally counts BOXES; the catch overview is an
 * OCR text layer whose box column comes back 960 of 1,037 while every weight
 * reconciles exactly to the printed total, so it can only be trusted on KG.
 * The allocation itself is a ratio either way, so this changes no answer on the
 * boxes path — what it changes is that `entered` and `actual` are then the same
 * kind of thing, instead of comparing 1,898 kg against 67 boxes and flagging it. */
const amountOf = (r, measure) => measure === 'kg'
  ? Number(r.total_weight ?? r.weight_kg ?? 0) || 0
  : Number(r.boxes || 0)
const boxesOf = r => amountOf(r, 'boxes')

/* --------------------------------------------------------------------------
 * Auto-split by price band.
 * Sort a mark's rows by £/kg and cut at the largest gaps between distinct
 * price levels — one cut fewer than there are bands. Bands are cheapest first,
 * so the bottom band is the smallest fish.
 *
 * Done per QUALITY MARK, for the reason above — pooled, the largest gap on the
 * 28-10 note is the A/A+ boundary itself, so the detector would have found the
 * quality step and called it a size band.
 * ------------------------------------------------------------------------ */
export function autoSplitHaddock(rows, spec = SPEC_A4) {
  const tgt = familyRows(rows, spec.digit)
  if (!tgt.length) return { error: noneMsg(spec) }
  const need = spec.bands.length
  const updates = [], bands = {}, thin = []
  for (const [mark, group] of marksOf(tgt, spec.digit)) {
    const prices = [...new Set(group.map(r => r2(pxOf(r))))].sort((a, b) => a - b)
    if (prices.length < need) {
      /* NAMED, NOT SILENTLY SKIPPED. A mark left unsplit while another is
         split would otherwise read as fish that was never landed. */
      thin.push(`${markName(mark, spec.digit)} has only ${prices.length} distinct price level(s), and ${need} bands need ${need}`)
      continue
    }
    const gaps = []
    for (let i = 1; i < prices.length; i++) gaps.push({ at: i, gap: prices[i] - prices[i - 1] })
    gaps.sort((a, b) => b.gap - a.gap)
    const cuts = gaps.slice(0, need - 1).map(g => g.at).sort((a, b) => a - b)
    /* The ceiling of each band but the dearest. A row at or below cuts[i]'s
       price sits in band i; anything above the last ceiling is the top band. */
    const ceil = cuts.map(c => prices[c - 1])
    for (const r of group) {
      const p = r2(pxOf(r))
      let i = 0
      while (i < ceil.length && p > ceil[i]) i++
      updates.push({ id: r.id, sub_grade: spec.bands[i] })
    }
    bands[markName(mark, spec.digit)] = ceil.map((c, i) => ({ band: spec.bands[i], max: c }))
  }
  if (!updates.length) return { error: `Not enough price spread to detect bands — ${thin.join('; ')}. Set sub-grades manually.` }
  return { updates, bands, thin }
}

/* --------------------------------------------------------------------------
 * Split by MANUAL trip totals.
 * The skipper keys the boxes of each band he graded that trip; they are
 * allocated across the landing's rows by price rank. Whole rows are assigned
 * by where their box-midpoint falls, so a row never gets two labels.
 *
 * THE TOTALS ARE APPORTIONED, NOT TAKEN AS BOX COUNTS, and that is the second
 * fault this fixes. The cuts used to be absolute — `miniCut = mini` — so when
 * the entered totals exceeded what the note carried, EVERY row fell under the
 * bottom cut and the whole landing came out one band. That is what happened on
 * 28-10: 221 boxes entered against 24 the page could see, and all 24 came back
 * Mini Metro while the page reported *"Mini 144 / Metro 52 / Chipper 25
 * allocated by price"* — a three-way split that never took place.
 *
 * What the skipper actually knows is the SHAPE of his grading, so that ratio is
 * what is applied to the rows the note really carries. Where the totals do
 * match the landed boxes this is arithmetically identical to the old absolute
 * cut, which is asserted by test — a generalisation, not a change of answer.
 *
 * `totals` is keyed by BAND NAME, so there is one vocabulary rather than a
 * {mini, metro, chipper} shorthand that would need a second mapping per spec.
 *
 * Returns { updates, actual, entered, diff, flag, assigned, marks } where
 * `assigned` is what was ACTUALLY labelled. The page must report that rather
 * than the entry: reporting the intention is what made the old message claim a
 * split it had not performed.
 * ------------------------------------------------------------------------ */
export function splitHaddockByTotals(rows, totals, spec = SPEC_A4, measure = 'boxes') {
  const tgt = familyRows(rows, spec.digit)
  if (!tgt.length) return { error: noneMsg(spec) }
  const amt = (r) => amountOf(r, measure)
  const want = spec.bands.map(b => Math.max(0, Number((totals || {})[b]) || 0))
  const entered = r2(want.reduce((s, v) => s + v, 0))
  /* NO TOTALS IS NOT A SPLIT INTO NOTHING. With every box unassigned the
     ratio is undefined, so there is nothing to apportion and saying so beats
     labelling the whole landing one band by default. */
  if (!entered) return { error: `Enter the boxes of ${spec.bands.join(' and ')} for this trip first.` }

  const actual = r2(tgt.reduce((s, r) => s + amt(r), 0))
  const assigned = {}, marks = []
  for (const b of spec.bands) assigned[b] = 0
  const updates = []
  for (const [mark, group] of marksOf(tgt, spec.digit)) {
    const sorted = [...group].sort((a, b) => pxOf(a) - pxOf(b))      // cheapest first
    const n = sorted.reduce((s, r) => s + amt(r), 0)
    /* Running ceilings in BOXES: band i ends once its share of the entered
       ratio is used up. The shares sum to exactly n, so the last band always
       takes the remainder and no row can fall off the end. */
    let acc = 0
    const ceil = want.map(v => (acc += n * (v / entered)))
    const mine = {}
    for (const b of spec.bands) mine[b] = 0
    let cum = 0
    for (const r of sorted) {
      const b = amt(r)
      const mid = cum + b / 2
      cum += b
      /* THE CUTS CANNOT CROSS, by construction — the shares are a partition of
         n, so the ceilings only ever increase. They do MEET, exactly, where a
         band was graded as nothing, and a row whose midpoint lands on that line
         goes to the CHEAPER band: calling a box Seed when it was Chipper, or
         Chipper when it was Mini, overstates the dear grade, and this record is
         what later trips are priced off. `<=` is what keeps that true. */
      let i = 0
      while (i < spec.bands.length - 1 && mid > ceil[i]) i++
      const sub = spec.bands[i]
      updates.push({ id: r.id, sub_grade: sub })
      mine[sub] += b
      assigned[sub] += b
    }
    marks.push({ mark: markName(mark, spec.digit), boxes: r2(n), assigned: { ...mine } })
  }
  for (const k of Object.keys(assigned)) assigned[k] = r2(assigned[k])
  const diff = r2(entered - actual)
  return { updates, actual, entered, diff, flag: Math.abs(diff) > 3, assigned, marks, measure }
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

/* buyerLeague() was removed Aug 2026. It ranked buyers on raw £/kg within a
 * species and grade, averaged over the whole period — which mostly measures
 * WHEN a buyer happened to be bidding, because prices move week to week. Two
 * tables both called "buyer league", ranking differently, is worse than one.
 * buyerPremiumLeague() below is the day-relative replacement. */


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
  /* GRADE FOR GRADE BY DEFAULT.
   *
   * With this off, the day's market average is taken across every grade of a
   * species at once — so a buyer who only took the top grade shows a premium
   * he has not earned, and one who took the cheap end looks mean. That is a
   * comparison between grades dressed up as a comparison between buyers.
   * Opt out with `byGrade: false` if you genuinely want the species-level view. */
  const byGrade = opts.byGrade !== false

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

/* How much of the fish in scope has no buyer against it.
 *
 * Rows with no buyer are dropped from every buyer breakdown — correctly, since
 * you cannot score a bid you cannot attribute. But dropping them silently
 * makes the league look complete when it is not, and the reader has no way to
 * tell a quiet buyer from a missing one.
 *
 * These rows are otherwise whole: species, grade, weight and value are all
 * there. So gross, tonnage, £/kg and species mix are unaffected — the hole is
 * confined to buyer attribution, and that is worth saying on the page. */
export function buyerCoverage(rows, landingById) {
  let blankRows = 0, blankValue = 0, blankKg = 0, totalValue = 0
  const byLanding = {}
  for (const r of rows) {
    const v = Number(r.value) || 0
    totalValue += v
    if (String(r.buyer || '').trim()) continue
    blankRows++; blankValue += v; blankKg += Number(r.weight_kg) || 0
    const l = landingById?.[r.landing_id]
    const o = (byLanding[r.landing_id] = byLanding[r.landing_id] ||
      { date: l?.landing_date || '', vessel: l?.vessel || '', market: l?.market || '', value: 0, rows: 0 })
    o.value += v; o.rows++
  }
  const landings = Object.values(byLanding).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return {
    blankRows, blankValue: r2(blankValue), blankKg: r2(blankKg), totalValue: r2(totalValue),
    pct: totalValue ? r2((100 * blankValue) / totalValue) : 0,
    landings,
  }
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
