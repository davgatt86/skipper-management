/* The worksheet, as ROWS and as FORM STATE — and the conversion both ways.
 *
 * Split out of `worksheet.js` so the shaping can be tested without a database.
 * `saveWorksheet` and `loadWorksheet` do the IO; everything that decides what a
 * field becomes is here, and `test-worksheet.mjs` runs a real round trip
 * through both halves.
 *
 * THE ROUND TRIP IS THE WHOLE POINT. The save was built first and nothing ever
 * read one back, so nobody found out whether what went in could come out again.
 * Two things genuinely cannot, and they are stated rather than papered over:
 *
 * - **The vessel name is not stored.** There is no column for it.
 * - **Bond ITEMS are not stored**, only each man's bond TOTAL on his crew row.
 *   A loaded sheet therefore carries one bond line per man for his total. The
 *   arithmetic is right; the itemisation has gone.
 *
 * Everything else must survive, and the test asserts it does.
 */

export const num = (v) => {
  if (v === '' || v == null) return null
  const n = Number(String(v).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

const uid = () => Math.random().toString(36).slice(2, 10)
const s = (v) => (v == null ? '' : String(v))

/* Carried over from the old single Logistics box. Kept as its own line as well
 * as on the head so nothing typed was lost before hauliers were split out —
 * which means the reader has to know to skip it. */
export const CARRIED = 'Carried over from Logistics'

/** Form state → the three row sets, exactly as they are written. */
export function stateToRows(state, boatId) {
  const {
    tripDate, quota, crew = [], fuel = [], haulage = [], haulageNote = '',
    labour = [], foreignCrew = [], bondItems = [], boxesLanded, daysAtSea, market, tripNo,
    landings,
  } = state

  const head = {
    boat_id: boatId,
    trip_no: tripNo || null,
    landed_date: tripDate || null,
    market: market || null,
    days_at_sea: num(daysAtSea),
    boxes_landed: num(boxesLanded),
    quota_recovery_pct: num(quota),
    landings: num(landings),
    notes: haulageNote?.trim() || null,
    status: 'draft',
  }

  const lines = []
  let sort = 0
  for (const f of fuel) {
    if (!f.location && !f.litres) continue
    lines.push({ section: 'fuel', label: f.location || '', entry_date: f.date || null,
                 qty: num(f.litres), unit: 'lt', sort: sort++ })
  }
  for (const h of haulage) {
    if (!h.haulier && !h.loads) continue
    lines.push({ section: 'haulage', label: h.haulier || '', detail: h.from || null,
                 qty: num(h.loads), unit: 'loads', note: h.note || null, sort: sort++ })
  }
  if (haulageNote?.trim()) {
    lines.push({ section: 'haulage', label: CARRIED, note: haulageNote.trim(), sort: sort++ })
  }
  for (const l of labour) {
    if (!l.name && !l.amount) continue
    lines.push({
      section: 'labour', label: l.name || '',
      basis: l.basis === 'flat' ? 'flat' : 'box',
      qty: l.basis === 'flat' ? null : num(l.boxes),
      unit: l.basis === 'flat' ? null : 'boxes',
      rate: num(l.rate), amount: num(l.amount), sort: sort++,
    })
  }
  for (const c of foreignCrew) {
    if (!c.name && !c.bonus) continue
    lines.push({ section: 'bonus', label: c.name || '', amount: num(c.bonus), sort: sort++ })
  }

  /* BOND IS ASSIGNED BY CREW **ID**, and this totalled on NAME — so every
   * worksheet ever kept recorded every man's bond as 0. Both saved sheets in
   * the database show it: fourteen men apiece, `bond` zero on all twenty-eight.
   *
   * `BondSection`, `Preview` and `pdfGenerator` all read `sumBondFor(items,
   * c.id)`, so the page, the preview and the PDF agreed with each other and
   * only the save disagreed — and nothing ever read a worksheet back, so the
   * one place it showed was a column nobody looked at. It survived precisely
   * because the read path did not exist.
   *
   * share_value is stored as well as the key, so a saved worksheet keeps the
   * fraction it was worked out on even if the share options change later. */
  const bondFor = (id) => bondItems
    .filter((b) => b.assignedTo === id)
    .reduce((t, b) => t + (Number(b.amount) || 0), 0)

  const crewRows = crew.filter((c) => (c.name || '').trim()).map((c, i) => ({
    crew_name: c.name.trim(),
    share_key: c.shareKey || null,
    share_value: num(c.shareCustom) ?? null,
    /* THE ROLE AND ITS LANDINGS, not just the percentage they produced. A
       figure stored without the thing that produced it is exactly how the bond
       went wrong — reopening the sheet would recompute every man as if he had
       done every landing. Empty means all of them. */
    role: c.role || null,
    role_landings: (c.roleLandings && c.roleLandings.length) ? c.roleLandings : null,
    bond: bondFor(c.id) || 0,
    bonus: num(c.bonus) || 0,
    sort: i,
  }))

  return { head, lines, crewRows }
}

/** The three row sets → form state, in the shape the page holds it. */
export function rowsToState(head, lines = [], crewRows = []) {
  if (!head) return null
  const of = (section) => lines.filter((l) => l.section === section)
  const carried = of('haulage').find((l) => l.label === CARRIED)

  const crew = crewRows.map((c) => ({
    id: uid(), rosterId: null,
    name: c.crew_name || '',
    shareKey: c.share_key || 'full',
    shareCustom: s(c.share_value),
    bonus: s(c.bonus || ''),
    role: c.role || null,
    roleLandings: Array.isArray(c.role_landings) ? c.role_landings : [],
  }))

  const bondItems = crewRows
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => Number(c.bond) > 0)
    .map(({ c, i }) => ({
      id: uid(),
      description: 'Bond (total from the kept worksheet)',
      qty: 1,
      unitPrice: Number(c.bond),
      amount: Number(c.bond),
      /* Assigned by the crewman's ID, which is what every reader of a bond
       * item uses — `sumBondFor(bondItems, c.id)`. The ids here are the fresh
       * ones minted for this load a few lines above, so the pairing holds. */
      assignedTo: crew[i]?.id ?? null,
    }))

  return {
    worksheetId: head.id ?? null,
    tripDate: head.landed_date || '',
    tripNo: s(head.trip_no),
    market: s(head.market),
    daysAtSea: s(head.days_at_sea),
    boxesLanded: s(head.boxes_landed),
    landings: s(head.landings),
    quota: s(head.quota_recovery_pct ?? ''),
    haulageNote: head.notes || carried?.note || '',
    crew,
    bondItems,
    fuel: of('fuel').map((l) => ({
      id: uid(), location: l.label || '', date: l.entry_date || '', litres: s(l.qty),
    })),
    haulage: of('haulage').filter((l) => l.label !== CARRIED).map((l) => ({
      id: uid(), haulier: l.label || '', from: l.detail || '',
      loads: s(l.qty), note: l.note || '',
    })),
    labour: of('labour').map((l) => ({
      id: uid(), name: l.label || '', basis: l.basis === 'flat' ? 'flat' : 'box',
      boxes: s(l.qty), rate: s(l.rate), amount: s(l.amount),
    })),
    foreignCrew: of('bonus').map((l) => ({
      id: uid(), name: l.label || '', bonus: s(l.amount),
    })),
  }
}
