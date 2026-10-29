/* --------------------------------------------------------------------------
 * ONE DOOR FOR THE THREE WAYS A TRIP'S GRADING ARRIVES
 *
 * David, Oct 2026: *"upload only accepts xsls. not pdf"*, then *"yes take
 * tally in pdf too"*. So the check beside a sales note takes any of:
 *
 *     day tally .xlsx     the wheelhouse count        BOXES
 *     day tally .pdf      the same sheet exported     BOXES
 *     catch overview .pdf the scales, out of the      KG
 *                         logbook export
 *
 * TWO PDFs THAT LOOK NOTHING ALIKE, so the file extension is not enough and the
 * document is SNIFFED rather than assumed. Getting this wrong would not error —
 * it would read one document's columns out of the other's layout and return a
 * confident set of wrong figures, which is the failure worth engineering
 * against. Each parser then reconciles against the total printed on its own
 * document, so a mis-routed file fails that too.
 *
 * The pages are pulled off the PDF ONCE and handed to whichever reader wins,
 * rather than parsing twice to find out.
 * ------------------------------------------------------------------------ */
import { ensurePdfjs } from '../pdfjs.js'
import { parseDayTally } from './parseDayTally.js'
import { parseTallyPdfPages, looksLikeTallyPdf } from './parseTallyPdf.js'
import { parseCatchOverviewPages, looksLikeCatchOverview } from './parseCatchOverview.js'

/** Pull {x, y, s} off every page of a PDF, once. */
export async function pdfPages(data) {
  const pdfjs = await ensurePdfjs()
  const doc = await pdfjs.getDocument({ data, verbosity: 0 }).promise
  const pages = []
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent()
    pages.push(tc.items.map(i => ({ x: i.transform[4], y: i.transform[5], s: i.str })))
  }
  return pages
}

/* --------------------------------------------------------------------------
 * WHICH DOCUMENT IS THIS? Decided on the words it prints, and the catch
 * overview is tested FIRST because it is the more distinctive of the two — it
 * prints PRODUCT GROUP and LIVING WEIGHT, which the grading sheet never does,
 * where the grading sheet's own marks are commoner words.
 *
 * NEITHER MATCHING IS ITS OWN ANSWER, not a fall-through to a guess. A reader
 * handed the wrong layout returns figures rather than an error.
 * ------------------------------------------------------------------------ */
export function sniffPdf(pages) {
  const text = (pages || []).flat().map(i => i && i.s).filter(Boolean).join(' ')
  if (looksLikeCatchOverview(text)) return 'catch overview'
  if (looksLikeTallyPdf(text)) return 'day tally'
  return null
}

/* --------------------------------------------------------------------------
 * Read whichever it is. Returns the shape the tally check wants:
 *   { lines, measure, kind, total, printedTotal, reconciles, ... }
 * or { error } with something a skipper can act on.
 * ------------------------------------------------------------------------ */
export async function readGradingDoc({ name, data }) {
  if (/\.(xlsx|xls)$/i.test(name)) {
    const res = await parseDayTally(data)
    if (!res || !res.lines || !res.lines.length) {
      return { error: `${name}: no tally lines read from that workbook.` }
    }
    return { ...res, measure: 'boxes', kind: 'day tally', name }
  }

  if (!/\.pdf$/i.test(name)) {
    return { error: `${name}: not a day tally or catch overview. Upload the tally (.xlsx or .pdf) or the catch overview (.pdf).` }
  }

  const pages = await pdfPages(data)
  const kind = sniffPdf(pages)
  if (!kind) {
    return { error: `${name}: this PDF is neither a grading sheet nor a catch overview — it carries neither set of column headings.` }
  }

  const res = kind === 'catch overview'
    ? parseCatchOverviewPages(pages)
    : parseTallyPdfPages(pages)

  if (!res.lines.length) {
    return { error: `${name}: read as a ${kind} and no graded rows came off it.${res.skippedPages.length ? ` Pages ${res.skippedPages.join(', ')} carried no column headings.` : ''}` }
  }
  /* REFUSED IF IT DOES NOT ADD UP, rather than compared against. Both documents
     print their own total, and a figure misread out of either would drive a
     comparison that names a downgrade which never happened. */
  if (!res.reconciles) {
    const unit = res.measure === 'kg' ? 'kg' : 'boxes'
    return {
      error: `${name}: read ${Math.round(res.total).toLocaleString('en-GB')} ${unit} against the ${
        res.printedTotal == null ? 'total printed on it' : `${Math.round(res.printedTotal).toLocaleString('en-GB')} it prints`
      }${res.diff == null ? '' : ` — out by ${Math.round(res.diff).toLocaleString('en-GB')}`}. Not compared.`,
    }
  }
  return { ...res, kind, name }
}
