/* Entry point for `scripts/kept-sheet-preview.mjs` — bundles the REAL component
 * and the REAL save/load shaping, so the preview cannot drift from what the
 * page renders or from what the database actually gives back. */
import { renderToStaticMarkup } from 'react-dom/server'
import KeptSheetView from '../src/squareup/KeptSheetView.jsx'
import { stateToRows, rowsToState } from '../src/lib/su/worksheetShape.js'
import { generateSquareUpPDF } from '../src/squareup/pdfGenerator.js'

/* Rows come back from PostgREST as the DATABASE holds them, not as the object
 * the writer built. Model that or the preview proves nothing. */
const asStored = ({ head, lines, crewRows }) => ({
  head: { id: 'ws-1', settlement_id: null, ...head },
  lines: lines.map((l, i) => ({
    id: 'ln-' + i, section: null, label: null, detail: null, note: null,
    entry_date: null, qty: null, unit: null, basis: null, rate: null, amount: null, ...l,
  })),
  crewRows: crewRows.map((c, i) => ({ id: 'cr-' + i, ...c })),
})

/** Put a form state through save and load, then render the sheet as the
 *  skipper sees it. `w` is the row the kept-sheets list holds. */
export function render(state, w) {
  const s = asStored(stateToRows(state, 'boat-1'))
  const t = rowsToState(s.head, s.lines, s.crewRows)
  const html = renderToStaticMarkup(<KeptSheetView w={w} t={t} onClose={() => {}} />)
  return {
    t,
    html,
    text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  }
}

/** The document the OFFICE gets, off the same state. */
export function pdf(state) {
  return generateSquareUpPDF({ totalShares: 0, quota: '10', fuel: [], labour: [],
    haulage: [], foreignCrew: [], vessel: 'AUDACIOUS BF83', ...state })
}
