/* THE YEAR SO FAR — what the boat has spent, and on what.
 *
 * David, Sep 2026: "invoice dashboard could be a 2026 insight per category."
 *
 * COMPARING A PART YEAR WITH A WHOLE ONE IS THE FAILURE THIS FILE EXISTS TO
 * PREVENT. The record runs to 26 August 2026 and 2026 stands at £693,796
 * against 2025's £1,312,459 — put side by side that reads as spending halving,
 * when it is eight months against twelve. Every comparison here is therefore
 * LIKE FOR LIKE: this year to the last invoice on record, against last year to
 * the same day. The page says which day it is measuring to, because a
 * comparison whose window is invisible is a comparison nobody can check.
 *
 * A part year is never annualised either. Running £693,796 out to a full year
 * would produce a figure that has not happened, sitting in a column of figures
 * that did — and this boat's costs are lumpy enough (one engine bill was 30% of
 * a year) that the projection would be wrong by more than the answer is worth.
 */

import { categoryOf, categoryLabel } from './categories.js'
import { yearShares } from './when.js'

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/** Day of the year, 1-366, so two years can be cut at the same point. */
const dayOfYear = (iso) => {
  const t = Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z')
  if (!Number.isFinite(t)) return null
  const d = new Date(t)
  return Math.round((t - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1
}

/**
 * Every invoice's contribution to one calendar year, honouring the date basis
 * and any work span. Returns the pieces rather than a total, so the caller can
 * group them and still know what was apportioned rather than dated.
 */
export function slicesForYear(invoices = [], year, { basis = 'total', on = 'invoice' } = {}) {
  const out = []
  for (const inv of invoices) {
    for (const s of yearShares(inv, on)) {
      if (s.year !== year) continue
      out.push({ inv, amount: num(inv[basis]) * s.share, share: s.share, spread: s.spread,
                 from: s.from || null, to: s.to || null })
    }
  }
  return out
}

/** The last date the record actually reaches, on the basis being used. */
export function recordReaches(invoices = [], on = 'invoice') {
  let last = null
  for (const inv of invoices) {
    const d = on === 'work' && inv.work_to ? String(inv.work_to).slice(0, 10)
      : on === 'work' && inv.work_from ? String(inv.work_from).slice(0, 10)
      : inv.invoice_date ? String(inv.invoice_date).slice(0, 10) : null
    if (d && (!last || d > last)) last = d
  }
  return last
}

/**
 * The year at a glance, per category, against the same window last year.
 *
 * `cutAt` is the day of the year both windows are cut at. It is taken from the
 * record rather than from the clock: if the last bundle went in three weeks ago
 * then that is how far the record reaches, and pretending otherwise would show
 * three weeks of nothing as three weeks of thrift.
 */
export function yearInsight(invoices = [], suppliers = [], opts = {}) {
  const { year, basis = 'total', on = 'invoice', cats } = opts
  const byId = new Map(suppliers.map((s) => [s.id, s]))

  const reaches = recordReaches(invoices, on)
  const reachedYear = reaches ? Number(reaches.slice(0, 4)) : null
  /* Only the latest year on record can be part of a year. An earlier one ran
     its full course whatever the record happens to hold about it. */
  const partial = reachedYear === year
  const cutAt = partial ? dayOfYear(reaches) : 366

  /* CUT ON THE PORTION'S OWN START, not the invoice's. A job running from
     November into March is in its second year from 1 January, so cutting that
     year at 26 August must keep it — cutting on the invoice's own start date
     would throw away a portion sitting squarely inside the window. */
  const within = (s) => !partial || (dayOfYear(s.from) ?? 1) <= cutAt

  const now = slicesForYear(invoices, year, { basis, on }).filter(within)
  const before = slicesForYear(invoices, year - 1, { basis, on }).filter(within)

  const sum = (rows) => rows.reduce((t, r) => t + r.amount, 0)

  const group = (rows) => {
    const m = new Map()
    for (const r of rows) {
      const k = categoryOf(r.inv, byId) || '__none__'
      const cur = m.get(k) || { key: k, total: 0, count: 0, firms: new Set() }
      cur.total += r.amount
      cur.count++
      if (r.inv.supplier_id) cur.firms.add(r.inv.supplier_id)
      m.set(k, cur)
    }
    return m
  }

  const a = group(now)
  const b = group(before)

  const categories = [...a.values()]
    .map((c) => {
      const was = b.get(c.key)?.total || 0
      return {
        ...c,
        firms: c.firms.size,
        label: categoryLabel(c.key === '__none__' ? null : c.key, cats),
        was,
        change: c.total - was,
        /* A category that did not exist last year has no percentage — it went
           from nothing to something, which is not a percentage change however
           much a chart would like one. */
        pct: was > 0 ? (c.total - was) / was : null,
        isNew: was === 0,
      }
    })
    .sort((x, y) => y.total - x.total)

  /* Categories that have STOPPED. A trade that was £40,000 last year and is
     nothing this year is the most interesting row on the page and would not
     appear at all if only this year's categories were listed. */
  const gone = [...b.values()]
    .filter((c) => !a.has(c.key) && c.total > 0)
    .map((c) => ({
      key: c.key, label: categoryLabel(c.key === '__none__' ? null : c.key, cats),
      total: 0, was: c.total, change: -c.total, pct: -1, count: 0, firms: 0, isNew: false,
    }))
    .sort((x, y) => y.was - x.was)

  const firms = new Map()
  for (const r of now) {
    const k = r.inv.supplier_id || r.inv.supplier || '—'
    const cur = firms.get(k) || { key: k, name: byId.get(r.inv.supplier_id)?.name || r.inv.supplier || 'no supplier', total: 0, count: 0 }
    cur.total += r.amount
    cur.count++
    firms.set(k, cur)
  }

  const total = sum(now)
  const wasTotal = sum(before)
  const spread = sum(now.filter((r) => r.spread))

  return {
    year,
    total,
    count: now.length,
    firms: [...firms.values()].sort((x, y) => y.total - x.total),
    categories,
    gone,
    /* WHAT IS BEING COMPARED, always stated. */
    partial,
    reaches,
    cutAt,
    was: wasTotal,
    change: total - wasTotal,
    pct: wasTotal > 0 ? (total - wasTotal) / wasTotal : null,
    /* HOW MUCH OF THIS YEAR IS AN APPORTIONMENT rather than a dated reading.
       A year built partly out of spread work spans should say so. */
    spread,
    biggest: [...now].sort((x, y) => y.amount - x.amount).slice(0, 8),
  }
}

/** Which years the record covers at all, newest first. */
export function yearsCovered(invoices = [], on = 'invoice') {
  const ys = new Set()
  for (const inv of invoices) for (const s of yearShares(inv, on)) ys.add(s.year)
  return [...ys].sort((a, b) => b - a)
}
