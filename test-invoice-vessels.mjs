/* THREE BOATS, ONE NAME.
 *
 * David, Sep 2026: "another worth knowing that 10 years are 3 different boats
 * ... oldest boat was sold aug 2018 / pair/single went into service oct 2018
 * but invoices for that boat could be from spring 2018 onwards / pair/single was
 * sold july 2022 / twin trawler in service oct 2022 but invoices from summer
 * 2022 could be for the twin vessel."
 *
 * All three are AUDACIOUS BF83. The dates below are his, and the BOPP invoice
 * is the real one out of the database.
 */
import assert from 'node:assert/strict'
import { DEFAULT_ERAS, resolveEras, eraOf, eraLabel, vesselOf, vesselSplit, eraService, vesselSplitPerYear }
  from './src/lib/invoices/vessels.js'

let n = 0
const eq = (a, b, m) => { n++; assert.deepEqual(a, b, m) }
const ok = (c, m) => { n++; assert.ok(c, m) }

// ---- THE PLAIN CASES ------------------------------------------------------
eq(eraOf('2016-11-01').key, 'pair', 'the oldest invoices are the old pair trawler')
eq(eraOf('2017-06-15').key, 'pair', 'and so is 2017')
eq(eraOf('2016-11-01').certain, true, 'well clear of any changeover, so certain')

eq(eraOf('2019-05-20').key, 'pair_single', 'once she is in service it is the pair/single')
eq(eraOf('2021-10-19').key, 'pair_single', 'through to 2021')
eq(eraOf('2019-05-20').certain, true, 'and certainly so')

eq(eraOf('2024-10-10').key, 'twin', 'and the twin from 2023 on')
eq(eraOf('2026-08-26').key, 'twin', 'up to today')
eq(eraOf('2026-08-26').certain, true, 'certainly')

// ---- THE FIRST CHANGEOVER: spring to August 2018 --------------------------
/* THE ONE THAT MATTERS. Etablissements BOPP Treuils JEB, £616,200 of winches,
 * invoiced 28-05-2018 — four months before the pair/single entered service and
 * while the old boat was still fishing. David: "bopp was purchases for the
 * oct 18 - jul 22 vessel". Date alone puts it on the wrong hull. */
{
  const bopp = eraOf('2018-05-28')
  eq(bopp.certain, false, 'THE BOPP DATE IS NOT DECIDABLE FROM THE DATE — it must be flagged')
  eq(bopp.key, 'pair', 'the boat in service is offered, because routine costs are the common case')
  eq(bopp.alsoCould, 'pair_single', 'and the boat being fitted out is named as the other candidate')
}

eq(eraOf('2018-02-01').certain, true, 'before the fit-out starts there is no doubt')
eq(eraOf('2018-02-01').key, 'pair', 'it is simply the old boat')
eq(eraOf('2018-03-15').certain, false, 'from spring the window is open')
eq(eraOf('2018-07-02').certain, false, 'and stays open while the old boat still fishes')

/* Once she is SOLD the doubt ends: an invoice cannot belong to a boat that has
 * gone. September 2018 is the pair/single and nothing else. */
eq(eraOf('2018-09-13').key, 'pair_single', 'after the sale it can only be the new boat')
eq(eraOf('2018-09-13').certain, true, 'so there is nothing to flag')

// ---- THE SECOND CHANGEOVER: summer to October 2022 ------------------------
eq(eraOf('2022-06-15').certain, false, 'summer 2022 is the same problem again')
eq(eraOf('2022-06-15').key, 'pair_single', 'the boat still in service is offered')
eq(eraOf('2022-06-15').alsoCould, 'twin', 'against the twin being fitted out')
eq(eraOf('2022-08-29').key, 'twin', 'after she is sold in July it can only be the twin')
eq(eraOf('2022-08-29').certain, true, 'and that is certain')
eq(eraOf('2022-05-01').certain, true, 'before summer, no doubt')

