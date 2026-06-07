import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

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
    const last6 = cells.slice(-6);
    if (!last6.every((c) => NUM_RE.test(c.str))) continue;

    const descCells = cells.slice(0, -6);
    const description = descCells.map((c) => c.str).join(' ').trim();
    // Skip rows whose description starts with header/footer words
    if (/^(total|vat|net)\b/i.test(description)) continue;
    if (!description) continue;

    const [qty, unitPrice, net, vatPct, vat, total] = last6.map((c) => parseNum(c.str));
    lineItems.push({ description, qty, unitPrice, net, vatPct, vat, total });
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
