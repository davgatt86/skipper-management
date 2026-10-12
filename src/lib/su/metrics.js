// One definition of every settlement figure, for both sheet formats.
//
// The two formats carry different things. Rather than two pages that each show
// whatever their own format happens to have, every figure is defined once here
// and each one says whether a format can produce it. The page then shows a
// number, or "n/a" with the reason — so it is obvious that a figure is missing
// because the sheet never had it, not because nobody built it.
//
// Coverage as at Aug 2026, counted from the live data:
//
//                        Audacious (12)   Beryl (363)
//   days at sea               12              343
//   weight landed             12                0
//   fuel used (litres)        12                0
//   trips                     12                0
//   recoveries                12                0
//   boat share                 0              363
//   fuel %                     0              363
//   settling VAT              12                0
//
// Note Beryl HAS days at sea on 94% of its settlements. Anything per day at
// sea is therefore available to both, even though the old app only showed it
// for Audacious.

export const NA_REASON = {
  weight: 'A Beryl sheet does not give weight landed',
  litres: 'A Beryl sheet does not give fuel in litres',
  recoveries: 'A Beryl sheet has no recoveries section',
  vat: 'A Beryl sheet does not show settling VAT',
  trips: 'A Beryl sheet is one landing, not a trip count',
  tripType: 'Beryl settlements are not split by trip type',
}

const sum = (rows, f) => rows.reduce((a, r) => a + (Number(f(r)) || 0), 0)
const nz = v => (Number(v) || 0)
const div = (a, b) => (b ? a / b : null)

/**
 * @param settlements rows from su_settlements for one boat and year
 * @param lines       su_settlement_lines for those settlements
 * @param format      'audacious' | 'beryl'
 */
export function computeMetrics({ settlements = [], lines = [], format = 'audacious' }) {
  const isBeryl = format === 'beryl'

  const gross = sum(settlements, s => s.total_income)
  const expenses = sum(settlements, s => s.total_expenses)
  const wages = sum(settlements, s => s.crew_wages_total)
  const recoveries = sum(settlements, s => s.total_recoveries)
  const days = sum(settlements, s => s.days_at_sea)
  const tonnes = sum(settlements, s => s.weight_landed) / 1000
  const litres = sum(settlements, s => s.fuel_used)
  const vat = sum(settlements, s => s.settling_vat)
  const trips = sum(settlements, s => s.trips)

  // The same idea under two names: what the boat keeps before the owner's own
  // costs. Audacious prints "owner's share", Beryl prints "boat share".
  const boatOwnerShare = isBeryl
    ? sum(settlements, s => s.boat_share)
    : sum(settlements, s => s.owners_share)

  // Fuel is a named expense line on both, so the percentage works for both
  // even though only Beryl prints it on the sheet.
  const fuelSpend = lines
    .filter(l => /^fuel/i.test(l.label || ''))
    .reduce((a, l) => a + nz(l.amount), 0)

  const n = settlements.length

  const M = (value, unavailable = null) => ({ value, unavailable })
  const NA = reason => ({ value: null, unavailable: reason })

  return {
    // ---- counts -------------------------------------------------------
    settlements: M(n),
    daysAtSea: M(days || null),
    trips: isBeryl ? NA(NA_REASON.trips) : M(trips || null),
    tonnesLanded: isBeryl ? NA(NA_REASON.weight) : M(tonnes || null),

    // ---- money, both formats -----------------------------------------
    gross: M(gross),
    expenses: M(expenses),
    crewWages: M(wages),
    boatOwnerShare: M(boatOwnerShare),
    afterExpenses: M(gross - expenses),
    avgGrossPer: M(div(gross, n)),
    avgBoatOwnerSharePer: M(div(boatOwnerShare, n)),
    bestLanding: M(n ? Math.max(...settlements.map(s => nz(s.total_income))) : null),

    // ---- percentages, both formats ------------------------------------
    boatOwnerSharePct: M(gross ? (boatOwnerShare / gross) * 100 : null),
    expensesPctOfGross: M(gross ? (expenses / gross) * 100 : null),
    crewSharePctOfGross: M(gross ? (wages / gross) * 100 : null),
    fuelPctOfGross: M(gross && fuelSpend ? (fuelSpend / gross) * 100 : null),

    // ---- per day at sea. Available to BOTH — Beryl records days too. ---
    grossPerDay: M(div(gross, days)),
    boatOwnerSharePerDay: M(div(boatOwnerShare, days)),
    expensesPerDay: M(div(expenses, days)),

    // ---- Audacious only ------------------------------------------------
    recoveries: isBeryl ? NA(NA_REASON.recoveries) : M(recoveries),
    cashGenerated: isBeryl ? NA(NA_REASON.recoveries) : M(recoveries + boatOwnerShare),
    settlingVat: isBeryl ? NA(NA_REASON.vat) : M(vat),
    fishPricePerTonne: isBeryl ? NA(NA_REASON.weight) : M(div(gross, tonnes)),
    fuelLitres: isBeryl ? NA(NA_REASON.litres) : M(litres || null),
    fuelPricePerLitre: isBeryl ? NA(NA_REASON.litres) : M(div(fuelSpend, litres)),
    litresPerTonne: isBeryl ? NA(NA_REASON.litres) : M(div(litres, tonnes)),
  }
}