// ---- WHAT CANNOT BE PLACED -----------------------------------------------
eq(eraOf(null), null, 'no date, no hull')
eq(eraOf('not a date'), null, 'nor a date the reader could not read')

// ---- THE OVERRIDE IS THE POINT -------------------------------------------
eq(vesselOf({ invoice_date: '2018-05-28' }), 'pair', 'left alone, BOPP sits with the old boat')
eq(vesselOf({ invoice_date: '2018-05-28', vessel_era: 'pair_single' }), 'pair_single',
   'and David saying otherwise settles it — the override always wins')
eq(vesselOf({ invoice_date: null, vessel_era: 'twin' }), 'twin',
   'an override places even an invoice with no date at all')
eq(vesselOf({ invoice_date: null }), null, 'while no date and no override is no hull')

// ---- THE SPLIT ------------------------------------------------------------
{
  const invoices = [
    { invoice_date: '2017-06-15', total: 1000 },                       // pair, certain
    { invoice_date: '2018-05-28', total: 616200 },                     // BOPP, in the window
    { invoice_date: '2018-06-01', total: 40 },                         // gloves, in the window
    { invoice_date: '2019-05-20', total: 5000 },                       // pair/single, certain
    { invoice_date: '2024-10-10', total: 8000 },                       // twin, certain
    { invoice_date: null, total: 500 },                                // no date
  ]
  const s = vesselSplit(invoices)
  const by = Object.fromEntries(s.rows.map((r) => [r.key, r]))

  eq(by.pair.total, 617240, 'un-corrected, the winches sit with the old boat')
  eq(by.pair_single.total, 5000, 'and the new boat looks cheap')
  eq(by.twin.total, 8000, 'the twin is unaffected')
  eq(s.undated.count, 1, 'the undated invoice is counted apart, never guessed onto a hull')

  /* THE UNCERTAIN LIST IS ORDERED BY MONEY, because that is the order they are
     worth deciding in: £616k of winches matters, a £40 box of gloves does not. */
  eq(s.uncertain.length, 2, 'both window invoices are flagged')
  eq(s.uncertain[0].amount, 616200, 'biggest first')
  eq(s.uncertain[0].alsoCould, 'pair_single', 'named against the boat it might belong to')
  eq(s.unsureTotal, 616240, 'and the total still to decide is stated')

  // With David's correction applied, the money moves.
  const fixed = invoices.map((i) =>
    (i.total === 616200 ? { ...i, vessel_era: 'pair_single' } : i))
  const s2 = vesselSplit(fixed)
  const by2 = Object.fromEntries(s2.rows.map((r) => [r.key, r]))
  eq(by2.pair.total, 1040, 'the old boat drops back to its own running costs')
  eq(by2.pair_single.total, 621200, 'and the winches land on the hull they were bought for')
  eq(s2.uncertain.length, 1, 'with only the gloves left to bother about')
}

// ---- THE ERAS ARE A SETTING ----------------------------------------------
eq(resolveEras(null).length, 4, 'nothing stored is three hulls and the build bucket')
{
  const r = resolveEras([{ key: 'twin', label: 'Twin rig' }])
  eq(r.find((e) => e.key === 'twin').label, 'Twin rig', 'a stored label wins')
  ok(r.find((e) => e.key === 'twin').from, 'while the rest of the shipped row survives')
}
eq(eraLabel(null), 'Not placed', 'and no hull reads as not placed, never as blank')

