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
  addsWrong, explainReadError,
} from './src/lib/invoices/periods.js'

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

console.log('boat invoices: ' + n + ' checks passed')
