/* A REFERENCE FOR AN INVOICE THAT CARRIES NO NUMBER.
 *
 * David, Sep 2026: "just make up a number for the page to log it as, not alter
 * the invoice itself."
 *
 * 54 invoices in this record have no number, worth £340,351. There is nothing to
 * read: the office does not print one on a handwritten chit, a card statement or
 * a delivery note used as an invoice. Until now that meant they could never be
 * matched at all — `docKey` returns null without a number, deliberately, because
 * guessing from amount and date alone would flag every routine repeat order and
 * a guard that fires on the ordinary case stops being read.
 *
 * DERIVED, NEVER INVENTED FRESH. A random reference would be worse than none:
 * two arrivals of the SAME invoice would get two different ones, so they still
 * would not match — and they would have stopped looking like invoices with no
 * number, which is the honest signal. Built from the firm, the date and the
 * total, the same invoice always produces the same reference and its copies
 * collide. That is the entire point of doing it.
 *
 * READABLE, NOT HASHED. `NN-DEKMARLTD-20220201-10200.00` says what it is made of
 * and can be checked by eye against the row. A four-character hash would say
 * nothing, and the first time two of them collided nobody could tell whether it
 * was the same invoice or the hash being small.
 *
 * IT IS NEVER THE OFFICE'S NUMBER. `su_invoices.invoice_no_assigned` marks it,
 * the `NN-` prefix shows it, and neither should ever be quoted back to Don
 * Fishing. A match on an assigned reference is also WEAKER evidence than a match
 * on a printed one — two genuinely separate identical orders from one firm on
 * one day produce the same reference — so the duplicate check reports it as a
 * different kind rather than letting the two look alike.
 */

import { normaliseSupplier } from './suppliers.js'

/** The firm, flattened to something short and stable enough to read. */
function firmPart(supplier) {
  const s = normaliseSupplier(supplier || '')
    .toUpperCase()
    .replace(/\(.*?\)/g, '')      // "(Macduff Branch)" is not part of the identity here
    .replace(/[^A-Z0-9]/g, '')
  return s ? s.slice(0, 10) : 'UNKNOWN'
}

/** The date as printed on the invoice, or an honest word when there is none. */
function datePart(d) {
  const t = String(d ?? '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t.replace(/-/g, '') : 'undated'
}

/** The total to the penny. Blank rather than 0 — see `Number('') === 0`, which
 *  has caught this repo four times. */
function totalPart(v) {
  const n = Number(v)
  return v === '' || v == null || !Number.isFinite(n) ? 'nototal' : n.toFixed(2)
}

/**
 * The reference for a row with no invoice number.
 *
 * Returns null where the row HAS a number — this never overwrites what the
 * office printed, and a caller that has one should keep it.
 */
export function assignedRef(row) {
  const printed = String(row?.invoice_no ?? '').trim()
  if (printed) return null
  return ['NN', firmPart(row?.supplier), datePart(row?.invoice_date), totalPart(row?.total)]
    .join('-')
}

/** Is this string one of ours rather than the office's? */
export function isAssignedRef(no) {
  return /^NN-/.test(String(no ?? '').trim())
}
