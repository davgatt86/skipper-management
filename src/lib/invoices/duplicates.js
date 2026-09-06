/* AN INVOICE THAT IS ALREADY ON FILE.
 *
 * Found Sep 2026 by sweeping the record: 60 groups, 61 rows and **£240,015.96**
 * counted twice across ten years. Not a reader fault and not an upload fault —
 * no two bundles even share a file name. It is how the approval run works:
 *
 *     Inverboyndie INV-0114, £34,971.60, dated 19 May 2023, appears in the
 *     bundles of 6 June, 13 June AND 19 June — three consecutive Mondays.
 *
 * Denise re-sends an invoice in the following week's PDF until it has been
 * approved, which is entirely correct of her and means the same cost arrives
 * two or three times. Six more groups are one bundle where the reader returned
 * the same invoice twice.
 *
 * THE PROCESS IS NOT GOING TO CHANGE, so the app has to catch it. This is the
 * only item on the list that gets worse while nobody looks at it.
 *
 * REPORTED, NEVER REFUSED. The save is not blocked and the row is not dropped
 * automatically — the same rule as the settlement totals and the net/VAT check.
 * A firm can legitimately reissue under a new number, an invoice number can be
 * misread, and being certain is not this function's business. It says what it
 * found and leaves the decision where it belongs.
 */

import { normaliseSupplier } from './suppliers.js'

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null)
const flatNo = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const day = (v) => String(v ?? '').slice(0, 10)

/**
 * The firm and the number together, which is what identifies an invoice.
 *
 * The FIRM goes through `normaliseSupplier` because it is the half that comes
 * off a model reading a photograph and drifts between two reads of the same
 * document — "Ironside & Son" came back "IRONSIDE AND SON" in a test, and
 * "Macduff Shipyards Ltd" arrives as "Limited" about half the time. Comparing
 * raw names would miss most of what this is for.
 *
 * Returns null where there is no number: an invoice with no number cannot be
 * matched this way, and guessing at one from the amount and date would flag
 * every routine repeat order a firm sends.
 */
export function docKey(row) {
  const no = flatNo(row?.invoice_no)
  if (!no) return null
  return normaliseSupplier(row?.supplier || '') + '|' + no
}

/**
 * What is already on file that this row looks like.
 *
 * `certain` where the date and the amount agree too — that is the same piece of
 * paper and nothing else. Where they differ it is `similar`: the office
 * reissues a corrected invoice under the same number with a "b" on the end, and
 * 3098 / 3098b turned out to be exactly that, £147,985.99 of double count. Both
 * are worth showing and they are NOT the same claim, so they are not made to
 * look alike.
 */
export function matchExisting(row, index) {
  const k = docKey(row)
  if (!k) return null
  const hits = index.get(k)
  if (!hits || !hits.length) return null

  const t = num(row.total)
  const d = day(row.invoice_date)
  const exact = hits.filter((h) => num(h.total) === t && day(h.invoice_date) === d)

  /* A MATCH ON A REFERENCE THIS APP MADE UP IS WEAKER EVIDENCE, and must not be
     dressed as `certain`. An assigned reference is BUILT from the firm, the date
     and the total, so a match on one says only that those three agree — which is
     precisely the guess this module has always refused to make on a numberless
     invoice, because it fires on every routine repeat order. It is worth showing
     and it is not the same claim, so it gets its own kind. */
  if (isAssigned(row) || hits.some(isAssigned)) {
    return { kind: 'derived', hits: exact.length ? exact : hits }
  }

  return {
    kind: exact.length ? 'certain' : 'similar',
    hits: exact.length ? exact : hits,
  }
}

/* Ours rather than the office's — either flagged in the database or wearing the
   prefix, since a row read off the page has the prefix before it has the flag. */
const isAssigned = (r) =>
  r?.invoice_no_assigned === true || /^NN-/.test(String(r?.invoice_no ?? '').trim())

/* NOTHING THE OFFICE PRINTED. Wider than `isAssigned` on purpose: a row on the
   review screen has not been saved yet, so a numberless invoice carries a BLANK
   number rather than an `NN-` reference — the reference is assigned in
   `saveBatchInvoices`. A check that only knew about `NN-` would therefore work
   on the record and do nothing at the one moment it is wanted. */
const noOfficeNumber = (r) => !flatNo(r?.invoice_no) || isAssigned(r)

/** Index the invoices already filed, so a bundle is checked in one pass. */
export function indexInvoices(invoices = [], { ignoreBatch = null } = {}) {
  const m = new Map()
  for (const inv of invoices) {
    /* THE BUNDLE BEING SAVED IS NOT ITS OWN DUPLICATE. Re-reading a bundle
       replaces its invoices, so its existing rows would otherwise match every
       row coming in and the whole thing would light up red. */
    if (ignoreBatch && inv.batch_id === ignoreBatch) continue
    const k = docKey(inv)
    if (!k) continue
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(inv)
  }
  return m
}

