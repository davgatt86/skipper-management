/* THE PRINTABLE ENGINE ROOM SHEET — made to be READ, by the engineer and by the
 * reader that will take a photograph of it.
 *
 * David, Sep 2026: "build printable sheet for reading. put decimal into the entry
 * box where it typically has a low number for example 2.2 to make it easier for
 * the reader."
 *
 * ONE FIGURE PER BOX. Free handwriting on a ruled line is where a 1 becomes a 7
 * and two figures run into one; a box per figure gives both the pen and the
 * reader a place for each character.
 *
 * THE DECIMAL POINT IS PRINTED, and only where this boat's own record says it
 * belongs. Every slip found in the old log was a decimal in the wrong place —
 * Charge Air Pressure 150 for 1.50, Lube Oil Pressure 42 for 4.2, gearbox oil
 * pressure 2.8 for 28 — so the one character most likely to be lost is now
 * printed rather than written. The rule, measured off the record rather than
 * decided row by row: a reading gets a point when it is typically BELOW 10 and
 * has been written with a point at least once. On Audacious that is exactly the
 * seven low pressures — charge air, HT, LT, lube oil, fuel and stop air on the
 * main engine, and generator oil. GOV is low too and has never had a point, so it
 * gets none; gearbox oil pressure is bar but reads 28, so it gets none either.
 *
 * THE BOX COUNT COMES FROM THE CONFIRMED RANGE, NOT FROM THE HIGHEST READING ON
 * RECORD. A 175-bar slip would otherwise print three boxes where one belongs,
 * and the sheet would then invite the next one. The stated range is the
 * authority here as it is in the entry checks; history only speaks for a
 * reading that has no range. Counters get one spare box to grow into.
 *
 * THE ROWS ARE THE APP'S, not the old paper sheet's, and named exactly as the app
 * stores them — a sheet that prints a field the app has no column for gives the
 * reader somewhere to write and nowhere to put it.
 *
 * Built and saved separately, like buildStoresDoc: doc.save() does nothing at
 * all under node, so the build half is what the preview renders and reads back.
 */
import { jsPDF } from 'jspdf'
import { ENGINE_TEMPLATE } from './template.js'

/* Printed on the sheet so a reader can tell which layout it is looking at. Bump
 * it whenever a row moves, or an old photograph will be read against a new grid. */
export const SHEET_LAYOUT = 'ER1'

// For a reading with no range and no history at all — a new boat, or a new row.
// A pressure gets two figures AND a point, which holds 28 and 2.2 alike.
const UNIT_DEFAULT = {
  bar: { int: 2, dec: 1 }, '°C': { int: 3, dec: 0 }, rpm: { int: 4, dec: 0 },
  kW: { int: 3, dec: 0 }, L: { int: 3, dec: 0 }, '%': { int: 3, dec: 0 }, h: { int: 6, dec: 0 },
}
const NO_UNIT_DEFAULT = { int: 2, dec: 0 }

const digitsOf = (n) => String(Math.floor(Math.abs(n))).length
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }

/* How many boxes a reading gets, whether a point is printed, and what that was
 * decided from — 'range', 'history', 'sibling' (the same row on the other
 * generator) or 'default'. The basis is returned so a test can say WHY. */
export function boxShape(group, param, { logs = [], limits = [], template = ENGINE_TEMPLATE, siblings = true } = {}) {
  const unit = template.find((g) => g.group === group)?.params.find((p) => p.label === param)?.unit ?? ''
  const lim = limits.find((l) => l.group_key === group && l.param_key === param)
  // A blank box is not a reading of nought — Number('') is 0, and this codebase
  // has been bitten by that six times.
  const hist = logs
    .map((l) => l.readings?.[group]?.[param])
    .filter((v) => v !== null && v !== undefined && v !== '')
    .map(Number)
    .filter(Number.isFinite)

  if (lim?.is_counter || unit === 'h') {
    if (!hist.length) return { ...UNIT_DEFAULT.h, basis: 'default' }
    return { int: digitsOf(Math.max(...hist)) + 1, dec: 0, basis: 'history' }
  }

  const rangeMax = lim && lim.max_val !== null && lim.max_val !== undefined && lim.max_val !== ''
    ? Number(lim.max_val) : null

  if (rangeMax === null && !hist.length) {
    if (siblings) {
      /* ONLY THE SAME KIND OF MACHINE. The first version borrowed from any group
       * with a row of the same name, and found the MAIN ENGINE first: its fuel
       * pressure reads about 4.5 bar, so Generator 2 — whose fuel pressure reads
       * 38 — was given one box and a printed point, a box nobody could write 38
       * in. Caught by test-engine-sheet.mjs, not by the preview, which checks
       * the drawing against the rule and so agreed with a wrong rule. A
       * generator's gauge is only like another generator's. */
      const kind = (name) => name.replace(/\s*\d+$/, '')
      for (const g of template) {
        if (g.group === group || kind(g.group) !== kind(group) || !g.params.some((p) => p.label === param)) continue
        const s = boxShape(g.group, param, { logs, limits, template, siblings: false })
        if (s.basis !== 'default') return { ...s, basis: 'sibling', from: g.group }
      }
    }
    return { ...(UNIT_DEFAULT[unit] || NO_UNIT_DEFAULT), basis: 'default' }
  }

  const top = rangeMax !== null ? rangeMax : Math.max(...hist)
  let int = Math.max(1, digitsOf(top))
  // A percentage reaches 100 and litres run past 99, whatever the record shows.
  if (unit === '%' || unit === 'L') int = Math.max(int, 3)
  const typical = rangeMax !== null ? rangeMax : median(hist)
  const dec = typical < 10 && hist.some((v) => !Number.isInteger(v)) ? 1 : 0
  return { int, dec, basis: rangeMax !== null ? 'range' : 'history' }
}

