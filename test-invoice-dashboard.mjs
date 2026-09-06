/* WHEN A COST BELONGS, WHAT A YEAR LOOKS LIKE, AND FINDING ONE INVOICE.
 *
 * The case that produced all three is real and is worth £397,271: Trevor
 * McDonald (Marine Engine Services) sent seven invoices, every one dated 5-8
 * October 2025 — a turbocharger failure, a MAK M20 major overhaul, an annual
 * maintenance, an air starter. Billed in a lump, so 30% of the whole of 2025
 * lands on two days from one firm.
 *
 * David: "is it possible to put the work done into relevant year not when
 * invoice was received."
 */
import assert from 'node:assert/strict'
import {
  workSpan, yearShares, workLabel, workDateCoverage, lumpBillings,
} from './src/lib/invoices/when.js'
import {
  yearInsight, slicesForYear, recordReaches, yearsCovered,
} from './src/lib/invoices/dashboard.js'
import { findInvoices, matchesQuery } from './src/lib/invoices/find.js'
import { checkForDuplicates, docKey } from './src/lib/invoices/duplicates.js'
import { categoryMatrix } from './src/lib/invoices/categories.js'

let n = 0
const eq = (a, b, m) => { n++; assert.deepEqual(a, b, m) }
const ok = (c, m) => { n++; assert.ok(c, m) }
const near = (a, b, m, tol = 0.005) => { n++; assert.ok(Math.abs(a - b) <= tol, `${m} (${a} vs ${b})`) }

// ---- A DATE IS A FACT, A SPREAD IS AN ASSUMPTION -------------------------

/* THE COMMON CASE IS NOT A SPAN AT ALL. Each of those seven invoices is one job
 * with one date on it, so a work DATE puts each in its own year with nothing
 * divided. Spreading an overhaul evenly across three years would be an invented
 * distribution, and inventing one where a date exists is the worst of both. */
eq(yearShares({ invoice_date: '2025-10-05', work_from: '2024-03-11' }, 'work'),
   [{ year: 2024, share: 1, spread: false, from: '2024-03-11', to: '2024-03-11' }],
   'one work date lands whole in its own year, nothing divided')

eq(yearShares({ invoice_date: '2025-10-05', work_from: '2024-03-11' }, 'invoice'),
   [{ year: 2025, share: 1, spread: false, from: '2025-10-05', to: '2025-10-05' }],
   'and on the invoice basis the work date is ignored entirely')

eq(yearShares({ invoice_date: '2025-10-05' }, 'work'),
   [{ year: 2025, share: 1, spread: false, from: '2025-10-05', to: '2025-10-05' }],
   'no work date falls back to the invoice date - the 2,625 already filed do not move')

eq(yearShares({ invoice_date: null }, 'work'), [],
   'and an invoice with no date at all belongs to no year, rather than to this one')

/* `work_to` ALONE IS NOT A SPAN. One date is a reading; a span is only a span
 * when both ends are stated. */
eq(workSpan({ work_from: '2024-03-11' }).stated, false, 'one date is not a span')
eq(workSpan({ work_from: '2024-03-11', work_to: '2024-03-28' }).stated, true, 'two dates are')

/* NOTHING IS REVERSED. Which of the two dates is wrong is not knowable — the
 * same rule the page numbers follow. */
eq(workSpan({ work_from: '2024-06-01', work_to: '2024-01-01' }), null,
   'a span that ends before it starts is refused, never swapped round')
eq(yearShares({ invoice_date: '2025-10-05', work_from: '2024-06-01', work_to: '2024-01-01' }, 'work'),
   [{ year: 2025, share: 1, spread: false, from: '2025-10-05', to: '2025-10-05' }],
   'and it falls back to the invoice date rather than disappearing')

// A span inside one year is that year, whole — nothing was divided.
{
  const sh = yearShares({ work_from: '2024-03-01', work_to: '2024-05-31' }, 'work')
  eq(sh.length, 1, 'a span inside one year is one year')
  eq(sh[0].spread, false, 'and is NOT reported as spread, because nothing was divided')
}

