/* CATEGORIES — what the money went on.
 *
 * David, Sep 2026: "catagorize them into catagories. engine repairs, filters,
 * tools, fishing gear, quota, etc, etc."
 *
 * The suppliers below are Audacious's OWN, with what they actually invoice for,
 * out of the database. Guessing at a plausible boat's suppliers would prove
 * nothing — the whole point of a suggestion is that it is right about THIS
 * boat's firms.
 */
import assert from 'node:assert/strict'
import {
  DEFAULT_CATEGORIES, resolveCategories, suggestCategory,
  categoryOf, categoryMatrix, categoryLabel,
} from './src/lib/invoices/categories.js'

let n = 0
const eq = (a, b, m) => { n++; assert.deepEqual(a, b, m) }
const ok = (c, m) => { n++; assert.ok(c, m) }
const key = (name, desc) => suggestCategory(name, desc ? [desc] : [])?.key ?? null

// ---- THE REAL SUPPLIERS ---------------------------------------------------
eq(key('Jackson Trawls Ltd'), 'gear', 'a net loft is fishing gear, off the name alone')
eq(key('Strachan Nets Limited'), 'gear', 'and so is a net company')
eq(key('Aberdeen Fish Producers Organisation (AFPO)'), 'quota', 'the PO is quota')
eq(key('Trevor McDonald (Marine Engine Services) Ltd'), 'engine', 'engine services is engine')
eq(key('J.C Hydraulics Ltd'), 'hydraulics', 'hydraulics is hydraulics')
eq(key('Woodsons of Aberdeen Ltd Marine Electronics'), 'electronics', 'and electronics electronics')
eq(key('Macduff Shipyards Ltd'), 'shipyard', 'the yard is the yard')
eq(key('Premier Refrigeration Ltd'), 'refrig', 'the ice plant')
eq(key('Peterhead Port Authority'), 'harbour', 'the harbour')
eq(key('Marasafe Ltd'), 'safety', 'the safety firm')
eq(key('Kinnaird Travel'), 'travel', 'and the travel agent')

/* THE FIFTH BIGGEST SUPPLIER ON THE BOAT, £616,200 of it, and the name is in
 * French. Without `treuil` it matched nothing and fell through to Electrical
 * off the words "electrical panel" in one description — six hundred thousand
 * pounds of winches filed as electrics. Found only by running the suggester
 * over the REAL supplier list. */
eq(key('Etablissements BOPP Treuils JEB', 'Systeme Scantrol; Electrical panel variation'),
   'hydraulics', 'treuils is winches, and winches are deck hydraulics — not electrical')

/* THE NAME BEATS THE DESCRIPTIONS. A firm called Trawls is a net loft whatever
 * one invoice happened to mention, and descriptions are a model's summary of a
 * photograph, so they drift more than a company name does. */
eq(suggestCategory('Jackson Trawls Ltd', ['1x oil filter for the van']).why, 'the name',
   'the name is weighed first')
eq(key('PBP Services Scotland Ltd', 'Anchor - shot blast, hot metal zinc spray and painted'),
   'shipyard', 'but a firm whose name says nothing is read off what it has sold')

/* NULL IS A PROPER ANSWER. Don Fishing do quota rent, commission and sundry
 * recharges — genuinely ambiguous, and £776k of it. Sweeping that into "Other"
 * would make a guess look like a decision. */
eq(key('The Don Fishing Company Ltd'), null,
   'a firm nothing fits is left for the skipper, NOT swept into Other')
eq(key(''), null, 'and a blank name suggests nothing')

// ---- ORDER MATTERS, same lesson as the crew certificate hints -------------
eq(key('Macduff Diesels Limited'), 'engine',
   'diesels is engine, and must be tested before the broad words catch it')
eq(key('', 'Lease of quota from AFPO - 10t NS COD @ £1,900 per tonne'), 'quota',
   'a quota lease is quota even with no firm named')

// ---- THE CATEGORY AN INVOICE COUNTS UNDER --------------------------------
{
  const sup = new Map([['s1', { id: 's1', name: 'Macduff Shipyards Ltd', category: 'shipyard' }]])
  eq(categoryOf({ supplier_id: 's1' }, sup), 'shipyard', 'an invoice inherits its firm')
  /* THE INVOICE WINS where it differs. The yard does slipping, welding and the
     odd bit of chandlery; the odd bit moves without disturbing the other 177. */
  eq(categoryOf({ supplier_id: 's1', category: 'chandlery' }, sup), 'chandlery',
     'and its own category beats the firmit came from')
  eq(categoryOf({ supplier_id: 'nobody' }, sup), null,
     'a firm with no category leaves the invoice unfiled, never "Other"')
}

// ---- THE MATRIX -----------------------------------------------------------
{
  const suppliers = [
    { id: 'jt', name: 'Jackson Trawls Ltd', category: 'gear' },
    { id: 'af', name: 'AFPO', category: 'quota' },
    { id: 'dn', name: 'Don Fishing', category: null },
  ]
  const invoices = [
    { supplier_id: 'jt', invoice_date: '2026-03-01', total: 5000 },
    { supplier_id: 'jt', invoice_date: '2025-03-01', total: 3000 },
    { supplier_id: 'af', invoice_date: '2026-06-01', total: 2000 },
    { supplier_id: 'dn', invoice_date: '2026-06-01', total: 1000 },
    // No date: kept in its row, counted apart, never guessed into this year.
    { supplier_id: 'jt', invoice_date: null, total: 500 },
  ]
  const m = categoryMatrix(invoices, suppliers)

  eq(m.columns, [2026, 2025, 'undated'], 'years newest first, undated last')
  eq(m.grand, 11500, 'and everything is counted')
  eq(m.rows.map((r) => r.key), ['gear', 'quota', '__none__'],
     'biggest first, with the unfiled LAST — it is a job to do, not a category')
  eq(m.rows[0].cells[2026], 5000, 'a cell is that category in that year')
  eq(m.rows[0].cells.undated, 500, 'and an undated invoice sits in its own column')
  eq(m.rows[0].total, 8500, 'the row totals across every column including undated')
  eq(m.rows[0].suppliers[0].name, 'Jackson Trawls Ltd', 'and the firms behind it are kept')
  ok(Math.abs(m.rows[0].share - 8500 / 11500) < 1e-9, 'with its share of the whole')
}

// ---- THE LIST IS A SETTING ------------------------------------------------
eq(resolveCategories(null).length, DEFAULT_CATEGORIES.length, 'nothing stored is the shipped list')
{
  const r = resolveCategories([{ key: 'gear', label: 'Nets & gear' }, { key: 'bait', label: 'Bait' }])
  eq(r.find((c) => c.key === 'gear').label, 'Nets & gear', 'a stored label wins')
  ok(r.find((c) => c.key === 'gear').hint, 'while the rest of the shipped row survives')
  ok(r.some((c) => c.key === 'bait'), 'and a category of the boat\'s own is added')
  eq(r.length, DEFAULT_CATEGORIES.length + 1, 'without dropping any of the shipped ones')
}
eq(categoryLabel(null), 'Not filed', 'no category reads as not filed, not as blank')

console.log('invoice categories: ' + n + ' checks passed')
