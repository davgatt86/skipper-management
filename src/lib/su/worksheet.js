import { supabase } from '../../supabaseClient'

// Saving the Square Up worksheet to the database.
//
// localStorage stays the working copy — it is instant, works with no signal,
// and autosaves as you type. This is the deliberate "keep it" step: the sheet
// then survives a cleared browser, follows you from the laptop to the phone,
// and can be compared against the settlement that comes back.
//
// A fleet with no su_boats row cannot save (nothing to hang it off). That is
// not an error — the page just stays local-only and says so.

export async function getWorksheetBoat() {
  const { data, error } = await supabase
    .from('su_boats')
    .select('id, name, registration, format')
    .limit(1)
    .maybeSingle()
  if (error) return null
  return data || null
}

const num = v => {
  if (v === '' || v == null) return null
  const n = Number(String(v).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * Write the worksheet. Children are replaced wholesale rather than diffed —
 * a worksheet is small and a clean replace cannot leave orphans behind.
 * Returns the worksheet id.
 */
export async function saveWorksheet(state, boatId, existingId) {
  const {
    tripDate, quota, crew = [], fuel = [], haulage = [], haulageNote = '',
    labour = [], foreignCrew = [], bondItems = [], boxesLanded, daysAtSea, market, tripNo,
  } = state

  const head = {
    boat_id: boatId,
    trip_no: tripNo || null,
    landed_date: tripDate || null,
    market: market || null,
    days_at_sea: num(daysAtSea),
    boxes_landed: num(boxesLanded),
    quota_recovery_pct: num(quota),
    notes: haulageNote?.trim() ? null : null,
    status: 'draft',
  }

  let id = existingId
  if (id) {
    const { error } = await supabase.from('su_worksheets').update(head).eq('id', id)
    if (error) throw error
    // Replace children.
    await supabase.from('su_worksheet_lines').delete().eq('worksheet_id', id)
    await supabase.from('su_worksheet_crew').delete().eq('worksheet_id', id)
  } else {
    const { data, error } = await supabase.from('su_worksheets').insert(head).select('id').single()
    if (error) throw error
    id = data.id
  }

  // Fuel and haulage carry quantities only — the office prices them.
  const lines = []
  let sort = 0
  for (const f of fuel) {
    if (!f.location && !f.litres) continue
    lines.push({
      worksheet_id: id, section: 'fuel', label: f.location || '',
      entry_date: f.date || null, qty: num(f.litres), unit: 'lt', sort: sort++,
    })
  }
  for (const h of haulage) {
    if (!h.haulier && !h.loads) continue
    lines.push({
      worksheet_id: id, section: 'haulage', label: h.haulier || '',
      detail: h.from || null, qty: num(h.loads), unit: 'loads', note: h.note || null, sort: sort++,
    })
  }
  // The free text carried over from the old Logistics box, kept as its own row
  // so nothing typed is lost even before it is split into hauliers.
  if (haulageNote?.trim()) {
    lines.push({
      worksheet_id: id, section: 'haulage', label: 'Carried over from Logistics',
      note: haulageNote.trim(), sort: sort++,
    })
  }
  for (const l of labour) {
    if (!l.name && !l.amount) continue
    lines.push({
      worksheet_id: id, section: 'labour', label: l.name || '',
      basis: l.basis === 'flat' ? 'flat' : 'box',
      qty: l.basis === 'flat' ? null : num(l.boxes),
      unit: l.basis === 'flat' ? null : 'boxes',
      rate: num(l.rate), amount: num(l.amount), sort: sort++,
    })
  }
  for (const c of foreignCrew) {
    if (!c.name && !c.bonus) continue
    lines.push({
      worksheet_id: id, section: 'bonus', label: c.name || '',
      amount: num(c.bonus), sort: sort++,
    })
  }
  if (lines.length) {
    const { error } = await supabase.from('su_worksheet_lines').insert(lines)
    if (error) throw error
  }

  // share_value is stored as well as the key, so a saved worksheet keeps the
  // fraction it was worked out on even if the share options change later.
  const bondFor = (name) => bondItems
    .filter(b => b.assignedTo === name)
    .reduce((s, b) => s + (Number(b.amount) || 0), 0)

  const crewRows = crew.filter(c => (c.name || '').trim()).map((c, i) => ({
    worksheet_id: id,
    crew_name: c.name.trim(),
    share_key: c.shareKey || null,
    share_value: num(c.shareCustom) ?? null,
    bond: bondFor(c.name) || 0,
    bonus: num(c.bonus) || 0,
    sort: i,
  }))
  if (crewRows.length) {
    const { error } = await supabase.from('su_worksheet_crew').insert(crewRows)
    if (error) throw error
  }

  return id
}

export async function loadLatestWorksheet(boatId) {
  const { data, error } = await supabase
    .from('su_worksheets')
    .select('id, trip_no, landed_date, status, updated_at')
    .eq('boat_id', boatId)
    .eq('status', 'draft')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return null
  return data || null
}