// ---- ONLY A CROSSING SPAN IS DIVIDED -------------------------------------
{
  // 2024-12-17 → 2025-01-15: 15 days in 2024, 15 in 2025.
  const sh = yearShares({ work_from: '2024-12-17', work_to: '2025-01-15' }, 'work')
  eq(sh.map((s) => s.year), [2024, 2025], 'a job over the new year is in both years')
  near(sh[0].share, 0.5, 'and half in each, pro rata by days')
  near(sh.reduce((t, s) => t + s.share, 0), 1,
       'THE SHARES MUST ADD TO EXACTLY ONE or a year quietly gains or loses money')
  ok(sh.every((s) => s.spread), 'both portions say they were apportioned rather than read')

  /* EACH PORTION CARRIES ITS OWN DATES. The 2025 portion begins on 1 January,
     not on the invoice's own start date — a report cutting 2025 at August has
     to keep a January-to-March portion that sits squarely inside its window. */
  eq(sh[1].from, '2025-01-01', 'the second year of a span starts on 1 January')
  eq(sh[0].to, '2024-12-31', 'and the first ends on 31 December')
}

eq(workLabel({ work_from: '2024-03-11', work_to: '2024-03-28' }), '2024-03-11 → 2024-03-28',
   'a span reads as a span')
eq(workLabel({ work_from: '2024-03-11' }), '2024-03-11', 'and one date reads as one date')
eq(workLabel({ invoice_date: '2025-10-05' }), '',
   'an invoice with no work date says nothing, rather than repeating the invoice date back')

// ---- WHERE A WORK DATE WOULD ACTUALLY CHANGE THE ANSWER -------------------
/* The real shape: several invoices from one firm on one day, worth real money.
 * There is no point asking for a work date on a £40 box of gloves. */
{
  const trevor = ['3095', '3096', '3097', '3098', '3098b', '3099', '3100'].map((no, i) => ({
    id: 't' + i, supplier_id: 'tm', supplier: 'Trevor McDonald (Marine Engine Services) Ltd',
    invoice_no: no, invoice_date: i === 6 ? '2025-10-08' : '2025-10-05',
    total: [70175.39, 5234.80, 9717.86, 147985.99, 142795.99, 16403.49, 4957.84][i],
    description: 'MAK M20 overhaul',
  }))
  const gloves = [
    { id: 'g1', supplier_id: 'js', supplier: 'John A Smith & Sons', invoice_date: '2025-04-01', total: 40 },
    { id: 'g2', supplier_id: 'js', supplier: 'John A Smith & Sons', invoice_date: '2025-04-01', total: 55 },
  ]
  const lumps = lumpBillings([...trevor, ...gloves])
  eq(lumps.length, 1, 'one firm-day is worth asking about, and the gloves are not')
  eq(lumps[0].count, 6, 'the six billed on the same day')
  near(lumps[0].total, 392313.52, 'worth £392,314 between them', 0.02)

  /* ONCE ANSWERED IT STOPS ASKING. A page that keeps offering a decision
     already made is a page people stop reading. */
  const answered = trevor.map((t) => ({ ...t, work_from: '2024-06-01' }))
  eq(lumpBillings([...answered, ...gloves]).length, 0, 'an invoice with a work date is not offered again')

  const cov = workDateCoverage(trevor)
  eq(cov.withWork, 0, 'none of the seven carries a work date yet')
  eq(cov.total, 7, 'and the page can say so out of how many')
}

// ---- A PART YEAR IS NEVER COMPARED WITH A WHOLE ONE ----------------------
/* THE FAILURE THIS PREVENTS IS THE REAL ONE. The record runs to 26 August 2026
 * and 2026 stands at £693,796 against 2025's £1,312,459 — side by side that
 * reads as spending halving, when it is eight months against twelve. */
{
  const invs = [
    { id: 'a', invoice_date: '2025-03-01', total: 100, supplier_id: 's1' },
    { id: 'b', invoice_date: '2025-11-01', total: 900, supplier_id: 's1' },   // after the cut
    { id: 'c', invoice_date: '2026-03-01', total: 120, supplier_id: 's1' },
  ]
  const sups = [{ id: 's1', name: 'A Firm', category: 'gear' }]
  const d = yearInsight(invs, sups, { year: 2026 })

  ok(d.partial, '2026 is known to be a part year')
  eq(d.reaches, '2026-03-01', 'and the page can say how far the record actually reaches')
  eq(d.total, 120, 'this year to that point')
  eq(d.was, 100,
     'against LAST year to the same point - the £900 of November is not in the comparison')
  eq(d.change, 20, 'so the change is +£20, not -£880')

  /* An earlier year ran its full course whatever the record holds about it. */
  ok(!yearInsight(invs, sups, { year: 2025 }).partial, 'a year already past is not partial')
  eq(yearInsight(invs, sups, { year: 2025 }).total, 1000, 'and is counted whole')
}