/**
 * Index the OTHER bundles waiting in the same run.
 *
 * THE HOLE THIS FILLS. Every other check compares against what is already
 * filed — but a run of bundles read together is not filed yet, so two of them
 * carrying the same invoice matched nothing and both saved. That is not a rare
 * shape: the office re-sends an invoice in the following week's PDF until it is
 * approved, and **38 of the 54 cross-bundle duplicates in the record are 2 to 10
 * days apart** — consecutive Mondays, which is precisely what lands in one run
 * when a year is loaded at a time.
 *
 * Saving one bundle at a time hid it, because the save refreshes what is filed
 * and the next card then sees it. "Save all" does the lot before that refresh,
 * so the very button that exists for loading in bulk was the one with no guard.
 */
export function indexRun(bundles = [], { exceptBatch = null } = {}) {
  const m = new Map()
  for (const b of bundles || []) {
    if (exceptBatch && b?.batch?.id === exceptBatch) continue
    for (const r of b?.rows || []) {
      const k = docKey(r)
      if (!k) continue
      if (!m.has(k)) m.set(k, [])
      m.get(k).push({ ...r, _batch: b.batch })
    }
  }
  return m
}

/**
 * Check a whole read before it is filed.
 *
 * Returns one entry per row that looks like something already on file, like
 * another row in the same bundle — six of the sixty groups were a single bundle
 * where the reader returned the same invoice twice — or like a row in another
 * bundle waiting in the same run.
 *
 * FOUR KINDS, AND THEY ARE FOUR DIFFERENT FACTS. Collapsing them would be the
 * 3098/3098b mistake again: `certain` and `similar` differ by whether the amount
 * agrees, and £147,985.99 turned on that. `within` and `run` are not history at
 * all — nothing is filed yet and the answer is simply to leave one out.
 */
export function checkForDuplicates(rows = [], invoices = [], opts = {}) {
  const index = indexInvoices(invoices, opts)
  const run = indexRun(opts.alsoInRun, { exceptBatch: opts.ignoreBatch })
  const split = indexSplits(rows)
  const carried = indexCarried(rows)
  const seen = new Map()
  const found = []

  rows.forEach((row, i) => {
    const k = docKey(row)

    /* Against the same read first. `within` is a different fact from `certain`:
       nothing is on file yet, so this is one bundle carrying an invoice twice,
       and the answer is to leave one out rather than to wonder about history. */
    if (k && seen.has(k)) {
      found.push({ index: i, row, kind: 'within', hits: [rows[seen.get(k)]], at: seen.get(k) })
      return
    }
    if (k) seen.set(k, i)

    /* ON FILE BEATS IN THE RUN. Both may be true; what is already filed is the
       confirmed fact and carries the stronger claim. */
    const m = matchExisting(row, index)
    if (m) { found.push({ index: i, row, ...m }); return }

    const alsoHere = k && run.get(k)
    if (alsoHere && alsoHere.length) {
      found.push({ index: i, row, kind: 'run', hits: alsoHere })
      return
    }

    /* LAST, because it is the weakest claim and every other kind is about a
       different document. This one is about the same document read twice. */
    const halves = split.get(splitKey(row))
    if (halves && halves.length > 1 && halves[0].i === i) {
      found.push({ index: i, row, kind: 'split', hits: halves.slice(1).map((h) => h.row) })
      return
    }

    const run2 = carried.get(carriedKey(row))
    if (run2 && run2.length > 1 && run2[0].i === i) {
      found.push({ index: i, row, kind: 'carried', hits: run2.slice(1).map((h) => h.row) })
    }
  })

  const value = found.reduce((t, f) => t + (num(f.row.total) || 0), 0)
  return {
    found,
    /* WHAT IT WOULD COST TO FILE THEM ANYWAY, which is the only number that
       makes anyone read the panel. */
    value,
    certain: found.filter((f) => f.kind === 'certain').length,
    similar: found.filter((f) => f.kind === 'similar').length,
    within: found.filter((f) => f.kind === 'within').length,
    run: found.filter((f) => f.kind === 'run').length,
    derived: found.filter((f) => f.kind === 'derived').length,
    split: found.filter((f) => f.kind === 'split').length,
    carried: found.filter((f) => f.kind === 'carried').length,
  }
}

