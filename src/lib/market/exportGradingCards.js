import { jsPDF } from 'jspdf'
import { ticketsFor, ticketSummary } from './gradingCards.js'

/* THE BOX-TOP TICKETS, printed for this trip only.
 *
 * Faithful to the folder the boat already uses — A4 portrait, EIGHT tickets to
 * a page, two across and four down, each one SPECIES over GRADE NAME over GRADE
 * CODE in the same weights. The crew know these; this is not the moment to
 * redesign them. The only difference is which ones come out of the printer.
 *
 * Measured off `Megs.pdf` rather than guessed: species 26pt, grade name 50pt,
 * code 40pt, rows pitched about 210pt apart down the page.
 *
 * A REGRADED TICKET CARRIES A WEIGHT BAND AND NO CODE — turbot and halibut are
 * regraded at the market, so the boat cannot name the grade, and the folder's
 * own Turbot.pdf and Halibut.pdf are already drawn that way.
 *
 * buildGradingCardsDoc is split from the save for the reason the stores sheet
 * and the catalogue are: `doc.save()` reaches for a browser and does NOTHING
 * under node, which once had me reading a stale PDF off disk and believing a
 * fix that had never run. The build half returns the document, so a script can
 * render the real one and read it back.
 */

const COLS = 2
const ROWS = 4

export function buildGradingCardsDoc(plan, meta = {}) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()      // 595
  const H = doc.internal.pageSize.getHeight()     // 842
  const ink = [10, 29, 38], mute = [150, 158, 163]

  const tickets = ticketsFor(plan, meta)
  const cellW = W / COLS
  const cellH = H / ROWS

  if (!tickets.length) {
    doc.setFont('helvetica', 'normal').setFontSize(12).setTextColor(...mute)
    doc.text('Nothing on the tally.', W / 2, H / 2, { align: 'center' })
    return doc
  }

  tickets.forEach((t, i) => {
    const onPage = i % (COLS * ROWS)
    if (i && onPage === 0) doc.addPage()
    const cx = (onPage % COLS) * cellW + cellW / 2
    const top = Math.floor(onPage / COLS) * cellH

    /* A faint cut guide. The originals have none — they are cut by eye — but
       eight to a page is a lot of scissors and a hairline costs nothing. */
    doc.setDrawColor(225).setLineWidth(0.4)
    if (onPage % COLS) doc.line(top === 0 ? cellW : cellW, top, cellW, top + cellH)
    if (onPage >= COLS) doc.line(0, top, W, top)

    doc.setTextColor(...ink)
    doc.setFont('helvetica', 'bold').setFontSize(26)
    doc.text(String(t.species).toUpperCase(), cx, top + 60, { align: 'center' })

    // The grade name is the thing read from a distance, so it is the big one.
    doc.setFontSize(t.name.length > 9 ? 38 : 50)
    doc.text(String(t.name).toUpperCase(), cx, top + 126, { align: 'center' })

    if (t.code) {
      doc.setFontSize(40)
      doc.text(String(t.code), cx, top + 182, { align: 'center' })
    } else if (t.regraded) {
      /* No code, because the market has not graded it yet. Saying so is better
         than a blank space that reads as a printing fault. */
      doc.setFont('helvetica', 'normal').setFontSize(11).setTextColor(...mute)
      doc.text('graded at the market', cx, top + 176, { align: 'center' })
    }
  })

  return doc
}

export function exportGradingCards(plan, meta = {}) {
  const s = ticketSummary(plan, meta)
  const name = `grading cards ${meta.trip || ''} ${meta.date || ''}`.trim().replace(/[/\\:]/g, '-')
  buildGradingCardsDoc(plan, meta).save((name || 'grading cards') + ` (${s.tickets}).pdf`)
}
