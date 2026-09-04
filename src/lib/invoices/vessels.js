/* TEN YEARS OF COSTS ARE THREE DIFFERENT BOATS.
 *
 * David, Sep 2026:
 *
 *   oldest boat was sold aug 2018
 *   pair/single went into service oct 2018 but invoices for that boat could be
 *     from spring 2018 onwards
 *   pair/single was sold july 2022
 *   twin trawler in service oct 2022 but invoices from summer 2022 could be for
 *     the twin vessel
 *
 * All three are AUDACIOUS BF83. Same name, same registration, different hulls
 * and different ways of fishing — so comparing 2019 gear spend against 2025 is
 * comparing two boats, and a grid that does not say so is quietly lying about a
 * trend.
 *
 * THE DATE PLACES AN INVOICE, EXCEPT WHERE IT CANNOT.
 *
 * A boat is bought and fitted out before it fishes and its bills start arriving
 * months ahead of it. So each changeover has a window where the invoice date
 * genuinely does not settle the question:
 *
 *   spring 2018 → Aug 2018   the old boat is still fishing AND the new one is
 *                            being fitted out. Both are plausible.
 *   summer 2022 → Oct 2022   the pair/single is being sold off while the twin
 *                            is being fitted. Both are plausible.
 *
 * THE PROOF THAT THIS IS NOT THEORETICAL is the fifth largest supplier on the
 * boat. Etablissements BOPP Treuils JEB — £616,200 of winches — is invoiced
 * 28-05-2018, four months before the pair/single entered service and while the
 * old boat was still fishing. David: "bopp was purchases for the oct 18 - jul
 * 22 vessel". Date alone would have put six hundred thousand pounds on the
 * wrong hull.
 *
 * SO AN INVOICE IN A WINDOW IS FLAGGED, NEVER GUESSED QUIETLY. It takes the
 * boat that was IN SERVICE as its provisional answer — routine running costs
 * are the common case and there are far more of them — and says it is unsure,
 * so the handful of big fit-out invoices can be moved. Guessing the other way
 * would move a hundred small chandlery bills to fix five large ones.
 *
 * Overridable per invoice, exactly like the category: `su_invoices.vessel_era`.
 */

export const DEFAULT_ERAS = [
  {
    key: 'pair',
    label: 'Pair trawler',
    note: 'the oldest boat, sold August 2018',
    // No start: everything before the next one belongs here.
    to: '2018-08-31',
  },
  {
    key: 'pair_single',
    label: 'Pair / single trawler',
    note: 'in service October 2018, sold July 2022',
    from: '2018-09-01',
    to: '2022-07-31',
    /* Her bills start in spring, while the old boat is still fishing. */
    fitOutFrom: '2018-03-01',
  },
  {
    key: 'twin',
    label: 'Twin trawler',
    note: 'in service October 2022',
    from: '2022-08-01',
    /* Same again: summer 2022 invoices can be hers. */
    fitOutFrom: '2022-06-01',
  },
]

/** A fleet's own eras merged over the shipped ones — same rule as the
 *  categories and the market clocks: a stored row supplies only what it
 *  changes, so a later correction still reaches the boat. */
export function resolveEras(stored) {
  const out = DEFAULT_ERAS.map((e) => ({ ...e }))
  for (const s of stored || []) {
    const at = out.findIndex((e) => e.key === s.key)
    if (at >= 0) out[at] = { ...out[at], ...s }
    else out.push({ ...s })
  }
  return out
}

export const eraLabel = (key, eras = DEFAULT_ERAS) =>
  eras.find((e) => e.key === key)?.label || (key ? key : 'Not placed')

/**
 * Which boat an invoice date falls to.
 *
 * Returns `{ key, certain, alsoCould }`, or null for no date.
 *
 * `certain: false` means the date lands in a changeover window and BOTH boats
 * are plausible — the one that was in service is offered, and the other is
 * named in `alsoCould` so the page can say which two it is choosing between
 * rather than presenting a guess as a fact.
 */
