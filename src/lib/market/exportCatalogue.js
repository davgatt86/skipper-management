import { jsPDF } from 'jspdf'
import autoTableMod from 'jspdf-autotable'
// Vite hands back the function; node's ESM interop hands back the namespace.
const autoTable = autoTableMod?.default ?? autoTableMod
import { freshestNote, tagFor } from './catalogue.js'

/* THE BUYERS' CATALOGUE, printed.
 *
 * This goes in a buyer's hand at the auction, so it is a working document like
 * the chalk sheet — not a report. He walks the market with it, crosses lots off
 * as they sell, and uses what is left to judge whether the next lot of that
 * grade is day 5 fish or day 1.
 *
 * ONE CLOCK PER PAGE. The four clocks are sold separately and a buyer usually
 * follows one or two of them — handing him a sheet where his clock starts
 * halfway down page 2 is handing him somebody else's document as well. Paper is
 * cheaper than a buyer losing his place.
 *
 * buildCatalogueDoc is split from the save for the same reason as the stores
 * sheet: doc.save() reaches for a browser and does NOTHING under node, which
 * once had me reading a stale PDF off disk and believing a fix that had never
 * run. The build half returns the document so a script can render the real one.
 */

const fmtDate = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '')
const hexToRgb = (h) => {
  const m = String(h).replace('#', '')
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)]
}