// ---- A CATEGORY THAT STOPPED IS THE MOST INTERESTING ROW ------------------
{
  const sups = [
    { id: 's1', name: 'Nets', category: 'gear' },
    { id: 's2', name: 'Yard', category: 'shipyard' },
    { id: 's3', name: 'Quota', category: 'quota' },
  ]
  const invs = [
    { id: '1', invoice_date: '2025-02-01', total: 1000, supplier_id: 's1' },
    { id: '2', invoice_date: '2025-02-01', total: 4000, supplier_id: 's2' },  // yard, last year only
    { id: '3', invoice_date: '2026-02-01', total: 1500, supplier_id: 's1' },
    { id: '4', invoice_date: '2026-02-01', total: 250, supplier_id: 's3' },   // quota, new
  ]
  const d = yearInsight(invs, sups, { year: 2026 })

  eq(d.categories.find((c) => c.key === 'gear').was, 1000, 'a category carries what it was')
  near(d.categories.find((c) => c.key === 'gear').pct, 0.5, 'and how far it has moved')

  const quota = d.categories.find((c) => c.key === 'quota')
  ok(quota.isNew, 'a category that did not exist last year is marked new')
  eq(quota.pct, null,
     'and has NO percentage - nothing to something is not a percentage, however much a chart wants one')

  eq(d.gone.map((g) => g.key), ['shipyard'],
     'a trade that has stopped is reported, and would not appear at all if only this year were listed')
  eq(d.gone[0].was, 4000, 'with what it used to be worth')
}

// ---- THE GRID AGREES WITH ITSELF ON EITHER BASIS -------------------------
{
  const sups = [{ id: 's1', name: 'Engines', category: 'engine' }]
  const invs = [
    { id: '1', supplier_id: 's1', invoice_date: '2025-10-05', total: 1000,
      work_from: '2024-12-17', work_to: '2025-01-15' },
    { id: '2', supplier_id: 's1', invoice_date: '2025-10-05', total: 500 },
  ]

  const byInvoice = categoryMatrix(invs, sups, { on: 'invoice' })
  eq(byInvoice.rows[0].cells[2025], 1500, 'on the invoice basis it is all 2025')
  eq(byInvoice.spread[2025] || 0, 0, 'and none of it is apportioned')

  const byWork = categoryMatrix(invs, sups, { on: 'work' })
  near(byWork.rows[0].cells[2024], 500, 'on the work basis half the spanning job is 2024')
  near(byWork.rows[0].cells[2025], 1000, 'and the other half plus the dated one is 2025')
  near(byWork.spread[2024], 500, 'the year says how much of itself is an apportionment')
  near(byWork.grand, byInvoice.grand,
       'THE MONEY IS THE SAME MONEY either way - only which year it sits in changes')

  /* Counted once however many years it touches: a divided invoice is still one
     document, and counting it twice makes the tally disagree with the file. */
  eq(byWork.rows[0].count, 2, 'a spanning invoice is one invoice, not two')
}

