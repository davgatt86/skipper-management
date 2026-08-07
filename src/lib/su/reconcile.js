import { supabase } from '../../supabaseClient'

// Comparing the worksheet that went to the office against the settlement that
// came back.
//
// Only things that mean the same on both sides are compared. Quantities are
// checked as quantities and money as money — comparing 27,500 litres against a
// pound figure would be worse than not checking at all. Anything with no
// counterpart says so rather than showing a difference of zero, because a zero
// difference reads as "checked and fine".

const n = v => Number(v || 0) || 0
const TOL_MONEY = 0.01
const TOL_QTY = 0.5

// A settlement covers the trip that was landed shortly before it was settled.
// Nothing carries a trip number on both sides, so the nearest worksheet by
// date inside a window is a candidate — never an automatic link.
const WINDOW_DAYS = 21

const daysBetween = (a, b) => Math.abs((new Date(a) - new Date(b)) / 86400000)

export async function findCandidateWorksheets(settlement) {
  if (!settlement?.boat_id || !settlement?.settling_date) return []
  const { data } = await supabase
    .from('su_worksheets')
    .select('id, trip_no, landed_date, boxes_landed, days_at_sea, market, settlement_id, status')
    .eq('boat_id', settlement.boat_id)
    .order('landed_date', { ascending: false })
  return (data || [])
    .filter(w => !w.settlement_id || w.settlement_id === settlement.id)
    .filter(w => w.landed_date && daysBetween(w.landed_date, settlement.settling_date) <= WINDOW_DAYS)
    .map(w => ({ ...w, daysApart: Math.round(daysBetween(w.landed_date, settlement.settling_date)) }))
    .sort((a, b) => a.daysApart - b.daysApart)
}

export async function loadWorksheetDetail(worksheetId) {
  const [wRes, lRes, cRes] = await Promise.all([
    supabase.from('su_worksheets').select('*').eq('id', worksheetId).maybeSingle(),
    supabase.from('su_worksheet_lines').select('*').eq('worksheet_id', worksheetId),
    supabase.from('su_worksheet_crew').select('*').eq('worksheet_id', worksheetId),
  ])
  return { worksheet: wRes.data, lines: lRes.data || [], crew: cRes.data || [] }
}

export async function linkWorksheet(worksheetId, settlementId) {
  const { error } = await supabase
    .from('su_worksheets')
    .update({ settlement_id: settlementId, status: 'sent' })
    .eq('id', worksheetId)
  if (error) throw error
}

export async function unlinkWorksheet(worksheetId) {
  const { error } = await supabase
    .from('su_worksheets')
    .update({ settlement_id: null })
    .eq('id', worksheetId)
  if (error) throw error
}

/**
 * Build the comparison rows.
 * status is 'match' | 'differs' | 'na'.
 */
export function compare({ worksheet, wsLines = [], wsCrew = [], settlement, stLines = [], stCrew = [], format }) {
  const isBeryl = format === 'beryl'
  const out = []

  const sectionQty = sec => wsLines.filter(l => l.section === sec).reduce((a, l) => a + n(l.qty), 0)
  const sectionAmount = sec => wsLines.filter(l => l.section === sec).reduce((a, l) => a + n(l.amount), 0)

  const money = v => '£' + Number(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const num = (v, unit) => Math.round(v).toLocaleString('en-GB') + (unit ? ' ' + unit : '')

  const add = (label, sent, settled, fmt, tol) => {
    if (sent == null || settled == null) return
    const diff = settled - sent
    out.push({
      label,
      sent: fmt(sent),
      settled: fmt(settled),
      diff,
      diffText: (diff > 0 ? '+' : '') + fmt(Math.abs(diff) === diff ? diff : diff),
      status: Math.abs(diff) <= tol ? 'match' : 'differs',
    })
  }
  const na = (label, reason) => out.push({ label, status: 'na', reason })

  // ---- quantities ----------------------------------------------------
  if (worksheet.days_at_sea != null && settlement.days_at_sea != null) {
    add('Days at sea', n(worksheet.days_at_sea), n(settlement.days_at_sea), v => num(v), TOL_QTY)
  } else {
    na('Days at sea', 'not on both sides')
  }

  const fuelSent = sectionQty('fuel')
  if (isBeryl) {
    na('Fuel taken', 'a Beryl sheet does not give fuel in litres')
  } else if (fuelSent && settlement.fuel_used != null) {
    add('Fuel taken', fuelSent, n(settlement.fuel_used), v => num(v, 'lt'), TOL_QTY)
  } else {
    na('Fuel taken', fuelSent ? 'the settlement does not record litres' : 'no fuel on the worksheet')
  }

  // Haulage is reported as loads and priced by the office, so there is nothing
  // on the settlement to compare a load count against.
  const loads = sectionQty('haulage')
  na('Truck loads', loads ? `you sent ${num(loads)} loads — the settlement prices haulage, it does not count them` : 'no haulage on the worksheet')

  // ---- money ----------------------------------------------------------
  const bondSent = wsCrew.reduce((a, c) => a + n(c.bond), 0)
  const bondSettled = stCrew.reduce((a, c) => a + n(c.bond), 0)
  if (bondSent || bondSettled) {
    add('Bond deductions', bondSent, bondSettled, money, TOL_MONEY)
  } else {
    na('Bond deductions', 'no bond on either side')
  }

  const labourSent = sectionAmount('labour')
  const labourSettled = stLines
    .filter(l => l.section === 'expense' && /labour|lumper/i.test(l.label || ''))
    .reduce((a, l) => a + n(l.amount), 0)
  if (labourSent || labourSettled) {
    add('Labour', labourSent, labourSettled, money, TOL_MONEY)
  } else {
    na('Labour', 'no labour on either side')
  }

  const bonusSent = sectionAmount('bonus')
  na('Contracted crew bonus', bonusSent
    ? `you sent ${money(bonusSent)} — it is paid outside the settlement, so there is nothing to check it against`
    : 'none on the worksheet')

  // ---- crew ------------------------------------------------------------
  if (wsCrew.length && stCrew.length) {
    add('Crew aboard', wsCrew.length, stCrew.length, v => num(v), 0)
  } else {
    na('Crew aboard', 'crew not on both sides')
  }

  return out
}

export const summarise = rows => ({
  differs: rows.filter(r => r.status === 'differs').length,
  matched: rows.filter(r => r.status === 'match').length,
  na: rows.filter(r => r.status === 'na').length,
})