export function buildCatalogueDoc(cat, meta = {}) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const ink = [10, 29, 38], hull = [23, 73, 168], mute = [110, 122, 130]

  const sections = [
    ...cat.clocks.map((c) => ({ title: `CLOCK ${c.clock.n} — ${c.clock.label.toUpperCase()}`, species: c.species })),
    // An unfiled species is printed rather than dropped: quietly leaving a fish
    // off a catalogue the buyers are working from is the failure to avoid.
    ...(cat.unfiled.length ? [{ title: 'NOT ON A CLOCK YET', species: cat.unfiled, warn: true }] : []),
  ]

  sections.forEach((sec, i) => {
    if (i > 0) doc.addPage()

    doc.setFillColor(...hull); doc.rect(0, 0, W, 62, 'F')
    doc.setTextColor(255).setFont('helvetica', 'bold').setFontSize(15)
    doc.text(sec.title, 36, 27)
    doc.setFont('helvetica', 'normal').setFontSize(9.5)
    doc.text([meta.vessel, meta.port, fmtDate(meta.saleDate)].filter(Boolean).join(' · ') || 'Day tally',
      36, 44)
    doc.setFontSize(8.5)
    doc.text(`${sec.species.reduce((n, s) => n + s.total, 0)} boxes`, W - 36, 44, { align: 'right' })

    /* THE RULE, at the top of every page. A buyer picking up page 3 has not
     * read page 1, and the whole sheet is meaningless without knowing which day
     * is A+. */
    doc.setFont('helvetica', 'bold').setFontSize(8.5).setTextColor(...ink)
    doc.text(freshestNote(cat), 36, 74)

    const body = []
    for (const sp of sec.species) {
      for (const g of sp.grades) {
        g.rows.forEach((r, n) => {
          body.push({
            species: n === 0 && g === sp.grades[0] ? sp.species : '',
            // Size folded INTO the grade rather than given a column of its own.
            // Nine columns did not fit A4 portrait: autoTable treats cellWidth
            // as a minimum, so squeezing them only made the overflow worse and
            // wrapped the TAG cell onto its own line, breaking every row.
            grade: n === 0 ? (g.size ? `${g.grade}  ${g.size}` : g.grade) : '',
            mark: r.mark,
            day: String(r.day),
            tag: r.tag.name,
            tagHex: r.tag.hex,
            tagInk: r.tag.ink,
            boxes: r.boxes,
            after: r.after,
            first: n === 0,
            newSpecies: n === 0 && g === sp.grades[0],
          })
        })
      }
    }

    autoTable(doc, {
      startY: 84,
      head: [['SPECIES', 'GRADE', '', 'DAY', 'TAG', 'BOXES', 'LEFT', 'SOLD']],
      body: body.map((r) => [r.species, r.grade, r.mark, r.day, r.tag, r.boxes,
                             r.after > 0 ? r.after : '—', '']),
      theme: 'grid',
      showHead: 'everyPage',
      styles: { font: 'helvetica', fontSize: 9.5, cellPadding: 3.5, lineColor: [214, 220, 226], textColor: ink },
      headStyles: { fillColor: hull, textColor: 255, fontStyle: 'bold', fontSize: 8 },
      columnStyles: {
        /* EIGHT COLUMNS, measured against the page rather than guessed. A4 is
         * 595pt and the margins take 72, leaving 523; autoTable adds cell
         * padding ON TOP of cellWidth, so 8 columns at 4.5pt a side is another
         * 72 and the content budget is 451.
         *
         * Nine columns did not fit, and squeezing them made it WORSE — cellWidth
         * is a minimum, so the overflow grew by exactly what I took away and the
         * TAG cell wrapped onto its own line, breaking the alignment of every
         * row. Size went into the grade cell instead. */
        /* The two TEXT columns are left to autoTable rather than pinned. It
         * knows what "Large (1b) 10-12kg" actually needs, and a fixed width it
         * cannot honour is what pushed the table off the page in the first
         * place — cellWidth is a MINIMUM, so squeezing made the overflow worse,
         * not better. */
        0: { cellWidth: 'auto', fontStyle: 'bold' },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 28, halign: 'center', fontStyle: 'bold' },
        3: { cellWidth: 26, halign: 'center' },
        4: { cellWidth: 56, halign: 'center', fontSize: 8 },
        5: { cellWidth: 42, halign: 'right', fontStyle: 'bold' },
        6: { cellWidth: 36, halign: 'right', textColor: mute },
        // Deliberately wide and empty: this is where he crosses it off.
        7: { cellWidth: 48 },
      },
      margin: { left: 36, right: 36, top: 60 },
      didParseCell: (d) => {
        if (d.section !== 'body') return
        const r = body[d.row.index]
        if (!r) return
        // A+ stands out — it is the reason the day column is there at all.
        if (d.column.index === 2 && r.mark === 'A+') {
          d.cell.styles.fillColor = [26, 101, 79]
          d.cell.styles.textColor = 255
        }
        // The tag cell is PRINTED IN THE TAG'S OWN COLOUR, because that is what
        // the buyer is looking at on the box — not a day number.
        if (d.column.index === 4) {
          d.cell.styles.fillColor = hexToRgb(r.tagHex)
          d.cell.styles.textColor = hexToRgb(r.tagInk)
          d.cell.styles.fontStyle = 'bold'
        }
        // A heavier rule where a new species starts, so the eye can find its
        // way down a long clock.
        if (r.newSpecies) d.cell.styles.lineWidth = { top: 1.2, right: 0.1, bottom: 0.1, left: 0.1 }
        else if (r.first) d.cell.styles.lineWidth = { top: 0.6, right: 0.1, bottom: 0.1, left: 0.1 }
      },
    })
  })

  // Footer once per page, after the loop — didDrawPage fires once per TABLE,
  // and with one table per clock that stamps them on top of each other.
  const pages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...mute)
    doc.text('Cross off each lot as it sells — LEFT is what remains of that grade after it.',
      36, H - 22)
    doc.text(`Page ${p} of ${pages}`, W - 36, H - 22, { align: 'right' })
  }

  return doc
}

export function exportCataloguePdf(cat, meta = {}) {
  const name = ['catalogue', meta.vessel, meta.saleDate].filter(Boolean).join(' ')
  buildCatalogueDoc(cat, meta).save(name.replace(/[/\\:]/g, '-') + '.pdf')
}
