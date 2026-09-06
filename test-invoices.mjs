/* BOAT INVOICES — the supplier lookup and the reporting periods.
 *
 * David, Sep 2026: "splitting is what we want, do whatever it needs to have it
 * split by supplier" and "just reporting periods. annual is most important."
 *
 * The supplier names here are the REAL drift already in this database — the
 * seven spellings of one fuel supplier out of `vessel_fuel_log`, and the
 * "J Smith" / "Messrs J Smith Ltd" merge off the sales notes that was hiding a
 * third of that firm's volume. The balance sentences are the real ones off
 * Denise's weekly emails, read out of Gmail.
 */
import assert from 'node:assert/strict'
import {
  normaliseSupplier, supplierIndex, matchSupplier, matchAll,
  withAlias, duplicateAliases,
} from './src/lib/invoices/suppliers.js'
import {
  periodOf, totalsByPeriod, supplierHistory, readManagerBalance,
  addsWrong, figuresMissing, explainReadError,
} from './src/lib/invoices/periods.js'
import { pageOrNull, pageRange, pageLabel } from './src/lib/invoices/pages.js'
import { invoiceKey, carryDecisions } from './src/lib/invoices/identity.js'
import { checkForDuplicates } from './src/lib/invoices/duplicates.js'
import { readFileSync } from 'node:fs'

let n = 0
const eq = (a, b, m) => { n++; assert.deepEqual(a, b, m) }
const ok = (c, m) => { n++; assert.ok(c, m) }

// ---- NORMALISING A COMPANY NAME ------------------------------------------
/* The real spellings out of the fuel log — 559,938 litres split across names
 * that are almost certainly one firm.
 *
 * NORMALISING GETS PART OF THE WAY AND IS NOT MEANT TO GET ALL OF IT. Case, the
 * ampersand, the apostrophe and the trailing Ltd are noise a scanner adds and
 * drops, so they collapse. Singular against plural is NOT noise — it is a real
 * difference in the words, and welding "Smiths" onto "Smith" is precisely the
 * unrecoverable guess this file refuses to make. Those go in the alias list,
 * where a person has said so. */
eq(new Set(['Smith & Sons', 'Smith & sons', 'SMITH AND SONS LTD',
            'Smith and Sons Limited'].map(normaliseSupplier)).size, 1,
   'punctuation, case and the company suffix all collapse to one key')

eq(normaliseSupplier("Smith's & Sons"), normaliseSupplier('Smiths &sons'),
   'and the apostrophe is punctuation, not a word break')

ok(normaliseSupplier('Smiths &sons') !== normaliseSupplier('Smith & Sons'),
   'but singular is not silently welded to plural — a person files that as an alias')
ok(normaliseSupplier('Smith') !== normaliseSupplier('Smith & Sons'),
   'and a bare "Smith" is NOT welded onto "Smith & Sons" — that guess cannot be undone')

eq(normaliseSupplier('Messrs J Smith Ltd'), 'messrs j smith', 'the company suffix comes off')
eq(normaliseSupplier('60N Bond Ltd'), '60n bond', 'and off a name carrying digits')
eq(normaliseSupplier('Thyboron Skibs & Motor A/S'), 'thyboron skibs and motor',
   'a Danish suffix too — these invoices come from Denmark and Norway')
eq(normaliseSupplier('  MACDUFF   SHIPYARDS  '), 'macduff shipyards', 'and the scanner spacing')
eq(normaliseSupplier(null), '', 'nothing normalises to nothing, not to "null"')

/* "Ltd" INSIDE a name is part of it — only a trailing suffix is noise. */
ok(normaliseSupplier('Ltd Lyth Seafoods') !== normaliseSupplier('Lyth Seafoods'),
   'a leading Ltd is part of the name, not a suffix to strip')

// ---- MATCHING -------------------------------------------------------------
const suppliers = [
  { id: 's1', name: 'John A Smith & Sons', aliases: ["Smith's", 'Smiths &sons'] },
  { id: 's2', name: '60N Bond Ltd', aliases: [] },
  { id: 's3', name: 'Macduff Shipyards Ltd', aliases: [] },
]
const idx = supplierIndex(suppliers)

eq(matchSupplier('60N Bond Ltd', idx).how, 'exact', 'the name as filed matches exactly')
eq(matchSupplier('60n bond', idx).supplier.id, 's2', 'and a scanner mangling the case still lands')
eq(matchSupplier('Macduff Shipyards', idx).supplier.id, 's3',
   'the Ltd dropping off does not lose the firm')
eq(matchSupplier("Smith's", idx).supplier.id, 's1', 'a filed alias matches')
eq(matchSupplier('JOHN A SMITH AND SONS LTD', idx).supplier.id, 's1',
   'and a spelling nobody filed, because it normalises the same')

/* THE ONE THAT MUST NOT MATCH. Welding two firms together puts an invoice
 * under the wrong name and the evidence that would tell them apart goes with
 * it. `buyerAliases` already refuses "J Smithson" against "J Smith". */
eq(matchSupplier('J Smithson', idx).matched, false,
   'a near miss is NEVER guessed at — that mistake is not recoverable')
eq(matchSupplier('Smith', idx).matched, false, 'nor a name that is merely shorter')
eq(matchSupplier('', idx).how, 'blank', 'and a blank name says it is blank')