// ---- FINDING ONE INVOICE AMONG 2,625 -------------------------------------
{
  const sups = [{ id: 's1', name: 'Woodsons of Aberdeen Ltd Marine Electronics' }]
  const invs = [
    { id: '1', supplier_id: 's1', invoice_no: 'W-4471', invoice_date: '2024-05-02',
      description: 'Scantrol trawl monitoring sensor repair', total: 5200 },
    { id: '2', supplier_id: 's1', invoice_no: 'W-4472', invoice_date: '2025-05-02',
      description: 'Furuno sounder service', total: 810.5 },
  ]
  const f = (o) => findInvoices(invs, { suppliers: sups, ...o })

  eq(f({ q: 'scantrol' }).count, 1, 'the description is searched, which is why this is worth having')
  eq(f({ q: 'woodsons 2025' }).count, 1,
     'terms are ANDed across every field - the way a person actually types a search')
  eq(f({ q: '5200' }).count, 1, 'and the amount finds its invoice')
  eq(f({ q: 'W4471' }).count, 1, 'punctuation does not have to be typed the way the model wrote it')
  eq(f({ q: 'woodsons of aberdeen' }).count, 2, 'a firm name spanning words still matches')

  /* AN UNMATCHED TERM RETURNS NOTHING. "No invoice says that" is an answer; a
     full list handed back as a result is not. */
  eq(f({ q: 'kongsberg' }).count, 0, 'a term that matches nothing returns nothing, never everything')

  near(f({ q: 'woodsons' }).total, 6010.5, 'and what the matches are worth')
  eq(f({ q: '', sort: 'amount', dir: 'desc' }).rows[0].id, '1', 'sorted by amount')
  eq(f({ min: 1000 }).count, 1, 'and filtered by size')

  ok(matchesQuery(invs[0], '', undefined), 'an empty search matches everything, as a blank box should')

  /* TERMS ARE SPLIT ON WHITESPACE, and this check exists because they once were
     not: a heredoc ate the backslash out of the split pattern, leaving it
     splitting on the LETTER "s". Every other search in this file still passed —
     "scantrol" became "cantrol" and matched anyway — so the fault was invisible
     from the outside and only visible in the source. This is the query that
     tells the two apart: split properly it is one term nothing contains, and
     split on "s" it collapses to "o" and matches everything. */
  eq(f({ q: 'sos' }).count, 0, 'a term is a term, split on spaces and nothing else')
}

// ---- ODDS AND ENDS -------------------------------------------------------
eq(recordReaches([{ invoice_date: '2026-08-26' }, { invoice_date: '2020-01-01' }]), '2026-08-26',
   'the record reaches as far as its latest invoice')
eq(yearsCovered([{ invoice_date: '2026-08-26' }, { invoice_date: '2020-01-01' }]), [2026, 2020],
   'and covers those years, newest first')
eq(slicesForYear([{ invoice_date: '2026-01-01', total: 10 }], 2026)[0].amount, 10,
   'a whole invoice is a whole slice')


