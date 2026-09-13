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
 * reader somewhere to write and nowhere to put it. Where the group sits on the
 * page comes from the template too (`sheet`), so a new group lands somewhere
 * rather than nowhere.
 *
 * Built and saved separately, like buildStoresDoc: doc.save() does nothing at
 * all under node, so the build half is what the preview renders and reads back.
 */
import { jsPDF } from 'jspdf'
import { ENGINE_TEMPLATE } from './template.js'

/* Printed on the sheet so a reader can tell which layout it is looking at. Bump
 * it whenever a row moves, or an old photograph will be read against a new grid.
 * ER2 (Sep 2026): the paper sheet's own fields joined, and rows moved to make
 * room for them. */
export const SHEET_LAYOUT = 'ER2'

// For a reading with no range, no history and no hint — a new boat, or a new row.
// A pressure gets two figures AND a point, which holds 28 and 2.2 alike.
const UNIT_DEFAULT = {
  bar: { int: 2, dec: 1 }, '°C': { int: 3, dec: 0 }, rpm: { int: 4, dec: 0 },
  kW: { int: 3, dec: 0 }, L: { int: 3, dec: 0 }, 'm³': { int: 3, dec: 1 },
  '%': { int: 3, dec: 0 }, h: { int: 6, dec: 0 },
}
const NO_UNIT_DEFAULT = { int: 2, dec: 0 }

const digitsOf = (n) => String(Math.floor(Math.abs(n))).length
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }

/* How many boxes a reading gets, whether a point is printed, and what that was
 * decided from — 'range', 'history', 'sibling' (the same row on another machine
 * of the same kind), 'hint' (the template's guess) or 'default'. Real data
 * always beats a guess, so that is also the order they are tried in. */
export function boxShape(group, param, { logs = [], limits = [], template = ENGINE_TEMPLATE, siblings = true } = {}) {
  const def = template.find((g) => g.group === group)?.params.find((p) => p.label === param)
  const unit = def?.unit ?? ''
  const hint = def?.boxes ? { int: def.boxes.int, dec: def.boxes.dec || 0, basis: 'hint' } : null
  const lim = limits.find((l) => l.group_key === group && l.param_key === param)
  // A blank box is not a reading of nought — Number('') is 0, and this codebase
  // has been bitten by that six times.
  const hist = logs
    .map((l) => l.readings?.[group]?.[param])
    .filter((v) => v !== null && v !== undefined && v !== '')
    .map(Number)
    .filter(Number.isFinite)

  if (lim?.is_counter || unit === 'h') {
    if (hist.length) return { int: digitsOf(Math.max(...hist)) + 1, dec: 0, basis: 'history' }
    return hint || { ...UNIT_DEFAULT.h, basis: 'default' }
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
       * generator's gauge is only like another generator's. And only REAL data
       * is borrowed: a sibling's own guess is no better than this row's. */
      const kind = (name) => name.replace(/\s*\d+$/, '')
      for (const g of template) {
        if (g.group === group || kind(g.group) !== kind(group) || !g.params.some((p) => p.label === param)) continue
        const s = boxShape(g.group, param, { logs, limits, template, siblings: false })
        if (s.basis === 'range' || s.basis === 'history') return { ...s, basis: 'sibling', from: g.group }
      }
    }
    return hint || { ...(UNIT_DEFAULT[unit] || NO_UNIT_DEFAULT), basis: 'default' }
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

/* The page laid out as BLOCKS: a single group, or a run of groups that share
 * their rows side by side. A group with no `sheet` hint goes in the right-hand
 * column rather than being left off — a row that exists in the app and not on
 * the paper is the failure this sheet exists to prevent. */
export function sheetBlocks(template = ENGINE_TEMPLATE) {
  const blocks = []
  for (const g of template) {
    const at = g.sheet || { column: 'right', order: 99 }
    const last = blocks[blocks.length - 1]
    if (at.pair && last && last.pair === at.pair) { last.groups.push(g); continue }
    blocks.push({ column: at.column, order: at.order ?? 99, pair: at.pair || null, groups: [g], title: at.pair || g.group })
  }
  const rank = { left: 0, right: 1, band: 2 }
  return blocks.sort((a, b) => (rank[a.column] ?? 1) - (rank[b.column] ?? 1) || a.order - b.order)
}

// ------------------------------------------------------------------ drawing
const INK = [10, 29, 38]
const RULE = [205, 212, 216]
const MUTE = [93, 112, 121]

/* ER1 had room to spare and grew its boxes to fill the page. ER2 carries the
   paper sheet's own fields as well — 17 more rows — so the rows are back to
   19.5pt, and it still fits one A4 page, which is one photograph a day. */
const BW = 13     // box width
const BH = 15     // box height
const BG = 1.6    // gap between boxes
const DOT = 7.5   // the space the printed point sits in
const RH = 19.5   // row height
const HEAD = 16   // section bar
const M = 28      // page margin
const GAP = 14    // between the two columns
const PAIR_GAP = 12

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

function singleRows(doc, x, y, w, group, shapes) {
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

const pairWidth = (groups, shapes) => Math.max(...groups.flatMap((g) =>
  g.params.map((p) => { const s = shapes.get(`${g.group}||${p.label}`); return s ? groupWidth(s) : 0 })))

/* Groups that share rows, side by side — the generators, as the paper sheet has
 * always had them, and the four refrigeration machines. The generator caption
 * names BOTH what the engine room calls it and what the app calls it, which David
 * confirmed in Sep 2026: DG1 is Generator 1. */
function pairedRows(doc, x, y, w, block, shapes) {
  const { groups } = block
  const labels = [...new Set(groups.flatMap((g) => g.params.map((p) => p.label)))]
  const unitOf = (label) => groups.flatMap((g) => g.params).find((p) => p.label === label)?.unit || ''
  const GW = pairWidth(groups, shapes)
  const rights = []
  for (let i = groups.length - 1, r = x + w - 4; i >= 0; i--, r -= GW + PAIR_GAP) rights[i] = r
  const caption = (g, i) => (block.pair === 'Generators' ? `DG${i + 1} · ${g.group}` : g.group)

  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...INK)
  groups.forEach((g, i) => doc.text(caption(g, i), rights[i] - GW / 2, y + 10, { align: 'center' }))
  y += 14

  for (const label of labels) {
    rowLabel(doc, x, y, label)
    rowUnit(doc, rights[0] - GW - 5, y, unitOf(label))
    groups.forEach((g, i) => {
      if (!g.params.some((p) => p.label === label)) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTE)
        doc.text('—', rights[i] - GW / 2, y + RH / 2 + 3, { align: 'center' })
        return
      }
      drawBoxes(doc, rights[i], y + (RH - BH) / 2, shapes.get(`${g.group}||${label}`))
    })
    rowRule(doc, x, y, w)
    y += RH
  }
  return y
}

