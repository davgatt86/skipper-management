import * as XLSX from 'xlsx'

/* Read the boat's day-tag tally spreadsheet.
 *
 * The sheet is the one kept on the wheelhouse PC — scales read out, somebody
 * types the boxes in. Layout as at Trip 63:
 *
 *   row  7   SPECIES | GRADE | SIZE | BOX (kg) | DAY 1 … DAY 10 | TOTAL
 *   row  8   TAG COLOUR → | | | | 1 … 10
 *   rows     COD | Sprag (2) | 4-7kg | 30kg | 4 | 8 | … | 33
 *            COD TOTAL | | | | 9 | 19 | …          <- subtotal, skipped
 *            GRAND TOTAL (all species) | …          <- skipped
 *
 * NOTHING HERE IS FOUND BY CELL REFERENCE. The header row is located by its
 * SPECIES label and the day columns by their own headings, so a row inserted
 * at the top or an extra day column does not silently shift every figure by
 * one. A totals row that got read as data would be the worst outcome — it
 * would double the fish — so they are dropped by name and the parsed total is
 * checked against the sheet's own GRAND TOTAL and reported either way.
 */

const norm = (v) => String(v ?? '').trim()

/* WHAT KIND OF FILE IS THIS, ACTUALLY.
 *
 * A spreadsheet starts `PK` (it is a zip) or `\xD0\xCF` for the old .xls
 * compound format. Anything else with an .xlsx name is not a workbook, whatever
 * the name says — and SheetJS will not refuse it, it will parse a PDF as one
 * long column of text and hand back a sheet with no SPECIES header.
 *
 * That produced "No sheet in that workbook has a SPECIES column — is it the day
 * tally?", which sends the skipper looking for a missing column in a file that
 * is not a spreadsheet at all. It happened for real: two of the boat's day
 * tallies were overwritten by a rendered PDF that kept the .xlsx name, and the
 * message pointed nowhere near the cause.
 *
 * Naming the actual file type costs four bytes of checking and turns a
 * confusing message into an obvious one. */
function fileKind(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  const at = (...bytes) => bytes.every((v, i) => b[i] === v)
  if (at(0x50, 0x4b)) return null                        // PK — xlsx/xlsm, fine
  if (at(0xd0, 0xcf, 0x11, 0xe0)) return null            // old .xls, fine
  if (at(0x25, 0x50, 0x44, 0x46)) return 'a PDF'
  if (at(0x89, 0x50, 0x4e, 0x47)) return 'a PNG image'
  if (at(0xff, 0xd8, 0xff)) return 'a JPEG image'
  if (at(0x7b) || at(0x5b)) return 'a JSON file'
  return 'not a spreadsheet'
}

