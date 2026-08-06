// Excel export for the Fish Sales Analyser — Summary / Species / Buyers / Rows
// sheets, scoped to whatever the screen is showing.
import { kpis, bySpecies, byBuyer, gradesFor, gradeLabel } from './salesAgg'

// Hull cobalt and its pale wash, matching --hull / --hull-pale in index.css.
// Exports are always on white, so these are the light-theme values.
const NAVY = 'FF1749A8', WHITE = 'FFFFFFFF', LIGHT = 'FFE4EBF8'
const GBP = '£#,##0.00', NUM = '#,##0', NUM2 = '#,##0.00'

function head(ws, row = 1) {
  const r = ws.getRow(row)
  r.eachCell(c => {
    c.font = { bold: true, color: { argb: WHITE } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
    c.alignment = { vertical: 'middle' }
  })
  r.height = 22
  ws.views = [{ state: 'frozen', ySplit: row }]
}

export async function exportSalesExcel({ scopeLabel, rows, landings, landingById }) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const k = kpis(rows, landings.length)

  // ---- Summary ----
  const s = wb.addWorksheet('Summary')
  s.columns = [{ width: 28 }, { width: 18 }]
  s.addRow(['Fish Sales — ' + scopeLabel]).font = { bold: true, size: 14, color: { argb: NAVY } }
  s.addRow([])
  const pairs = [['Landings', k.landings], ['Total value', k.value], ['Total weight (kg)', k.kg], ['Total boxes', k.boxes], ['Average £/kg', k.pkg]]
  for (const [a, b] of pairs) { const r = s.addRow([a, b]); r.getCell(1).font = { bold: true } }
  s.getCell('B4').numFmt = GBP; s.getCell('B5').numFmt = NUM; s.getCell('B6').numFmt = NUM; s.getCell('B7').numFmt = NUM2

  // ---- Species (with grade breakdown) ----
  const sp = wb.addWorksheet('Species')
  sp.addRow(['Species', 'Grade', 'Boxes', 'Kg', 'Value', '£/kg'])
  head(sp)
  sp.columns = [{ width: 22 }, { width: 16 }, { width: 10 }, { width: 12 }, { width: 14 }, { width: 10 }]
  for (const o of bySpecies(rows)) {
    const r = sp.addRow([o.species, 'ALL', o.boxes, o.kg, o.value, o.pkg])
    r.font = { bold: true }
    r.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } } })
    for (const g of gradesFor(rows, o.species)) sp.addRow(['', g.grade, g.boxes, g.kg, g.value, g.pkg])
  }
  sp.getColumn(5).numFmt = GBP; sp.getColumn(4).numFmt = NUM; sp.getColumn(6).numFmt = NUM2

  // ---- Buyers ----
  const by = wb.addWorksheet('Buyers')
  by.addRow(['Buyer', 'Boxes', 'Kg', 'Value', '£/kg', 'Top species'])
  head(by)
  by.columns = [{ width: 26 }, { width: 10 }, { width: 12 }, { width: 14 }, { width: 10 }, { width: 34 }]
  for (const o of byBuyer(rows)) by.addRow([o.buyer, o.boxes, o.kg, o.value, o.pkg, o.top])
  by.getColumn(4).numFmt = GBP; by.getColumn(3).numFmt = NUM; by.getColumn(5).numFmt = NUM2

  // ---- Rows ----
  const rw = wb.addWorksheet('Rows')
  rw.addRow(['Date', 'Market', 'Vessel', 'Buyer', 'Species', 'Grade', 'MSC', 'Boxes', 'Box kg', 'Kg', '£/kg', 'Value'])
  head(rw)
  rw.columns = [{ width: 11 }, { width: 20 }, { width: 18 }, { width: 24 }, { width: 16 }, { width: 14 }, { width: 6 }, { width: 8 }, { width: 8 }, { width: 10 }, { width: 8 }, { width: 12 }]
  for (const r of rows) {
    const l = landingById[r.landing_id] || {}
    rw.addRow([l.landing_date || '', l.market || '', l.vessel || '', r.buyer, r.species_canon || r.species, gradeLabel(r), r.msc ? 'Y' : '', Number(r.boxes), Number(r.box_weight), Number(r.weight_kg), Number(r.price_per_kg), Number(r.value)])
  }
  rw.getColumn(12).numFmt = GBP; rw.getColumn(11).numFmt = NUM2; rw.getColumn(10).numFmt = NUM

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `fish-sales ${scopeLabel}.xlsx`.replace(/[/\\:]/g, '-')
  a.click()
  URL.revokeObjectURL(a.href)
}