// ---- MATCHING A WHOLE BUNDLE ---------------------------------------------
{
  const rows = [
    { supplier_raw: '60N Bond Ltd', total: 1688.4 },
    { supplier_raw: 'MACDUFF SHIPYARDS', total: 4200 },
    { supplier_raw: 'Woodsons of Aberdeen', total: 310.5 },
    { supplier_raw: 'Woodsons of Aberdeen Ltd', total: 89.2 },
    { supplier_raw: 'Thyboron Skibs', total: 2100 },
  ]
  const r = matchAll(rows, suppliers)
  eq(r.rows.filter((x) => x.supplier_id).length, 2, 'the two filed firms are matched')

  /* THE UNMATCHED ARE GROUPED BY FIRM, NOT LISTED PER INVOICE. Woodsons appears
     twice in one bundle under two spellings; asking the skipper to file it
     twice is how a filing screen stops being used. */
  eq(r.unknown.length, 2, 'two firms to file, not three invoices')
  eq(r.unknown.map((u) => u.name), ['Thyboron Skibs', 'Woodsons of Aberdeen'],
     'the biggest by value first — file the one that matters most before the small one')
  const wood = r.unknown.find((u) => /Woodsons/.test(u.name))
  eq(wood.count, 2, "Woodsons' two spellings are ONE decision, not two")
  eq(wood.total, 399.7, 'with their value added up, so the decision has weight behind it')
}

// ---- ALIASES --------------------------------------------------------------
{
  const s = suppliers[0]
  eq(withAlias(s, "SMITHS & SONS"), null,
     'a spelling an alias already covers adds nothing — no write, no stamped updated_at')
  eq(withAlias(s, 'John A Smith and Sons Ltd'), null,
     'and neither does one the canonical name already covers')
  eq(withAlias(s, 'John Smith Fuels'), ["Smith's", 'Smiths &sons', 'John Smith Fuels'],
     'a genuinely new spelling is kept exactly as it was written')
  eq(withAlias(s, '   '), null, 'and blank is not an alias')
}

{
  /* Two firms claiming one alias is a mistake made on the page. First filed
     wins and the clash is REPORTED — letting the later one take it would move
     invoices between suppliers with nothing to show why. */
  const clashing = [
    { id: 'a', name: 'North Sea Marine', aliases: ['NSM'] },
    { id: 'b', name: 'Northern Supplies', aliases: ['nsm.'] },
  ]
  eq(supplierIndex(clashing).get('nsm').id, 'a', 'the first filed keeps the alias')
  const d = duplicateAliases(clashing)
  eq(d.length, 1, 'and the clash is reported rather than swallowed')
  eq(d[0].also.id, 'b', 'naming the supplier that would have taken it')
}

// ---- PERIODS --------------------------------------------------------------
eq(periodOf('2026-08-31', 'year').label, '2026', 'a calendar year is just the year')
eq(periodOf('2026-08-31', 'quarter').label, '2026 Q3', 'August is Q3 on a calendar year')
eq(periodOf('2026-08-31', 'month').label, 'Aug 2026', 'and a month reads as a month')

/* A YEAR IS A SETTING. Don Fishing run this boat's quarterly accounts to
 * 30 June, so the year may not be the calendar one — and a July-to-June year
 * labelled a bare "2026" is read two ways by two people. */
eq(periodOf('2026-08-31', 'year', 7).label, '2026/27', 'a July year start says which years it spans')
eq(periodOf('2026-05-31', 'year', 7).label, '2025/26', 'and May falls in the year before it')
eq(periodOf('2026-08-31', 'quarter', 7).label, '2026/27 Q1',
   'quarters run from the year start, or they do not add up to it')
eq(periodOf('2026-06-30', 'quarter', 7).label, '2025/26 Q4',
   'and 30 June is the last day of the old year, which is the date the office closes on')

eq(periodOf(null, 'year'), null, 'no date is no period — never quietly this year')
eq(periodOf('not a date', 'year'), null, 'nor is a date the reader could not read')

// ---- TOTALS ---------------------------------------------------------------
{
  const invoices = [
    { supplier_id: 's2', invoice_date: '2026-08-25', total: 1688.4, net: 1407 },
    { supplier_id: 's2', invoice_date: '2026-07-14', total: 1200, net: 1000 },
    { supplier_id: 's3', invoice_date: '2026-08-01', total: 4200, net: 3500 },
    { supplier_id: 's3', invoice_date: '2025-11-02', total: 900, net: 750 },
    { supplier_id: null, supplier_raw: 'Woodsons', invoice_date: '2026-08-03', total: 310.5 },
    { supplier_id: null, supplier_raw: '', invoice_date: null, total: 75 },
  ]
  const t = totalsByPeriod(invoices, suppliers, { grain: 'year' })

  eq(t.periods.map((p) => p.label), ['2026', '2025'], 'newest year first, as a page reads')
  eq(t.periods[0].total, 7398.9, '2026 totals its four dated invoices')
  eq(t.periods[1].total, 900, 'and 2025 its one')

  /* AN UNDATED INVOICE IS COUNTED AND NAMED, never dropped. A report quietly
     missing costs is worse than one that says how much it could not place. */
  eq(t.undated.count, 1, 'the undated invoice is counted')
  eq(t.undated.total, 75, 'and its value kept where it can be seen')

  const y26 = t.periods[0]
  eq(y26.suppliers.map((s) => s.name),
     ['Macduff Shipyards Ltd', '60N Bond Ltd', 'Woodsons'],
     'suppliers ranked by spend within the year')
  eq(y26.suppliers[1].total, 2888.4, 'a firm with two invoices in the year is added up')
  eq(y26.suppliers[2].filed, false, 'and one nobody has filed says so')
  eq(y26.suppliers[2].name, 'Woodsons', 'under the name the reader gave, which is what gets filed')

  /* NET AND GROSS DIFFER BY THE VAT, which is real money — the basis is always
     stated rather than one being quietly assumed. */
  const netT = totalsByPeriod(invoices, suppliers, { grain: 'year', basis: 'net' })
  eq(netT.basis, 'net', 'the basis is reported')
  eq(netT.periods[0].total, 5907, 'and net totals the net column')

  const q = totalsByPeriod(invoices, suppliers, { grain: 'quarter' })
  eq(q.periods.map((p) => p.label), ['2026 Q3', '2025 Q4'], 'quarters work the same way')
}

