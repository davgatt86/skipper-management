import assert from 'node:assert'
import { suggestMerges } from './src/lib/invoices/mergeSuppliers.js'

let n = 0
const ok = (c, why) => { assert.ok(c, why); n++ }
const eq = (a, b, why) => { assert.deepStrictEqual(a, b, why); n++ }

const firm = (id, name, category, extra = {}) =>
  ({ id, name, category, aliases: [], not_same_as: [], ...extra })
const inv = (id, supplier_id, total, invoice_date, description) =>
  ({ id, supplier_id, total, invoice_date, description })

/* ---- THE RULE, AND WHY IT IS THIS ONE -----------------------------------
 * Chosen by measurement over this boat's 211 real firms, not by taste:
 *   prefix containment            5 pairs
 *   same first word              51 pairs
 *   same first word + same trade 10 pairs
 * All five prefix pairs are worth a person looking at. The first-word rule is
 * mostly noise and matched "The Don Fishing Company" against "The Garret Home
 * Furnishings" — on the word "the". A suggester that is mostly wrong stops
 * being read, and then the real pair hides among the refusals.
 */
{
  const s = [
    firm('a', 'MAN Diesel & Turbo', 'engine'),
    firm('b', 'MAN Diesel & Turbo (Frederikshavn)', 'engine'),
  ]
  const i = [inv('1', 'a', 25888.94, '2017-08-07', 'Cylinder head overhaul'),
             inv('2', 'b', 1757.22, '2017-10-26', 'Order confirmation, parts')]
  const [p] = suggestMerges(s, i)
  eq(p.keep.id, 'a', 'the side with more invoices is offered as the keeper')
  eq(p.drop.id, 'b', 'and the smaller one folds in')
  eq(p.extra, 'frederikshavn', 'the words one name carries and the other does not')
  ok(p.sameTrade, 'and both being one trade is noted')
  eq(p.keep.count, 1, 'each side carries its own count')
  eq(p.drop.value, 1757.22, 'and its own money')
}

/* ---- IT NEVER GUESSES A NEAR MISS ---------------------------------------
 * The rule this whole area rests on: welding two genuinely different firms
 * together cannot be undone once the invoice that would tell them apart is
 * filed under the wrong name.
 */
{
  const s = [
    firm('a', 'D. Steven & Son', 'freight'),
    /* A man's name, a different trade, and it matches a search for "steven". */
    firm('b', 'Steven Clark Motor Body Repairs', 'vehicle'),
    firm('c', 'Ocean Blue Quota Company', 'quota'),
    firm('d', 'Ocean Endeavour Ltd', 'quota'),
    firm('e', 'Amazon Music', 'office'),
    firm('f', 'Amazon Marketplace', 'office'),
    /* Both begin "The", which is what made the first-word rule useless. */
    firm('g', 'The Don Fishing Company Ltd', 'chandlery'),
    firm('h', 'The Garret Home Furnishings', 'chandlery'),
  ]
  eq(suggestMerges(s, []), [], 'not one of these is offered as a merge')
}

/* ---- ANSWERED ONCE, NEVER ASKED AGAIN -----------------------------------
 * Two of the five real pairs on this boat are deliberately NOT merges. Without
 * somewhere to put that, the panel would ask again every time the page opened
 * — the "warning that fires on the ordinary case" failure, and then the one
 * real pair hides among the refusals.
 */
{
  const base = [
    firm('a', 'Macduff Shipyards Ltd', 'shipyard'),
    firm('b', 'Macduff Shipyards Limited (Macduff Crane Hire)', 'plant'),
  ]
  eq(suggestMerges(base, []).length, 1, 'unanswered, it is offered')
  ok(!suggestMerges(base, [])[0].sameTrade, 'and flagged as two different trades')

  const told = [{ ...base[0], not_same_as: ['b'] }, base[1]]
  eq(suggestMerges(told, []), [], 'told apart on one side, it is gone')
  /* WHICH SIDE CARRIES THE ANSWER IS AN ACCIDENT OF ORDERING, so both are
     checked — a refusal recorded on only one row would come back the next time
     the list was read the other way round. */
  const other = [base[0], { ...base[1], not_same_as: ['a'] }]
  eq(suggestMerges(other, []), [], 'and told apart on the other side, still gone')
}

/* ---- WHAT IT CANNOT SEE, and the page says so --------------------------- */
{
  const s = [firm('a', 'Seaway Net Company', 'gear'), firm('b', 'Seaway Group', 'gear')]
  eq(suggestMerges(s, []), [],
     'names sharing only a first word are NOT offered — Seaway was a real merge found by eye')
}

/* ---- A COMPANY SUFFIX IS NOISE, NOT THE DIFFERENCE ---------------------- */
{
  const s = [firm('a', 'North East Fabricators Limited', 'shipyard'),
             firm('b', 'North East Fabricators (Macduff Shipyards Ltd)', 'shipyard')]
  const [p] = suggestMerges(s, [])
  ok(!/^(ltd|limited)\b/.test(p.extra), 'no company suffix left stranded at the front of it')
  ok(p.extra.includes('macduff'), 'and what actually differs survives')
}

/* ---- THE ONE WORTH DECIDING COMES FIRST -------------------------------- */
{
  const s = [
    firm('a', "Baird's Pharmacy", 'medical'), firm('b', "Baird's Pharmacy (RMB Retail Limited)", 'medical'),
    firm('c', 'Macduff Shipyards Ltd', 'shipyard'), firm('d', 'Macduff Shipyards Limited (Crane Hire)', 'plant'),
  ]
  const i = [inv('1', 'a', 557, '2022-02-01'), inv('2', 'b', 687, '2024-06-11'),
             inv('3', 'c', 1346921, '2019-03-04'), inv('4', 'd', 4121, '2021-05-06')]
  const out = suggestMerges(s, i)
  eq(out.length, 2, 'both pairs are found')
  eq(out[0].keep.name, 'Macduff Shipyards Ltd', 'and the £1.3m one is asked about first')
}

/* ---- A FIRM WITH NO INVOICES IS STILL A FIRM --------------------------- */
{
  const s = [firm('a', 'Jackson Trawls', 'gear'), firm('b', 'Jackson Trawls Peterhead', 'gear')]
  const [p] = suggestMerges(s, [])
  eq(p.keep.count, 0, 'nought invoices is nought, not a crash')
  eq(p.drop.value, 0, 'and nought money')
  eq(p.keep.first, null, 'with no dates rather than invented ones')
}

console.log('merge suppliers: ' + n + ' checks passed')
