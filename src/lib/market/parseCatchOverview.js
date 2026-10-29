/* --------------------------------------------------------------------------
 * THE CATCH OVERVIEW — the scales, by grading code, out of the logbook export
 *
 * David, Oct 2026: *"upload only accepts xsls. not pdf"*, on the tally check.
 * The PDF he has is this one, and it is the better document for the job: it is
 * the WEIGHED landing rather than the wheelhouse count, so it sits beside the
 * sales note instead of 9% above it.
 *
 *     tally (wheelhouse)   305 haddock boxes   ·  1,094 all species
 *     catch overview       279                 ·  1,037      <- this document
 *     note                 280                 ·  1,042
 *
 * IT CARRIES AN OCR TEXT LAYER, NOT A BORN-DIGITAL ONE. One generated font
 * (`g_d0_f1`), stray question marks where digits should be — `732.00?`,
 * `681.00???` — and cells run together, `1.160849.00` being the CF column and
 * the living weight with nothing between them. So nothing here may be taken on
 * trust, and this file is mostly about which half can be.
 *
 * MEASURED ON THE REAL TRIP 72 EXPORT, and the two columns are not alike:
 *
 *     WEIGHT   every species reconciles EXACTLY to its own printed total
 *     BOXES    902 of the printed 1,037 — 13 rows lose theirs, silently
 *
 * **So the comparison runs on WEIGHT.** That is not a compromise: the note
 * carries a weight per row too, the check is of shares either way, and on the
 * real pair it is the quieter reading — A4 comes out +0.9 points against the
 * note where boxes give +3.0, because a weighed kilo matches a weighed kilo.
 *
 * Boxes are still read and returned, because the row reads better with them,
 * but they are NEVER what the ladder is compared on and the panel says which
 * measure it used. A figure that is right 87% of the time and silent about the
 * other 13% is exactly the shape this repo keeps getting caught by.
 * ------------------------------------------------------------------------ */
import { ensurePdfjs } from '../pdfjs.js'
import { FAO_SPECIES } from './auctionOrder.js'

/* `1d - Good Seed`, `U9a - 5-10 KG`, `5b - X Small` — the code, then the name.
 * The tally writes it the other way round, `Good Seed (1d)`, and this parser
 * emits the tally's spelling so one grade reader serves both documents. That
 * is the parser's job here, the way parse-core canonicalises a species: the
 * `lines` it returns are the app's shape, not a transcript of the page. */
const GRADE = /^([0-9]+[a-z]?|U9[a-z]?|x)\s*[-–]\s*(.+)$/i
/* `Haddock (HAD)` — the FAO code is what joins, not the trade name. */
const SPECIES = /^(.+?)\s*\(([A-Z]{3})\)$/
/* A PREFIX MATCH, NOT A WHOLE ONE. The OCR appends rubbish to otherwise sound
 * figures — `732.00?` is the Good Seed weight — and an anchored match threw it
 * away. That one null hid the entire downgrade on the real pair: A1 read −0.2
 * points instead of −6.4 and no candidate was raised at all.
 * WHAT MAKES THIS SAFE IS THE RECONCILE, not the regex. If the OCR mangles a
 * digit rather than trailing one, the parsed total stops matching the printed
 * total and the caller refuses the document instead of comparing against it. */
const MONEY = /^[\d,]+\.\d{2}/

const num = (s) => Number(String(s).replace(/[^0-9.]/g, '')) || 0

/* Rows on this export are not flat: a cell often sits a point or two off its
 * own line — the box count for `1c - Pinger` is one above the rest of the row.
 * Banding by exact y loses it, so items are clustered within a tolerance. */
const BAND = 3

/* --------------------------------------------------------------------------
 * COLUMNS ARE CALIBRATED OFF EACH PAGE'S OWN HEADER, never hard-coded.
 * The three pages of the real export are at different scales — GRADE sits at
 * x=117 on page 1 and x=110 on page 2 — so a fixed band would read page 1 and
 * quietly miss page 2. The header is reprinted on every page, which is what
 * makes this possible; a page without one is skipped and SAID, not guessed at.
 * Same anchoring as the P&J note's Withdrawn flag.
 * ------------------------------------------------------------------------ */
const NEAR = 9

/* THE READING IS SPLIT FROM THE PDF, the way parse-core splits `parseExtracted`
 * from `parsePdf`. `ensurePdfjs` resolves a worker URL and needs a browser, so
 * a parser welded to it could only ever be checked by uploading a file on a real
 * login — and this one is picking columns out of an OCR layer, which is the
 * half most worth testing. `pages` is one array of {x, y, s} per page.
 */