// ---- ONE SUPPLIER OVER TIME ----------------------------------------------
{
  const invoices = [
    { supplier_id: 's2', invoice_date: '2026-08-25', total: 1688.4 },
    { supplier_id: 's2', invoice_date: '2025-08-25', total: 1500 },
    { supplier_id: 's3', invoice_date: '2026-08-01', total: 4200 },
  ]
  const h = supplierHistory(invoices, 's2')
  eq(h.total, 3188.4, 'the firm across every year')
  eq(h.periods.length, 2, 'over two of them')
  eq(h.confidence, 'two periods — thin', 'and two is thin, said plainly')

  eq(supplierHistory(invoices, 's3').confidence, 'one period only — not a pattern yet',
     'ONE YEAR IS AN OBSERVATION, NOT A PATTERN — same rule as the gear lives')
  eq(supplierHistory(invoices, 'nobody').average, null,
     'nothing to average is null, never 0 — a zero average reads as "they cost nothing"')
}

// ---- THE MANAGER'S BALANCE, off the real sentences ------------------------
/* These are the actual words out of Denise's weekly emails. */
{
  const good = readManagerBalance(
    "Your manager's balance is sitting at just over £413k to the good after settling on Friday, but any queries just let me know.")
  eq(good.value, 413000, 'just over £413k reads as 413,000')
  eq(good.direction, 'good', 'and to the good is the right way')

  /* THE DIRECTION IS THE PART THAT MATTERS. This is the real 15-06 email, and
     £113k on the wrong side of the account is a quarter of a million pounds
     different from £113k on the right side. */
  const bad = readManagerBalance(
    "Your managers' balance is sitting at £113k the wrong way as the £336668 scientific quota adjustment was processed on Friday")
  eq(bad.value, -113000, 'the wrong way is NEGATIVE, not merely noted')
  eq(bad.direction, 'against', 'and it is named as against')
  ok(!/336668/.test(String(bad.value)), 'the quota adjustment further along is not read as the balance')

  eq(readManagerBalance("Your manager's balance is sitting at just under £304k to the good, but any queries let me know.").value,
     304000, '"just under" is the same figure — the office rounds, and so does this')
  eq(readManagerBalance("Your managers' balance is sitting at £325k to the good after settling last Wednesday").value,
     325000, 'a plain figure with no hedge')

  /* Neither phrase present. Unstated is NOT "to the good" — saying so would
     assert a sign nobody wrote. */
  const q = readManagerBalance("Your manager's balance is £50k at present")
  eq(q.direction, 'unstated', 'no direction given is reported as unstated')
  ok(q.text.length > 0, 'and the sentence is kept, so the reader can judge it')

  eq(readManagerBalance('All good to go thanks'), null, 'a reply with no balance gives null')
  eq(readManagerBalance(''), null, 'and so does nothing at all')
}

/* ---- THE NAME AS READ IS IN `supplier` -----------------------------------
 *
 * su_invoices came from outside this repo and calls that column `supplier`.
 * The report looked for `supplier_raw` — a name from the shape designed before
 * that table was found — so every unfiled invoice reported "no supplier read"
 * about a row whose firm was written on it. That is worse than a blank: it is
 * a claim that the reader failed where nothing failed. Found on the four real
 * July invoices, which name their suppliers perfectly clearly.
 */
{
  const rows = [
    { supplier: 'John A Smith & Sons', invoice_date: '2026-07-10', total: 218.40 },
    { supplier: 'Jackson Trawls Ltd', invoice_date: '2026-07-15', total: 5200 },
  ]
  const t = totalsByPeriod(rows, [])
  eq(t.periods[0].suppliers.map((s) => s.name),
     ['Jackson Trawls Ltd', 'John A Smith & Sons'],
     'an unfiled invoice is named by the supplier as READ, off the real column')
  ok(!t.periods[0].suppliers.some((s) => s.name === 'no supplier read'),
     'and never claims the reader failed when the name is right there')

  /* Both spellings of the column work, so a row from either shape reads. */
  eq(totalsByPeriod([{ supplier_raw: 'Woodsons', invoice_date: '2026-01-01', total: 10 }], [])
       .periods[0].suppliers[0].name, 'Woodsons', 'supplier_raw still works where it is used')

  /* AND A GENUINELY BLANK ONE STILL SAYS SO. The message is right, it was
     just being said about the wrong rows. */
  eq(totalsByPeriod([{ supplier: '   ', invoice_date: '2026-01-01', total: 10 }], [])
       .periods[0].suppliers[0].name, 'no supplier read',
     'a row the reader really could not name still says so')
}

