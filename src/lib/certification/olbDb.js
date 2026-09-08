/* Reading and writing the Official Log Book.
 *
 * THERE IS NO UPDATE AND NO DELETE OF AN ENTRY IN HERE, and there must never
 * be one. Reg 9 of SI 1981/570 allows exactly one way to put a wrong entry
 * right: "make and sign a further entry referring to the entry and amending or
 * cancelling it". The database refuses both anyway — no policy, and the grants
 * revoked — so a function written here would fail rather than do harm; but the
 * absence is the point.
 *
 * Closing a book IS an update, and the only one: entry 6 records the date and
 * place it was closed, and after that nothing may be added.
 */

import { supabase } from '../../supabaseClient'

const BOOK = 'id, fleet_id, vessel_id, book_no, opened_on, opened_place,'
  + ' closed_on, closed_place, delivered_on, delivered_to, created_at'

const ENTRY = 'id, fleet_id, vessel_id, book_id, entry_n, occurred_on, occurred_at_place,'
  + ' narrative, signed_name, signed_by_officer, witness_name, recorded_by, recorded_at,'
  + ' corrects_entry_id'

/** Every book for this boat, newest first. NULL VESSEL MEANS ALL. */
export async function listBooks(vesselId) {
  let q = supabase.from('official_log_books').select(BOOK).order('opened_on', { ascending: false })
  if (vesselId) q = q.eq('vessel_id', vesselId)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

/**
 * Every entry, oldest first — a log book is read forwards.
 *
 * READ WHOLE, across books. What is overdue runs across a book boundary: a
 * drill held in the last book is still the last drill held, and asking only
 * the open book would report every recurring entry as never made on the day a
 * new book is opened.
 */
export async function listEntries(vesselId) {
  let q = supabase.from('official_log_book_entries').select(ENTRY)
    .order('occurred_on', { ascending: true }).order('recorded_at', { ascending: true })
  if (vesselId) q = q.eq('vessel_id', vesselId)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

/** Open a book. Entries 1, 2, 3 and 5 are what this records. */
export async function openBook(vesselId, { bookNo, openedOn, openedPlace }) {
  const { data, error } = await supabase.from('official_log_books').insert({
    vessel_id: vesselId,
    book_no: text(bookNo),
    opened_on: openedOn,
    opened_place: text(openedPlace),
  }).select(BOOK).single()
  if (error) throw error
  return data
}

/**
 * Close a book — entry 6, the date and place.
 *
 * After this nothing may be added: reg 8, "no entry shall be made in an
 * official log book after" the delivery time. The database enforces it, so
 * hiding the form is presentation and not the boundary.
 */
export async function closeBook(id, { closedOn, closedPlace }) {
  const { data, error } = await supabase.from('official_log_books')
    .update({ closed_on: closedOn, closed_place: text(closedPlace) })
    .eq('id', id).select(BOOK).single()
  if (error) throw error
  return data
}

/** Record that it went to the superintendent or proper officer, within 48 hours. */
export async function deliverBook(id, { deliveredOn, deliveredTo }) {
  const { data, error } = await supabase.from('official_log_books')
    .update({ delivered_on: deliveredOn, delivered_to: text(deliveredTo) })
    .eq('id', id).select(BOOK).single()
  if (error) throw error
  return data
}

/**
 * Make an entry.
 *
 * `signedByOfficer` is not a convenience flag. Ordinarily an entry to be
 * signed by the skipper "may ... be signed by an officer authorised by the
 * skipper" — but seven of the thirty-three say IN PERSON, and on those it may
 * not. Recording which it was is the only way that rule can ever be checked.
 */
export async function addEntry(entry) {
  const { data, error } = await supabase.from('official_log_book_entries').insert({
    vessel_id: entry.vesselId,
    book_id: entry.bookId,
    entry_n: Number(entry.entryN),
    occurred_on: entry.occurredOn,
    occurred_at_place: text(entry.place),
    narrative: text(entry.narrative),
    signed_name: String(entry.signedName || '').trim(),
    signed_by_officer: !!entry.signedByOfficer,
    witness_name: text(entry.witnessName),
    recorded_by: entry.userId || null,
    corrects_entry_id: entry.correctsEntryId || null,
  }).select(ENTRY).single()
  if (error) throw error
  return data
}

/**
 * Put a wrong entry right — by making another one, never by editing.
 *
 * Reg 9 word for word: a further entry "referring to the entry and amending or
 * cancelling it". The original stays exactly as written, because that is what
 * the book says happened; the correction is a second fact about it.
 */
export async function correctEntry(originalId, entry) {
  return addEntry({ ...entry, correctsEntryId: originalId })
}

const text = (v) => (String(v ?? '').trim() || null)
