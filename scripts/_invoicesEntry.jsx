/* Entry point for `scripts/invoices-preview.mjs` — bundles the REAL pure
 * shaping and the REAL review/report components, so the preview cannot drift
 * from what the page renders. The page itself is behind a login and a fleet. */
import { renderToStaticMarkup } from 'react-dom/server'
import { matchAll } from '../src/lib/invoices/suppliers.js'
import { totalsByPeriod } from '../src/lib/invoices/periods.js'

export function match(rows, suppliers) { return matchAll(rows, suppliers) }
export function totals(invoices, suppliers, opts) { return totalsByPeriod(invoices, suppliers, opts) }
export function html(el) {
  const h = renderToStaticMarkup(el)
  return { html: h, text: h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }
}