/* ---- BUILDING A BOAT IS NOT RUNNING ONE ----------------------------------
 * David, Sep 2026: "add a new category of boats. new build costs ... i think
 * some bopp, shipyard & woodsons bills should be in the new build costs."
 *
 * Macduff 30543 makes the case on its own: £287,874 for "stage payment due
 * when hull is 100% completed", dated October 2017 — a year before the
 * pair/single ever fished and while the old boat still was. Charged to either
 * hull it is a lie about what she cost to run.
 */
{
  const eras = resolveEras(null)
  eq(eras.map((e) => e.key), ['pair', 'newbuild', 'pair_single', 'twin'],
     'four buckets, in the order David listed them')
  const nb = eras.find((e) => e.key === 'newbuild')
  ok(nb.manualOnly, 'the build bucket is filled by hand and never by date')
  ok(!nb.from && !nb.to, 'and it deliberately carries no dates')

  /* THE TRAP THIS FLAG EXISTS FOR. An era with neither `from` nor `to`
     satisfies "on or after the start AND on or before the end" for EVERY date,
     so without excluding it from the date logic New build costs would have
     swallowed every invoice after the old boat was sold. */
  for (const d of ['2015-01-01', '2016-06-01', '2017-10-31', '2019-01-01',
                   '2021-01-01', '2023-01-01', '2026-09-01']) {
    ok(eraOf(d).key !== 'newbuild', `${d} never falls to the build bucket on its own`)
  }
  /* And the dated boats still behave exactly as before it was added. */
  eq(eraOf('2016-05-01').key, 'pair', 'the old boat still takes an early date')
  eq(eraOf('2020-06-01').key, 'pair_single', 'the middle boat still takes a middle one')
  eq(eraOf('2026-01-01').key, 'twin', 'and the twin still takes a recent one')
  eq(eraOf('2018-05-28').certain, false, 'the changeover window is still a window')
  eq(eraOf('2018-05-28').alsoCould, 'pair_single', 'naming the same other candidate')
  eq(eraOf('2022-07-01').alsoCould, 'twin', 'and the second changeover too')

  /* ONLY AN EXPLICIT DECISION PUTS AN INVOICE THERE. */
  eq(vesselOf({ invoice_date: '2017-10-31' }), 'pair', 'the stage payment lands on the old boat by date')
  eq(vesselOf({ invoice_date: '2017-10-31', vessel_era: 'newbuild' }), 'newbuild',
     'and only the skipper moves it to the build')

  eq(eraLabel('newbuild'), 'New build costs', 'it has a name of its own')
}

/* ---- A BUILD HAS NO YEARS OF SERVICE ------------------------------------
 * So it has no cost per year of service either, and must not be ranked beside
 * three hulls that actually fished.
 */
{
  const eras = resolveEras(null)
  const invoices = [
    { invoice_date: '2017-10-31', total: 287874.10, vessel_era: 'newbuild' },
    { invoice_date: '2018-05-28', total: 616200, vessel_era: 'newbuild' },
    { invoice_date: '2020-01-01', total: 10000 },
    { invoice_date: '2024-01-01', total: 20000 },
  ]
  eq(eraService('newbuild', invoices, eras), null, 'a build has no service window')
  ok(eraService('twin', invoices, eras), 'while a hull that fished still has one')

  const split = vesselSplitPerYear(invoices, eras)
  const by = Object.fromEntries(split.rows.map((r) => [r.key, r]))
  eq(by.newbuild.total, 904074.10, 'the build carries both orders')
  eq(by.newbuild.perYear, null, 'and NO cost per year — a rate would be invented')
  ok(by.twin.perYear > 0, 'the boats that fished still have one')
  /* THE WHOLE POINT: the running costs of the hulls are now their own. */
  eq(by.pair_single.total, 10000, 'the pair/single keeps only what she was run on')
  eq(by.pair.total, 0, 'and the stage payment is off the old boat entirely')

  /* An invoice moved to the build is SETTLED, so it stops being asked about. */
  eq(split.uncertain.length, 0, 'nothing moved by hand is still undecided')
}

/* ---- IT IS A SETTING, like the other three ------------------------------- */
{
  const r = resolveEras([{ key: 'newbuild', label: 'Newbuild' }])
  eq(r.find((e) => e.key === 'newbuild').label, 'Newbuild', 'a stored label wins')
  ok(r.find((e) => e.key === 'newbuild').manualOnly,
     'and the flag that keeps it out of the date logic survives the merge')
}

console.log('invoice vessels: ' + n + ' checks passed')