export function sheetShapes({ logs = [], limits = [], template = ENGINE_TEMPLATE } = {}) {
  const out = new Map()
  for (const g of template) {
    for (const p of g.params) out.set(`${g.group}||${p.label}`, boxShape(g.group, p.label, { logs, limits, template }))
  }
  return out
}

// ------------------------------------------------------------------ drawing
const INK = [10, 29, 38]
const RULE = [205, 212, 216]
const MUTE = [93, 112, 121]

/* Sized to fill A4, not merely to fit it. The first cut left the bottom quarter
   of the page empty below the signature — room that belongs in the boxes, since
   a bigger box is easier to write in with a cold hand and easier for the reader
   to split into figures. The widest generator row still leaves room for "Jacket
   Water Temp", which is what sets the box width. */
const BW = 13.5   // box width
const BH = 17     // box height
const BG = 1.6    // gap between boxes
const DOT = 7.5   // the space the printed point sits in
const RH = 23.5   // row height
const HEAD = 16   // section bar
const M = 28      // page margin
const GAP = 14    // between the two columns

const groupWidth = ({ int, dec }) =>
  int * BW + (int - 1) * BG + (dec ? DOT + dec * BW + (dec - 1) * BG : 0)

function drawBoxes(doc, right, top, { int, dec }) {
  let x = right - groupWidth({ int, dec })
  doc.setDrawColor(...INK); doc.setLineWidth(0.6)
  for (let i = 0; i < int; i++) {
    doc.rect(x, top, BW, BH)
    x += BW + (i < int - 1 ? BG : 0)
  }
  if (dec) {
    // Bold and large, on the baseline between the boxes, so a figure written
    // either side of it cannot be read as one number.
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(...INK)
    doc.text('.', x + DOT / 2, top + BH - 1.5, { align: 'center' })
    x += DOT
    for (let i = 0; i < dec; i++) { doc.rect(x, top, BW, BH); x += BW + BG }
  }
}

function sectionHead(doc, x, y, w, text) {
  doc.setFillColor(...INK); doc.rect(x, y, w, HEAD, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(255, 255, 255)
  doc.text(text.toUpperCase(), x + 6, y + 11)
  doc.setTextColor(...INK)
  return y + HEAD
}

function rowLabel(doc, x, y, label) {
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...INK)
  doc.text(label, x + 4, y + RH / 2 + 3)
}

function rowUnit(doc, right, y, unit) {
  if (!unit) return
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...MUTE)
  doc.text(unit, right, y + RH / 2 + 2.5, { align: 'right' })
}

function rowRule(doc, x, y, w) {
  doc.setDrawColor(...RULE); doc.setLineWidth(0.4); doc.line(x, y + RH, x + w, y + RH)
}

function paramRows(doc, x, y, w, group, shapes) {
  for (const p of group.params) {
    const shape = shapes.get(`${group.group}||${p.label}`)
    const right = x + w - 4
    rowLabel(doc, x, y, p.label)
    rowUnit(doc, right - groupWidth(shape) - 5, y, p.unit)
    drawBoxes(doc, right, y + (RH - BH) / 2, shape)
    rowRule(doc, x, y, w)
    y += RH
  }
  return y
}

/* The generators side by side, as the paper sheet has always had them. The
 * caption names BOTH what the engine room calls it and what the app calls it,
 * because which physical set is "Generator 1" is exactly the question an hour
 * meter reading 7,396 against 8,864 on record raised. */
