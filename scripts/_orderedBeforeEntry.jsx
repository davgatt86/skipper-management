/* Entry point for `scripts/ordered-before-preview.mjs` — bundles the REAL
 * component so the preview cannot drift from what the page renders. */
import { renderToStaticMarkup } from 'react-dom/server'
import OrderedBefore from '../src/components/OrderedBefore.jsx'
import { orderHistory } from '../src/lib/stores/history.js'

export function render(lists, lines, currentListId) {
  const onList = lines.filter((l) => l.list_id === currentListId).map((l) => l.item_key)
  const hist = orderHistory(lists, lines, { excludeListId: currentListId, excludeKeys: onList })
  const html = renderToStaticMarkup(
    <OrderedBefore hist={hist} byKey={new Map()} open onToggle={() => {}} onAdd={() => {}} />)
  return {
    hist,
    html,
    // Tags stripped, so ordering checks read the page as a person would.
    text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  }
}
