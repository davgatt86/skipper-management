import { supabase } from '../../supabaseClient'
import { pageRange } from '../invoices/pages'
import { carryDecisions } from '../invoices/identity'
import { assignedRef } from '../invoices/reference.js'
import { matchAll, withAlias } from '../invoices/suppliers'
import { figuresMissing } from '../invoices/periods'

/* READING AND WRITING THE INVOICE RECORD.
 *
 * The shaping — who a supplier is, what a period totals — lives in
 * `src/lib/invoices/`, tested without a database. This half is only the IO, the
 * same split as `worksheet.js` against `worksheetShape.js`, and for the same
 * reason: the arithmetic is the part worth testing.
 *
 * `su_invoices` was NOT created by this repo. It came with four real July
 * invoices already in it, so every write here is additive to a shape that was
 * already there and may still be written to by the Square Up fleet settlements
 * app. Nothing renames or deletes its columns.
 */

const BATCH = 'id, fleet_id, boat_id, file_path, filename, bytes, page_count, '
  + 'from_email, subject, received_at, manager_balance, manager_balance_text, status, note, '
  + 'read_result, read_at'

const INVOICE = 'id, batch_id, supplier_id, supplier, invoice_no, invoice_date, '
  + 'description, net, vat, total, currency, invoice_no_assigned, account_code, status, paid_date, '
  + 'page_from, page_to, file_path, confidence, category, vessel_era, work_from, work_to'

/** The bundles that have arrived, newest first. */
export async function listBatches(fleetId) {
  if (!fleetId) return []
  const { data, error } = await supabase
    .from('su_invoice_batches')
    .select(BATCH + ', su_invoices(id)')
    .eq('fleet_id', fleetId)
    .order('received_at', { ascending: false })
  if (error) return []
  return (data || []).map(({ su_invoices: inv, ...b }) => ({
    ...b,
    invoiceCount: (inv || []).length,
  }))
}

/** Every invoice for the fleet — the report reads them all and totals locally. */
export async function listInvoices(fleetId) {
  if (!fleetId) return []
  /* Read WHOLE, in pages. Supabase caps a REST response at 1,000 rows and does
     not say so — the Buyer League and Reconcile pages both showed a silently
     truncated answer before `fetchAll` existed. A year's costs quietly missing
     its tail is the same failure wearing a different hat. */
  const out = []
  const size = 1000
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase
      .from('su_invoices').select(INVOICE)
      .eq('fleet_id', fleetId)
      .order('invoice_date', { ascending: false })
      .range(from, from + size - 1)
    if (error) return out
    out.push(...(data || []))
    if (!data || data.length < size) return out
  }
}

export async function listSuppliers(fleetId) {
  if (!fleetId) return []
  const { data, error } = await supabase
    .from('su_invoice_suppliers')
    .select('id, name, aliases, category, note')
    .eq('fleet_id', fleetId)
    .order('name')
  return error ? [] : (data || [])
}

/** Create a supplier, taking the name the reader produced as its first alias. */
export async function createSupplier(fleetId, name, { alias, category } = {}) {
  const clean = String(name || '').trim()
  if (!clean) throw new Error('A supplier needs a name.')
  const aliases = alias && alias.trim() && alias.trim() !== clean ? [alias.trim()] : []
  const { data, error } = await supabase
    .from('su_invoice_suppliers')
    .insert({ fleet_id: fleetId, name: clean, aliases, category: category || null })
    .select('id, name, aliases, category, note')
    .single()
  if (error) throw error
  return data
}

/** File a name the reader produced against a supplier already on the list. */
export async function addAlias(supplier, raw) {
  const next = withAlias(supplier, raw)
  /* Null means the spelling is already covered. Writing anyway would stamp
     updated_at for a change that is not one. */
  if (!next) return supplier
  const { data, error } = await supabase
    .from('su_invoice_suppliers')
    .update({ aliases: next })
    .eq('id', supplier.id)
    .select('id, name, aliases, category, note')
    .single()
  if (error) throw error
  return data
}

/**
 * Save what the reader found for one bundle.
 *
 * REPLACED WHOLESALE, not merged. Reading the same bundle twice must not double
 * the year's costs, and a bundle is small — the same rule as re-ingesting a
 * sales note, which deletes its rows and re-inserts them.
 *
 * ONLY the invoices belonging to THIS batch are cleared. The four July rows
 * that came from outside this repo carry no batch_id and must survive
 * untouched; a delete scoped by fleet rather than by batch would take them.
 */
