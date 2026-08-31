/* THE BOND INVOICE, AND THE LINE THAT WAS NOT THERE.
 *
 * David, Aug 2026: "bond parse isn't picking up pinot grigo lines".
 *
 * On invoice SI-390 that item is too long for its column and the print breaks
 * it in three — description, then figures, then the product code alone. The
 * figures row carried no description, so `if (!description) continue` dropped
 * it: £66 gone off the bond with nothing to show it had existed.
 *
 * Same class of fault as the sales-note wrapped row, in a different document:
 * a fixed-width print, a cell too wide for its column, and a parser anchoring
 * on the part that moved.
 *
 * The rows below are the REAL ones off that invoice, as pdf.js extracts them.
 */
import assert from 'node:assert/strict'
import { itemsFromRows } from './src/squareup/invoiceParser.js'

let n = 0
const eq = (a, b, m) => { n++; assert.deepEqual(a, b, m) }
const ok = (c, m) => { n++; assert.ok(c, m) }

// One row of the real invoice: cells left-to-right, y descending down the page.
let y = 800
const row = (...cells) => ({ page: 1, y: y--, items: cells.map((s, i) => ({ str: s, x: i * 40 })) })

const rows = [
  row('Description', 'Qty/Hrs', 'Price/Rate', 'Net', '% VAT', 'VAT', 'Total (£)'),
  row('Regal Blue KS 200s (Regal) (TOBRKS)', '30.00', '37.00', '1,110.00', '0.00', '0.00', '1,110.00'),
  row('LM Blue 200s (TOBLMB)', '6.00', '22.00', '132.00', '0.00', '0.00', '132.00'),
  row('Aberfeldy Madeira 12YO 40% (WHIABER)', '2.00', '30.00', '60.00', '0.00', '0.00', '60.00'),
  row('Grey Goose Original (40%) 70cl (SPIGG)', '3.00', '38.00', '114.00', '0.00', '0.00', '114.00'),
  row('Tanqueray Gin (47.3%) 100cl (GINTAN)', '1.00', '17.50', '17.50', '0.00', '0.00', '17.50'),
  // ---- THE WRAPPED ONE, exactly as it comes out ----
  row('Barefoot Pinot Grigio 11.5% 75cl'),
  row('2.00', '33.00', '66.00', '0.00', '0.00', '66.00'),
  row('(WINBFPG)'),
  // ---- and the line after it, which must not be disturbed ----
  row('Yellow Tail Bubbles Blanc (11.5%) 75cl (WINWBB)', '6.00', '0.00', '0.00', '0.00', '0.00', '0.00'),
  row('1,679.50 (£)'),
  row('Total Net'),
]

const items = itemsFromRows(rows)

// ---- THE LINE THAT WAS MISSING -------------------------------------------
const pg = items.find((i) => /Pinot Grigio/i.test(i.description))
ok(pg, 'the Pinot Grigio line is read at all — it used to vanish entirely')
eq(pg.qty, 2, 'two bottles')
eq(pg.unitPrice, 33, 'at £33')
eq(pg.total, 66, 'the £66 that was going missing off the bond')
ok(pg.description.includes('(WINBFPG)'),
   'and the product code from the third line is put back on — it is what tells two wines apart')

// ---- nothing else moved ---------------------------------------------------
eq(items.length, 7, 'seven items, not six')
eq(items.map((i) => i.total), [1110, 132, 60, 114, 17.5, 66, 0],
   'every line, in order, with the wrapped one in its right place')
ok(items.every((i) => !/^(total|vat|net)\b/i.test(i.description)), 'no footer row read as an item')
ok(!items.some((i) => i.description === 'Description'), 'and no header row either')

/* THE ZERO-PRICED LINE IS KEPT. Yellow Tail comes through at £0.00 and it is a
 * real line on the bond — a bottle handed over is a bottle handed over, and
 * dropping it because it cost nothing would lose the record of it. */
const yt = items.find((i) => /Yellow Tail/i.test(i.description))
ok(yt, 'a line priced at nothing is still a line')
eq(yt.qty, 6, 'six of them')

// ---- the description must not bleed ---------------------------------------
{
  /* A heading followed by a NORMAL item must not have the heading welded onto
   * it. Only a row whose figures arrived alone may borrow the line above. */
  const r2 = [
    row('Description', 'Qty/Hrs', 'Price/Rate', 'Net', '% VAT', 'VAT', 'Total (£)'),
    row('Regal Blue KS 200s (TOBRKS)', '30.00', '37.00', '1,110.00', '0.00', '0.00', '1,110.00'),
  ]
  const it = itemsFromRows(r2)
  eq(it.length, 1, 'one item')
  eq(it[0].description, 'Regal Blue KS 200s (TOBRKS)', 'and the header did not stick to it')
}

