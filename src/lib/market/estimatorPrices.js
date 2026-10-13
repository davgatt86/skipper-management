// Build the Estimator's price objects from the Daily Prices board.
// The board stores a unified vocabulary (Saithe/Monkfish/Pollack/Lemon) with
// A-grades for both markets (DK sort N -> "A"+N). The Estimator, however,
// expects PD names (Coley/Monks/Lythe/Lemons) keyed by A1..A5/U9 (+ A4c/A4m/A4ma
// for haddock) and DK names (Atlantic Cod/Saithe/...) keyed by sort NUMBER.
// This translates board rows into exactly those shapes so "Where to Land" can
// value an on-board tally against the latest board prices with no manual entry.

// board species -> Estimator PD species name (matches the estimator's SP_TO_PD)
const PD_NAME = {
  Cod: 'Cod', Haddock: 'Haddock', Whiting: 'Whiting', Catfish: 'Catfish', Saithe: 'Coley',
  Monkfish: 'Monks', Pollack: 'Lythe', Lemon: 'Lemons', Megrim: 'Megrim', Ling: 'Ling',
  Hake: 'Hake', Plaice: 'Plaice', Squid: 'Squid', Turbot: 'Turbot', Halibut: 'Halibut',
  Witch: 'Witch', Tusk: 'Tusk', Brill: 'Brill', Skate: 'Skate',
}
// board species -> Estimator DK species name (matches the estimator's SP_TO_DK)
const DK_NAME = {
  Cod: 'Atlantic Cod', Haddock: 'Haddock', Whiting: 'Whiting', Catfish: 'Catfishes', Saithe: 'Saithe',
  Monkfish: 'Monkfish', Pollack: 'Pollack', Lemon: 'Lemon Sole', Megrim: 'Megrim', Ling: 'Ling',
  Hake: 'European Hake', Plaice: 'European Plaice', Squid: 'Squid', Turbot: 'Turbot',
  Halibut: 'Atlantic Halibut', Witch: 'Witch Flounder', Tusk: 'Tusk',
}

// average a list of numbers, ignoring null/undefined; null if none
function avg(list) {
  const xs = list.filter(v => v != null && !isNaN(v)).map(Number)
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
}
const r2 = n => (n == null ? null : Math.round(n * 100) / 100)

/* AN UNSOLD GRADE DOES NOT VALUE A TALLY. David, Oct 2026: "don't use unsold
 * in estimator."
 *
 * The board prints a high and an average against a grade that did not clear,
 * and those are real prices for whatever did sell — but valuing a hold of fish
 * against a grade the market would not take is the wrong way to decide where
 * to land, which is the one question this page exists to answer.
 *
 * IT IS FILTERED PER ROW, BEFORE GROUPING, and that is the whole care in it.
 * The estimator averages the TWO most recent board days together, so a grade
 * unsold yesterday and sold today would otherwise blend a non-sale into a real
 * price. Dropped per row, the group simply keeps the day that cleared — the
 * most recent price the market actually paid, which is the right answer.
 *
 * ONLY `unsold === true` IS DROPPED. The column is nullable and null means the
 * row was filed before any of this was read, so a falsy test keeps every one
 * of the ~60,000 historical rows behaving exactly as it did. Treating null as
 * unsold would empty the board.
 *
 * A GRADE UNSOLD ON BOTH DAYS FALLS BACK TO ITS OWN LAST CLEARED PRICE.
 * David, Oct 2026: "fall back to it's own last cleared price." Not the other
 * market, and not nothing — the most recent day the market actually paid for
 * THAT grade. Borrowing Denmark prices a Scottish chipper off a different
 * auction, and valuing at nothing quietly drops part of the hold.
 *
 * THE WINDOW IS 14 DAYS AND IT IS MEASURED, NOT CHOSEN. Over the board's own
 * record, a grade that goes unsold clears again within one or two board days
 * 38 times out of 47; the longest spell ever recorded is 8 board days, which
 * is 11 calendar days across the weekends. 14 covers every spell on record
 * with headroom, and keeps the query at ~475 rows. Past that the price is too
 * old to value a hold with and the grade is reported unpriced instead — a
 * three-week-old price presented as today's is worse than no price.
 *
 * IT IS THE SAME ROW, PUT THROUGH THE SAME ARITHMETIC. The fallback day's row
 * is fed into the group exactly as a current row would be, so the haddock
 * blends and every other per-grade rule run unchanged — there is no second
 * pricing path to drift. All that is added is the DATE it came from.
 *
 * AND THE DATE IS REPORTED, because a price from last Tuesday valuing today's
 * tally is a decision the skipper is entitled to see. `lastCleared` carries
 * the grade, the day and how far back it is; `unsold` is what is still
 * unpriced after looking. The two are different facts and read differently.
 *
 * pdRows: market_prices records for the PD board over the lookback window —
 * the 2 LATEST days are what prices the tally, the rest exist only to answer
 * "when did this grade last clear". dkRows: the 2 latest DK days.
 * Each: { price_date, species, grade, subgrade, low, high, ave, unsold }.
 * Returns { pd, dk } in the Estimator's expected shape, plus `missing` (board
 * species the estimator cannot place), `lastCleared` (grades priced off an
 * older day, with that day) and `unsold` (grades that cleared nowhere in the
 * window and are not priced at all). */
