/* THE SAME GRID READ THE OTHER WAY — by firm instead of by trade.
 *
 * Built off the matrix `categoryMatrix` already produced rather than a second
 * pass over the invoices, so the two views cannot disagree about a total. That
 * is not theoretical tidiness: the chalk sheet and the buyers' catalogue worked
 * out the sale order twice, both rendered perfectly, and disagreed with each
 * other — and this is money rather than a running order.
 *
 * THE YEAR CELLS ARE MERGED ACROSS CATEGORY ROWS, NOT TAKEN FROM ONE. A firm
 * appears under more than one category the moment a single invoice of theirs is
 * filed differently from the rest, which really happens — Inverboyndie sells
 * gear and the odd bit of quota, Macduff Shipyards does slipping and the odd bit
 * of chandlery. Reading a firm out of whichever row it appeared in first would
 * report part of it as the whole of it, and the row would still look perfectly
 * plausible.
 */
export function bySupplierRows(matrix, limit = 40) {
  const by = new Map()
  for (const row of matrix.rows || []) {
    for (const s of row.suppliers || []) {
      const k = s.id || s.name
      const cur = by.get(k) || {
        key: k, name: s.name, total: 0, count: 0, cells: {}, first: null, last: null,
      }
      cur.total += s.total
      cur.count += s.count
      for (const [col, v] of Object.entries(s.cells || {})) {
        cur.cells[col] = (cur.cells[col] || 0) + v
      }
      /* When a firm was first and last invoiced. A row of years raises the
         question on its own — a firm that stops appearing is one the boat has
         stopped using, and that is worth seeing beside what it was worth. */
      if (s.first && (!cur.first || s.first < cur.first)) cur.first = s.first
      if (s.last && (!cur.last || s.last > cur.last)) cur.last = s.last
      by.set(k, cur)
    }
  }
  return [...by.values()].sort((a, b) => b.total - a.total).slice(0, limit)
}