export function parseCatchOverviewPages(pages) {

  const lines = []
  const skippedPages = []
  let printedKg = null, printedBoxes = null
  let fao = null, speciesName = null

  for (let p = 1; p <= pages.length; p++) {
    const items = (pages[p - 1] || []).filter(i => i.s && String(i.s).trim())
      .map(i => ({ x: i.x, y: i.y, s: String(i.s).trim() }))

    const header = Object.fromEntries(items
      .filter(i => /^(GRADE|WEIGHT|BOXES)$/.test(i.s))
      .map(i => [i.s, i.x]))
    if (header.GRADE == null || header.WEIGHT == null) { skippedPages.push(p); continue }

    const ys = [...new Set(items.map(i => Math.round(i.y)))].sort((a, b) => b - a)
    const bands = []
    for (const y of ys) {
      const b = bands.find(b => Math.abs(b.y - y) <= BAND)
      if (b) b.ys.add(y); else bands.push({ y, ys: new Set([y]) })
    }

    for (const band of bands) {
      const row = items.filter(i => band.ys.has(Math.round(i.y))).sort((a, b) => a.x - b.x)
      /* THE HEADER ROW IS NOT A GRADE ROW. Widening the grade cell to any text
         — so that uncoded grades like `Mix` are kept — swept the word GRADE
         itself in on every page. It carried no weight so it broke no total,
         which is precisely how it would have gone unnoticed. */
      if (row.some(i => /^(PRODUCT GROUP|GRADE|LIVING WEIGHT)$/.test(i.s))) continue

      /* A species heading carries down the rows beneath it until the next. */
      const sp = row.find(i => SPECIES.test(i.s))
      if (sp) { const m = sp.s.match(SPECIES); speciesName = m[1].trim(); fao = m[2] }

      /* The document's own grand total, which is what the parse is checked
         against. Taken as the FIRST weight and the integer after it. */
      /* READ BY COLUMN, the same calibration as every other cell. Picking the
         figures out of the joined sentence read `38,115.00` as the box count.
         The total row prints three weights; the one under WEIGHT is landed. */
      if (row.some(i => /^Total$/i.test(i.s))) {
        const kg = row.find(i => Math.abs(i.x - header.WEIGHT) < NEAR && MONEY.test(i.s))
        if (kg) printedKg = num(kg.s.match(MONEY)[0])
        if (header.BOXES != null) {
          const bx = row.find(i => Math.abs(i.x - header.BOXES) < NEAR && /^[\d,]+$/.test(i.s))
          if (bx) printedBoxes = num(bx.s)
        }
      }

      /* ANY text in the grade column is a row, not only a coded one. Redfish
         grades read `Medium` / `Selected` / `Small` and tusk reads `Mix` — no
         code, so they sit on no A-ladder rung, but they are real landed weight
         and dropping them would make the total fail to reconcile for a reason
         that has nothing to do with a misread digit. */
      const g = row.find(i => Math.abs(i.x - header.GRADE) < NEAR && /[A-Za-z0-9]/.test(i.s))
      if (!g || !fao) continue
      const m = g.s.match(GRADE)
      const wt = row.find(i => Math.abs(i.x - header.WEIGHT) < NEAR && MONEY.test(i.s))
      const bxItem = header.BOXES == null ? null
        : row.find(i => Math.abs(i.x - header.BOXES) < NEAR && /^\d+$/.test(i.s))

      lines.push({
        species: FAO_SPECIES[fao] || speciesName || fao,
        fao,
        /* The tally's spelling, so one grade reader serves both documents —
           and the document's own words where there is no code to turn round. */
        grade: m ? `${m[2].trim()} (${m[1].toLowerCase()})` : g.s,
        kg: wt ? num(wt.s.match(MONEY)[0]) : null,
        /* NULL, NEVER 0 — a box count the OCR lost must not read as a landing
           of none. `Number('') === 0` has caught this codebase seven times. */
        boxes: bxItem ? Number(bxItem.s) : null,
      })
    }
  }

  const total = Math.round(lines.reduce((s, l) => s + (l.kg || 0), 0) * 100) / 100
  /* RECONCILED AGAINST ITS OWN PRINTED TOTAL, the sales note's discipline. An
     OCR layer that can insert a question mark can drop a digit, and a wrong
     weight here would drive a comparison that names a downgrade that never
     happened. A penny of rounding is allowed; anything more is not reconciled
     and the caller must say so rather than compare against it. */
  const diff = printedKg == null ? null : Math.round((total - printedKg) * 100) / 100
  return {
    lines,
    measure: 'kg',
    total,
    totalBoxes: lines.reduce((s, l) => s + (l.boxes || 0), 0),
    boxesUnread: lines.filter(l => l.boxes == null).length,
    printedTotal: printedKg,
    printedBoxes,
    diff,
    reconciles: diff != null && Math.abs(diff) <= 0.01,
    skippedPages,
  }
}

/* The thin wrapper: get pdf.js, pull the items off every page, hand them over. */
export async function parseCatchOverview(data) {
  const pdfjs = await ensurePdfjs()
  const doc = await pdfjs.getDocument({ data, verbosity: 0 }).promise
  const pages = []
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent()
    pages.push(tc.items.map(i => ({ x: i.transform[4], y: i.transform[5], s: i.str })))
  }
  return parseCatchOverviewPages(pages)
}

/** Does this PDF look like a catch overview at all? */
export function looksLikeCatchOverview(text) {
  const t = String(text || '')
  return /PRODUCT GROUP/i.test(t) && /LIVING WEIGHT/i.test(t)
}