export async function saveBatchInvoices(batch, rows, fleetId) {
  /* WHAT A PERSON DECIDED SURVIVES A RE-READ. WHAT A MODEL READ DOES NOT.
   *
   * Saving replaces every invoice off this bundle, which is right — reading it
   * again should produce this bundle afresh, not a second copy of it. But two
   * columns are not the reader's at all: `vessel_era` and `category` are the
   * skipper's answers to questions the invoice cannot answer, and they are
   * expensive. 102 invoices carry a vessel decision, and six of those decisions
   * moved £751,000 onto the right hull.
   *
   * So re-reading one bundle to pick up its page numbers would have quietly
   * undone them, weeks later, with nothing on screen to say so. They are lifted
   * off the old rows and put back on the new ones.
   *
   * THE MATCH IS ON THE INVOICE NUMBER, and where there is none, on the firm,
   * the total and the date together. A decision that cannot be matched is
   * REPORTED, never guessed onto the nearest row — putting one invoice's answer
   * on another is exactly the unrecoverable mistake the supplier lookup refuses
   * to make with a near-miss name. */
  const { data: kept } = await supabase
    .from('su_invoices')
    .select('invoice_no, supplier, total, invoice_date, category, vessel_era, work_from, work_to')
    .eq('batch_id', batch.id)


  const { error: de } = await supabase
    .from('su_invoices').delete().eq('batch_id', batch.id)
  if (de) throw de

  /* The skipper's answers lifted off what is about to be replaced. Anything
     that cannot be matched to an invoice in the new read is returned and
     reported — never spread onto the nearest row. */
  const carried = carryDecisions(kept || [], rows)
  const clean = carried.rows
    .filter((r) => (r.supplier || '').trim() || r.total !== '' )
    .map((r) => ({
      fleet_id: fleetId,
      boat_id: batch.boat_id,
      batch_id: batch.id,
      supplier_id: r.supplier_id || null,
      supplier: (r.supplier || '').trim(),
      /* A REFERENCE WHERE THE DOCUMENT CARRIES NO NUMBER, marked as ours.
         54 invoices had none — a handwritten chit, a card statement, a delivery
         note used as an invoice — and without a number `docKey` returns null, so
         they could never be matched at all. The reference is DERIVED from the
         firm, the date and the total, so two arrivals of the same invoice
         produce the same one and collide; a random reference would have left
         them unmatchable AND stopped them looking like invoices with no number.
         `invoice_no_assigned` is what keeps it from ever being mistaken for the
         office's own number. */
      invoice_no: (r.invoice_no || '').trim() || assignedRef(r),
      invoice_no_assigned: !((r.invoice_no || '').trim()),
      invoice_date: r.invoice_date || null,
      description: (r.description || '').trim() || null,
      /* NOT NULL with a default of 0 — sending null explicitly OVERRIDES the
         default and is refused, which is what stopped a run of ten bundles
         dead. A blank goes in as 0 because the column demands a number; that it
         was never read is recorded below rather than lost. */
      net: num(r.net) ?? 0, vat: num(r.vat) ?? 0, total: num(r.total) ?? 0,
      currency: r.currency || 'GBP',
      account_code: (r.account_code || '').trim() || null,
      status: r.status || 'unpaid',
      ...pageRange(r.page_from, r.page_to, batch.page_count),
      /* The document itself, so an invoice can always be opened at its own
         pages rather than the reader's word being the only record. */
      file_path: batch.file_path,
      /* WHAT THE READER DID NOT GET. A 0 that the document never showed must
         not read like a 0 that it did — the column exists for exactly this. */
      confidence: mergeConfidence(r),
      /* The skipper's own answers, carried over. `r` wins where the form has one —
         a decision made just now beats one made last time. */
      category: r.category ?? null,
      vessel_era: r.vessel_era ?? null,
      /* WHEN THE WORK WAS DONE, where the invoice says. Blank means "use the
         invoice date", which is what every one of the 2,625 already filed does. */
      work_from: dateOrNull(r.work_from),
      work_to: dateOrNull(r.work_to),
    }))

  if (clean.length) {
    const { error } = await supabase.from('su_invoices').insert(clean)
    if (error) throw error
  }

  /* The stored read is cleared on filing: it exists to survive a reload before
     saving, and keeping it afterwards would leave a second, staler copy of
     figures that now live in su_invoices. */
  const { error: ue } = await supabase
    .from('su_invoice_batches')
    .update({ status: 'filed', read_result: null })
    .eq('id', batch.id)
  if (ue) throw ue

  /* WHAT WAS CARRIED AND WHAT COULD NOT BE. A decision that found no invoice
     in the new read is handed back by name, because the alternative is that
     it disappears — and the whole point of carrying them is that they cost
     real work to make. */
  return { saved: clean.length, carried: carried.carried, lost: carried.lost }
}

/* WHAT THE READER PRODUCED, KEPT ON THE BATCH.
 *
 * A read is a paid API call on a five-page photograph. It used to live only in
 * the page's memory, so a reload threw away something that had cost money and
 * a minute of waiting. Stored here, the queue survives closing the laptop.
 *
 * These rows are still NOT invoices until the skipper has looked at them —
 * this is the queue made durable, not a way round the review. */
/* PUT A BUNDLE BACK TO UNREAD, stored read and all.
 *
 * The opposite of storeRead, and it has to clear BOTH halves. Leaving
 * `read_result` behind would put the bundle back on the queue the moment the
 * page reloaded — the effect that restores a half-checked run after closing the
 * laptop, which is right there and wrong here. */
