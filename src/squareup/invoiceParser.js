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

  // Detect line items: a row where the last 6 cells are decimal numbers
  // and the first cell is non-numeric description text.
  const lineItems = [];
  for (const r of rows) {
    const cells = r.items;
    if (cells.length < 7) continue;

    // Count the trailing run of decimal-number cells. 60N Bond rows have 7
    // numeric columns (Qty, Price/Rate, Discount, Net, %VAT, VAT, Total);
    // older layouts without a Discount column have 6. Read whichever is
    // present so Qty (first col) is never confused with Price/Rate.
    let n = 0;
    while (n < cells.length && NUM_RE.test(cells[cells.length - 1 - n].str)) n++;
    if (n < 6) continue;

    const take = n >= 7 ? 7 : 6;
    const nums = cells.slice(-take).map((c) => parseNum(c.str));
    const descCells = cells.slice(0, -take);
    const description = descCells.map((c) => c.str).join(' ').trim();
    // Skip rows whose description starts with header/footer words
    if (/^(total|vat|net)\b/i.test(description)) continue;
    if (!description) continue;

    let qty, unitPrice, discount, net, vatPct, vat, total;
    if (take === 7) {
      [qty, unitPrice, discount, net, vatPct, vat, total] = nums;
    } else {
      [qty, unitPrice, net, vatPct, vat, total] = nums;
      discount = 0;
    }
    lineItems.push({ description, qty, unitPrice, discount, net, vatPct, vat, total });
  }

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