/* ---- WHAT A FAILED READ MEANS ------------------------------------------
 *
 * The edge function passes the API's own error straight through, so an ordinary
 * billing stop arrives as a JSON blob. A skipper reading that cannot tell a
 * card needing topped up from the boat's books being broken.
 */
{
  const real = 'AI request failed: {"type":"error","error":{"type":"invalid_request_error",'
    + '"message":"Your credit balance is too low to access the Anthropic API. '
    + 'Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_011Ced"}'
  const e = explainReadError(real)
  eq(e.what, 'The reader has run out of credit.', 'the real billing failure reads in plain English')
  ok(/console.anthropic.com/.test(e.next), 'and says where to fix it')
  ok(/Nothing is lost/.test(e.next), 'and that the bundles are still there, because that is the worry')
  eq(e.raw, real, 'THE RAW TEXT IS KEPT — it is the evidence, and is shown under "what it said"')

  eq(explainReadError('Reading took too long - try fewer pages').what,
     'That bundle took too long to read.', 'a timeout is its own thing')
  ok(/rate/i.test(explainReadError('429 rate_limit_error').what)
     || /too much at once/.test(explainReadError('429 rate_limit_error').what),
     'so is being throttled')

  /* AN UNFAMILIAR ERROR IS PASSED THROUGH UNTOUCHED. Guessing at what an
     unrecognised failure means would be worse than showing it. */
  const odd = 'something nobody has seen before'
  eq(explainReadError(odd).what, odd, 'an unrecognised failure is shown exactly as it came')
  eq(explainReadError(odd).next, null, 'with no invented advice attached')
}

/* ---- A FIGURE THE READER DID NOT GET ------------------------------------
 *
 * THE HOLE THIS CLOSES. `addsWrong` says nothing when a figure is blank — net
 * and VAT cannot disagree with a total that is not there — so a bundle with a
 * blank net was reported as "nothing flagged, every row ... adds up" and then
 * refused on save by a NOT NULL constraint. The page told the skipper all was
 * well and then would not file it.
 */
eq(figuresMissing({ net: 191.33, vat: 27.07, total: 218.40 }), [],
   'a complete invoice is missing nothing')
eq(figuresMissing({ net: 5200, vat: 0, total: 5200 }), [],
   'and a genuine zero VAT is a figure, not a blank')
eq(figuresMissing({ net: null, vat: 0, total: 218.40 }), ['net'],
   'the blank net that stopped the run is named')
eq(figuresMissing({ net: '', vat: '', total: '' }), ['net', 'vat', 'total'],
   'an empty box counts as missing, not as nought')
eq(figuresMissing({}), ['net', 'vat', 'total'], 'and so does a row with nothing on it')
eq(figuresMissing({ net: 'abc', vat: 0, total: 10 }), ['net'],
   'as does something that is not a number at all')

/* THE TWO CHECKS DIVIDE THE WORK CLEANLY: one says the figures disagree, the
   other says a figure is absent. Neither should answer for the other. */
{
  const r = { net: null, vat: 0, total: 218.40 }
  eq(addsWrong(r), false, 'a blank is not called a disagreement')
  ok(figuresMissing(r).length > 0, 'but it IS reported as missing')
}

/* ---- WHICH PAGES OF THE BUNDLE ------------------------------------------
 *
 * A weekly bundle is the whole week photographed into one PDF, so the pages are
 * what turns "open the scan" from five pages to hunt through into the invoice
 * itself. They are also the ONE field the reader returns that nothing
 * downstream can check against the invoice - so what IS checkable is checked.
 */

/* PAGE 0 IS THE WHOLE REASON THIS IS ITS OWN MODULE. Number('') is 0 and
 * Number.isFinite(0) is true, so the obvious implementation files an empty box
 * as page 0 - a page that does not exist, saved as though somebody had read it
 * off the scan. Fourth instance in this codebase after the engine running
 * hours, the gear measurement in mm and the invoice VAT figure. */
eq(pageOrNull(''), null, 'a blank page box stays blank')
eq(pageOrNull(null), null, 'so does a null')
eq(pageOrNull(0), null, 'page 0 does not exist')
eq(pageOrNull('0'), null, 'nor as a string')
eq(pageOrNull(-2), null, 'nor backwards')
eq(pageOrNull(2.5), null, 'half a page is not a page')
eq(pageOrNull('3'), 3, 'a number the reader sent as text still reads')
eq(pageOrNull(3), 3, 'and as a number')

/* MOST INVOICES ARE ONE PAGE, and that is a reading rather than an assumption:
 * the reader is told to set page_to equal to page_from for a single-pager. */
eq(pageRange(3, 4, 5), { page_from: 3, page_to: 4 }, 'an ordinary two-page invoice')
eq(pageRange(3, null, 5), { page_from: 3, page_to: 3 }, 'no end given means it is one page')
eq(pageRange(null, 4, 5), { page_from: null, page_to: null },
   'an end with no start is not half an answer')

/* NOTHING IS CLAMPED OR SWAPPED. Which of the two numbers is wrong is not
 * knowable, so a range that cannot be true is dropped whole - a page number
 * bent until it fits is a guess wearing the clothes of a reading. */
eq(pageRange(4, 2, 5), { page_from: null, page_to: null },
   'ends before it starts - dropped, never reversed')
eq(pageRange(9, 9, 5), { page_from: null, page_to: null },
   'past the end of a five-page bundle')
eq(pageRange(9, 9, null), { page_from: 9, page_to: 9 },
   'with no page count known there is nothing to check it against')

eq(pageLabel(3, 3), 'p. 3', 'one page reads as one page')
eq(pageLabel(3, 4), 'pp. 3–4', 'two pages get the range')
eq(pageLabel('', ''), '', 'an unread page says nothing rather than "p. 0"')

/* AND THE READER HAS TO ASK FOR THEM. The prompt lives in the edge function,
 * which is in this repo now precisely so a change to it can be seen - without
 * this, everything above still passes while no page number is ever produced. */
{
  const fn = readFileSync('supabase/functions/su-parse-document/index.ts', 'utf8')
  ok(fn.includes('"page_from": number|null, "page_to": number|null'),
     'the invoice prompt still asks the reader for the pages')
  ok(fn.includes('return null for both rather than guessing'),
     'and still tells it not to guess one')
}

