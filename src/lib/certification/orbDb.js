/* Reading and writing the Oil Record Book.
 *
 * Kept apart from the page for the same reason as `db.js`: what is worth
 * testing is the shaping, and it cannot be tested through a component that
 * drags the supabase client in behind it.
 *
 * THERE IS NO UPDATE AND NO DELETE OF AN ENTRY IN HERE, and there must never
 * be one. The database refuses both -- no policy, and the grants revoked as
 * well -- so a function written here would fail rather than do harm; but the
 * absence is the point. A wrong entry is put right by `correctEntry`, which
 * writes a NEW entry pointing at the old one, exactly as a paper book is
 * corrected by striking through and initialling rather than by erasing.
 */

import { supabase } from '../../supabaseClient'

const PAGE = 'id, fleet_id, vessel_id, page_no, opened_at, closed_at,'
  + ' master_signed_by, master_signed_name, master_signed_at, created_at'

const ENTRY = 'id, fleet_id, vessel_id, page_id, entry_date, code, item_n, narrative,'
  + ' quantity, unit, tank, position_text, port, started_at, stopped_at,'
  + ' officer_name, recorded_by, recorded_at, corrects_entry_id, fuel_log_id'

/** Every page, newest first. NULL VESSEL MEANS ALL, as everywhere else. */
export async function listPages(vesselId) {
  let q = supabase.from('oil_record_book_pages').select(PAGE).order('page_no', { ascending: false })
  if (vesselId) q = q.eq('vessel_id', vesselId)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

/**
 * Every entry, oldest first -- a record book is read forwards.
 *
 * READ WHOLE, not per page. The retention date is three years after the LAST
 * entry in the book and the weekly sludge gap runs across pages, so both
 * answers are wrong if only one page is in hand.
 */
export async function listEntries(vesselId) {
  let q = supabase.from('oil_record_book_entries').select(ENTRY)
    .order('entry_date', { ascending: true }).order('recorded_at', { ascending: true })
  if (vesselId) q = q.eq('vessel_id', vesselId)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

/**
 * Open the next page.
 *
 * THE NUMBER IS THE BOAT'S, NOT A COUNT OF ROWS. `max + 1` off what is on
 * record, so a book started at page 40 because thirty-nine are on paper keeps
 * numbering from there. Unique on (vessel_id, page_no), so two people opening
 * a page at once produces a refusal rather than two page 12s.
 */
export async function openPage(vesselId, pageNo) {
  const { data, error } = await supabase.from('oil_record_book_pages')
    .insert({ vessel_id: vesselId, page_no: pageNo }).select(PAGE).single()
  if (error) throw error
  return data
}

/** Close a page. Closing is not signing: the master signs separately. */
export async function closePage(pageId) {
  const { data, error } = await supabase.from('oil_record_book_pages')
    .update({ closed_at: new Date().toISOString() })
    .eq('id', pageId).select(PAGE).single()
  if (error) throw error
  return data
}

/**
 * The master signs a completed page. Reg 20 names the master specifically, and
 * RLS enforces it -- an officer's update carrying a `master_signed_at` is
 * refused by policy, so hiding the button is presentation and not the boundary.
 *
 * The NAME is stored beside the id for the same reason as the self-certificate:
 * an app_users row can be renamed or removed, and a signature has to keep
 * saying who gave it.
 */
export async function signPage(pageId, { userId, name }) {
  const now = new Date().toISOString()
  const { data, error } = await supabase.from('oil_record_book_pages')
    .update({ closed_at: now, master_signed_by: userId || null, master_signed_name: name || null, master_signed_at: now })
    .eq('id', pageId).select(PAGE).single()
  if (error) throw error
  return data
}

/**
 * Make an entry.
 *
 * Blank strings are sent as null rather than as empty text, because
 * `Number('') === 0` has bitten this repo five times and a quantity of nought
 * is a real reading. Nothing is defaulted: an unstated tank is unstated.
 */
export async function addEntry(entry) {
  const { data, error } = await supabase.from('oil_record_book_entries').insert({
    vessel_id: entry.vesselId,
    page_id: entry.pageId,
    entry_date: entry.entryDate,
    code: entry.code,
    item_n: entry.code === 'I' ? null : (entry.itemN || null),
    narrative: text(entry.narrative),
    quantity: numOrNull(entry.quantity),
    unit: text(entry.unit),
    tank: text(entry.tank),
    position_text: text(entry.position),
    port: text(entry.port),
    started_at: entry.startedAt || null,
    stopped_at: entry.stoppedAt || null,
    officer_name: String(entry.officerName || '').trim(),
    recorded_by: entry.userId || null,
    corrects_entry_id: entry.correctsEntryId || null,
    /* Where it was raised from a fuel log movement. Null for one written
       straight into the book, and never used to edit the entry afterwards. */
    fuel_log_id: entry.fuelLogId || null,
  }).select(ENTRY).single()
  if (error) throw error
  return data
}

/**
 * PUT A WRONG ENTRY RIGHT -- by making another one, never by editing.
 *
 * The correction carries `corrects_entry_id`, so the book reads as the paper
 * one does: the mistake is still there, and the entry that supersedes it says
 * which. The officer signing the correction is the officer signing an entry,
 * so it is named the same way and asked for again rather than copied off the
 * row being corrected -- the man putting it right may not be the man who got
 * it wrong.
 */
export async function correctEntry(originalId, entry) {
  return addEntry({ ...entry, correctsEntryId: originalId })
}

const text = (v) => (String(v ?? '').trim() || null)
function numOrNull(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
