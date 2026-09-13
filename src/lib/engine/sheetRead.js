/* WHAT THE READER MADE OF A PHOTO OF THE ENGINE ROOM SHEET — turned into a form
 * the engineer checks, never into a saved log.
 *
 * David, Sep 2026: *"build the photo reader for the sheet."* The sheet was built
 * FOR this (printSheet.js): one figure per box, the decimal point printed where
 * the boat's own record uses one, every row named exactly as the app stores it.
 *
 * THE READER IS TOLD WHICH ROWS TO LOOK FOR, AND THE LIST IS THE APP'S.
 * `sheetFields` builds it from ENGINE_TEMPLATE and the same box shapes the sheet
 * prints, and the client sends it with the photo. So a row added to the template
 * is read the day it is printed, with no redeploy of the reader — and the reader
 * is never asked for a field the app has nowhere to put.
 *
 * NOTHING HERE CORRECTS A FIGURE. It flags; the man with the paper decides. The
 * figure most worth reading exactly is the one that looks wrong: a generator
 * counter logged below its last reading is the mistake the save check exists to
 * catch, and a reader that "fixed" it would hide it. The existing range,
 * reversal and drift checks run on save exactly as they do for a typed entry.
 *
 * FOUR THINGS ARE FLAGGED, and each is a fact about the SHEET, not a guess:
 *   unsure   — the reader said so
 *   boxes    — more figures than the sheet gives boxes for
 *   decimal  — a decimal where the sheet prints no point
 *   places   — more decimal places than the sheet has boxes for
 */

export const readKey = (group, param) => `${group}||${param}`

// The characters the reader keeps in a label. A label carrying anything else
// would come back under a different key and its figure would be lost —
// test-sheet-read.mjs asserts every template label passes.
export const LABEL_CHARS = /^[\p{L}\p{N} °³%().&/-]+$/u

export const OPERATION_WORDS = ['steaming', 'towing', 'alongside']

export function sheetFields(template, shapes) {
  return template.flatMap((g) => g.params.map((p) => {
    const s = shapes?.get(readKey(g.group, p.label)) || { int: 3, dec: 0 }
    return { group: g.group, param: p.label, unit: p.unit || '', int: s.int, dec: s.dec }
  }))
}

const REASONS = {
  unsure: 'the reader was not sure of it',
  boxes: 'more figures than the sheet has boxes for',
  decimal: 'a decimal where the sheet prints no point',
  places: 'more decimal places than the sheet has boxes for',
}

export function flagText(reasons) {
  return (reasons || []).map((r) => REASONS[r] || r).join('; ')
}

function realDay(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  const d = new Date(iso + 'T00:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso
}

const text = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : '')

export function reviewSheetRead(result, fields, { today, layout: expected } = {}) {
  const byKey = new Map((fields || []).map((f) => [readKey(f.group, f.param), f]))
  const unsure = new Set(Array.isArray(result?.unsure) ? result.unsure : [])
  const readings = {}
  const flags = {}
  let read = 0

  for (const [k, v] of Object.entries(result?.readings || {})) {
    const f = byKey.get(k)
    // A figure that is not a number is not a reading. Blank stays blank — the
    // Number('') === 0 trap has bitten this repo seven times.
    if (!f || typeof v !== 'number' || !Number.isFinite(v)) continue
    ;(readings[f.group] ||= {})[f.param] = String(v)
    read++

    const why = []
    if (unsure.has(k)) why.push('unsure')
    const [intPart, decPart = ''] = String(Math.abs(v)).split('.')
    if (intPart.length > f.int) why.push('boxes')
    if (decPart && !f.dec) why.push('decimal')
    else if (decPart.length > f.dec) why.push('places')
    if (why.length) flags[k] = why
  }

  /* THE DATE FILES EVERY FIGURE UNDER A DAY, so a doubtful one is never used.
     Unread, impossible or in the future, the form takes today and says so —
     the page names which, because "check the date" sends nobody anywhere. */
  let log_date = today
  let dateNote = null
  const iso = typeof result?.date === 'string' ? result.date : null
  if (!iso) dateNote = 'unread'
  else if (!realDay(iso)) dateNote = 'impossible'
  else if (today && iso > today) dateNote = 'future'
  else log_date = iso

  const op = String(result?.vessel_operation || '').toLowerCase()
  const readLayout = text(result?.layout, 12) || null

  return {
    draft: {
      log_date,
      vessel_operation: OPERATION_WORDS.includes(op) ? op : '',
      readings,
      notes: text(result?.notes, 1000),
      logged_by: text(result?.logged_by, 80),
    },
    flags,
    summary: { read, blank: Math.max(0, byKey.size - read), flagged: Object.keys(flags).length },
    layout: readLayout,
    layoutMatches: !!readLayout && readLayout === expected,
    expectedLayout: expected || null,
    dateNote,
    readDate: iso,
  }
}
