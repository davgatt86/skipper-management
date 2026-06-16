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

/* pdRows / dkRows: market_prices records from the 2 latest days for that source.
 * Each: { species, grade, subgrade, low, high, ave }.
 * Returns { pd, dk } in the Estimator's expected shape, plus a `missing` note
 * listing board species the estimator can't place (so the UI can flag them). */
export function buildEstimatorPrices(pdRows = [], dkRows = []) {
  const pd = {}, dk = {}
  const missing = new Set()

  // ---- group + average across the (up to 2) days ----
  // PD: key species|grade|subgrade
  const pdGroups = {}
  for (const r of pdRows) {
    const k = `${r.species}|${r.grade}|${r.subgrade || ''}`
    ;(pdGroups[k] = pdGroups[k] || { species: r.species, grade: r.grade, subgrade: r.subgrade, ave: [], high: [], low: [] })
    pdGroups[k].ave.push(r.ave); pdGroups[k].high.push(r.high); pdGroups[k].low.push(r.low)
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
        if (s.includes('chipper')) { if (ave != null) obj['A4c'] = ave }
        else if (s.includes('metro')) { if (ave != null) obj['A4ma'] = ave; if (high != null) obj['A4m'] = high }
        // 'round' / anything else on A4 -> ignored on purpose (no bare 'A4' key)
      } else if (ave != null) {
        obj[g.grade] = ave   // A1 / A2 / A3 -> AVG only
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

  return { pd, dk, missing: [...missing] }
}

// Pick the 2 most recent distinct dates from a list of {price_date} rows.
export function latestTwoDates(dayRows = []) {
  return [...new Set(dayRows.map(d => d.price_date).filter(Boolean))].sort().reverse().slice(0, 2)
}