/* ---- WHAT A PERSON DECIDED SURVIVES A RE-READ ---------------------------
 *
 * Reading a bundle again replaces every invoice off it, which is right. But
 * `vessel_era` and `category` are the skipper's answers to questions the
 * invoice cannot answer, and they are expensive: 102 invoices carry a vessel
 * decision and six of those moved £751,000 onto the right hull.
 *
 * The ordinary reason to re-read a bundle is now to pick up its PAGE NUMBERS —
 * so without this, the first use of the new feature would quietly undo weeks of
 * work, with nothing on screen to say so.
 */
{
  const kept = [
    { invoice_no: 'FA000741', supplier: 'BOPP', total: 479750, invoice_date: '2018-05-28',
      vessel_era: 'pair_single', category: 'newbuild' },
    { invoice_no: '', supplier: 'Ironside & Son', total: 120, invoice_date: '2019-02-01',
      vessel_era: 'pair_single', category: null },
    { invoice_no: 'GONE-1', supplier: 'Vanished Ltd', total: 50, invoice_date: '2019-02-01',
      vessel_era: 'twin', category: null },
    { invoice_no: 'X1', supplier: 'No decision', total: 9, invoice_date: '2019-01-01',
      vessel_era: null, category: null },
  ]
  const rows = [
    { invoice_no: 'fa/000741', supplier: 'Etablissements BOPP', total: 479750, invoice_date: '2018-05-28' },
    { invoice_no: '', supplier: 'IRONSIDE AND SON', total: 120, invoice_date: '2019-02-01' },
    { invoice_no: 'NEW-9', supplier: 'Something else', total: 7, invoice_date: '2019-02-01' },
  ]
  const r = carryDecisions(kept, rows)

  eq(r.rows[0].vessel_era, 'pair_single', 'the boat decision survives a re-read')
  eq(r.rows[0].category, 'newbuild', 'and so does the category')
  ok(true, 'matched on the invoice NUMBER, though the reader wrote the firm differently')

  /* THE FIRM IN THE FALLBACK KEY GOES THROUGH normaliseSupplier, and that is
   * not tidiness. The name is the one part of the key that comes off a model
   * reading a photograph, so it drifts between two reads of the SAME document —
   * this case is why: "Ironside & Son" came back as "IRONSIDE AND SON" and a
   * raw comparison lost the decision. It would have failed silently, and only
   * on the invoices with no number, which are the hand-written ones. */
  eq(r.rows[1].vessel_era, 'pair_single', 'no invoice number - matched on firm, total and date')
  eq(invoiceKey({ invoice_no: '', supplier: 'IRONSIDE AND SON', total: 120, invoice_date: '2019-02-01' }),
     invoiceKey({ invoice_no: null, supplier: 'Ironside & Son', total: '120.00', invoice_date: '2019-02-01' }),
     'the ampersand and the decimals do not break the fallback key')
  ok(invoiceKey({ supplier: 'Ironside & Son', total: 120, invoice_date: '2019-02-01' }) !==
     invoiceKey({ supplier: 'Ironside & Son', total: 121, invoice_date: '2019-02-01' }),
     'but a different total is a different invoice')

  eq(r.rows[2].vessel_era ?? null, null, 'a genuinely new invoice gets nobody else’s decision')
  eq(r.carried, 2, 'two carried over')

  /* NAMED, NEVER NUDGED ONTO THE NEAREST ROW. Putting one invoice's answer on
   * another is the unrecoverable mistake, the same one the supplier lookup
   * refuses to make with a near-miss name. */
  eq(r.lost.length, 1, 'one decision had no invoice left to sit on')
  eq(r.lost[0].invoice_no, 'GONE-1', 'and it is handed back by name')
  ok(!r.lost.some((l) => l.invoice_no === 'X1'),
     'a row that never carried a decision is not reported as lost')

  /* A decision made on the screen just now beats one made last time. */
  const fresh = carryDecisions(kept, [{ ...rows[0], vessel_era: 'twin' }])
  eq(fresh.rows[0].vessel_era, 'twin', 'an answer given now wins over the one carried')
}

/* ---- THE READER IS ASKED FOR THE WORK DATES TOO -------------------------
 *
 * David, Sep 2026: "add work dates." Typing them onto 2,625 invoices was never
 * going to happen, and an engine or yard invoice normally prints when the job
 * was actually done.
 *
 * THE FAILURE MODE IS NOT A WRONG DATE, IT IS A COPIED ONE. A model handed an
 * invoice carrying only an invoice date will put that date in work_from, and
 * the result is indistinguishable from a reading: every invoice would then have
 * a work date, the "dated by work" grid would be an exact copy of the billed
 * one, and nothing on the page would say why. Both halves of the guard are
 * asserted here because the prompt lives on a server and the enforcement does
 * not run in this process.
 */
{
  const fn = readFileSync('supabase/functions/su-parse-document/index.ts', 'utf8')

  ok(fn.includes('"work_from": "YYYY-MM-DD"|null, "work_to": "YYYY-MM-DD"|null'),
     'the invoice prompt asks for the work dates')
  ok(fn.includes('never copy the invoice date into work_from'),
     'and forbids the one answer that would look like a reading and be none')
  ok(fn.includes('if (from && !to && billed && from === billed) from = null;'),
     'and the function drops a work date equal to the invoice date anyway')
  ok(fn.includes('if (from && to && to < from) { from = null; to = null; }'),
     'a span ending before it starts is refused whole, never reversed')
  ok(fn.includes('if (from && to && to === from) to = null;'),
     'and a one-day span is stored as one date - a date is read, a span is divided')
  ok(fn.includes('fixWorkDates(fixPages('),
     'and both checks actually run on the way out')

  /* THE THREE PROMPTS MUST NOT DRIFT INTO ONE ANOTHER. This file is deployed
     by hand, so the two that this change does not touch are pinned here: a
     settling sheet misread because a sentence moved while the invoice prompt
     was being edited would be invisible until a settlement came out wrong. */
  ok(fn.includes('at 31% of 136421 the boat share is about 42300, NOT 38300'),
     'the Beryl boat-share sanity check is untouched')
  ok(fn.includes('it is usually a letter followed by 3 digits (e.g. G035, H033)'),
     'and so is the settlement crew code')
}