/* ONE INVOICE READ AS TWO — the page split.
 *
 * Found Sep 2026 by opening two scans David asked about. The office feeds a
 * two-page invoice into the scanner BACK PAGE FIRST, so the bundle runs
 * [totals page, items page]. The reader takes each as an invoice of its own and
 * files the same cost twice:
 *
 *     Strachan Trawls, bundle of 11 May 2022
 *       page 2   TOTAL GBP 1,523.00, due date, bank details, no items
 *       page 3   the header and the items, subtotal 1,507.79 + VAT 15.21
 *     ...which is 1,523.00. One invoice, filed twice.
 *
 * NEITHER `docKey` NOR THE DERIVED REFERENCE CAN SEE IT. docKey needs a number
 * and neither page has one; the derived reference is firm + DATE + total, and
 * the two halves disagree about the date because only the header page carries
 * it — so the £4,247.37 pair came out as NN-STRACHANTR-undated-4247.37 against
 * NN-STRACHANTR-20220328-4247.37 and matched nothing at all.
 *
 * SO THE KEY DROPS THE DATE and keeps what both halves of one invoice must
 * agree on: the firm and the printed total.
 *
 * THE GUARD IS THAT ONE SIDE HAS NO NUMBER. Two invoices from one firm for the
 * same amount in one bundle are perfectly ordinary — Woodsons bill £1,180 most
 * months and Ironside £270 — and every one of those carries the office's own
 * number on BOTH sides, because both are real headers. A page with no header
 * has no number to read. Measured over the whole record: 25 same-firm-same-total
 * groups, of which this rule flags 3 — and those 3 are exactly the ones opening
 * the scans proved. No genuine pair is touched.
 */
const splitKey = (row) =>
  normaliseSupplier(row?.supplier || '') + '|' + (num(row?.total) ?? 'x')

function indexSplits(rows = []) {
  const m = new Map()
  rows.forEach((row, i) => {
    const t = num(row?.total)
    if (t === null || t === 0) return          // a nil total matches everything
    const k = splitKey(row)
    if (!m.has(k)) m.set(k, [])
    m.get(k).push({ i, row })
  })
  /* Only where at least one side has no number of its own. */
  for (const [k, v] of m) if (v.length < 2 || !v.some((x) => noOfficeNumber(x.row))) m.delete(k)
  return m
}

/* A RUNNING CARRIED-FORWARD FIGURE READ AS AN INVOICE — the dearest mistake in
 * the record, at £136,140.56.
 *
 * Macduff Shipyards 36766 of 10-11-2021 is ONE invoice printed over five pages,
 * scanned back page first. Every printed page carries a brought-forward figure
 * at the top and a carried-forward at the foot, and the reader took each page's
 * carry-forward as that page's invoice total:
 *
 *     scan p5  c/f £32,102.57      scan p3  c/f £54,483.39
 *     scan p4  c/f £50,413.79      scan p2  c/f £55,737.45
 *
 * — four invoices totalling £192,737.20 for one job that came to £56,596.64.
 * The page carrying the real TOTAL was skipped, so nothing on the record
 * contradicted it. `split` cannot see this: the four totals are all different,
 * and `split` keys on firm + total.
 *
 * THREE THINGS AT ONCE, and it needs all three or it fires on ordinary work:
 *   - SEVERAL rows, one firm, none with a number the office printed — a page
 *     with no header has no number, so every page of one invoice looks numberless;
 *   - all carrying THE SAME invoice date — one job invoiced once on one day,
 *     where genuine separate invoices from a firm land on different days;
 *   - and NO NET/VAT SPLIT on any of them. This is the strongest of the three.
 *     A real invoice prints its net and its VAT; a carry-forward line is a bare
 *     running figure, so the reader has nothing to split and returns zeroes.
 *
 * Swept over the whole ten-year record it fires on Macduff and NOTHING else —
 * not the seven numberless Jackson rows in one bundle, nor the five Strachan,
 * because those all carry a real net and VAT of their own.
 *
 * REPORTED, NEVER RESOLVED, like everything else here. Which page holds the real
 * total is a question for whoever opens the scan, and the answer is often a page
 * that got no row at all.
 */
const carriedKey = (row) =>
  normaliseSupplier(row?.supplier || '') + '|' + day(row?.invoice_date)

function indexCarried(rows = []) {
  const m = new Map()
  rows.forEach((row, i) => {
    if (!day(row?.invoice_date)) return          // undated tells us nothing here
    if (!noOfficeNumber(row)) return
    const t = num(row?.total)
    if (t === null || t === 0) return
    /* NO SPLIT READ AT ALL — not "no VAT", which is ordinary on zero-rated gear
       and shows as net === total. Both at nought with money in the total means
       the reader found a bare figure, which is what a carry-forward line is. */
    if (num(row?.net) !== 0 || num(row?.vat) !== 0) return
    const k = carriedKey(row)
    if (!m.has(k)) m.set(k, [])
    m.get(k).push({ i, row })
  })
  for (const [k, v] of m) if (v.length < 2) m.delete(k)
  return m
}