/* ---- AN INVOICE THAT IS ALREADY ON FILE ---------------------------------
 *
 * Swept out of the real record Sep 2026: 60 groups, 61 rows, £240,015.96
 * counted twice. Not a reader fault and not a double upload — no two bundles
 * even share a file name. It is the approval run:
 *
 *   Inverboyndie INV-0114, £34,971.60 dated 19 May 2023, is in the bundles of
 *   6 June, 13 June AND 19 June — three consecutive Mondays, because it had
 *   not been approved yet.
 *
 * The office is right to re-send and is not going to stop, so the app catches
 * it. These are the real rows.
 */
{
  const filed = [
    { id: 'a', batch_id: 'jun06', supplier: 'Inverboyndie Trawls LLP',
      invoice_no: 'INV-0114', invoice_date: '2023-05-19', total: 34971.60 },
    { id: 'b', batch_id: 'jun13', supplier: 'Inverboyndie Trawls LLP',
      invoice_no: 'INV-0114', invoice_date: '2023-05-19', total: 34971.60 },
    { id: 'c', batch_id: 'sep02', supplier: 'Jackson Trawls Ltd',
      invoice_no: 'TPSI004203', invoice_date: '2021-10-04', total: 6534 },
  ]

  const rows = [
    /* The same invoice a third time, in the bundle of 19 June. */
    { supplier: 'Inverboyndie Trawls LLP', invoice_no: 'INV-0114',
      invoice_date: '2023-05-19', total: 34971.60 },
    /* Genuinely new. */
    { supplier: 'Macduff Shipyards Ltd', invoice_no: 'V119300',
      invoice_date: '2025-10-02', total: 350.26 },
  ]

  const r = checkForDuplicates(rows, filed)
  eq(r.found.length, 1, 'the invoice already filed twice is caught the third time')
  eq(r.found[0].kind, 'certain',
     'and CERTAIN, because the firm, the number, the date and the amount all agree')
  eq(r.found[0].hits.length, 2, 'naming both copies already on file')
  near(r.value, 34971.60, 'and what filing it again would cost')
  eq(r.found[0].index, 0, 'by position, so the page can flag the right row')

  /* THE FIRM GOES THROUGH normaliseSupplier, and it earns its keep here more
     than anywhere: the name is the half that comes off a photograph. "Macduff
     Shipyards Limited" and "Macduff Shipyards Ltd" are both in the real record
     for the same firm. */
  const drift = checkForDuplicates(
    [{ supplier: 'INVERBOYNDIE TRAWLS', invoice_no: 'inv/0114',
       invoice_date: '2023-05-19', total: 34971.60 }], filed)
  eq(drift.found.length, 1,
     'a firm written differently and a number punctuated differently still match')

  /* THE BUNDLE BEING SAVED IS NOT ITS OWN DUPLICATE. Re-reading a bundle
     replaces its invoices, so without this every row of it would light up. */
  const reread = checkForDuplicates(
    [{ supplier: 'Jackson Trawls Ltd', invoice_no: 'TPSI004203',
       invoice_date: '2021-10-04', total: 6534 }], filed, { ignoreBatch: 'sep02' })
  eq(reread.found.length, 0, 'a bundle re-read does not flag its own invoices')

  /* 3098 / 3098b: same firm and number, DIFFERENT amount. That is a reissue,
     not the same paper — a different claim, so it is not made to look alike. */
  const reissue = checkForDuplicates(
    [{ supplier: 'Inverboyndie Trawls LLP', invoice_no: 'INV-0114',
       invoice_date: '2023-05-19', total: 29781.60 }], filed)
  eq(reissue.found[0].kind, 'similar', 'a different amount under the same number is SIMILAR')
  ok(reissue.found[0].kind !== 'certain', 'and never claimed as the same paper')

  /* SIX OF THE SIXTY GROUPS WERE ONE BUNDLE READ TWICE, which checking against
     the database alone would miss — nothing is on file yet. */
  const twice = checkForDuplicates([
    { supplier: 'New Firm Ltd', invoice_no: 'X-1', invoice_date: '2026-01-01', total: 100 },
    { supplier: 'New Firm Ltd', invoice_no: 'X-1', invoice_date: '2026-01-01', total: 100 },
  ], [])
  eq(twice.found.length, 1, 'the same invoice twice in one read is caught')
  eq(twice.found[0].kind, 'within', 'and named as this bundle carrying it twice')
  eq(twice.found[0].at, 0, 'pointing at the row it repeats')

  /* AN INVOICE WITH NO NUMBER STILL CANNOT BE MATCHED ON ONE — docKey needs a
     number and there is none, so `certain` and `similar` are both out of reach.
     THE ASSERTION HERE USED TO BE THAT NOTHING WAS REPORTED AT ALL, on the
     reasoning that guessing from amount and date would flag a firm's monthly £40
     box of gloves every time. Half of that was right and half was wrong: opening
     the scans in Sep 2026 turned up three real duplicates that no number-based
     check could see, one of them C & I Hydraulics at £187.10 — read as DFC12265
     on one scan and with no number at all on the other. So it is reported, as
     the weakest kind, and the DATE is what keeps the gloves quiet: a monthly
     charge lands on a different day each time. */
  const noNumber = checkForDuplicates(
    [{ supplier: 'Inverboyndie Trawls LLP', invoice_no: '', invoice_date: '2023-05-19', total: 34971.60 }],
    filed)
  eq(noNumber.certain, 0, 'no invoice number means no claim on the number')
  eq(noNumber.similar, 0, 'nor the weaker one that still rests on a number')
  eq(noNumber.sameamount, 1, 'but the same firm and amount on that day is worth saying')
  eq(docKey({ supplier: 'A Firm', invoice_no: null }), null, 'and there is still no key at all')

  /* THE GLOVES. Same firm, same amount, ANOTHER DAY — silence, which is the
     whole reason the date is in the rule. */
  const gloves = checkForDuplicates(
    [{ supplier: 'Inverboyndie Trawls LLP', invoice_no: '', invoice_date: '2023-06-19', total: 34971.60 }],
    filed)
  eq(gloves.found.length, 0, 'the same amount on another date is left alone')
}


console.log('invoice dashboard: ' + n + ' checks passed')
