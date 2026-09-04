import { normaliseSupplier } from './suppliers.js'

/* TELLING ONE INVOICE FROM THE NEXT ACROSS A RE-READ.
 *
 * Reading a bundle again REPLACES every invoice off it, which is right: the
 * bundle is the source, and reading it twice should produce it afresh rather
 * than a second copy alongside the first.
 *
 * BUT FOUR COLUMNS ARE NOT THE READER'S. `vessel_era` and `category` are the
 * skipper's answers to questions the invoice cannot answer — which of three
 * boats a 2018 winch order was for, whether "Lease 20tn N/S Cod" is quota or
 * fishing gear. They are expensive answers: 102 invoices carry a vessel
 * decision, and six of those moved £751,000 onto the right hull.
 *
 * So a re-read that dropped them would quietly undo weeks of decisions, with
 * nothing on screen to say so — and it would do it for the most ordinary reason
 * imaginable, someone re-reading one bundle to pick up its page numbers.
 */

/**
 * The invoice NUMBER where there is one: it is the firm's own identifier and
 * survives the same document being read twice, even if the reader words the
 * description differently the second time.
 *
 * Where there is none — and plenty of these are photographs of hand-written
 * notes — the firm, the total and the date TOGETHER. Three things agreeing is a
 * match; any less is not, and the answer to a near miss here is the same as the
 * answer to a near-miss supplier name: leave it alone. Moving one invoice's
 * decision onto another is not recoverable once the evidence is filed.
 *
 * THE FIRM GOES THROUGH `normaliseSupplier` AND THAT IS NOT A DETAIL. The name
 * is the one part of the key that comes off a MODEL READING A PHOTOGRAPH, so it
 * drifts between one read of a document and the next read of the same document
 * — caught by test, where "Ironside & Son" came back as "IRONSIDE AND SON" and
 * a raw comparison lost the decision. That is the same drift the supplier
 * lookup exists for; using anything weaker here would have quietly dropped
 * decisions on exactly the invoices that have no number, which are the
 * hand-written ones.
 */
export function invoiceKey(r) {
  const flat = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const no = flat(r?.invoice_no)
  if (no) return 'no:' + no
  const total = Number(r?.total)
  return 'sum:' + normaliseSupplier(r?.supplier || '') + '|' +
         (Number.isFinite(total) ? total.toFixed(2) : '') + '|' +
         String(r?.invoice_date || '').slice(0, 10)
}

/**
 * Lift the skipper's decisions off what is being replaced and put them back on
 * what replaces it.
 *
 * Returns `{ rows, carried, lost }`. A decision whose invoice is not in the new
 * read is LOST — the invoice it belonged to is no longer there, and there is
 * nowhere honest to put it — so it is counted and named rather than dropped
 * silently or spread onto whatever is nearest.
 *
 * A decision already on the incoming row WINS: it was made just now, on the
 * screen, and beats one made last time.
 */
export function carryDecisions(kept = [], rows = []) {
  const held = new Map()
  for (const k of kept) {
    if (!k?.category && !k?.vessel_era && !k?.work_from && !k?.work_to) continue
    held.set(invoiceKey(k), { row: k, category: k.category ?? null, vessel_era: k.vessel_era ?? null,
                              work_from: k.work_from ?? null, work_to: k.work_to ?? null })
  }

  const used = new Set()
  const out = rows.map((r) => {
    const hit = held.get(invoiceKey(r))
    if (!hit) return { ...r }
    used.add(invoiceKey(r))
    return {
      ...r,
      category: r.category ?? hit.category,
      vessel_era: r.vessel_era ?? hit.vessel_era,
      /* WHEN THE WORK WAS DONE IS THE SKIPPER'S ANSWER TOO, and a dearer one to
         make than either of the others: it is read off the invoice by a person
         and cannot be recovered from anything the reader returns. It carries
         for the same reason. */
      work_from: r.work_from ?? hit.work_from,
      work_to: r.work_to ?? hit.work_to,
    }
  })

  const lost = [...held.entries()]
    .filter(([k]) => !used.has(k))
    .map(([, v]) => v.row)

  return { rows: out, carried: used.size, lost }
}