function generatorRows(doc, x, y, w, gens, shapes) {
  const labels = [...new Set(gens.flatMap((g) => g.params.map((p) => p.label)))]
  const unitOf = (label) => gens.flatMap((g) => g.params).find((p) => p.label === label)?.unit || ''
  const GW = Math.max(...labels.flatMap((label) =>
    gens.map((g) => { const s = shapes.get(`${g.group}||${label}`); return s ? groupWidth(s) : 0 })))
  const right2 = x + w - 4
  const right1 = right2 - GW - 12
  const cols = [right1, right2]

  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...INK)
  gens.forEach((g, i) => doc.text(`DG${i + 1} · ${g.group}`, cols[i] - GW / 2, y + 10, { align: 'center' }))
  y += 14

  for (const label of labels) {
    rowLabel(doc, x, y, label)
    rowUnit(doc, right1 - GW - 5, y, unitOf(label))
    gens.forEach((g, i) => {
      if (!g.params.some((p) => p.label === label)) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTE)
        doc.text('—', cols[i] - GW / 2, y + RH / 2 + 3, { align: 'center' })
        return
      }
      drawBoxes(doc, cols[i], y + (RH - BH) / 2, shapes.get(`${g.group}||${label}`))
    })
    rowRule(doc, x, y, w)
    y += RH
  }
  return y
}

const fmtDay = (d) => {
  const t = d instanceof Date ? d : new Date(d)
  return Number.isNaN(t.getTime()) ? '' : t.toLocaleDateString('en-GB')
}

export function buildEngineSheet({ vessel = {}, logs = [], limits = [], template = ENGINE_TEMPLATE, printedOn = new Date() } = {}) {
  const shapes = sheetShapes({ logs, limits, template })
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const colW = (W - 2 * M - GAP) / 2
  const xL = M
  const xR = M + colW + GAP
  const name = [vessel?.vessel_name, vessel?.pln].filter(Boolean).join(' · ')

  // ---- head
  doc.setTextColor(...INK)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15)
  doc.text('Daily Engine Room Log', M, 40)
  doc.setFontSize(12)
  doc.text(name || 'Vessel ______________________', W - M, 40, { align: 'right' })

  // The date in boxes too: a date read wrongly files every figure under the
  // wrong day, and nothing on the rest of the sheet would say so.
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...INK)
  doc.text('DATE', M, 64)
  let dx = M + 32
  const two = { int: 2, dec: 0 }
  ;['DD', 'MM', 'YY'].forEach((cap, i) => {
    const gw = groupWidth(two)
    drawBoxes(doc, dx + gw, 53, two)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...MUTE)
    doc.text(cap, dx + gw / 2, 76, { align: 'center' })
    dx += gw
    if (i < 2) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.setTextColor(...INK)
      doc.text('/', dx + 5, 65, { align: 'center' })
      dx += 10
    }
  })

  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTE)
  doc.text('One figure in each box. Where a decimal point is printed, write the figures either side of it.', W - M, 62, { align: 'right' })
  doc.text(`Layout ${SHEET_LAYOUT} · every row is named as the app stores it`, W - M, 73, { align: 'right' })

  const y0 = 88

  // ---- left: the main engine
  const main = template.find((g) => /^Main Engine/.test(g.group))
  const gearbox = template.find((g) => /^Gearbox/.test(g.group))
  const gens = template.filter((g) => /^Generator/.test(g.group))
  const rest = template.filter((g) => g !== main && g !== gearbox && !gens.includes(g))

  let yL = y0
  if (main) { yL = sectionHead(doc, xL, yL, colW, main.group); yL = paramRows(doc, xL, yL, colW, main, shapes) }

  // ---- right: gearbox, generators, anything added later, then notes
  let yR = y0
  if (gearbox) { yR = sectionHead(doc, xR, yR, colW, gearbox.group); yR = paramRows(doc, xR, yR, colW, gearbox, shapes) + 12 }
  if (gens.length) { yR = sectionHead(doc, xR, yR, colW, 'Generators'); yR = generatorRows(doc, xR, yR, colW, gens, shapes) + 12 }
  for (const g of rest) { yR = sectionHead(doc, xR, yR, colW, g.group); yR = paramRows(doc, xR, yR, colW, g, shapes) + 12 }

  const bodyEnd = Math.max(yL, yR + HEAD + 70)
  yR = sectionHead(doc, xR, yR, colW, 'Notes')
  doc.setDrawColor(...RULE); doc.setLineWidth(0.6)
  doc.rect(xR, yR, colW, bodyEnd - yR)

  // ---- sign-off
  const yS = bodyEnd + 30
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...INK)
  doc.text('LOGGED BY', xL, yS)
  doc.text('SIGNATURE', xR, yS)
  doc.setDrawColor(...INK); doc.setLineWidth(0.6)
  doc.line(xL + 58, yS + 2, xL + colW, yS + 2)
  doc.line(xR + 58, yS + 2, xR + colW, yS + 2)

  // ---- foot
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...MUTE)
  doc.text(`${name || 'Engine room'} · printed ${fmtDay(printedOn)} · Skipper Management · layout ${SHEET_LAYOUT}`, M, H - 18)

  return doc
}

export function exportEngineSheet(opts = {}) {
  const doc = buildEngineSheet(opts)
  const v = opts.vessel || {}
  const slug = String(v.pln || v.vessel_name || 'vessel').replace(/[^\w]+/g, '-')
  doc.save(`engine-room-sheet-${slug}.pdf`)
}
