/* WHICH PAGES OF THE BUNDLE AN INVOICE IS.
 *
 * A weekly bundle is the whole week photographed into one PDF — five pages, six
 * invoices — so "open the scan" has always meant "here are five pages, find it
 * yourself". The pages are the only field the reader returns that nothing
 * downstream can check against the invoice itself: the net, the VAT, the total
 * and the supplier are all printed on the page and can be read back, but WHICH
 * page it was on is a question only whoever read the bundle was ever in a
 * position to answer, and asking again costs another read of the whole file.
 *
 * SO A PAGE IT IS UNSURE OF COMES BACK BLANK. A wrong page number opens the
 * scan at the wrong invoice and looks certain doing it; a missing one just says
 * the bundle has to be read through, which is what happened before this existed.
 * Same rule as `confidence` on the figures, and the same rule the reader itself
 * is told to follow.
 */

/**
 * A page number, and only if it could be one.
 *
 * `Number('')` is 0 and `Number.isFinite(0)` is true, so the obvious version of
 * this turns an empty box into PAGE 0 — a page that does not exist, saved as
 * though somebody had read it off the scan. That is the FOURTH time that exact
 * trap has bitten in this codebase, after the engine running hours, the gear
 * measurement in mm and the invoice VAT figure. Blank stays blank the whole way
 * through, and so does anything below 1 or with a fraction in it.
 */
export function pageOrNull(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 ? n : null
}

/**
 * A whole page range, checked against the one thing about the document that is
 * not the reader's opinion: how many pages it actually has, counted off the PDF
 * with pdf.js when the bundle went in.
 *
 * NOTHING IS CLAMPED INTO RANGE. A page number bent until it fits is a guess
 * wearing the clothes of a reading — so a range that cannot be true is dropped
 * whole, and an invoice that ends before it starts is not quietly swapped round
 * either, because whichever of the two numbers is wrong is not knowable.
 *
 * A missing `to` falls to `from`: most invoices are a single page, and that is
 * the reading, not an assumption.
 */
export function pageRange(from, to, pageCount = null) {
  const a = pageOrNull(from)
  if (a === null) return { page_from: null, page_to: null }
  const b = pageOrNull(to) ?? a
  if (b < a) return { page_from: null, page_to: null }
  if (pageCount && (a > pageCount || b > pageCount)) return { page_from: null, page_to: null }
  return { page_from: a, page_to: b }
}

/** How an invoice's pages read to a person: `p. 3`, `pp. 3–4`, or nothing. */
export function pageLabel(from, to) {
  const { page_from: a, page_to: b } = pageRange(from, to)
  if (a === null) return ''
  return a === b ? `p. ${a}` : `pp. ${a}\u2013${b}`
}
