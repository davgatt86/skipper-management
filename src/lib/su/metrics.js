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