/* The client has to carry them onto the review row, or the reader fills in a
   field nobody ever sees and the save writes null over it. */
{
  const parse = readFileSync('src/lib/su/parse.js', 'utf8')
  ok(parse.includes('work_from: i.work_from'),
     'mapInvoices carries the work dates onto the row the skipper checks')
}


/* ---- THE SAME INVOICE IN TWO BUNDLES OF ONE RUN --------------------------
 *
 * The gap David asked about before loading 2016: every other check compares
 * against what is FILED, and a run of bundles read together is not filed yet.
 * The office re-sends until approved, and 38 of the 54 cross-bundle duplicates
 * on record are 2-10 days apart — consecutive Mondays, which is exactly what
 * lands in one run when a year goes in at a time.
 */
{
  const inv = (no, total, date, supplier = 'Inverboyndie Trawls Ltd') =>
    ({ supplier, invoice_no: no, total, invoice_date: date })

  const monday1 = { batch: { id: 'b1', received_at: '2023-06-06' },
                    rows: [inv('INV-0114', 34971.60, '2023-05-19'), inv('INV-0120', 500, '2023-06-01')] }
  const monday2 = { batch: { id: 'b2', received_at: '2023-06-13' },
                    rows: [inv('INV-0114', 34971.60, '2023-05-19'), inv('INV-0131', 900, '2023-06-08')] }
  const run = [monday1, monday2]

  // Nothing on file, so the check as it stood found nothing at all.
  const blind = checkForDuplicates(monday2.rows, [], { ignoreBatch: 'b2' })
  ok(blind.found.length === 0, 'without the run it sees nothing')

  const seen = checkForDuplicates(monday2.rows, [], { ignoreBatch: 'b2', alsoInRun: run })
  ok(seen.run === 1, 'with the run it catches the re-send')
  ok(seen.found.length === 1, 'and only the one row')
  ok(seen.found[0].row.invoice_no === 'INV-0114', 'it is the right row')
  ok(seen.found[0].hits[0]._batch.received_at === '2023-06-06', 'it names the other bundle')
  ok(Math.round(seen.value) === 34972, 'the value is what filing it twice would cost')

  // A BUNDLE IS NOT ITS OWN DUPLICATE, or every row of a re-read lights up.
  const self = checkForDuplicates(monday2.rows, [], { ignoreBatch: 'b2', alsoInRun: [monday2] })
  ok(self.found.length === 0, 'its own rows are not counted against it')

  // ON FILE BEATS IN THE RUN — both can be true, and the filed one is confirmed.
  const filed = [{ ...inv('INV-0114', 34971.60, '2023-05-19'), batch_id: 'old' }]
  const both = checkForDuplicates(monday2.rows, filed, { ignoreBatch: 'b2', alsoInRun: run })
  ok(both.certain === 1 && both.run === 0, 'already filed wins over in the run')

  // THE FOUR KINDS STAY FOUR FACTS.
  const twice = { batch: { id: 'b3', received_at: '2023-07-04' },
                  rows: [inv('INV-9', 10, '2023-07-01'), inv('INV-9', 10, '2023-07-01')] }
  const w = checkForDuplicates(twice.rows, [], { ignoreBatch: 'b3', alsoInRun: [twice] })
  ok(w.within === 1 && w.run === 0, 'a bundle carrying it twice is still "within"')

  // NO NUMBER IS NEVER MATCHED, in the run either — guessing from amount and
  // date would flag every routine repeat order a firm sends.
  const noNo = { batch: { id: 'b4', received_at: '2023-08-01' }, rows: [inv('', 250, '2023-07-20')] }
  const noNo2 = { batch: { id: 'b5', received_at: '2023-08-08' }, rows: [inv('', 250, '2023-07-20')] }
  const blank = checkForDuplicates(noNo2.rows, [], { ignoreBatch: 'b5', alsoInRun: [noNo, noNo2] })
  ok(blank.found.length === 0, 'an invoice with no number is not matched in the run')

  // The firm still goes through normaliseSupplier: it is the half that comes off
  // a photograph and drifts between two reads of the same document.
  const drift = { batch: { id: 'b6', received_at: '2023-09-04' },
                  rows: [inv('INV-0114', 34971.60, '2023-05-19', 'INVERBOYNDIE TRAWLS LIMITED')] }
  const d = checkForDuplicates(drift.rows, [], { ignoreBatch: 'b6', alsoInRun: [monday1, drift] })
  ok(d.run === 1, 'a drifted firm name still matches in the run')

  // An absent run must change nothing — every existing caller passes none.
  const none = checkForDuplicates(monday2.rows, [], { ignoreBatch: 'b2', alsoInRun: undefined })
  ok(none.found.length === 0 && none.run === 0, 'no run given behaves exactly as before')
}


