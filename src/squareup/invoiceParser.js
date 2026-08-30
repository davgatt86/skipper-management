// Shared with every other PDF parser in the app — see src/lib/pdfjs.js.
import { ensurePdfjs } from '../lib/pdfjs.js';

const NUM_RE = /^[\d,]+\.\d{2}$/;
const parseNum = (s) => parseFloat(String(s).replace(/,/g, ''));

/**
 * Parse a bond invoice PDF (60N Bond style: 7 columns —
 * Description, Qty/Hrs, Price/Rate, Net, %VAT, VAT, Total).
 *
 * Returns { lineItems: [...], meta: { vendor, invoiceNumber, date, totalNet } }.
 * Generic enough to handle similar 6-number-trailing layouts from other suppliers.
 */
export async function parseBondInvoice(file) {
  const buffer = await file.arrayBuffer();
  const pdfjsLib = await ensurePdfjs();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  const allItems = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    for (const it of tc.items) {
      const s = (it.str || '').replace(/\s+/g, ' ').trim();
      if (!s) continue;
      allItems.push({
        str: s,
        x: it.transform[4],
        y: it.transform[5],
        page: p,
      });
    }
  }

  // Cluster into visual rows by Y coordinate (PDF coords go bottom-up)
  const rows = [];
  for (const it of allItems) {
    const row = rows.find((r) => r.page === it.page && Math.abs(r.y - it.y) < 3);
    if (row) row.items.push(it);
    else rows.push({ y: it.y, page: it.page, items: [it] });
  }
  rows.forEach((r) => r.items.sort((a, b) => a.x - b.x));

  const lineItems = itemsFromRows(rows)

  // Extract metadata
  const flatText = allItems.map((i) => i.str).join(' ');
  const meta = {};
  const mInv = flatText.match(/Invoice Number\s+([A-Za-z0-9\-_/]+)/i);
  if (mInv) meta.invoiceNumber = mInv[1];
  const mDate = flatText.match(/Invoice Date\s+(\d{2}\/\d{2}\/\d{4})/i);
  if (mDate) meta.date = mDate[1];
  const mVendor = flatText.match(/(60N Bond Ltd|[A-Z][A-Za-z0-9 &.'\-]{3,}? (?:Ltd|Limited|Co\.|PLC|LLP))/);
  if (mVendor) meta.vendor = mVendor[1].trim();
  const mTotal = flatText.match(/Total Net\s+([\d,]+\.\d{2})/i);
  if (mTotal) meta.totalNet = parseNum(mTotal[1]);

  return { lineItems, meta };
}

/* THE DESCRIPTION AND THE FIGURES ARE NOT ALWAYS ON THE SAME LINE.
 *
 * David, Aug 2026: "bond parse isn't picking up pinot grigo lines". On invoice
 * SI-390 that item is too long for its column and the print breaks it in three:
 *
 *     Barefoot Pinot Grigio 11.5% 75cl        <- description, no figures
 *     2.00 33.00 66.00 0.00 0.00 66.00        <- figures, no description
 *     (WINBFPG)                               <- the product code, alone
 *
 * Every other item on the invoice is one line. The figures row was being
 * dropped by `if (!description) continue` — so the line vanished, £66 of it,
 * with nothing to show it had ever been there.
 *
 * SAME CLASS OF FAULT AS THE SALES NOTE. A fixed-width print, a cell too wide
 * for its column, the tail pushed onto another line, and a parser anchoring on
 * the part that moved. That one cost £54.24 in one row and was the third of its
 * kind; this is the same shape in a different document.
 *
 * SPLIT OUT AND PURE so it can be tested against the real rows off the real
 * invoice without a browser or a PDF — the reason `worksheetShape` exists.
 */
export function itemsFromRows(rows) {
  const out = []
  // Reading order, explicitly. Rows arrive in pdf.js text order, which is
  // usually reading order and is not promised to be.
  const ordered = [...rows].sort((r1, r2) => r1.page - r2.page || r2.y - r1.y)

  // A description line held back in case the figures are on the next row.
  let carried = null

  ordered.forEach((r, i) => {
    const cells = r.items
    let n = 0
    while (n < cells.length && NUM_RE.test(cells[cells.length - 1 - n].str)) n++

    if (n < 6) {
      /* No figures. Either an ordinary heading, or the description half of a
         wrapped item — keep it and let the next row decide which. A row that is
         only a product code belongs to the item ABOVE and is handled there. */
      const txt = cells.map((c) => c.str).join(' ').trim()
      if (txt && !isCodeOnly(txt) && !isFurniture(txt)) carried = txt
      return
    }

    const take = n >= 7 ? 7 : 6
    const nums = cells.slice(-take).map((c) => parseNum(c.str))
    let description = cells.slice(0, -take).map((c) => c.str).join(' ').trim()

    // The figures came on their own: the description is the line above.
    if (!description && carried) description = carried
    carried = null

    if (!description) return
    if (/^(total|vat|net)\b/i.test(description)) return

    /* A lone product code on the next line belongs to this item. Worth keeping:
       it is what tells two similar wines apart on the bond. */
    const next = ordered[i + 1]
    if (next) {
      const nextTxt = next.items.map((c) => c.str).join(' ').trim()
      if (isCodeOnly(nextTxt) && !description.includes(nextTxt)) description += ' ' + nextTxt
    }

    let qty, unitPrice, discount, net, vatPct, vat, total
    if (take === 7) [qty, unitPrice, discount, net, vatPct, vat, total] = nums
    else { [qty, unitPrice, net, vatPct, vat, total] = nums; discount = 0 }

    out.push({ description, qty, unitPrice, discount, net, vatPct, vat, total })
  })

  return out
}

// "(WINBFPG)" — a product code on a line of its own.
const isCodeOnly = (s) => /^\([A-Z0-9]{2,12}\)$/.test(String(s).trim())

// Page furniture that must never be carried onto the next item's description.
const isFurniture = (s) => /^(description|invoice|customer|delivery|notes|page \d|registered|bank details|account:|sort code|total|vat rate|exempt|due date)/i.test(String(s).trim())