const PAIR_LABEL_W = 100
const pairBlockWidth = (block, shapes) =>
  PAIR_LABEL_W + block.groups.length * pairWidth(block.groups, shapes) + (block.groups.length - 1) * PAIR_GAP + 4

function drawBlock(doc, x, y, w, block, shapes) {
  y = sectionHead(doc, x, y, w, block.title)
  return block.pair ? pairedRows(doc, x, y, w, block, shapes) : singleRows(doc, x, y, w, block.groups[0], shapes)
}

const fmtDay = (d) => {
  const t = d instanceof Date ? d : new Date(d)
  return Number.isNaN(t.getTime()) ? '' : t.toLocaleDateString('en-GB')
}

export const OPERATIONS = ['Steaming', 'Towing', 'Alongside']

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
  doc.text('DATE', M, 62)
  let dx = M + 32
  const two = { int: 2, dec: 0 }
  ;['DD', 'MM', 'YY'].forEach((cap, i) => {
    const gw = groupWidth(two)
    drawBoxes(doc, dx + gw, 51, two)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...MUTE)
    doc.text(cap, dx + gw / 2, 73, { align: 'center' })
    dx += gw
    if (i < 2) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.setTextColor(...INK)
      doc.text('/', dx + 5, 63, { align: 'center' })
      dx += 10
    }
  })

  // Steaming / towing / alongside: ONE tick, laid out from the right edge in.
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
  const TICK = 11
  const widths = OPERATIONS.map((o) => TICK + 4 + doc.getTextWidth(o))
  doc.setFont('helvetica', 'bold')
  const opLabelW = doc.getTextWidth('OPERATION')
  let ox = W - M - (opLabelW + 8 + widths.reduce((a, b) => a + b, 0) + 12 * (OPERATIONS.length - 1))
  doc.setTextColor(...INK)
  doc.text('OPERATION', ox, 62)
  ox += opLabelW + 8
  OPERATIONS.forEach((o, i) => {
    doc.setDrawColor(...INK); doc.setLineWidth(0.6)
    doc.rect(ox, 53, TICK, TICK)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...INK)
    doc.text(o, ox + TICK + 4, 62)
    ox += widths[i] + 12
  })

  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTE)
  doc.text('One figure in each box. Where a decimal point is printed, write the figures either side of it. Tick one operation.', M, 86)

  const y0 = 96
  const blocks = sheetBlocks(template)
  const inColumn = (c) => blocks.filter((b) => b.column === c)

  // ---- the two columns
  let yL = y0
  for (const b of inColumn('left')) yL = drawBlock(doc, xL, yL, colW, b, shapes) + 12
  let yR = y0
  for (const b of inColumn('right')) yR = drawBlock(doc, xR, yR, colW, b, shapes) + 12

  // ---- the full-width band, with the notes beside it
  let y = Math.max(yL, yR) + 2
  let bandEnd = y
  for (const b of inColumn('band')) {
    const bw = pairBlockWidth(b, shapes)
    const end = drawBlock(doc, xL, y, bw, b, shapes)
    const notesX = xL + bw + GAP
    const notesW = W - M - notesX
    if (notesW > 60) {
      const top = sectionHead(doc, notesX, y, notesW, 'Notes')
      doc.setDrawColor(...RULE); doc.setLineWidth(0.6)
      doc.rect(notesX, top, notesW, end - top)
    }
    bandEnd = end
    y = end + 12
  }

  // ---- sign-off
  const yS = bandEnd + 22
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...INK)
  doc.text('LOGGED BY', xL, yS)
  doc.text('SIGNATURE', xR, yS)
  doc.setDrawColor(...INK); doc.setLineWidth(0.6)
  doc.line(xL + 58, yS + 2, xL + colW, yS + 2)
  doc.line(xR + 58, yS + 2, xR + colW, yS + 2)

  // ---- foot
  doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...MUTE)
  doc.text(`${name || 'Engine room'} · printed ${fmtDay(printedOn)} · Skipper Management · Layout ${SHEET_LAYOUT} · every row is named as the app stores it`, M, H - 16)

  return doc
}

export function exportEngineSheet(opts = {}) {
  const doc = buildEngineSheet(opts)
  const v = opts.vessel || {}
  const slug = String(v.pln || v.vessel_name || 'vessel').replace(/[^\w]+/g, '-')
  doc.save(`engine-room-sheet-${slug}.pdf`)
}
