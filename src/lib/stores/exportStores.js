import { jsPDF } from 'jspdf'
import autoTableMod from 'jspdf-autotable'
// Vite hands back the function; node's ESM interop hands back the namespace.
// Same defensive shape as parse-core's import, so this works under both — and
// so scripts can exercise this file rather than a copy of it.
const autoTable = autoTableMod?.default ?? autoTableMod
import { CATEGORIES, categoryLabel, unitLong, supplierName } from './catalogue.js'
import { SHEET_WORDS, words, missingTranslations } from './i18n.js'

/* Getting the order off the boat and to the shop.
 *
 * THE SUPPLIER HAS NO LOGIN, so this is not a nicety — a stores list that
 * cannot leave the app is a list nobody can fill. PDF to send or print, CSV
 * for anyone who would rather have it in a spreadsheet.
 *
 * `lang` picks the supplier's language for a foreign landing. supplierName()
 * falls back to English wherever a translation is missing rather than
 * guessing, and the English is printed alongside so the shop can always
 * check — a wrong word on a provisions order gets the wrong food onto a boat
 * that is about to sail. Stage 1 ships every translation blank, so today this
 * prints English throughout; the plumbing is here so stage 3 is a toggle.
 */

// The four columns, in order. Named once so the two head rows cannot drift.
const KEYS = ['qty', 'unit', 'item', 'note']

const fmtDate = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '')
const catOrder = (k) => {
  const i = CATEGORIES.findIndex((c) => c.key === k)
  return i < 0 ? 999 : i
}

// Lines grouped into the order the paper form runs in, so a shop picking from
// this walks its shelves once.
export function groupForOrder(lines) {
  const m = new Map()
  for (const l of lines || []) {
    if (!m.has(l.category)) m.set(l.category, [])
    m.get(l.category).push(l)
  }
  return [...m.entries()]
    .sort((a, b) => catOrder(a[0]) - catOrder(b[0]))
    .map(([key, items]) => [key, items.slice().sort((a, b) => a.name.localeCompare(b.name))])
}

/* Build the document. Split from the save so a script can render the REAL
 * order sheet and read it back — doc.save() reaches for a browser and does
 * nothing in node, which had me checking a stale file on disk and believing a
 * page-break fix that had never run. */