export const LAST_CLEARED_WINDOW_DAYS = 14
export function buildEstimatorPrices(pdRows = [], dkRows = []) {
  const pd = {}, dk = {}
  const missing = new Set()
  const unsoldKeys = new Map()   // key -> readable label, for rows we dropped
  const lastCleared = []         // grades priced off an older day
  const unsold = []              // grades that cleared nowhere in the window

  const label = r => `${r.species} ${r.grade}${r.subgrade ? ' ' + r.subgrade : ''}`.trim()
  const keyOf = r => `${r.species}|${r.grade}|${r.subgrade || ''}`
  const hasPrice = r => r.ave != null || r.high != null

  // The two most recent board days are what price the tally. Anything older in
  // pdRows is lookback only — it must never quietly join the average.
  const pdDates = [...new Set(pdRows.map(r => r.price_date).filter(Boolean))].sort().reverse()
  const latest = pdDates[0] || null
  const pricingDays = new Set(pdDates.slice(0, 2))
  // No price_date at all means the caller passed the old two-day shape; price
  // every row, exactly as before, rather than silently returning nothing.
  const isPricingRow = r => (pdDates.length ? pricingDays.has(r.price_date) : true)

  // ---- group + average across the (up to 2) days ----
  // PD: key species|grade|subgrade
  const pdGroups = {}
  const add = (k, r) => {
    ;(pdGroups[k] = pdGroups[k] || { species: r.species, grade: r.grade, subgrade: r.subgrade, ave: [], high: [], low: [] })
    pdGroups[k].ave.push(r.ave); pdGroups[k].high.push(r.high); pdGroups[k].low.push(r.low)
  }
  for (const r of pdRows) {
    if (!isPricingRow(r)) continue
    const k = keyOf(r)
    if (r.unsold) { unsoldKeys.set(k, label(r)); continue }
    add(k, r)
  }

  // ---- fall back to the grade's own last cleared day --------------------
  // Only for grades with nothing left on EITHER pricing day. One unsold day
  // beside one that cleared is not news — that price stands.
  const dayMs = 86400000
  const cutoff = latest ? new Date(new Date(latest).getTime() - LAST_CLEARED_WINDOW_DAYS * dayMs).toISOString().slice(0, 10) : null
  for (const [k, lbl] of [...unsoldKeys].sort((a, b) => a[1].localeCompare(b[1]))) {
    if (pdGroups[k]) continue
    const back = pdRows
      .filter(r => keyOf(r) === k && !r.unsold && hasPrice(r) && !pricingDays.has(r.price_date)
        && (!cutoff || r.price_date >= cutoff))
      .sort((a, b) => String(b.price_date).localeCompare(String(a.price_date)))[0]
    if (!back) { unsold.push(lbl); continue }
    add(k, back)
    lastCleared.push({
      label: lbl,
      date: back.price_date,
      daysBack: latest ? Math.round((new Date(latest) - new Date(back.price_date)) / dayMs) : null,
    })
  }
  for (const g of Object.values(pdGroups)) {
    const name = PD_NAME[g.species]
    if (!name) { missing.add('PD ' + g.species); continue }
    const obj = (pd[name] = pd[name] || {})
    const ave = r2(avg(g.ave)), high = r2(avg(g.high))   // LOW intentionally dropped — never used to value a tally
    // Haddock follows the skipper's grading rule and is built on its own:
    //   A1 / A2 / A3 / A4 Chipper  -> AVG
    //   Metro                      -> A4 Metro HIGH   (key A4m)
    //   Mini Metro                 -> A4 Metro AVG    (key A4ma)
    //   A4 Round (cheap ungutted) and the LOW column are NEVER used.
    if (name === 'Haddock') {
      if (g.grade === 'A4') {
        const s = String(g.subgrade || '').toLowerCase()
        if (s.includes('chipper')) {
          if (ave != null) obj['A4c'] = ave
          if (high != null) obj['A4c (high)'] = high          // for the HIGH-page avg+high blend
        } else if (s.includes('metro')) {
          // Mini Metro (A4ma) and Metro (A4m) both come off this one Metro row.
          //   AVG page : Mini = blend(low,avg),  Metro = blend(avg,high)
          //   HIGH page: Mini = avg,             Metro = high
          const low = r2(avg(g.low))
          const miniAvg  = (low != null && ave != null)  ? r2((low + ave) / 2)  : (ave != null ? ave : low)
          const metroAvg = (ave != null && high != null) ? r2((ave + high) / 2) : (high != null ? high : ave)
          if (miniAvg  != null) obj['A4ma']   = miniAvg   // shown grade + AVG-page value
          if (metroAvg != null) obj['A4m']    = metroAvg  // shown grade + AVG-page value
          if (ave  != null)     obj['A4m_av'] = ave       // HIGH-page Mini  (hidden helper)
          if (high != null)     obj['A4m_hi'] = high      // HIGH-page Metro (hidden helper)
        }
        // 'round' / anything else on A4 -> ignored on purpose (no bare 'A4' key)
      } else if (ave != null) {
        obj[g.grade] = ave                                 // A1 / A2 / A3 -> AVG (shown)
        if (high != null) obj[g.grade + ' (high)'] = high  // for the HIGH-page avg+high blend
      }
      continue
    }
    // All other species: AVG (+ HIGH so the "Mid" toggle works). No LOW.
    if (ave != null) obj[g.grade] = ave
    if (high != null) obj[g.grade + ' (high)'] = high
  }

  // DK: key species|grade ; grade "A"+sort -> sort number; 'U'/blank -> '9'
  const dkGroups = {}
  for (const r of dkRows) {
    const k = `${r.species}|${r.grade}`
    ;(dkGroups[k] = dkGroups[k] || { species: r.species, grade: r.grade, ave: [] })
    dkGroups[k].ave.push(r.ave != null ? r.ave : r.high)  // DK board carries the avg in `ave`
  }
  for (const g of Object.values(dkGroups)) {
    const name = DK_NAME[g.species]
    if (!name) { missing.add('DK ' + g.species); continue }
    const sort = /^A\d$/.test(g.grade) ? g.grade.slice(1) : '9'   // A1->1, A0->0, U->9
    const ave = r2(avg(g.ave))
    if (ave == null) continue
    const obj = (dk[name] = dk[name] || {})
    obj[sort] = ave
  }

  return { pd, dk, missing: [...missing], unsold, lastCleared }
}

// Pick the 2 most recent distinct dates from a list of {price_date} rows.
export function latestTwoDates(dayRows = []) {
  return [...new Set(dayRows.map(d => d.price_date).filter(Boolean))].sort().reverse().slice(0, 2)
}