{
  // Two wrapped items in a row: each takes its OWN description, not the first.
  const r3 = [
    row('Barefoot Pinot Grigio 11.5% 75cl'),
    row('2.00', '33.00', '66.00', '0.00', '0.00', '66.00'),
    row('(WINBFPG)'),
    row('Some Other Very Long Wine Name 75cl'),
    row('1.00', '20.00', '20.00', '0.00', '0.00', '20.00'),
    row('(WINOTH)'),
  ]
  const it = itemsFromRows(r3)
  eq(it.length, 2, 'both wrapped items are read')
  ok(/Pinot Grigio/.test(it[0].description) && /WINBFPG/.test(it[0].description), 'the first keeps its own')
  ok(/Some Other/.test(it[1].description) && /WINOTH/.test(it[1].description),
     'and the second does NOT inherit the first')
}

{
  // A description with no figures anywhere after it is not invented into a line.
  const it = itemsFromRows([row('Barefoot Pinot Grigio 11.5% 75cl'), row('Notes')])
  eq(it, [], 'a description on its own produces nothing')
}

// ---- the 7-column layout (with a Discount column) -------------------------
{
  const it = itemsFromRows([
    row('Something (CODE)', '2.00', '10.00', '1.00', '19.00', '0.00', '0.00', '19.00'),
  ])
  eq(it.length, 1, 'the seven-number layout still reads')
  eq(it[0].discount, 1, 'and its discount column is picked up')
  eq(it[0].total, 19, 'with the right total')
}

eq(itemsFromRows([]), [], 'no rows, no items')

console.log('bond invoice: ' + n + ' checks passed')

/* ── WHO OWES WHAT ─────────────────────────────────────────────────────────
 *
 * `bondBreakdown` is what the skipper's view of a kept sheet and the office's
 * PDF both rest on. One function on purpose: the chalk sheet and the buyers'
 * catalogue rendered perfectly and disagreed with each other because the sale
 * order was worked out twice, and this is money.
 */
const { bondBreakdown } = await import('./src/squareup/helpers.js')

const bcrew = [{ id: 'c1', name: 'David' }, { id: 'c2', name: 'Norman' }]
const bitems = [
  { id: '1', description: 'Baccy', amount: 148, assignedTo: 'c1' },
  { id: '2', description: 'Whisky', amount: 30, assignedTo: 'c1' },
  { id: '3', description: 'Wine', amount: 66, assignedTo: 'c2' },
  { id: '4', description: 'Galley', amount: 60, assignedTo: 'stores' },
  { id: '5', description: 'Last trip', amount: 22, assignedTo: null, carried: true },
  { id: '6', description: 'Nobody', amount: 17.5, assignedTo: null },
]
const b = bondBreakdown(bitems, bcrew)

eq(b.perCrew.map(x => [x.c.name, x.total]), [['David', 178], ['Norman', 66]],
   'each man carries his own total')
eq(b.perCrew[0].items.map(i => i.description), ['Baccy', 'Whisky'],
   'AND HIS ITEMS — the total is what is disputed, the items are what settles it')
eq(b.stores.total, 60, 'the boat pays its own')

/* CARRIED IS NOT UNASSIGNED, though both are charged to nobody. Carried is a
 * balance brought forward and is an ordinary thing for the office to read;
 * unassigned is a question. Printing them as one figure would turn every
 * carried balance into a red flag and every real flag into a shrug. */
eq(b.carried.total, 22, 'a carried balance stands on its own')
eq(b.unassigned.total, 17.5, 'and does not swell the unassigned figure')
eq(b.total, 343.5, 'and everything still adds up to the whole bond')

/* Bond charged to a man who has since been taken off the sheet. It belongs to
 * nobody the page can name, so it is counted as unassigned rather than dropped
 * out of the total — which would leave the sheet quietly short. */
{
  const gone = bondBreakdown(
    [{ id: 'x', description: 'His', amount: 40, assignedTo: 'departed' }], bcrew)
  eq(gone.unassigned.total, 40, 'bond charged to a man no longer aboard is not lost')
  eq(gone.total, 40, 'and the sheet still totals to it')
}

eq(bondBreakdown([], bcrew).isEmpty, true, 'no bond at all is its own state')
eq(bondBreakdown([], bcrew).total, 0, 'and totals nothing')
eq(bondBreakdown(bitems, []).unassigned.total, 261.5,
   'with nobody on the sheet, every crew bond is unattributable — never silently dropped')

console.log('bond breakdown: ' + n + ' checks passed in total')