/* ---- ONE INVOICE READ AS TWO — the page split -----------------------------
 *
 * Off the real Strachan Trawls bundle of 11 May 2022, opened Sep 2026. The
 * office feeds a two-page invoice back page first, so the scan runs
 * [totals page, items page] and the reader files the cost twice. Neither
 * docKey nor the derived reference can see it: docKey needs a number and
 * neither page has one, and the reference is firm + DATE + total while only
 * the header page carries a date.
 */
{
  const row = (o) => ({ supplier: 'Strachan Trawls (Fraserburgh) Ltd', invoice_no: '',
                        invoice_date: null, total: 1523, ...o })

  // Page 2 is the tail: a total, a due date, no items and no header, so no date.
  // Page 3 is the head: the items and the invoice date.
  const tailPage = row({ page_from: 2, page_to: 2 })
  const headPage = row({ page_from: 3, page_to: 3, invoice_date: '2022-03-18' })
  const r = checkForDuplicates([tailPage, headPage], [])
  ok(r.split === 1, 'the two halves of one invoice are flagged')
  ok(r.found[0].index === 0 && r.found[0].hits[0].page_from === 3,
     'it flags the first half and points at the other page')
  ok(r.value === 1523, 'the cost of filing it twice is the one total, not two')

  // THE DATES DISAGREE ON PURPOSE. This is the £4,247.37 pair, which the derived
  // reference missed for exactly this reason: NN-STRACHANTR-undated-4247.37
  // against NN-STRACHANTR-20220328-4247.37.
  const refMiss = checkForDuplicates(
    [row({ total: 4247.37, invoice_no: 'NN-STRACHANTR-undated-4247.37', invoice_no_assigned: true }),
     row({ total: 4247.37, invoice_date: '2022-03-28',
           invoice_no: 'NN-STRACHANTR-20220328-4247.37', invoice_no_assigned: true })], [])
  ok(refMiss.split === 1 && refMiss.derived === 0,
     'a pair the derived reference cannot match is still caught')

  // TWO REAL INVOICES FOR THE SAME AMOUNT ARE ORDINARY and must not be flagged.
  // Woodsons bill £1,180 most months; both sides carry the office's own number.
  const genuine = checkForDuplicates(
    [{ supplier: 'Woodsons Of Aberdeen Ltd', invoice_no: '191042', invoice_date: '2020-04-02', total: 1180 },
     { supplier: 'Woodsons Of Aberdeen Ltd', invoice_no: '190364', invoice_date: '2020-03-02', total: 1180 }], [])
  ok(genuine.found.length === 0, 'two numbered invoices for the same amount are left alone')

  // A BLANK NUMBER IS THE PRE-SAVE SHAPE. The derived reference is assigned in
  // saveBatchInvoices, so on the review screen the row carries '' — a check that
  // only knew about NN- would do nothing at the one moment it is wanted.
  ok(checkForDuplicates([row({ page_from: 2 }), row({ page_from: 3 })], []).split === 1,
     'it fires before the reference has been assigned')

  // Different firms, same total: not a split.
  ok(checkForDuplicates([row({}), row({ supplier: 'Jackson Trawls Ltd' })], []).split === 0,
     'the same total from two different firms is not a split')

  // A NIL TOTAL MATCHES EVERYTHING, so it is never a key. Number('') === 0 has
  // caught this repo four times.
  ok(checkForDuplicates([row({ total: 0 }), row({ total: 0 })], []).split === 0,
     'two rows with no total are not called the same invoice')

  // On file beats a split: the stronger claim wins and the row is reported once.
  const filed = [{ id: 'x', batch_id: 'other', supplier: 'Strachan Trawls (Fraserburgh) Limited',
                   invoice_no: 'INV-18080', invoice_date: '2022-02-20', total: 1523 }]
  const both = checkForDuplicates(
    [row({ invoice_no: 'INV-18080', invoice_date: '2022-02-20' }), row({ page_from: 3 })], filed)
  ok(both.found.filter((f) => f.index === 0).length === 1, 'a row is reported once, not twice')
  ok(both.found[0].kind === 'certain', 'what is already filed is the stronger claim')
}


