import { jsPDF } from 'jspdf';
import { fmtDate, shareTextOf, fmtShares, fmtMoney, sumBondFor, todayISO } from './helpers.js';

/**
 * Generate the square-up sheet as a jsPDF document.
 * Returns the jsPDF instance — caller decides whether to save, share, or open it.
 */
export function generateSquareUpPDF({
  vessel, tripDate, crew, totalShares, quota,
  fuel, labour, logistics, foreignCrew, bondItems,
}) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const PAGE_W = doc.internal.pageSize.getWidth();
  const PAGE_H = doc.internal.pageSize.getHeight();
  const MARGIN = 40;
  const CONTENT_W = PAGE_W - 2 * MARGIN;

  const INK = [10, 22, 34];
  const DIM = [90, 106, 122];
  const BRASS = [138, 90, 10];
  const DIVIDER = [200, 210, 220];
  const HAIR = [235, 240, 246];
  const PALE = [188, 198, 210];
  const RED = [180, 90, 70];

  const setInk = (rgb) => doc.setTextColor(rgb[0], rgb[1], rgb[2]);
  const setStroke = (rgb) => doc.setDrawColor(rgb[0], rgb[1], rgb[2]);

  let y = 56;

  const ensureSpace = (needed) => {
    if (y + needed > PAGE_H - MARGIN - 30) {
      doc.addPage();
      y = MARGIN + 16;
    }
  };

  // Header
  doc.setFont('times', 'bold');
  doc.setFontSize(26);
  setInk(INK);
  doc.text(vessel || '—', MARGIN, y);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  setInk(DIM);
  doc.text('TRIP SQUARE-UP', MARGIN, y + 14, { charSpace: 2 });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  setInk(INK);
  doc.text(fmtDate(tripDate) || '—', PAGE_W - MARGIN, y, { align: 'right' });

  y += 22;
  setStroke(INK);
  doc.setLineWidth(1.5);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 22;

  const sectionTitle = (title) => {
    ensureSpace(28);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    setInk(BRASS);
    doc.text(title, MARGIN, y, { charSpace: 2.5 });
    y += 7;
    setStroke(DIVIDER);
    doc.setLineWidth(0.6);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 13;
  };

  const hairLine = () => {
    setStroke(HAIR);
    doc.setLineWidth(0.4);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  };

  const emptyLine = (text) => {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(10);
    setInk([154, 170, 184]);
    doc.text(text, MARGIN, y);
    y += 18;
  };

  // SHARES
  sectionTitle('SHARES');
  if (crew.length === 0) {
    emptyLine('No crew added.');
  } else {
    for (const c of crew) {
      ensureSpace(18);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10.5);
      setInk(INK);
      doc.text(c.name || '—', MARGIN, y);

      setInk(DIM);
      doc.text(shareTextOf(c), MARGIN + 320, y, { align: 'right' });

      if (c.bonus) {
        doc.setFont('helvetica', 'bold');
        setInk(BRASS);
        doc.text(`+ ${c.bonus}%`, PAGE_W - MARGIN, y, { align: 'right' });
      } else {
        setInk(PALE);
        doc.text('—', PAGE_W - MARGIN, y, { align: 'right' });
      }

      y += 6;
      hairLine();
      y += 10;
    }

    ensureSpace(20);
    setStroke(INK);
    doc.setLineWidth(1);
    doc.line(MARGIN, y - 2, PAGE_W - MARGIN, y - 2);
    y += 12;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    setInk(INK);
    doc.text('Total shares', MARGIN, y);
    doc.text(fmtShares(totalShares), PAGE_W - MARGIN, y, { align: 'right' });
    y += 18;
  }
  y += 8;

  // BOND
  sectionTitle('BOND');
  const crewBondTotals = crew
    .map((c) => ({ c, total: sumBondFor(bondItems, c.id) }))
    .filter((x) => x.total > 0);
  const storesTotal = sumBondFor(bondItems, 'stores');
  const unassignedTotal = bondItems
    .filter((b) => !b.assignedTo)
    .reduce((s, b) => s + (Number(b.amount) || 0), 0);

  if (crewBondTotals.length === 0 && storesTotal === 0 && unassignedTotal === 0) {
    emptyLine('TBC');
  } else {
    for (const { c, total } of crewBondTotals) {
      ensureSpace(18);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10.5);
      setInk(INK);
      doc.text(c.name || '—', MARGIN, y);
      doc.text(fmtMoney(total), PAGE_W - MARGIN, y, { align: 'right' });
      y += 6;
      hairLine();
      y += 10;
    }
    if (storesTotal > 0) {
      ensureSpace(18);
      doc.setFont('helvetica', 'italic');
      setInk(INK);
      doc.text('Stores', MARGIN, y);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      setInk(DIM);
      doc.text('(boat pays)', MARGIN + 38, y);
      doc.setFontSize(10.5);
      setInk(INK);
      doc.text(fmtMoney(storesTotal), PAGE_W - MARGIN, y, { align: 'right' });
      y += 6;
      hairLine();
      y += 10;
    }
    if (unassignedTotal > 0) {
      ensureSpace(18);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      setInk(RED);
      doc.text('Unassigned (review)', MARGIN, y);
      doc.text(fmtMoney(unassignedTotal), PAGE_W - MARGIN, y, { align: 'right' });
      y += 6;
      hairLine();
      y += 10;
    }
  }
  y += 6;

  // QUOTA
  sectionTitle('QUOTA RECOVERY');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  setInk(INK);
  doc.text(`${quota}%`, MARGIN, y);
  y += 24;

  // FUEL
  sectionTitle('FUEL');
  if (fuel.length === 0) {
    emptyLine('None.');
  } else {
    for (const f of fuel) {
      ensureSpace(18);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10.5);
      setInk(INK);
      doc.text(f.location || '—', MARGIN, y);

      doc.setFontSize(9.5);
      setInk(DIM);
      doc.text(f.date ? fmtDate(f.date) : '', MARGIN + 300, y, { align: 'right' });

      doc.setFontSize(10.5);
      setInk(INK);
      doc.text(f.litres ? `${Number(f.litres).toLocaleString('en-GB')} lt` : '', PAGE_W - MARGIN, y, { align: 'right' });
      y += 6;
      hairLine();
      y += 10;
    }
  }
  y += 6;

  // LOGISTICS
  if (logistics?.trim()) {
    sectionTitle('LOGISTICS / TRANSPORT');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    setInk(INK);
    const lines = doc.splitTextToSize(logistics, CONTENT_W);
    for (const line of lines) {
      ensureSpace(14);
      doc.text(line, MARGIN, y);
      y += 14;
    }
    y += 10;
  }

  // LABOUR
  sectionTitle('LABOUR');
  if (labour.length === 0) {
    emptyLine('None.');
  } else {
    for (const l of labour) {
      ensureSpace(18);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10.5);
      setInk(INK);
      doc.text(l.name || '—', MARGIN, y);

      doc.setFontSize(9.5);
      setInk(DIM);
      doc.text(l.boxes ? `${l.boxes} boxes` : '', MARGIN + 300, y, { align: 'right' });

      doc.setFontSize(10.5);
      setInk(INK);
      doc.text(l.amount ? fmtMoney(l.amount) : '', PAGE_W - MARGIN, y, { align: 'right' });
      y += 6;
      hairLine();
      y += 10;
    }
  }
  y += 6;

  // FOREIGN CREW BONUS
  sectionTitle('FOREIGN CREW BONUS');
  if (!foreignCrew || foreignCrew.length === 0) {
    emptyLine('None.');
  } else {
    for (const c of foreignCrew) {
      ensureSpace(18);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10.5);
      setInk(INK);
      doc.text(c.name || '—', MARGIN, y);
      doc.text(c.bonus ? fmtMoney(c.bonus) : '—', PAGE_W - MARGIN, y, { align: 'right' });
      y += 6;
      hairLine();
      y += 10;
    }
  }
  y += 8;

  // Footer (every page)
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    setInk([138, 152, 168]);
    const footY = PAGE_H - 24;
    doc.text(`Generated ${fmtDate(todayISO())}`, MARGIN, footY, { charSpace: 0.4 });
    if (pageCount > 1) {
      doc.text(`Page ${i} of ${pageCount}`, PAGE_W / 2, footY, { align: 'center', charSpace: 0.4 });
    }
    doc.text((vessel || '').toUpperCase(), PAGE_W - MARGIN, footY, { align: 'right', charSpace: 0.4 });
  }

  return doc;
}

export function makeFilename({ vessel, tripDate }) {
  const v = (vessel || 'squareup').replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  const d = tripDate || todayISO();
  return `${v}_squareup_${d}.pdf`;
}

export async function shareOrDownloadPDF(doc, filename) {
  const blob = doc.output('blob');
  const file = new File([blob], filename, { type: 'application/pdf' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }

  triggerDownload(blob, filename);
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
