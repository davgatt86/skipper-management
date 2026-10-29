/* --------------------------------------------------------------------------
 * THE DAY TALLY, AS A PDF — the Peterhead Grading Sheet export
 *
 * David, Oct 2026: *"yes take tally in pdf too"*.
 *
 * THIS REVERSES A DECISION RECORDED IN THIS REPO, and it is his to reverse.
 * The note under the day-tag work read: *"The PDF export is readable and is NOT
 * parsed ... It is not worth a second parser: the spreadsheet is the same
 * figures without a text-extraction step between them, and two readers for one
 * document is the parse-core failure again."* That reasoning was about the
 * MARKET LAYOUT, where the workbook is always to hand. The tally check is a
 * different situation — it is read beside a sales note, often from a phone,
 * where what you have is whatever was exported last.
 *
 * SO THE PARSE-CORE WARNING IS ANSWERED RATHER THAN IGNORED. The failure there
 * was two copies of one READER drifting apart. Here there is one reader per
 * FORMAT, both emitting the identical shape, and `test-tally-pdf.mjs` parses
 * the real trip 71 PDF and the real trip 71 workbook and asserts the two agree
 * line for line. A drift makes that suite fail rather than going unnoticed for
 * months on a server nobody looks at.
 *
 * It is a far kinder document than the catch overview: born-digital, five real
 * fonts, no OCR artefacts — and the grade already reads `XL (1a)`, the same
 * spelling the workbook uses, so `tallyCode` needs nothing added.
 * ------------------------------------------------------------------------ */
import { ensurePdfjs } from '../pdfjs.js'

/* `DAY 1-3`, `DAY 8-9`, and a single `DAY 4` if the bands are ever dropped. */
const DAY = /^DAY\s*(\d+)(?:\s*[-–]\s*(\d+))?$/i
const INT = /^\d+$/
const SPECIES_TOTAL = /^(.+?)\s+TOTAL$/i
const GRAND = /GRAND TOTAL/i
/* Rows are flat on this export, but a label and its figures can sit a point
   apart — GRAND TOTAL is at y=238 with its numbers at y=237. */
const BAND = 3

/* --------------------------------------------------------------------------
 * CELLS GO TO THE NEAREST COLUMN, NOT TO ONE WITHIN A TOLERANCE.
 *
 * The headings are CENTRED over their columns while the data is not: `GRADE`
 * prints at x=128 and every grade under it at x=107, and `DAY 1-3` at x=308
 * with its figures at 319–323. A fixed band read the whole document as ZERO
 * rows while still finding the grand total, which is the worst way for this to
 * fail — it looks like an empty tally rather than a parser that missed.
 *
 * Nearest-wins is safe here because the columns are 50–80pt apart and the
 * worst offset is 21pt, so no cell can reach its neighbour. `limit` is a
 * backstop for stray ink out at the margins.
 * ------------------------------------------------------------------------ */
function nearest(cols, x, limit = 40) {
  let best = null, d = Infinity
  for (const c of cols) { const dd = Math.abs(c.x - x); if (dd < d) { d = dd; best = c } }
  return d <= limit ? best : null
}

const int = (s) => { const n = Number(String(s).replace(/[^0-9-]/g, '')); return Number.isFinite(n) ? n : null }

/* --------------------------------------------------------------------------
 * The reading, split from the PDF for the reason parse-core splits
 * `parseExtracted` from `parsePdf`: `ensurePdfjs` resolves a worker URL and
 * needs a browser, and the column picking is the half worth testing.
 * `pages` is one array of {x, y, s} per page.
 * ------------------------------------------------------------------------ */
