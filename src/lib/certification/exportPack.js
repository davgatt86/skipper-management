import { jsPDF } from 'jspdf'
import autoTableMod from 'jspdf-autotable'
// Vite hands back the function; node's ESM interop hands back the namespace.
const autoTable = autoTableMod?.default ?? autoTableMod

/* THE INSPECTION PACK, ON PAPER.
 *
 * `buildPackDoc` is split from `exportPackPdf` for the reason the stores sheet
 * documents: `doc.save()` reaches for a browser and does NOTHING AT ALL under
 * node — no error, no file — which once had a page-break fix believed for
 * several runs that had never executed once. The build half returns the
 * document, so `scripts/inspection-pack-preview.mjs` renders the REAL sheet and
 * reads it back with pdf.js rather than checking a copy that can drift.
 *
 * The order of the sections is the argument of the document. What the pack does
 * NOT cover comes FIRST, before anything that looks like evidence, because a
 * surveyor who reads eight pages of certificates and then a note about missing
 * books has already formed a view. Put the other way round it is a disclaimer;
 * put this way round it is the summary.
 */

const D = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—')

// One ink for the whole document. It is printed and often photocopied, so the
// signal is the WORD, never the colour — the colour only sorts the eye.
const INK = [10, 29, 38]
const RUST = [194, 52, 42]
const BRASS = [169, 118, 20]
const MUTE = [93, 112, 121]

const STATE_WORD = {
  expired: 'EXPIRED', due: 'Due', valid: 'Valid', noexpiry: 'No expiry',
  overdue: 'OVERDUE', current: 'Current', undated: 'No review date',
  never: 'Never examined', unsafe: 'UNSAFE', 'no-interval': 'No interval set',
  'out-of-service': 'Out of service', superseded: 'Superseded', withdrawn: 'Withdrawn',
}
const stateWord = (s) => STATE_WORD[s] || s || '—'
const stateInk = (s) =>
  (s === 'expired' || s === 'overdue' || s === 'unsafe' ? RUST
    : s === 'due' || s === 'undated' || s === 'never' || s === 'no-interval' ? BRASS
      : INK)

const M = 40                       // page margin, points
let Y = 0                          // running cursor, reset per document

function head(doc, text, size = 13) {
  const w = doc.internal.pageSize.getWidth()
  if (Y > doc.internal.pageSize.getHeight() - 120) { doc.addPage(); Y = M }
  doc.setFont('helvetica', 'bold').setFontSize(size).setTextColor(...INK)
  doc.text(text, M, Y)
  Y += 6
  doc.setDrawColor(...INK).setLineWidth(0.8).line(M, Y, w - M, Y)
  Y += 16
}

function para(doc, text, { ink = MUTE, size = 8.5, gap = 11 } = {}) {
  const w = doc.internal.pageSize.getWidth() - M * 2
  doc.setFont('helvetica', 'normal').setFontSize(size).setTextColor(...ink)
  const lines = doc.splitTextToSize(text, w)
  for (const l of lines) {
    if (Y > doc.internal.pageSize.getHeight() - 50) { doc.addPage(); Y = M }
    doc.text(l, M, Y)
    Y += gap
  }
  Y += 4
}

function table(doc, headRow, body, opts = {}) {
  if (!body.length) return
  autoTable(doc, {
    startY: Y,
    head: [headRow],
    body,
    margin: { left: M, right: M },
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 4, textColor: INK, lineColor: [210, 218, 217] },
    headStyles: { fillColor: [23, 73, 168], textColor: 255, fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: [246, 248, 247] },
    ...opts,
  })
  Y = doc.lastAutoTable.finalY + 22
}

/**
 * Build the document. Takes the output of `inspectionPack()` and nothing else,
 * so what is printed cannot disagree with what a screen showed.
 */
