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
 * A GRADE DROPPED ON BOTH DAYS IS REPORTED, NOT SILENTLY LOST. It then has no
 * price at all, and `resolvePrice` falls back within the A4 family or returns
 * null so the other market is borrowed — safe, but invisible. The skipper is
 * told which grades are unpriced and why, because "the market would not take
 * your chippers" is the single most useful thing the board can say to a man
 * deciding where to land.
 *
 * pdRows / dkRows: market_prices records from the 2 latest days for that
 * source. Each: { species, grade, subgrade, low, high, ave, unsold }.
 * Returns { pd, dk } in the Estimator's expected shape, plus `missing` (board
 * species the estimator cannot place) and `unsold` (grades left unpriced
 * because they did not clear on either day). */
export function buildEstimatorPrices(pdRows = [], dkRows = []) {
  const pd = {}, dk = {}
  const missing = new Set()
  const unsoldKeys = new Map()   // key -> readable label, for rows we dropped

  const label = r => `${r.species} ${r.grade}${r.subgrade ? ' ' + r.subgrade : ''}`.trim()

  // ---- group + average across the (up to 2) days ----
  // PD: key species|grade|subgrade
  const pdGroups = {}
  for (const r of pdRows) {
    const k = `${r.species}|${r.grade}|${r.subgrade || ''}`
    if (r.unsold) { unsoldKeys.set(k, label(r)); continue }
    ;(pdGroups[k] = pdGroups[k] || { species: r.species, grade: r.grade, subgrade: r.subgrade, ave: [], high: [], low: [] })
    pdGroups[k].ave.push(r.ave); pdGroups[k].high.push(r.high); pdGroups[k].low.push(r.low)
  }
  // Only the grades with nothing left on EITHER day are unpriced. One unsold
  // day beside one that cleared is not news — the price stands.
  const unsold = [...unsoldKeys].filter(([k]) => !pdGroups[k]).map(([, v]) => v).sort()
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

  return { pd, dk, missing: [...missing], unsold }
}

// Pick the 2 most recent distinct dates from a list of {price_date} rows.
export function latestTwoDates(dayRows = []) {
  return [...new Set(dayRows.map(d => d.price_date).filter(Boolean))].sort().reverse().slice(0, 2)
}