export function parseTallyPdfPages(pages) {
  const lines = []
  let printedTotal = null, printedDays = null
  const skippedPages = []
  let seq = 0

  for (let p = 0; p < pages.length; p++) {
    const items = (pages[p] || [])
      .filter(i => i.s != null && String(i.s).trim())
      .map(i => ({ x: i.x, y: i.y, s: String(i.s).trim() }))

    /* CALIBRATED OFF EACH PAGE'S OWN HEADER. It is reprinted on every page,
       and a page without one is skipped and SAID rather than guessed at. */
    const head = Object.fromEntries(items
      .filter(i => /^(SPECIES|GRADE|SIZE|BOX \(kg\)|TOTAL)$/.test(i.s))
      .map(i => [i.s, i.x]))
    const dayCols = items.filter(i => DAY.test(i.s))
      .map(i => { const m = i.s.match(DAY); return { x: i.x, day: Number(m[1]), dayTo: m[2] ? Number(m[2]) : Number(m[1]) } })
      .sort((a, b) => a.x - b.x)
    if (head.SPECIES == null || head.TOTAL == null || !dayCols.length) { skippedPages.push(p + 1); continue }
    /* Every column this page has, as one list for nearest-wins. */
    const cols = [
      ...Object.entries(head).map(([k, x]) => ({ k, x })),
      ...dayCols.map(d => ({ k: 'day' + d.day, x: d.x })),
    ]

    const ys = [...new Set(items.map(i => Math.round(i.y)))].sort((a, b) => b - a)
    const bands = []
    for (const y of ys) {
      const b = bands.find(b => Math.abs(b.y - y) <= BAND)
      if (b) b.ys.add(y); else bands.push({ y, ys: new Set([y]) })
    }

    /* THE TAG COLOUR IS READ OFF THE SHEET, NEVER DERIVED FROM THE DAY. The
       Purple band STARTS on day 4 and day 4 is ORANGE in the old ten-colour
       table, so deriving it mis-colours three bands in four — on the one
       document a buyer reads against the tag stapled to the box. The same rule
       `tagOf()` follows for the workbook. */
    /* The colour row is the one whose DAY COLUMNS hold a bare word. Requiring
       every item on it to be uppercase found nothing: it also carries the
       label `TAG COLOUR` and an arrow, so the tags came back null while the
       rest of the parse looked perfect. */
    /* The colour row is the one carrying a bare WORD on two or more different
       day columns. Two narrower tests both failed on the real sheet: requiring
       every item to be uppercase tripped over the row's own `TAG COLOUR` label,
       and ignoring that tripped over the `→` beside it, which sits 22pt from
       the first day column and so counts as being on it. Both left the tags
       null while every other figure on the page parsed perfectly. */
    const wordOnDay = (b) => {
      const hits = new Map()
      for (const i of items) {
        if (!b.ys.has(Math.round(i.y)) || !/^[A-Za-z][A-Za-z ]*$/.test(i.s)) continue
        const c = nearest(dayCols, i.x, 25)
        if (c && !hits.has(c.day)) hits.set(c.day, i)
      }
      return hits
    }
    const colourRow = bands.map(b => ({ b, hits: wordOnDay(b) }))
      .filter(x => x.hits.size >= 2)
      .sort((a, b) => b.hits.size - a.hits.size)[0]
    for (const d of dayCols) {
      const hit = colourRow && colourRow.hits.get(d.day)
      d.tagName = hit ? hit.s.toUpperCase() : null
    }

    for (const band of bands) {
      const row = items.filter(i => band.ys.has(Math.round(i.y))).sort((a, b) => a.x - b.x)
      const joined = row.map(i => i.s).join(' ')

      /* The grand total is what the parse is checked against. */
      if (GRAND.test(joined)) {
        const tot = row.find(i => INT.test(i.s) && nearest(cols, i.x)?.k === 'TOTAL')
        if (tot) printedTotal = Number(tot.s)
        printedDays = dayCols.map(d => {
          const c = row.find(i => INT.test(i.s) && nearest(cols, i.x)?.k === 'day' + d.day)
          return { day: d.day, dayTo: d.dayTo, boxes: c ? Number(c.s) : null }
        })
        continue
      }
      /* A SPECIES SUBTOTAL IS NOT A ROW — it is the same fish counted again.
         The Shetland note taught this one: `HADD total` reads exactly like a
         transaction until you add the landing up and find it doubled.
         ON THIS LAYOUT THE GUARD IS BELT-AND-BRACES and says so rather than
         claiming otherwise: measured, every subtotal label is right-aligned
         into the SIZE or BOX column — `HADDOCK TOTAL` at x=210 against SIZE at
         205 — so none has a cell under SPECIES and the `!sp || !gr` test below
         already drops it. Mutation-checked: removing this line changes neither
         the line count nor the total. It is kept for the day the export
         left-aligns that label, which is the day it would start counting fish
         twice. */
      if (SPECIES_TOTAL.test(joined.replace(/\s+\d[\d\s]*$/, '').trim())) continue

      const at = (k) => row.find(i => nearest(cols, i.x)?.k === k)
      const sp = at('SPECIES')
      const gr = at('GRADE')
      if (!sp || !gr) continue
      if (/^SPECIES$/i.test(sp.s)) continue

      const size = at('SIZE')
      const boxKg = at('BOX (kg)')
      const totCell = row.find(i => INT.test(i.s) && nearest(cols, i.x)?.k === 'TOTAL')

      /* ONE LINE PER DAY BAND, exactly as the workbook reader emits them, so a
         tally read either way is the same object downstream. A band of nought
         is not a line: the workbook does not emit one either, and a run of
         zeroes would make every species look landed on every day. */
      const perDay = []
      for (const d of dayCols) {
        const cell = row.find(i => INT.test(i.s) && nearest(cols, i.x)?.k === 'day' + d.day)
        const boxes = cell ? Number(cell.s) : null
        perDay.push({ d, boxes })
        if (!boxes) continue
        lines.push({
          species: sp.s.toUpperCase(),
          grade: gr.s,
          size: size ? size.s : null,
          boxKg: boxKg ? boxKg.s : null,
          day: d.day, dayTo: d.dayTo, dayLabel: d.day === d.dayTo ? String(d.day) : `${d.day}-${d.dayTo}`,
          tagName: d.tagName,
          boxes,
          seq: seq++,
        })
      }
      /* EVERY ROW CHECKS AGAINST ITS OWN PRINTED TOTAL. A day cell read into the
         wrong column would still add up across the sheet; this catches it on
         the row it happened. A row whose days do not reach its total is kept
         and FLAGGED rather than dropped — the boxes were landed either way. */
      const rowSum = perDay.reduce((s, c) => s + (c.boxes || 0), 0)
      if (totCell && rowSum !== Number(totCell.s)) {
        for (const l of lines.slice(-perDay.filter(c => c.boxes).length)) l.rowTotalDisagrees = Number(totCell.s)
      }
    }
  }

  const total = lines.reduce((s, l) => s + l.boxes, 0)
  const diff = printedTotal == null ? null : total - printedTotal
  const days = [...new Set(lines.map(l => l.dayLabel))]
  return {
    lines, total, days, printedTotal, printedDays, diff,
    reconciles: diff === 0,
    rowsDisagreeing: lines.filter(l => l.rowTotalDisagrees != null).length,
    skippedPages,
    measure: 'boxes',
  }
}

/* The thin wrapper: get pdf.js, pull the items off every page, hand them over. */
export async function parseTallyPdf(data) {
  const pdfjs = await ensurePdfjs()
  const doc = await pdfjs.getDocument({ data, verbosity: 0 }).promise
  const pages = []
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent()
    pages.push(tc.items.map(i => ({ x: i.transform[4], y: i.transform[5], s: i.str })))
  }
  return parseTallyPdfPages(pages)
}

/** Does this PDF look like the grading sheet rather than a catch overview? */
export function looksLikeTallyPdf(text) {
  const t = String(text || '')
  return /GRADING SHEET/i.test(t) || (/\bSPECIES\b/.test(t) && /\bDAY\s*\d/i.test(t))
}