export function buildPackDoc(pack) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  Y = M

  /* ---- cover -------------------------------------------------------- */
  doc.setFont('helvetica', 'bold').setFontSize(20).setTextColor(...INK)
  doc.text('INSPECTION PACK', M, Y); Y += 24

  doc.setFont('helvetica', 'bold').setFontSize(13)
  doc.text(pack.vessel?.label || 'Vessel not named', M, Y); Y += 16

  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...MUTE)
  const d = pack.details || {}
  const bits = [
    d.pln ? `PLN ${d.pln}` : null,
    d.gross_tonnage ? `${d.gross_tonnage} GT` : null,
    d.length_registered ? `${d.length_registered} m registered` : null,
    d.flag_state ? `Flag ${d.flag_state}` : null,
  ].filter(Boolean)
  if (bits.length) { doc.text(bits.join('   ·   '), M, Y); Y += 14 }
  doc.text(`Period ${D(pack.period.from)} to ${D(pack.period.to)}`
         + `      Produced ${D(pack.generatedAt)}`, M, Y)
  Y += 24

  /* THE SENTENCE THAT KEEPS THIS DOCUMENT HONEST. It is on the cover, in the
     body ink rather than grey, because everything after it depends on being
     read as a report of records rather than a statement about a boat. */
  doc.setDrawColor(...INK).setLineWidth(2).line(M, Y - 4, M, Y + 40)
  doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...INK)
  const claim = doc.splitTextToSize(
    'This is a report of what this vessel’s records hold for the period above. '
  + 'It is not a declaration of compliance, and nothing in it certifies the vessel, '
  + 'her equipment or her crew. Where a record is absent, this pack says so rather '
  + 'than leaving it out.', W - M * 2 - 12)
  let cy = Y + 6
  for (const l of claim) { doc.text(l, M + 12, cy); cy += 11 }
  Y = cy + 18

  /* ---- 1. what this pack does NOT cover ------------------------------ */
  head(doc, '1.  WHAT THIS PACK DOES NOT COVER')

  if (!pack.notCovered.length) {
    para(doc, 'Every book this pack reports on carries entries for the period, and every '
            + 'certificate listed has its document held here.', { ink: INK })
  } else {
    const holes = pack.notCovered.filter((g) => g.kind === 'empty')
    const paper = pack.notCovered.filter((g) => g.kind === 'paper')
    const files = pack.notCovered.filter((g) => g.kind === 'nofile')

    if (holes.length) {
      doc.setFont('helvetica', 'bold').setFontSize(9.5).setTextColor(...RUST)
      doc.text(`${holes.length} record${holes.length === 1 ? ' has' : 's have'} no entries at all`,
        M, Y); Y += 14
      table(doc, ['Record', 'Why it matters'],
        holes.map((g) => [g.label, g.why]),
        { columnStyles: { 0: { cellWidth: 130, fontStyle: 'bold' } } })
    }

    /* NOT A FAILING, AND IT MUST NOT LOOK LIKE ONE. Kept apart from the holes
       above with its own heading and its own words. */
    if (paper.length) {
      doc.setFont('helvetica', 'bold').setFontSize(9.5).setTextColor(...INK)
      doc.text('Kept on paper — the paper book is the record', M, Y); Y += 14
      table(doc, ['Record', 'Why'], paper.map((g) => [g.label, g.why]),
        { columnStyles: { 0: { cellWidth: 130, fontStyle: 'bold' } } })
    }

    if (files.length) {
      doc.setFont('helvetica', 'bold').setFontSize(9.5).setTextColor(...INK)
      doc.text('Documents held elsewhere', M, Y); Y += 14
      table(doc, ['', 'Detail'], files.map((g) => [g.label, g.why]),
        { columnStyles: { 0: { cellWidth: 130, fontStyle: 'bold' } } })
    }
  }

  /* ---- 2. the record books ------------------------------------------- */
  head(doc, '2.  THE RECORD BOOKS')
  para(doc, 'Entries made in the period, with the lifetime position beside it. '
          + 'A book that is quiet in one period is a different thing from a book that '
          + 'has never been started, so both figures are given. No interval is claimed '
          + 'for a book where the regulation prescribes none.')
  table(doc,
    ['Book', 'In period', 'First', 'Last', 'Ever', 'Last ever'],
    pack.books.map((b) => [
      b.label,
      b.never ? 'never started' : String(b.n),
      D(b.first), D(b.last),
      String(b.total), D(b.everLast),
    ]),
    {
      columnStyles: {
        0: { cellWidth: 150 }, 1: { cellWidth: 68, halign: 'right' },
        4: { cellWidth: 44, halign: 'right' },
      },
      didParseCell: (h) => {
        if (h.section === 'body' && h.column.index === 1 && pack.books[h.row.index]?.never) {
          h.cell.styles.textColor = RUST
          h.cell.styles.fontStyle = 'bold'
        }
      },
    })

  /* ---- 3. vessel certificates ---------------------------------------- */
  head(doc, '3.  VESSEL CERTIFICATES')
  para(doc, `As they stood on ${D(pack.certs.asOf)} — the closing date of the period, `
          + 'not today. A certificate is a state rather than an event, so it is not '
          + 'filtered into the window.')

  if (!pack.certs.all.length) {
    para(doc, 'No vessel certificates are on record.', { ink: RUST })
  } else {
    table(doc,
      ['Certificate', 'Category', 'Number', 'Issuer', 'Expires', 'State', 'Doc'],
      pack.certs.all
        .slice()
        .sort((a, b) => String(a.category).localeCompare(String(b.category))
                     || String(a.cert_type).localeCompare(String(b.cert_type)))
        .map((c) => [
          c.cert_type, c.category || '—', c.cert_number || '—', c.issuer || '—',
          D(c.expiry_date), stateWord(c.state), c.hasFile ? 'held' : 'elsewhere',
        ]),
      {
        columnStyles: { 4: { cellWidth: 56 }, 5: { cellWidth: 54 }, 6: { cellWidth: 46 } },
        didParseCell: (h) => {
          if (h.section !== 'body' || h.column.index !== 5) return
          h.cell.styles.textColor = stateInk(String(h.cell.raw).toLowerCase() === 'expired'
            ? 'expired' : String(h.cell.raw) === 'Due' ? 'due' : 'valid')
        },
      })

    /* A LAPSE INSIDE THE WINDOW disappears from an as-at list the moment it is
       renewed, and it is exactly what gets asked about. */
    if (pack.certs.lapsed.length) {
      doc.setFont('helvetica', 'bold').setFontSize(9.5).setTextColor(...BRASS)
      doc.text('Lapsed during this period', M, Y); Y += 14
      table(doc, ['Certificate', 'Expired'],
        pack.certs.lapsed.map((c) => [c.cert_type, D(c.expiry_date)]),
        { columnStyles: { 1: { cellWidth: 70 } } })
    }
  }

  /* ---- 4. crew -------------------------------------------------------- */
  head(doc, '4.  CREW ABOARD AND THEIR TICKETS')
  if (!pack.crew.length) {
    para(doc, 'Nobody is recorded as aboard.', { ink: RUST })
  } else {
    para(doc, `${pack.crew.length} aboard as at ${D(pack.certs.asOf)}. `
            + 'Crew who have left are not listed: a former hand’s expired ticket is '
            + 'not a finding, and listing it would bury the ones that are.')
    table(doc,
      ['Name', 'Rank', 'Nationality', 'Passport', 'Expires', 'Tickets', 'Expired', 'Due'],
      pack.crew.map((c) => [
        c.name, c.rank || '—', c.nationality || '—',
        c.passportNumber || 'none on file', D(c.passportExpiry),
        String(c.tickets.length),
        c.expired.length ? String(c.expired.length) : '—',
        c.due.length ? String(c.due.length) : '—',
      ]),
      { columnStyles: { 5: { cellWidth: 44, halign: 'right' }, 6: { cellWidth: 46, halign: 'right' }, 7: { cellWidth: 36, halign: 'right' } } })

    const bad = pack.crew.flatMap((c) =>
      [...c.expired.map((t) => [c.name, t.cert_type, D(t.expiry_date), 'EXPIRED']),
       ...c.due.map((t) => [c.name, t.cert_type, D(t.expiry_date), 'Due'])])
    if (bad.length) {
      doc.setFont('helvetica', 'bold').setFontSize(9.5).setTextColor(...RUST)
      doc.text('Tickets expired or falling due', M, Y); Y += 14
      table(doc, ['Crew', 'Ticket', 'Expires', 'State'], bad,
        { columnStyles: { 2: { cellWidth: 60 }, 3: { cellWidth: 56 } } })
    }
  }

  /* ---- 5. risk assessments -------------------------------------------- */
  head(doc, '5.  RISK ASSESSMENTS')
  if (!pack.assessments.length) {
    para(doc, 'No risk assessments are on record.', { ink: RUST })
  } else {
    para(doc, `${pack.assessmentsLive} in force, ${pack.assessmentsHeld} held in all. `
            + 'A superseded or withdrawn assessment is counted but not listed as in '
            + 'force — a review makes a new assessment and points the old one at it, '
            + 'so what the crew were briefed on last year is still exactly what they '
            + 'were briefed on.')
    table(doc,
      ['Ref', 'Assessment', 'Assessed', 'By', 'Review due', 'State', 'Hazards', 'Unrated', 'Briefed'],
      pack.assessments.map((a) => [
        a.ref || '—', a.title, D(a.assessedOn), a.assessedBy,
        D(a.reviewDue), stateWord(a.state),
        String(a.hazards), a.unrated ? String(a.unrated) : '—',
        a.briefed ? String(a.briefed) : 'none',
      ]),
      {
        columnStyles: {
          0: { cellWidth: 34 }, 2: { cellWidth: 54 }, 4: { cellWidth: 58 },
          5: { cellWidth: 62 }, 6: { cellWidth: 44, halign: 'right' },
          7: { cellWidth: 42, halign: 'right' }, 8: { cellWidth: 40, halign: 'right' },
        },
      })
    if (pack.hazardsUnrated) {
      para(doc, `${pack.hazardsUnrated} hazards carry no likelihood and severity, so they `
              + 'have no rating. A rating of nothing is not a rating of nought, and none '
              + 'has been inferred from the wording of the original.', { ink: BRASS })
    }
  }

  /* ---- 6. lifting and work equipment ---------------------------------- */
  head(doc, '6.  LIFTING AND WORK EQUIPMENT')
  if (!pack.equipment.length) {
    para(doc, 'No lifting or work equipment is on record, and no thorough examinations. '
            + 'LOLER (SI 2006/2184) and PUWER (SI 2006/2183) both apply to a fishing '
            + 'vessel of this kind; this pack can say nothing about either.', { ink: RUST })
  } else {
    table(doc,
      ['Equipment', 'Kind', 'ID', 'SWL', 'Last examined', 'Next due', 'State'],
      pack.equipment.map((e) => [
        e.name, e.kind, e.identifier || '—', e.swl || '—',
        D(e.lastExamined), D(e.nextDue), stateWord(e.state),
      ]),
      { columnStyles: { 4: { cellWidth: 68 }, 5: { cellWidth: 60 }, 6: { cellWidth: 74 } } })
  }

  /* ---- 7. maintenance -------------------------------------------------- */
  head(doc, '7.  MAINTENANCE DONE IN THE PERIOD')
  if (!pack.maintenance.length) {
    para(doc, `No maintenance was recorded between ${D(pack.period.from)} and `
            + `${D(pack.period.to)}. ${pack.maintenanceTasks} tasks are on the schedule.`,
    { ink: BRASS })
  } else {
    table(doc,
      ['Done', 'Task', 'Component', 'Hours', 'By'],
      pack.maintenance.map((m) => [
        D(m.doneOn), m.task, m.component || '—',
        m.runningHours == null ? '—' : String(m.runningHours), m.doneBy || '—',
      ]),
      { columnStyles: { 0: { cellWidth: 58 }, 3: { cellWidth: 50, halign: 'right' } } })
  }

  /* ---- 8. other records ------------------------------------------------ */
  head(doc, '8.  OTHER RECORDS')
  table(doc, ['Record', 'Position'], [
    ['Crew lists lodged in the period', String(pack.crewLists)],
    ['Familiarisations completed', String(pack.familiarisation)],
    ['Annual self-certifications on record',
      pack.selfCerts.length
        ? pack.selfCerts.map((s) => `${s.period}${s.completedAt ? ' — signed ' + D(s.completedAt) : ' — not signed'}`).join('; ')
        : 'none'],
  ], { columnStyles: { 0: { cellWidth: 220 } } })

  /* ---- footer, once per page ------------------------------------------- */
  /* Stamped after the loop, never in didDrawPage — that hook fires once per
     TABLE, and with a dozen tables it printed the footer on top of itself. */
  const pages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    const H = doc.internal.pageSize.getHeight()
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...MUTE)
    doc.text(
      `${pack.vessel?.label || 'Vessel'}  ·  inspection pack  ·  `
      + `${D(pack.period.from)} to ${D(pack.period.to)}  ·  `
      + 'a report of records, not a declaration of compliance',
      M, H - 22)
    doc.text(`${p} of ${pages}`, W - M, H - 22, { align: 'right' })
  }

  return doc
}

export function exportPackPdf(pack) {
  const doc = buildPackDoc(pack)
  const name = `inspection-pack-${(pack.vessel?.label || 'vessel')
    .replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}-${pack.period.to || 'today'}.pdf`
  doc.save(name)
  return name
}
