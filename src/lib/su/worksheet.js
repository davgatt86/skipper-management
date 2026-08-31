import { supabase } from '../../supabaseClient'
import { stateToRows, rowsToState } from './worksheetShape'

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

/**
 * Write the worksheet. Children are replaced wholesale rather than diffed —
 * a worksheet is small and a clean replace cannot leave orphans behind.
 * Returns the worksheet id.
 *
 * The SHAPING lives in `worksheetShape.js`, so save and load are two halves of
 * one thing that can be tested against each other without a database. This half
 * is only the writing.
 */
export async function saveWorksheet(state, boatId, existingId) {
  const { head, lines, crewRows } = stateToRows(state, boatId)

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

  if (lines.length) {
    const { error } = await supabase
      .from('su_worksheet_lines')
      .insert(lines.map(l => ({ ...l, worksheet_id: id })))
    if (error) throw error
  }
  if (crewRows.length) {
    const { error } = await supabase
      .from('su_worksheet_crew')
      .insert(crewRows.map(c => ({ ...c, worksheet_id: id })))
    if (error) throw error
  }

  return id
}

/* ---------------------------------------------------------------------------
 * READING ONE BACK.
 *
 * The save was written first and nothing was ever built to open it again:
 * `loadLatestWorksheet` returned only the HEAD — no lines, no crew — and was
 * exported and then called by nothing at all. So a worksheet went into the
 * database and stayed there, while the working copy lived in localStorage. On a
 * new device, or after a cleared browser, the sheet was gone even though it was
 * sitting in the table. David: "I can't see / recall saved worksheets."
 *
 * WHAT COMES BACK, AND WHAT CANNOT.
 *
 * The lines and the crew round-trip. Two things do not, and the page says so
 * rather than restoring something that looks complete and is not:
 *
 * - **The vessel name is not stored at all.** It stays whatever the form has.
 * - **Bond ITEMS are not stored** — only each man's bond TOTAL, folded onto his
 *   crew row. So a loaded sheet carries one bond line per man for his total
 *   rather than the itemised list he typed. The arithmetic is right and the
 *   breakdown is gone, which is worth knowing before you load over live work.
 * --------------------------------------------------------------------------- */

const HEAD = 'id, trip_no, landed_date, market, days_at_sea, boxes_landed, '
  + 'quota_recovery_pct, status, notes, settlement_id, created_at, updated_at'

/**
 * Every kept worksheet for this boat, newest first.
 *
 * The crew rows come with it so the panel can say what a sheet actually holds
 * — how many men, and whether any bond was recorded against them. That second
 * one matters: the save keyed bond on the crewman's NAME while it is assigned
 * by his ID, so every sheet kept before Aug 2026 has zero bond for every man.
 * A figure of nought and a figure never recorded must not read alike.
 */
export async function listWorksheets(boatId) {
  if (!boatId) return []
  const { data, error } = await supabase
    .from('su_worksheets')
    .select(HEAD + ', su_worksheet_crew(bond), su_worksheet_lines(section, detail, amount)')
    .eq('boat_id', boatId)
    .order('updated_at', { ascending: false })
  if (error) return []
  return (data || []).map(({ su_worksheet_crew: c, su_worksheet_lines: l, ...w }) => {
    const crewBond = (c || []).reduce((s, r) => s + (Number(r.bond) || 0), 0)
    const bond = (l || []).filter((x) => x.section === 'bond')
    const sum = (rows) => rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)
    /* A sheet with bond LINES knows its own items, so its total is the lines —
       summing the crew rows as well would count the assigned ones twice. One
       kept before bond lines existed has only the crew totals, and how much of
       its bond went unassigned is not merely nought but UNKNOWN: the items were
       never written down. Null, so the panel can decline to say. */
    return {
      ...w,
      crewCount: (c || []).length,
      bondTotal: bond.length ? sum(bond) : crewBond,
      unassignedBond: bond.length
        ? sum(bond.filter((x) => !x.detail || x.detail === 'carried'))
        : null,
    }
  })
}

/* WHICH SETTLING SHEET THIS WORKSHEET BECAME.
 *
 * The column has existed since the table was built and nothing ever set it, so
 * there was no way to tell which worksheet produced which settlement — the two
 * records of one trip sat side by side with nothing joining them.
 *
 * Set by hand rather than matched on the date. A settlement covers a RUN of
 * trips, not one, and the office does not say which — inferring it is the
 * hardest code in this repo (solveSettlementRuns) and it exists precisely
 * because a date window is not good enough. Here the skipper knows, so he says.
 */
export async function linkWorksheet(id, settlementId) {
  const { error } = await supabase
    .from('su_worksheets')
    .update({ settlement_id: settlementId || null, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

/** The boat's settlements, newest first, to choose from. */
export async function listSettlements(boatId) {
  if (!boatId) return []
  const { data, error } = await supabase
    .from('su_settlements')
    .select('id, reference, settling_date')
    .eq('boat_id', boatId)
    .order('settling_date', { ascending: false })
    .limit(40)
  return error ? [] : (data || [])
}

export async function deleteWorksheet(id) {
  // The children go with it: both carry `worksheet_id` on delete cascade.
  const { error } = await supabase.from('su_worksheets').delete().eq('id', id)
  if (error) throw error
}

/**
 * One worksheet, in the shape the form holds it — so loading is `setX(...)`
 * per field and not a translation layer in the page.
 *
 * Returns `null` if it has gone (deleted on another device), rather than a
 * half-built object.
 */
export async function loadWorksheet(id) {
  const [{ data: head, error: he }, { data: lines }, { data: crewRows }] = await Promise.all([
    supabase.from('su_worksheets').select(HEAD).eq('id', id).maybeSingle(),
    supabase.from('su_worksheet_lines').select('*').eq('worksheet_id', id).order('sort'),
    supabase.from('su_worksheet_crew').select('*').eq('worksheet_id', id).order('sort'),
  ])
  if (he || !head) return null
  return rowsToState(head, lines || [], crewRows || [])
}
