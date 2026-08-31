import { jsPDF } from 'jspdf';
import { fmtDate, shareTextOf, fmtShares, fmtMoney, sumBondFor, bondBreakdown, todayISO } from './helpers.js';

/**
 * Generate the square-up sheet as a jsPDF document.
 * Returns the jsPDF instance — caller decides whether to save, share, or open it.
 */
export function generateSquareUpPDF({
  vessel, tripDate, crew, totalShares, quota,
  fuel, labour, haulage = [], haulageNote = '', foreignCrew, bondItems,
  landings = 1, bonusPlan = null,
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
        /* SAY WHY. "+ 0.0625%" on its own reads as a typo — it is a mate's
           quarter share of a two-landing trip, and the office has no way to
           check that unless the sheet says so. Same discipline as the bond: a
           figure without the thing that produced it is not a record. */
        if (c.role) {
          const on = (c.roleLandings && c.roleLandings.length && landings > 1)
            ? ' · landing ' + c.roleLandings.join(' & ')
            : '';
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8.5);
          setInk(DIM);
          doc.text(c.role + on, MARGIN + 340, y);
          doc.setFontSize(10.5);
        }
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

    /* HOW MANY LANDINGS, because the role bonuses are divided by it. Without
       this the sheet shows a mate on 0.0625% and nothing explains the figure. */
    if (landings > 1) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      setInk(DIM);
      doc.text(`Role bonuses split across ${landings} landings.`, MARGIN, y);
      y += 14;
    }

    /* A ROLE NOBODY HELD ON A LANDING IS MONEY NOT PAID OUT, and the sheet is
       where the office would otherwise never see it. Reported, never quietly
       handed to the man who did the other landing. */
    const gaps = (bonusPlan && bonusPlan.unallocated) || [];
    if (gaps.length) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      setInk(BRASS);
      for (const g of gaps) {
        ensureSpace(12);
        doc.text(`No ${g.role} on landing ${g.landing} — ${g.pct}% not allocated.`, MARGIN, y);
        y += 12;
      }
      y += 4;
    }
  }
  y += 8;

  // BOND
  sectionTitle('BOND');
  /* TOTALS ONLY — what each man actually had never goes on this sheet. David,
     Aug 2026: "the exportable sheet doesn't need this info though, just myself
     as skipper. office only needs to see total £ per crewman + any carried over
     balance." The itemisation lives on the kept worksheet, which is where an
     argument about a bottle of whisky gets settled. */
  const bond = bondBreakdown(bondItems, crew);
  const crewBondTotals = bond.perCrew.filter((x) => x.total > 0);
  const storesTotal = bond.stores.total;
  const carriedTotal = bond.carried.total;
  const unassignedTotal = bond.unassigned.total;

  if (crewBondTotals.length === 0 && storesTotal === 0
      && carriedTotal === 0 && unassignedTotal === 0) {
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
    /* A BALANCE BROUGHT FORWARD, not a question. It came off an earlier trip
       and nobody has been charged for it — the office should read it as a
       figure like any other, in the same ink as the rest. Printing it in the
       red "review" line would make every carried balance look like a mistake,
       and a warning that fires on the ordinary case stops being read. */
    if (carriedTotal > 0) {
      ensureSpace(18);
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(10.5);
      setInk(INK);
      doc.text('Carried over', MARGIN, y);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      setInk(DIM);
      doc.text('(not yet charged)', MARGIN + 62, y);
      doc.setFontSize(10.5);
      setInk(INK);
      doc.text(fmtMoney(carriedTotal), PAGE_W - MARGIN, y, { align: 'right' });
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

  // TRUCKS & HAULAGE — who carted, from where, how many loads. No money:
  // the office prices it, same as fuel.
  sectionTitle('TRUCKS & HAULAGE');
  if (haulage.length === 0 && !haulageNote?.trim()) {
    emptyLine('None.');
  } else {
    for (const h of haulage) {
      ensureSpace(18);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10.5);
      setInk(INK);
      doc.text(h.haulier || '—', MARGIN, y);

      doc.setFontSize(9.5);
      setInk(DIM);
      doc.text(h.from || '', MARGIN + 300, y, { align: 'right' });

      doc.setFontSize(10.5);
      setInk(INK);
      doc.text(h.loads ? `${h.loads} loads` : '', MARGIN + CONTENT_W, y, { align: 'right' });
      y += 18;
    }
    if (haulageNote?.trim()) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10.5);
      setInk(INK);
      const lines = doc.splitTextToSize(haulageNote, CONTENT_W);
      for (const line of lines) {
        ensureSpace(14);
        doc.text(line, MARGIN, y);
        y += 14;
      }
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

      // The office needs to see how a labour figure was arrived at, not just
      // the total — per box at a rate, or a flat price.
      doc.setFontSize(9.5);
      setInk(DIM);
      doc.text(
        (l.basis || 'box') === 'box'
          ? (l.boxes ? `${l.boxes} boxes @ ${fmtMoney(l.rate || 0)}` : '')
          : 'flat rate',
        MARGIN + 300, y, { align: 'right' }
      );

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