export function buildStoresDoc(list, lines, byKey = new Map(), lang = 'en') {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const ink = [10, 29, 38], hull = [23, 73, 168], mute = [110, 122, 130]
  const groups = groupForOrder(lines)

  const w = words(lang)
  const missing = missingTranslations(lines, byKey, lang)

  doc.setFillColor(...hull); doc.rect(0, 0, W, 66, 'F')
  doc.setTextColor(255).setFont('helvetica', 'bold').setFontSize(17)
  doc.text(w.title, 40, 32)
  // The English title beside the translated one. Everything on this sheet
  // carries its English, so a word of mine being off costs the shop nothing.
  // Measured at the title's own size BEFORE the font is changed — getTextWidth
  // reports at whatever size is set when it is called.
  const titleW = doc.getTextWidth(w.title)
  if (lang !== 'en') {
    doc.setFont('helvetica', 'normal').setFontSize(9)
    doc.text(SHEET_WORDS.en.title, 40 + titleW + 10, 32)
  }
  doc.setFont('helvetica', 'normal').setFontSize(10.5)
  doc.text([list?.title, fmtDate(list?.starts_on)].filter(Boolean).join(' · ') || 'Stores', 40, 50)
  if (list?.meals_for) {
    doc.setFontSize(10)
    doc.text(`${w.mealsFor} ${list.meals_for}`, W - 40, 50, { align: 'right' })
  }

  /* ONE TABLE PER CATEGORY, and the category is part of the HEAD.
   *
   * A single table with the category as an ordinary body row looked fine until
   * a category straddled a page break: page 2 then opened with "12 Toilet
   * Rolls" and nothing to say what shelf that was. On a sheet whose entire job
   * is being picked from by somebody in a shop, an orphaned line is the one
   * thing worth spending a few lines of code on. As a head it repeats on every
   * page the category runs onto. */
  let y = 82
  for (const [cat, items] of groups) {
    const label = categoryLabel(cat).toUpperCase()
    // Heading drawn by hand rather than as a head row: autoTable does not
    // repeat a colSpan head row across a page break, so a category that
    // straddles one lost its name — which is what put "12 Toilet Rolls" alone
    // at the top of page 2 with nothing to say what shelf it was.
    const heading = (txt, at) => {
      doc.setFillColor(236, 239, 238); doc.rect(40, at - 11, W - 80, 15, 'F')
      doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...ink)
      doc.text(txt, 45, at)
    }
    if (y > doc.internal.pageSize.getHeight() - 90) { doc.addPage(); y = 56 }
    heading(label, y)
    y += 8
    const startedOn = doc.getCurrentPageInfo().pageNumber

    autoTable(doc, {
      startY: y,
      /* The English goes on its own head ROW, not inline as "ANTAL / QTY".
       * Inline wrapped in the two narrow columns and came off the page as
       * "ENHED /" over "/ QTY", which is worse than either language alone.
       * Two plain head rows repeat across a page break perfectly well — it is
       * only a colSpan head that does not. */
      head: lang === 'en'
        ? [KEYS.map((k) => SHEET_WORDS.en[k])]
        : [KEYS.map((k) => words(lang)[k]), KEYS.map((k) => SHEET_WORDS.en[k])],
      body: items.map((l) => {
        const item = byKey.get(l.item_key)
        const name = item ? supplierName(item, lang) : l.name
        // Print the English beside a translation, never instead of it.
        const shown = name !== l.name ? `${name}  (${l.name})` : l.name
        /* The unit gets its OWN column, spelt out. "12 cs" is clear on the boat
         * and ambiguous across a counter — the person picking this has never
         * seen the app, and reading it as 12 loose items is a week's food
         * short. A column also keeps the quantities aligned down the page,
         * which a shop reads far faster than a ragged "12 cs" / "6 dozen". */
        return [Number(l.qty), unitLong(l.unit, l.qty, lang), shown, l.note || '']
      }),
      theme: 'grid',
      showHead: 'everyPage',
      styles: { font: 'helvetica', fontSize: 9.5, cellPadding: 4, lineColor: [220, 226, 230], textColor: ink },
      headStyles: { fillColor: hull, textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
      // The English row sits under the supplier's, quieter but plainly there.
      didParseCell: (d) => {
        if (d.section === 'head' && d.row.index === 1) {
          d.cell.styles.fontStyle = 'normal'
          d.cell.styles.fontSize = 7.5
          d.cell.styles.textColor = [200, 216, 240]
          d.cell.styles.cellPadding = { top: 0, bottom: 3, left: 4, right: 4 }
        }
        if (d.section === 'head' && d.row.index === 0 && lang !== 'en') {
          d.cell.styles.cellPadding = { top: 3, bottom: 0, left: 4, right: 4 }
        }
      },
      columnStyles: {
        // 46, not 38: Norwegian ANTALL wraps to a stray 'L' in a narrower
        // column, which is the sort of thing only rendering the page shows.
        0: { cellWidth: 46, halign: 'right', fontStyle: 'bold' },
        1: { cellWidth: 62 },
        3: { cellWidth: 128 },
      },
      margin: { left: 40, right: 40, top: 56 },
      // Carried onto a new page: say so, so the picker still knows the shelf.
      // The footer is NOT drawn here — didDrawPage fires once per TABLE, and
      // with one table per category that stamped eight copies of it on top of
      // each other. It is stamped once per page after the loop instead.
      didDrawPage: () => {
        if (doc.getCurrentPageInfo().pageNumber !== startedOn) heading(`${label} (${w.continued})`, 44)
      },
    })
    y = doc.lastAutoTable.finalY + 18
  }

  /* THE KEY, and the admission.
   *
   * The unit column prints the supplier's word, so the English sits here — the
   * same "always beside it, never instead of it" rule the item names follow,
   * applied to the one column too narrow to carry both.
   *
   * And anything with no translation on file is NAMED. A half-translated order
   * that does not say so is the failure worth guarding against: the cook
   * believes the list is ready and the first anyone knows is a short delivery.
   * Better an English word the shop queries than a silent gap. */
  if (lang !== 'en') {
    const used = [...new Set(lines.map((l) => l.unit))].filter((u) => unitLong(u, 2, lang))
    const key = used.map((u) => `${unitLong(u, 2, lang)} = ${unitLong(u, 2, 'en')}`).join('  ·  ')
    if (y > doc.internal.pageSize.getHeight() - 110) { doc.addPage(); y = 56 }
    if (key) {
      doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...ink)
      doc.text(key, 40, y + 4)
      y += 16
    }
    if (missing.length) {
      doc.setFontSize(8).setTextColor(...mute)
      const names = missing.map((l) => l.name).join(', ')
      doc.text(
        doc.splitTextToSize(
          `Printed in English — no translation on file: ${names}`, W - 80),
        40, y + 4)
    }
  }

  const pages = doc.internal.getNumberOfPages()
  const H = doc.internal.pageSize.getHeight()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...mute)
    doc.text(`${lines.length} ${w.items} · ${w.generated} ${fmtDate(new Date().toISOString().slice(0, 10))}`, 40, H - 24)
    doc.text(`${w.page} ${p} ${w.of} ${pages}`, W - 40, H - 24, { align: 'right' })
  }

  return doc
}

export function exportStoresPdf(list, lines, byKey = new Map(), lang = 'en') {
  buildStoresDoc(list, lines, byKey, lang)
    .save(`stores ${list?.title || ''} ${list?.starts_on || ''}`.trim().replace(/[/\\:]/g, '-') + '.pdf')
}

export function exportStoresCsv(list, lines, byKey = new Map(), lang = 'en') {
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`
  // The supplier's word gets its OWN column rather than replacing the English,
  // so a spreadsheet of this is still readable on the boat. Same rule as the
  // PDF: beside it, never instead of it.
  const head = ['Category', 'Item', 'Qty', 'Unit', 'Note', 'Aboard', 'Added']
  if (lang !== 'en') head.splice(2, 0, `Item (${lang})`)
  const rows = [head]
  for (const [cat, items] of groupForOrder(lines)) {
    for (const l of items) {
      const r = [categoryLabel(cat), l.name, Number(l.qty), unitLong(l.unit, l.qty) || 'unit',
                 l.note || '', l.got ? 'yes' : '', (l.added_at || '').slice(0, 10)]
      if (lang !== 'en') {
        const item = byKey.get(l.item_key)
        const t = item ? supplierName(item, lang) : l.name
        r.splice(2, 0, t === l.name ? '' : t)
      }
      rows.push(r)
    }
  }
  const csv = rows.map((r) => r.map(q).join(',')).join('\r\n')
  // BOM so Excel opens it as UTF-8 rather than mangling anything accented —
  // which matters more now that a column can hold ø, æ and å.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `stores ${list?.title || ''} ${list?.starts_on || ''}`.trim().replace(/[/\\:]/g, '-') + '.csv'
  a.click()
  URL.revokeObjectURL(a.href)
}
