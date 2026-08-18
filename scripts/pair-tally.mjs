/* Pair-team combined tally -> a PDF for reading and an xlsx for the Estimator.
 *
 * Sandy's boats send one email with THREE columns — Rosebloom, Boy John, and
 * the combined total. Where to Land wants the pair as one boat: they tow one
 * net, so the catch is one catch and splitting it would just halve every grade.
 *
 * TWO FILES, DELIBERATELY, because the Estimator reads them very differently:
 *
 *   .xlsx   parseBoatRows() reads it directly — deterministic, instant, free.
 *   .pdf    goes to the AI reader, costs an API call, and the page labels the
 *           result "read by AI — check carefully".
 *
 * So the xlsx is the one to upload. The PDF is for reading on the phone and
 * for the record.
 *
 * GRADE LABELS ARE THE BOAT'S OWN, NOT RETITLED. The Estimator has its own
 * normalisers — canonSp for species, canonSize/gradeCode for the size token —
 * and they expect boat spelling (SML, LRG, X S, SPRAG, ROBBY, MINI METRO).
 * Rewriting them here to match GRADE_DICT would break the very matching it is
 * meant to help, and anything that still does not match lands in the mapping
 * step for the skipper to set, which is what that step is for.
 *
 *   node scripts/pair-tally.mjs <tally.json> [outdir]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const XLSX = require('xlsx')
const { jsPDF } = require('jspdf')
require('jspdf-autotable')

const [, , src, outDir = '.'] = process.argv
if (!src) { console.error('usage: node scripts/pair-tally.mjs <tally.json> [outdir]'); process.exit(1) }
const t = JSON.parse(readFileSync(src, 'utf8'))

const rows = []
for (const sp of t.species) for (const g of sp.grades) rows.push({ sp: sp.name, size: g[0], boxes: g[1], kg: g[2] })
const totBoxes = rows.reduce((a, r) => a + r.boxes, 0)
const totKg = rows.reduce((a, r) => a + r.kg, 0)

// The tally's own stated total is an INDEPENDENT check on the transcription —
// the only one there is, so it is worth failing loudly on.
if (t.statedBoxes != null && (t.statedBoxes !== totBoxes || t.statedKg !== totKg)) {
  console.error(`MISMATCH: rows give ${totBoxes}/${totKg}, the tally says ${t.statedBoxes}/${t.statedKg}`)
  process.exit(1)
}

/* ---- xlsx, in the exact shape parseBoatRows expects ---------------------
 * Species header: first cell UPPERCASE, second cell '*'.
 * Size rows:      blank species, then size, boxes, weight.
 * Sheet named TOTALS because the reader tries a sheet matching /total/ first. */
const aoa = [['SPECIES', 'SIZE', 'BOXES', 'WEIGHT']]
for (const sp of t.species) {
  aoa.push([sp.name, '*', '', ''])
  for (const g of sp.grades) aoa.push(['', g[0], g[1], g[2]])
}
aoa.push(['Total', '', totBoxes, totKg])
const wb = XLSX.utils.book_new()
const ws = XLSX.utils.aoa_to_sheet(aoa)
ws['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 9 }, { wch: 10 }]
XLSX.utils.book_append_sheet(wb, ws, 'TOTALS')
const xlsxPath = join(outDir, `${t.slug}.xlsx`)
XLSX.writeFile(wb, xlsxPath)

/* ---- pdf ---- */
const doc = new jsPDF({ unit: 'pt', format: 'a4' })
const W = doc.internal.pageSize.getWidth()
const ink = [10, 29, 38], hull = [23, 73, 168], mute = [110, 122, 130]

doc.setFillColor(...hull); doc.rect(0, 0, W, 74, 'F')
doc.setTextColor(255).setFont('helvetica', 'bold').setFontSize(17)
doc.text('PAIR TEAM COMBINED TALLY', 40, 34)
doc.setFont('helvetica', 'normal').setFontSize(10.5)
doc.text(t.title, 40, 52)
doc.setFontSize(9)
doc.text(t.asAt, 40, 66)

doc.setTextColor(...ink).setFont('helvetica', 'bold').setFontSize(22)
doc.text(`${totBoxes.toLocaleString('en-GB')} boxes`, 40, 108)
doc.text(`${totKg.toLocaleString('en-GB')} kg`, 200, 108)
doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...mute)
doc.text('COMBINED — both boats, one catch', 40, 124)

const body = []
for (const sp of t.species) {
  const b = sp.grades.reduce((a, g) => a + g[1], 0), k = sp.grades.reduce((a, g) => a + g[2], 0)
  body.push([{ content: sp.name, styles: { fontStyle: 'bold' } }, '',
              { content: b.toLocaleString('en-GB'), styles: { fontStyle: 'bold' } },
              { content: k.toLocaleString('en-GB'), styles: { fontStyle: 'bold' } }])
  for (const g of sp.grades) body.push(['', g[0], g[1].toLocaleString('en-GB'), g[2].toLocaleString('en-GB')])
}
body.push([{ content: 'TOTAL', styles: { fontStyle: 'bold' } }, '',
           { content: totBoxes.toLocaleString('en-GB'), styles: { fontStyle: 'bold' } },
           { content: totKg.toLocaleString('en-GB'), styles: { fontStyle: 'bold' } }])

doc.autoTable({
  startY: 138,
  head: [['SPECIES', 'GRADE', 'BOXES', 'KGS']],
  body,
  theme: 'grid',
  styles: { font: 'helvetica', fontSize: 8.6, cellPadding: 3, lineColor: [220, 226, 230], textColor: ink },
  headStyles: { fillColor: hull, textColor: 255, fontStyle: 'bold' },
  columnStyles: { 0: { cellWidth: 100 }, 1: { cellWidth: 120 }, 2: { halign: 'right' }, 3: { halign: 'right' } },
  margin: { left: 40, right: 40 },
})

const pdfPath = join(outDir, `${t.slug}.pdf`)
writeFileSync(pdfPath, Buffer.from(doc.output('arraybuffer')))

console.log(`${xlsxPath}\n${pdfPath}`)
console.log(`${rows.length} grade lines across ${t.species.length} species · ${totBoxes} boxes · ${totKg.toLocaleString('en-GB')} kg`)
