/* WHICH YEAR A COST BELONGS TO.
 *
 * David, Sep 2026: "although it was received in 1 batch from him, the actual
 * works spans multiple years. is it possible to put the work done into relevant
 * year not when invoice was received."
 *
 * THE CASE IS WORTH £397,271. Trevor McDonald (Marine Engine Services) sent
 * seven invoices, every one dated 5-8 October 2025 — a turbocharger failure
 * investigation, a MAK M20 major overhaul, an annual maintenance, an air
 * starter replacement. Billed in a lump, so **30% of the whole of 2025**
 * (£1,312,459) arrives on two days from one firm, and whichever years that work
 * was actually done in are understated by the same amount.
 *
 * THREE DATES, AND THEY ARE THREE DIFFERENT FACTS:
 *
 *   received   when the bundle came off the office scanner. Says nothing about
 *              the cost — the same bundle carried invoices from 2017.
 *   invoiced   when the firm billed it. A fact, and the honest default.
 *   worked     when the job was actually done. What the skipper is asking for,
 *              and the only one that puts a cost in the year it was incurred.
 *
 * A DATE IS A FACT AND A SPREAD IS AN ASSUMPTION, so they are kept apart. One
 * work date lands whole in its year, exactly like an invoice date. Only a
 * stated SPAN is divided, only pro rata by days, and every allocation says
 * whether it was divided — so a year total can report how much of itself rests
 * on a reading and how much on an apportionment.
 *
 * Most invoices need none of this. Each of Trevor McDonald's seven is one job
 * with one date printed on it, so seven work dates put seven jobs in their own
 * years with nothing divided at all. That is why the work DATE comes first and
 * the span is the exception — spreading an engine overhaul evenly across three
 * years is an invented distribution, and inventing one where a date exists
 * would be the worst of both.
 */

const DAY = 86400000

const asUTC = (v) => {
  const s = String(v ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const t = Date.parse(s + 'T00:00:00Z')
  return Number.isFinite(t) ? t : null
}

/**
 * The work span an invoice actually states.
 *
 * `work_to` on its own is NOT a span — a single date is a reading, and a span
 * is only a span when both ends are stated. An impossible span (ending before
 * it starts) is refused whole rather than reversed: which of the two dates is
 * wrong is not knowable, the same rule the page numbers follow.
 */
export function workSpan(inv) {
  const from = asUTC(inv?.work_from)
  if (from === null) return null
  const to = asUTC(inv?.work_to)
  if (to === null) return { from, to: from, stated: false }
  if (to < from) return null
  return { from, to, stated: true }
}

/** Which date this invoice is counted on, and where it came from. */
export function dateBasisOf(inv, on = 'invoice') {
  if (on === 'work') {
    const span = workSpan(inv)
    if (span) return { span, source: 'work' }
  }
  const d = asUTC(inv?.invoice_date)
  if (d === null) return { span: null, source: 'none' }
  return { span: { from: d, to: d, stated: false }, source: 'invoice' }
}

/**
 * How an invoice's money is allocated to calendar years.
 *
 * Returns `[{ year, share, spread }]`, the shares summing to 1. An invoice with
 * no usable date returns `[]` — it belongs to no year, and is counted apart by
 * the caller rather than being guessed into the current one.
 *
 * A span inside one year is that year, whole, and `spread` is false: nothing
 * was divided, so nothing should be reported as if it had been.
 */
export function yearShares(inv, on = 'invoice') {
  const { span } = dateBasisOf(inv, on)
  if (!span) return []

  const y0 = new Date(span.from).getUTCFullYear()
  const y1 = new Date(span.to).getUTCFullYear()
  const iso = (t) => new Date(t).toISOString().slice(0, 10)
  if (y0 === y1) return [{ year: y0, share: 1, spread: false, from: iso(span.from), to: iso(span.to) }]

  /* PRO RATA BY DAYS, both ends inclusive — a job that ran the last week of
     December and the first week of January was half in each year, and counting
     it whole in either would be a worse answer than dividing it. */
  const out = []
  let counted = 0
  const totalDays = (span.to - span.from) / DAY + 1
  for (let y = y0; y <= y1; y++) {
    const a = Math.max(span.from, Date.UTC(y, 0, 1))
    const b = Math.min(span.to, Date.UTC(y, 11, 31))
    const days = (b - a) / DAY + 1
    counted += days
    /* EACH PORTION CARRIES ITS OWN DATES, not the invoice's. A job running
       from November to March is in its second year from 1 January, and a
       report cutting the year at August has to know that — cutting on the
       invoice's own start date would drop the January-to-March portion out of
       a window it sits squarely inside. */
    out.push({ year: y, share: days / totalDays, spread: true, from: iso(a), to: iso(b) })
  }
  /* The shares are a division of one invoice and must add to exactly one, or a
     year total quietly loses or gains money. Guarded rather than trusted. */
  if (Math.abs(counted - totalDays) > 0.5) return [{ year: y0, share: 1, spread: false, from: iso(span.from), to: iso(span.from) }]
  return out
}

/** How the span reads to a person. Empty where there is nothing to say. */
export function workLabel(inv) {
  const span = workSpan(inv)
  if (!span) return ''
  const fmt = (t) => new Date(t).toISOString().slice(0, 10)
  return span.stated && span.from !== span.to
    ? `${fmt(span.from)} → ${fmt(span.to)}`
    : fmt(span.from)
}

/** How many of these invoices state when the work was done. */
export function workDateCoverage(invoices = [], basis = 'total') {
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  let withWork = 0, withWorkValue = 0, spanning = 0, total = 0, value = 0
  for (const inv of invoices) {
    total++
    value += num(inv[basis])
    if (!workSpan(inv)) continue
    withWork++
    withWorkValue += num(inv[basis])
    if (yearShares(inv, 'work').length > 1) spanning++
  }
  return { withWork, withWorkValue, spanning, total, value }
}

/**
 * Where a work date would actually change the answer.
 *
 * A firm that bills a lump long after the job is the whole reason this exists,
 * and there is no point asking for a work date on a £40 box of gloves invoiced
 * the week it was bought. So the page offers the ones that matter: several
 * invoices from one firm on one day, worth real money, with none of them
 * carrying a work date yet. Biggest first, which is the order they are worth
 * doing in — the same rule as the changeover invoices.
 */
export function lumpBillings(invoices = [], { basis = 'total', minTotal = 20000, minCount = 2 } = {}) {
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const byDay = new Map()
  for (const inv of invoices) {
    if (!inv.invoice_date || !inv.supplier_id) continue
    if (workSpan(inv)) continue           // already answered
    const k = inv.supplier_id + '|' + String(inv.invoice_date).slice(0, 10)
    const cur = byDay.get(k)
      || { supplier_id: inv.supplier_id, supplier: inv.supplier, date: String(inv.invoice_date).slice(0, 10),
           total: 0, count: 0, invoices: [] }
    cur.total += num(inv[basis])
    cur.count++
    cur.invoices.push(inv)
    byDay.set(k, cur)
  }
  return [...byDay.values()]
    .filter((g) => g.count >= minCount && g.total >= minTotal)
    .sort((a, b) => b.total - a.total)
}