export function eraOf(date, eras = DEFAULT_ERAS) {
  const d = String(date || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null

  const inService = eras.find((e) =>
    (!e.from || d >= e.from) && (!e.to || d <= e.to))
  if (!inService) return null

  /* A LATER boat whose fit-out had started by this date is the other candidate.
     Only a later one: an invoice cannot belong to a boat already sold. */
  const iAt = eras.indexOf(inService)
  const fitting = eras.find((e, i) =>
    i > iAt && e.fitOutFrom && d >= e.fitOutFrom && (!e.from || d < e.from))

  return fitting
    ? { key: inService.key, certain: false, alsoCould: fitting.key }
    : { key: inService.key, certain: true, alsoCould: null }
}

/** The boat an invoice actually counts under: its own, else the date's, else
 *  nothing. Nothing stays nothing — an undated invoice belongs to no hull. */
export function vesselOf(invoice, eras = DEFAULT_ERAS) {
  if (invoice.vessel_era) return invoice.vessel_era
  return eraOf(invoice.invoice_date, eras)?.key || null
}

/**
 * Spend per boat, and — the point of the whole thing — what is still unsure.
 *
 * `uncertain` is every invoice sitting in a changeover window with no override,
 * biggest first, because that is the order they are worth deciding in: the
 * £616k of winches matters and a £40 box of gloves does not.
 */
export function vesselSplit(invoices = [], eras = DEFAULT_ERAS, opts = {}) {
  const { basis = 'total' } = opts
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

  const rows = new Map(eras.map((e) => [e.key, { ...e, total: 0, count: 0, unsure: 0 }]))
  const uncertain = []
  const undated = { total: 0, count: 0 }

  for (const inv of invoices) {
    const amt = num(inv[basis])
    const placed = eraOf(inv.invoice_date, eras)
    if (!placed) {
      /* No date means no hull. Counted apart rather than dropped or guessed —
         the same rule the period report follows. */
      if (!inv.vessel_era) { undated.total += amt; undated.count++; continue }
    }
    const key = inv.vessel_era || placed?.key
    const row = rows.get(key)
    if (!row) continue
    row.total += amt
    row.count++

    if (!inv.vessel_era && placed && !placed.certain) {
      row.unsure += amt
      uncertain.push({ invoice: inv, amount: amt, offered: placed.key, alsoCould: placed.alsoCould })
    }
  }

  return {
    rows: [...rows.values()],
    undated,
    uncertain: uncertain.sort((a, b) => b.amount - a.amount),
    unsureTotal: uncertain.reduce((s, u) => s + u.amount, 0),
  }
}

/* COMPARING THE THREE BOATS' TOTALS IS COMPARING THREE DIFFERENT LENGTHS OF
 * TIME, and the page was doing exactly that.
 *
 * The record holds two and a half years of the old boat, nearly four of the
 * pair/single and four of the twin — so the totals rank the boats by how long
 * each one sits in the record, not by what she cost to run. £ per year of
 * service is the comparable figure.
 *
 * THE FIRST BOAT'S FIGURE IS THE ONE TO DISTRUST, and it says so. She was sold
 * in August 2018 and the invoices only start in 2016, so her window is where
 * the RECORD begins rather than where she did — a boat is dearest when she is
 * new and when she is worn out, and we hold only the end of her. The flag
 * `fromRecord` marks a window that is an artefact of what was kept.
 */
export function eraService(era, invoices = [], eras = DEFAULT_ERAS) {
  const dates = invoices
    .map((i) => (i.invoice_date ? String(i.invoice_date).slice(0, 10) : null))
    .filter(Boolean)
    .sort()
  const earliest = dates[0] || null
  const latest = dates[dates.length - 1] || null
  if (!earliest || !latest) return null

  const e = eras.find((x) => x.key === era)
  if (!e) return null

  /* No start means "everything before the next one", so the window opens where
     the record does — a fact about the record rather than about the boat. No
     end means she is still fishing, so it closes where the record reaches. */
  const from = e.from && e.from > earliest ? e.from : earliest
  const to = e.to && e.to < latest ? e.to : latest
  const days = (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000 + 1
  if (!Number.isFinite(days) || days <= 0) return null

  return { from, to, years: days / 365.25, fromRecord: !e.from, stillFishing: !e.to }
}

/** The split, with each boat's service window and her cost per year of it. */
export function vesselSplitPerYear(invoices = [], eras = DEFAULT_ERAS, opts = {}) {
  const split = vesselSplit(invoices, eras, opts)
  return {
    ...split,
    rows: split.rows.map((r) => {
      const service = eraService(r.key, invoices, eras)
      return {
        ...r,
        service,
        /* Null rather than 0 where there is no window to divide by. A boat with
           nothing on record has no cost per year, and a 0 would rank her as the
           cheapest hull this business ever ran. */
        perYear: service && service.years > 0 ? r.total / service.years : null,
      }
    }),
  }
}
