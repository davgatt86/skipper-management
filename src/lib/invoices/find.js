/* FINDING ONE INVOICE AMONG 2,625.
 *
 * There was no way to see a single invoice anywhere on this page — only totals
 * by category and by firm. Ten years of costs and the one question a person
 * actually arrives with, "what was that Scantrol bill", had no answer.
 *
 * Every one of the 2,625 carries a description, which is what makes searching
 * the text worth doing at all rather than a name-only lookup.
 *
 * A SEARCH THAT SILENTLY DROPS ROWS IS WORSE THAN NO SEARCH, so this filters and
 * counts and never truncates without saying so — the caller is handed the whole
 * matching set and decides what to show. An unmatched term returns nothing
 * rather than falling back to everything: "no invoice says Scantrol" is an
 * answer, and a full list presented as a result is not.
 */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/* PUNCTUATION IS REMOVED, NOT REPLACED, AND THE TERM IS TREATED THE SAME WAY.
   Turning it into a space instead looks equivalent and is not: the reader wrote
   an invoice number as "W-4471", which becomes "w 4471", and a person typing
   "W4471" then matches nothing at all. Caught by test. Digits are kept —
   an invoice number is the most precise thing anyone will type here.

   Each FIELD is flattened on its own and the fields joined by a space, so a
   term can never match across the join between a supplier's name and the date
   that happens to follow it. */
const flat = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')

/**
 * Terms are ANDed, and each may match any field.
 *
 * `jackson 2024` therefore finds Jackson Trawls invoices from 2024 without
 * anyone having to know which box is which — the way a person actually types a
 * search. Quoting is not supported on purpose: nobody would use it, and a
 * feature nobody uses is a feature that is wrong when it is finally tried.
 */
export function matchesQuery(inv, q, supplierName) {
  const terms = String(q ?? '').toLowerCase().split(/\s+/).map(flat).filter(Boolean)
  if (!terms.length) return true
  const hay = [
    supplierName, inv.supplier, inv.invoice_no, inv.description,
    inv.invoice_date, inv.work_from, inv.work_to, inv.account_code,
    /* The amount, so "5200" finds a £5,200 invoice. Both with and without the
       pence, since a person types whichever is on the paper in front of them. */
    num(inv.total).toFixed(2), String(Math.round(num(inv.total))),
  ].map(flat).join(' ')
  return terms.every((t) => hay.includes(t))
}

/**
 * Filter, total and sort in one pass.
 *
 * `year` matches on whichever basis the caller is using, so a search inside
 * "when the work was done" finds the invoice under the year the job was in
 * rather than the year it was billed — otherwise the drill-down from a cell
 * would disagree with the cell it came from, which is the chalk-sheet-versus-
 * catalogue failure in a different costume.
 */
export function findInvoices(invoices = [], opts = {}) {
  const {
    q = '', year = null, category = null, supplierId = null, era = null,
    min = null, max = null, basis = 'total',
    sort = 'date', dir = 'desc', suppliers = [], yearOf = null, categoryFor = null, eraFor = null,
  } = opts

  const nameOf = new Map(suppliers.map((s) => [s.id, s.name]))
  const out = []

  for (const inv of invoices) {
    if (year != null && yearOf && !yearOf(inv).includes(year)) continue
    if (category != null && categoryFor && categoryFor(inv) !== category) continue
    if (supplierId != null && inv.supplier_id !== supplierId) continue
    if (era != null && eraFor && eraFor(inv) !== era) continue
    const amt = num(inv[basis])
    if (min != null && amt < min) continue
    if (max != null && amt > max) continue
    if (!matchesQuery(inv, q, nameOf.get(inv.supplier_id))) continue
    out.push(inv)
  }

  const key = {
    date: (i) => String(i.invoice_date || ''),
    amount: (i) => num(i[basis]),
    supplier: (i) => String(nameOf.get(i.supplier_id) || i.supplier || '').toLowerCase(),
  }[sort] || ((i) => String(i.invoice_date || ''))

  out.sort((a, b) => {
    const ka = key(a), kb = key(b)
    if (ka === kb) return 0
    return (ka < kb ? -1 : 1) * (dir === 'asc' ? 1 : -1)
  })

  return { rows: out, count: out.length, total: out.reduce((t, i) => t + num(i[basis]), 0) }
}