export async function clearRead(id) {
  const { error } = await supabase.from('su_invoice_batches')
    .update({ read_result: null, read_at: null, status: 'new' })
    .eq('id', id)
  if (error) throw error
}

export async function storeRead(id, rows) {
  const { error } = await supabase.from('su_invoice_batches')
    .update({ read_result: rows, read_at: new Date().toISOString(), status: 'read' })
    .eq('id', id)
  if (error) throw error
}

/* WHAT A FIRM SELLS. One decision covering every invoice it has ever sent —
 * 153 firms against 2,625 invoices, which is the only reason categorising ten
 * years is a job anyone would finish. Overridable on the invoice where a firm
 * genuinely sells two things. */
export async function setSupplierCategory(id, category) {
  const { error } = await supabase.from('su_invoice_suppliers')
    .update({ category: category || null }).eq('id', id)
  if (error) throw error
}

/** Several at once, for confirming a screen of suggestions in one go. */
export async function setSupplierCategories(pairs) {
  for (const [id, category] of pairs) await setSupplierCategory(id, category)
}

/** One invoice out of step with its firm. */
export async function setInvoiceCategory(id, category) {
  const { error } = await supabase.from('su_invoices')
    .update({ category: category || null }).eq('id', id)
  if (error) throw error
}

/* The fleet's own category list — only what it CHANGES, merged over the
   shipped one by resolveCategories(). */
export async function loadCategorySettings(fleetId) {
  if (!fleetId) return null
  const { data, error } = await supabase.from('su_invoice_categories')
    .select('data, eras').eq('fleet_id', fleetId).maybeSingle()
  return error ? null : { categories: data?.data ?? null, eras: data?.eras ?? null }
}

/* WHICH BOAT AN INVOICE BELONGS TO, where the date cannot say.
 *
 * Ten years here are three hulls, all called AUDACIOUS BF83, and a boat's bills
 * start months before she fishes — so an invoice inside a changeover is
 * genuinely undecidable from its date. This is the skipper settling one. */
/* WHEN THE WORK WAS DONE — the skipper reading it off the invoice.
 *
 * A span that ends before it starts is refused by a CHECK on the table rather
 * than being quietly reversed here: which of the two dates is wrong is not
 * knowable, the same rule the page numbers and the settlement totals follow. */
export async function setInvoiceWork(id, from, to) {
  const { error } = await supabase.from('su_invoices')
    .update({ work_from: dateOrNull(from), work_to: dateOrNull(to) }).eq('id', id)
  if (error) throw error
}

/** A whole lump billing answered in one action — the usual case, since a firm
 *  that bills six jobs on one day is the reason this exists at all. */
export async function setInvoicesWork(ids, from, to) {
  if (!ids.length) return
  const { error } = await supabase.from('su_invoices')
    .update({ work_from: dateOrNull(from), work_to: dateOrNull(to) }).in('id', ids)
  if (error) throw error
}

export async function setInvoiceVessel(id, era) {
  const { error } = await supabase.from('su_invoices')
    .update({ vessel_era: era || null }).eq('id', id)
  if (error) throw error
}

/** Several at once — a whole window's worth after one decision. */
export async function setInvoiceVessels(ids, era) {
  if (!ids.length) return
  const { error } = await supabase.from('su_invoices')
    .update({ vessel_era: era || null }).in('id', ids)
  if (error) throw error
}

export async function setBatchStatus(id, status, note) {
  const patch = { status }
  if (note !== undefined) patch.note = note
  const { error } = await supabase.from('su_invoice_batches').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteBatch(id) {
  /* The invoices are ON DELETE SET NULL, so they SURVIVE this and keep their
     figures. The cost was incurred whether or not the scan is kept, and losing
     the rows would quietly reduce the year's total. */
  const { error } = await supabase.from('su_invoice_batches').delete().eq('id', id)
  if (error) throw error
}

/** The reader's rows, with each name matched against the fleet's suppliers. */
export function applySuppliers(rows, suppliers) {
  return matchAll(rows, suppliers)
}

/* Keep the reader's own doubts, and add any figure it could not make out. */
function mergeConfidence(r) {
  const missing = figuresMissing(r)
  if (!missing.length) return r.confidence || null
  return { ...(r.confidence || {}), blank_as_read: missing }
}

const num = (v) => {
  if (v === '' || v == null) return null
  const n = Number(String(v).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : null
}
/* A DATE OR NOTHING. An empty box is not a date, and '' reaches Postgres as an
   invalid input rather than a null — the same class of trap as page 0. */
const dateOrNull = (v) => {
  const s = String(v ?? '').slice(0, 10)
  return /^d{4}-d{2}-d{2}$/.test(s) ? s : null
}

/* The rule lives in src/lib/invoices/pages.js so it can be tested without a
   database — see the note there about page 0. */