export function parseDayTally(buf) {
  /* Checked BEFORE handing it to SheetJS, which will happily read almost
   * anything and leave the real problem two errors downstream. */
  const kind = fileKind(buf)
  if (kind) {
    return {
      error: kind === 'not a spreadsheet'
        ? 'That file is not a spreadsheet — the day tally is an .xlsx workbook.'
        : `That file is ${kind}, not a spreadsheet. The day tally is an .xlsx workbook — `
          + 'check the file has not been replaced by something else with the same name.',
    }
  }

  const wb = XLSX.read(buf, { type: 'array' })

  // The tally sheet is whichever one carries a SPECIES header — the workbook
  // also holds a grading reference, a tag-colour key and a lists tab.
  let sheetName = null, rows = null, hdr = -1
  for (const name of wb.SheetNames) {
    const r = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null, blankrows: false })
    const i = r.findIndex((row) => norm(row?.[0]).toUpperCase() === 'SPECIES')
    if (i >= 0) { sheetName = name; rows = r; hdr = i; break }
  }
  if (hdr < 0) {
    return { error: 'No sheet in that workbook has a SPECIES column — is it the day tally?' }
  }

  /* A COLUMN IS A TAG, NOT ALWAYS A DAY.
   *
   * Peterhead Port Authority cut the ten day-tag colours to FOUR on 2 Oct 2026,
   * and the sheet's own Tag Colours tab states the new scheme: Black 1-3,
   * Purple 4-5, Red 6-7, Orange 8-9. So the tally now heads its columns
   * "DAY 1-3" rather than "DAY 1", and the old `^DAY (\d+)$` matched none of
   * them — which is the "no DAY columns" the page reported.
   *
   * `day` stays the FIRST day of the band, so every ordering downstream still
   * works unchanged: freshest-first in the catalogue, high-to-low stacking in
   * buildStacks, and the A+ mark on the newest tag. A band label rides along
   * for anything that PRINTS the day, because "8-9" is what is on the box. */
  const dayCols = []
  for (let c = 0; c < (rows[hdr] || []).length; c++) {
    const m = norm(rows[hdr][c]).match(/^DAY\s*(\d+)(?:\s*[-‐-―]\s*(\d+))?$/i)
    if (!m) continue
    const from = Number(m[1])
    const to = m[2] ? Number(m[2]) : from
    // A band written backwards is dropped whole rather than reversed: which of
    // the two numbers is wrong is not knowable, the same refusal the invoice
    // page makes on an impossible page range.
    if (to < from) continue
    dayCols.push({ col: c, day: from, dayTo: to, dayLabel: to > from ? `${from}-${to}` : String(from) })
  }
  if (!dayCols.length) return { error: 'Found the SPECIES header but no DAY columns under it.' }

  /* THE TAG COLOUR IS READ, NEVER DERIVED FROM THE DAY NUMBER.
   *
   * Under the new scheme the Purple band STARTS at day 4 — and day 4 is Orange
   * in the old ten-colour table. Three of the four bands would print the wrong
   * colour on a document whose whole job is matching the tag stapled to the
   * box. The sheet states the colour under each column, so it is taken from
   * there and only falls back to the day number for the old layout.
   *
   * The old sheets put the day NUMBER in that row (1, 2, 3 …), so a value that
   * is a number is not a colour name and is ignored. */
  const tagRow = rows[hdr + 1] && /TAG\s*COLOUR/i.test(norm(rows[hdr + 1][0])) ? rows[hdr + 1] : null
  if (tagRow) {
    for (const d of dayCols) {
      const v = norm(tagRow[d.col])
      if (v && !Number.isFinite(Number(v))) d.tagName = v
    }
  }

  const lines = []
  let printedTotal = null
  for (let i = hdr + 1; i < rows.length; i++) {
    const r = rows[i] || []
    const species = norm(r[0])
    const grade = norm(r[1])
    if (!species) continue

    if (/^GRAND TOTAL/i.test(species)) {
      const last = r[r.length - 1]
      const n = Number(last)
      if (Number.isFinite(n)) printedTotal = n
      continue
    }
    if (/\bTOTAL\b/i.test(species)) continue      // per-species subtotal
    if (!grade) continue                          // TAG COLOUR row and spacers

    for (const { col, day, dayTo, dayLabel, tagName } of dayCols) {
      const boxes = Number(r[col])
      if (Number.isFinite(boxes) && boxes > 0) {
        // `seq` is the row's position in the sheet, which is already the
        // grading order — XL, Large, Cod, Sprag, Med, B Baby, Baby, Robbie.
        // Carrying it means the layout can follow the market's own order
        // instead of sorting grade names alphabetically, which put Sprag
        // above Med and Cod above Large.
        lines.push({
          species, grade, size: norm(r[2]) || null, boxKg: norm(r[3]) || null,
          day, dayTo, dayLabel, tagName: tagName || null, boxes, seq: i,
        })
      }
    }
  }

  const total = lines.reduce((s, l) => s + l.boxes, 0)
  const days = [...new Set(lines.map((l) => l.day))].sort((a, b) => a - b)

  // Trip details sit above the header as label/value pairs across merged cells,
  // so they are found by label rather than by position.
  const meta = {}
  for (let i = 0; i < hdr; i++) {
    const r = rows[i] || []
    for (let c = 0; c < r.length; c++) {
      const label = norm(r[c]).replace(/:$/, '')
      if (!label) continue
      const value = r.slice(c + 1).find((v) => norm(v) !== '')
      if (value == null) continue
      if (/^Landing Port$/i.test(label)) meta.port = norm(value)
      if (/^Fishing Method$/i.test(label)) meta.gear = norm(value)
      if (/^Landing or Consignment$/i.test(label)) meta.kind = norm(value)
      if (/Boxes of Fish going private/i.test(label)) meta.privateFish = norm(value)
    }
  }

  return {
    sheetName, lines, total, days, meta,
    printedTotal,
    // Same idea as the sales-note reconcile: say whether the parse agrees with
    // the total the sheet prints for itself, rather than quietly assuming it.
    reconciles: printedTotal == null ? null : printedTotal === total,
  }
}
