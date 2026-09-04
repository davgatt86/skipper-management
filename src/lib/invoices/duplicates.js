/* AN INVOICE THAT IS ALREADY ON FILE.
 *
 * Found Sep 2026 by sweeping the record: 60 groups, 61 rows and **£240,015.96**
 * counted twice across ten years. Not a reader fault and not an upload fault —
 * no two bundles even share a file name. It is how the approval run works:
 *
 *     Inverboyndie INV-0114, £34,971.60, dated 19 May 2023, appears in the
 *     bundles of 6 June, 13 June AND 19 June — three consecutive Mondays.
 *
 * Denise re-sends an invoice in the following week's PDF until it has been
 * approved, which is entirely correct of her and means the same cost arrives
 * two or three times. Six more groups are one bundle where the reader returned
 * the same invoice twice.
 *
 * THE PROCESS IS NOT GOING TO CHANGE, so the app has to catch it. This is the
 * only item on the list that gets worse while nobody looks at it.
 *
 * REPORTED, NEVER REFUSED. The save is not blocked and the row is not dropped
 * automatically — the same rule as the settlement totals and the net/VAT check.
 * A firm can legitimately reissue under a new number, an invoice number can be
 * misread, and being certain is not this function's business. It says what it
 * found and leaves the decision where it belongs.
 */

import { normaliseSupplier } from './suppliers.js'

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null)
const flatNo = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const day = (v) => String(v ?? '').slice(0, 10)

/**
 * The firm and the number together, which is what identifies an invoice.
 *
 * The FIRM goes through `normaliseSupplier` because it is the half that comes
 * off a model reading a photograph and drifts between two reads of the same
 * document — "Ironside & Son" came back "IRONSIDE AND SON" in a test, and
 * "Macduff Shipyards Ltd" arrives as "Limited" about half the time. Comparing
 * raw names would miss most of what this is for.
 *
 * Returns null where there is no number: an invoice with no number cannot be
 * matched this way, and guessing at one from the amount and date would flag
 * every routine repeat order a firm sends.
 */
export function docKey(row) {
  const no = flatNo(row?.invoice_no)
  if (!no) return null
  return normaliseSupplier(row?.supplier || '') + '|' + no
}

/**
 * What is already on file that this row looks like.
 *
 * `certain` where the date and the amount agree too — that is the same piece of
 * paper and nothing else. Where they differ it is `similar`: the office
 * reissues a corrected invoice under the same number with a "b" on the end, and
 * 3098 / 3098b turned out to be exactly that, £147,985.99 of double count. Both
 * are worth showing and they are NOT the same claim, so they are not made to
 * look alike.
 */
export function matchExisting(row, index) {
  const k = docKey(row)
  if (!k) return null
  const hits = index.get(k)
  if (!hits || !hits.length) return null

  const t = num(row.total)
  const d = day(row.invoice_date)
  const exact = hits.filter((h) => num(h.total) === t && day(h.invoice_date) === d)
  return {
    kind: exact.length ? 'certain' : 'similar',
    hits: exact.length ? exact : hits,
  }
}

/** Index the invoices already filed, so a bundle is checked in one pass. */
export function indexInvoices(invoices = [], { ignoreBatch = null } = {}) {
  const m = new Map()
  for (const inv of invoices) {
    /* THE BUNDLE BEING SAVED IS NOT ITS OWN DUPLICATE. Re-reading a bundle
       replaces its invoices, so its existing rows would otherwise match every
       row coming in and the whole thing would light up red. */
    if (ignoreBatch && inv.batch_id === ignoreBatch) continue
    const k = docKey(inv)
    if (!k) continue
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(inv)
  }
  return m
}

/**
 * Check a whole read before it is filed.
 *
 * Returns one entry per row that looks like something already on file OR like
 * another row in the same read — six of the sixty groups were a single bundle
 * where the reader returned the same invoice twice, so checking only against
 * the database would have missed them.
 */
export function checkForDuplicates(rows = [], invoices = [], opts = {}) {
  const index = indexInvoices(invoices, opts)
  const seen = new Map()
  const found = []

  rows.forEach((row, i) => {
    const k = docKey(row)

    /* Against the same read first. `within` is a different fact from `certain`:
       nothing is on file yet, so this is one bundle carrying an invoice twice,
       and the answer is to leave one out rather than to wonder about history. */
    if (k && seen.has(k)) {
      found.push({ index: i, row, kind: 'within', hits: [rows[seen.get(k)]], at: seen.get(k) })
      return
    }
    if (k) seen.set(k, i)

    const m = matchExisting(row, index)
    if (m) found.push({ index: i, row, ...m })
  })

  const value = found.reduce((t, f) => t + (num(f.row.total) || 0), 0)
  return {
    found,
    /* WHAT IT WOULD COST TO FILE THEM ANYWAY, which is the only number that
       makes anyone read the panel. */
    value,
    certain: found.filter((f) => f.kind === 'certain').length,
    similar: found.filter((f) => f.kind === 'similar').length,
    within: found.filter((f) => f.kind === 'within').length,
  }
}