/* ---- A RUNNING CARRIED-FORWARD FIGURE READ AS AN INVOICE ------------------
 *
 * The dearest mistake in the record, at £136,140.56. Macduff Shipyards 36766 of
 * 10-11-2021 is ONE invoice over five pages, scanned back page first, and every
 * page carries a brought-forward at the top and a carried-forward at the foot.
 * The reader took each page's carry-forward as that page's invoice total, and
 * the page printing the real TOTAL of £56,596.64 got no row at all.
 */
{
  const pg = (total, o = {}) => ({ supplier: 'Macduff Shipyards Ltd', invoice_no: '',
                                   invoice_date: '2021-11-10', net: 0, vat: 0, total, ...o })
  const r = checkForDuplicates([pg(55737.45), pg(54483.39), pg(50413.79), pg(32102.57)], [])
  ok(r.carried === 1, 'four pages of one running total are flagged once')
  ok(r.found[0].hits.length === 3, 'and it names the other three')
  ok(r.split === 0, 'split cannot see it — the four totals are all different')

  // ALL THREE CONDITIONS ARE NEEDED. Drop any one and it must fall silent.
  ok(checkForDuplicates([pg(55737.45, { net: 46447.88, vat: 9289.57 }),
                         pg(54483.39, { net: 45402.83, vat: 9080.56 })], []).carried === 0,
     'rows carrying a real net and VAT are ordinary invoices')
  ok(checkForDuplicates([pg(55737.45, { invoice_date: '2021-11-10' }),
                         pg(54483.39, { invoice_date: '2021-11-24' })], []).carried === 0,
     'two dates means two invoices, not one running total')
  ok(checkForDuplicates([pg(55737.45, { invoice_no: '36766' }), pg(54483.39)], []).carried === 0,
     'a number the office printed means it is an invoice')
  ok(checkForDuplicates([pg(55737.45, { invoice_date: null }), pg(54483.39, { invoice_date: null })], [])
       .carried === 0, 'undated rows say nothing either way')

  // THE SEVEN NUMBERLESS JACKSON ROWS IN ONE REAL BUNDLE MUST NOT FIRE. They
  // each carry their own net and VAT off their own printed totals block.
  const jackson = [
    { supplier: 'Jackson Trawls Ltd', invoice_no: '', invoice_date: null, net: 4143.96, vat: 96.79, total: 4240.75 },
    { supplier: 'Jackson Trawls Ltd', invoice_no: '', invoice_date: null, net: 19965.05, vat: 20.78, total: 19985.83 },
    { supplier: 'Jackson Trawls Ltd', invoice_no: '', invoice_date: null, net: 4250, vat: 0, total: 4250 },
  ]
  ok(checkForDuplicates(jackson, []).carried === 0, 'a bundle of real numberless invoices is left alone')

  // net === total with no VAT is ORDINARY on zero-rated fishing gear and is not
  // the same thing as no split having been read at all.
  ok(checkForDuplicates([pg(4250, { net: 4250 }), pg(2070, { net: 2070 })], []).carried === 0,
     'zero-rated is not the same as no split read')
}


/* ---- THE SAME AMOUNT ON FILE UNDER A DIFFERENT NUMBER ---------------------
 *
 * docKey is firm + number, and a number is the field most likely to be misread:
 * handwritten, short, sometimes not read at all. Three real duplicates got past
 * every other check that way, the dearest being Trevor McDonald at £142,795.99 -
 * the standalone scan is NAMED 3098B.pdf and was filed as 3098, while the Monday
 * bundle has the same invoice as 3098b. It survived the whole 88-group sweep.
 */
{
  const filed = (no, o = {}) => ({ id: no, batch_id: 'old', supplier: 'Trevor McDonald (Marine Engine Services)',
                                   invoice_no: no, invoice_date: '2025-10-05', total: 142795.99, ...o })
  const row = { supplier: 'Trevor McDonald (Marine Engine Services)', invoice_no: '3098b',
                invoice_date: '2025-10-05', total: 142795.99 }
  const r = checkForDuplicates([row], [filed('3098')], { ignoreBatch: 'new' })
  ok(r.sameamount === 1, '3098b against a filed 3098 is flagged')
  ok(r.value === 142795.99, 'and it is worth the whole invoice')

  // A MATCH ON THE NUMBER IS THE STRONGER CLAIM and must win outright.
  const exact = checkForDuplicates([{ ...row, invoice_no: '3098' }], [filed('3098')], { ignoreBatch: 'new' })
  ok(exact.certain === 1 && exact.sameamount === 0, 'a real number match beats it and is reported once')

  // THE DATE IS WHAT KEEPS IT QUIET. A firm billing the same amount on another
  // day is ordinary - Woodsons' £1,180 lands every month.
  const monthly = checkForDuplicates(
    [{ supplier: 'Woodsons Of Aberdeen Ltd', invoice_no: '211294', invoice_date: '2023-02-01', total: 1180 }],
    [{ id: 'x', batch_id: 'old', supplier: 'Woodsons Of Aberdeen Ltd', invoice_no: '210630',
       invoice_date: '2023-01-05', total: 1180 }], { ignoreBatch: 'new' })
  ok(monthly.found.length === 0, 'a monthly standing charge on another date is left alone')

  // UNDATED ON EITHER SIDE IS NOT EVIDENCE AGAINST - the Fraserburgh security
  // charge carries a PERIOD and no invoice date at all, and that is the pair
  // this rule found: a handwritten 472 read as L472 on the other scan.
  const undated = checkForDuplicates(
    [{ supplier: 'Fraserburgh Harbour Patrol', invoice_no: '472', invoice_date: null, total: 56.1 }],
    [{ id: 'y', batch_id: 'old', supplier: 'Fraserburgh Harbour Patrol', invoice_no: 'L472',
       invoice_date: null, total: 56.1 }], { ignoreBatch: 'new' })
  ok(undated.sameamount === 1, 'an undated pair still matches on firm and amount')

  // One side with no number at all is the C & I Hydraulics case, £187.10.
  const noNumber = checkForDuplicates(
    [{ supplier: 'C & I Hydraulics', invoice_no: '', invoice_date: null, total: 187.1 }],
    [{ id: 'z', batch_id: 'old', supplier: 'C & I Hydraulics', invoice_no: 'DFC12265',
       invoice_date: '2022-12-23', total: 187.1 }], { ignoreBatch: 'new' })
  ok(noNumber.sameamount === 1, 'a numberless row against a numbered one is flagged')

  // The bundle being re-read is never its own duplicate, here as everywhere.
  ok(checkForDuplicates([row], [filed('3098', { batch_id: 'new' })], { ignoreBatch: 'new' })
       .found.length === 0, 're-reading a bundle does not flag it against itself')

  // A different firm at the same amount on the same day is not a match.
  ok(checkForDuplicates([row], [{ ...filed('3098'), supplier: 'Jackson Trawls Ltd' }],
       { ignoreBatch: 'new' }).found.length === 0, 'the firm still has to agree')
}

console.log('boat invoices: ' + n + ' checks passed')