// Per-settlement rows for the trip comparison table. Anything the format
// cannot produce comes back null and is shown as n/a rather than zero —
// a zero here would quietly drag an average down.
export function perSettlement(s, lines, format) {
  const isBeryl = format === 'beryl'
  const income = nz(s.total_income)
  const days = nz(s.days_at_sea)
  const tonnes = nz(s.weight_landed) / 1000
  const share = isBeryl ? nz(s.boat_share) : nz(s.owners_share)
  const fuelSpend = (lines || [])
    .filter(l => l.settlement_id === s.id && /^fuel/i.test(l.label || ''))
    .reduce((a, l) => a + nz(l.amount), 0)

  return {
    id: s.id,
    date: s.settling_date,
    reference: s.reference,
    tripType: s.trip_type || 'fishing',
    income,
    expenses: nz(s.total_expenses),
    wages: nz(s.crew_wages_total),
    share,
    days: days || null,
    tonnes: isBeryl ? null : (tonnes || null),
    sharePerDay: days ? share / days : null,
    grossPerDay: days ? income / days : null,
    cashPerTonne: !isBeryl && tonnes ? (nz(s.cash_generated) / tonnes) : null,
    pricePerTonne: !isBeryl && tonnes ? income / tonnes : null,
    fuelPct: income && fuelSpend ? (fuelSpend / income) * 100 : null,
    // Tonnes needed just to cover this trip's expenses at its own fish price.
    breakEvenTonnes: !isBeryl && tonnes && income
      ? nz(s.total_expenses) / (income / tonnes)
      : null,
  }
}

// ---- display helpers -------------------------------------------------
export const money = v => (v == null ? null : '£' + Math.round(v).toLocaleString('en-GB'))
export const money2 = v => (v == null ? null : '£' + Number(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
export const pct = v => (v == null ? null : v.toFixed(1) + '%')
export const qty = (v, unit) => (v == null ? null : Math.round(v).toLocaleString('en-GB') + (unit ? ' ' + unit : ''))

/* "% OF INCOME" — DERIVED, AND IT WAS A DEAD COLUMN FOR 381 SETTLEMENTS.
 *
 * The settlement page has printed a "% of income" heading since it was built,
 * over a column reading `su_settlement_lines.pct_income`. Measured Oct 2026:
 * ZERO of 3,505 lines across ALL 381 settlements carry one, and nothing in
 * this repo writes it — the reader is never asked for a line percentage (the
 * Audacious prompt takes `label` and `amount`; Beryl's two percentages are
 * sheet-level), and `SettlementImport` inserts five columns of which that is
 * not one. So every row printed an em dash under a heading promising a figure
 * the app had no way to hold. Found by David asking why the column was empty.
 *
 * IT IS COMPUTED RATHER THAN READ, and that is not this codebase's usual call.
 * A currency conversion keeps its printed original because it rests on a rate
 * nobody put on the document; this rests on two figures already on the sheet
 * and already reconciled against it, so it is the m³ conversion case — exact,
 * derivable, with no source that can be lost. Nothing to store, nothing to
 * drift, and no second copy of a figure the sheet already carries.
 *
 * THE DENOMINATOR IS THE SETTLEMENT'S OWN `total_income`, NEVER THE SUM OF THE
 * INCOME LINES, and the record is emphatic about why: 365 of 389 settlements
 * have NO income lines at all — a Beryl sheet carries a gross sales figure and
 * no income section. Summing the lines would have divided by zero on 94% of
 * the record while looking perfectly right on the 24 Audacious sheets in front
 * of me. Every one of the 389 carries a usable total_income.
 *
 * NO INCOME IS NO PERCENTAGE — never 0%, never Infinity. The same rule as a
 * quota line with no allocation: there is nothing to divide by, so there is no
 * answer, and an em dash says exactly that where "0.00" would be a claim.
 *
 * AND A BLANK AMOUNT IS NOT AN AMOUNT OF NOUGHT. `Number(null)` and
 * `Number('')` are both 0 and both pass `Number.isFinite`, so the first cut of
 * this returned a confident 0.00% for a line carrying no figure at all — the
 * eighth time that trap has been hit here, after the engine hours, the gear mm,
 * the invoice VAT, the invoice page, the running hours, the risk rating and the
 * ORB reading. Caught by the test, not by reading it back. A line that came to
 * nothing IS 0.00%, and one with no figure is an em dash; the two must not
 * print alike.
 */
const blank = v => v == null || (typeof v === 'string' && v.trim() === '')

export function pctOfIncome(amount, totalIncome) {
  if (blank(totalIncome) || blank(amount)) return null
  const inc = Number(totalIncome)
  if (!Number.isFinite(inc) || inc <= 0) return null
  const amt = Number(amount)
  if (!Number.isFinite(amt)) return null
  return (amt / inc) * 100
}
