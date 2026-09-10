import assert from 'node:assert'
import {
  MAPPING, mappingFor, unrecorded, draftFromFuel, reconcile,
} from './src/lib/certification/orbLink.js'

let n = 0
const ok = (c, why) => { assert.ok(c, why); n++ }
const eq = (a, b, why) => { assert.deepStrictEqual(a, b, why); n++ }

const V = 'v-1'
const fuel = (id, kind, date, litres, extra = {}) =>
  ({ id, kind, entry_date: date, litres, vessel_id: V, ...extra })

/* ---- THE MAPPING IS THE REGULATION'S, NOT OURS ------------------------- */
{
  eq(mappingFor('fuel').code, 'H', 'bunkering fuel is code H')
  eq(mappingFor('fuel').itemN, '26.3', 'item 26.3, type and quantity of fuel oil')
  eq(mappingFor('lube_oil').itemN, '26.4', 'and lubricating oil is its own item')
  eq(mappingFor('dirty_oil').code, 'C', 'oil residues ashore are code C')
  eq(mappingFor('waste').itemN, '12.1', 'to a reception facility')
  eq(mappingFor('consumption'), null, 'a kind the book does not want maps to nothing')
  eq(mappingFor(undefined), null, 'and neither does nothing')

  /* EVERY MAPPING SAYS WHAT IT CANNOT SUPPLY. Item 26.3 wants the tank and its
     total content, and the fuel log has no tank column — so a derived entry is
     incomplete on exactly the part that makes it compliant, and the draft has
     to say so rather than look finished. */
  for (const k of Object.keys(MAPPING)) {
    ok(MAPPING[k].needs.length > 0, k + ' states what a person must still add')
  }
}

/* ---- WHAT IS NOT IN THE BOOK ------------------------------------------- */
{
  const rows = [
    fuel('f1', 'fuel', '2026-08-01', 12000),
    fuel('f2', 'lube_oil', '2026-08-02', 400),
    fuel('f3', 'dirty_oil', '2026-08-03', 900),
    /* Not an oil movement the book wants. */
    fuel('f4', 'consumption', '2026-08-04', 5000),
  ]
  const entries = [{ id: 'e1', fuel_log_id: 'f1' }]

  const out = unrecorded(rows, entries, { vesselId: V, asOf: '2026-09-10' })
  eq(out.map((r) => r.id), ['f3', 'f2'], 'the two unlinked ones, newest first')
  ok(!out.some((r) => r.id === 'f1'), 'a movement already in the book is not a gap')
  ok(!out.some((r) => r.id === 'f4'), 'nor is a kind the book never wanted')
}

/* ---- SCOPE, AND THE ROWS THAT PREDATE THE VESSEL COLUMN ---------------- */
{
  const rows = [
    fuel('a', 'fuel', '2026-08-01', 100),
    fuel('b', 'fuel', '2026-08-01', 100, { vessel_id: 'other-boat' }),
    /* The fuel log predates vessel_id; those rows belong to the fleet's boat. */
    fuel('c', 'fuel', '2026-08-01', 100, { vessel_id: null }),
  ]
  const out = unrecorded(rows, [], { vesselId: V, asOf: '2026-09-10' })
  eq(out.map((r) => r.id).sort(), ['a', 'c'], "another boat's movement is not this book's business")
}

/* ---- A DATE IN THE FUTURE IS NOT A GAP YET ---------------------------- */
{
  const rows = [fuel('f', 'fuel', '2026-12-25', 100)]
  eq(unrecorded(rows, [], { vesselId: V, asOf: '2026-09-10' }), [],
     'a movement dated ahead of today is not outstanding')
  eq(unrecorded([fuel('x', 'fuel', 'not a date', 1)], [], { asOf: '2026-09-10' }), [],
     'and a row with no readable date is not counted at all')
}

/* ---- THE DRAFT LEAVES THE SIGNATURE BLANK ----------------------------
 * The one field this cannot supply and the one reg 20 is most particular
 * about. `addEntry` would refuse a blank one — officer_name is NOT NULL — and
 * that refusal is the rule working rather than an obstacle.
 */
{
  const d = draftFromFuel(
    fuel('f1', 'fuel', '2026-08-01', 12000, { grade: 'MGO', location: 'Peterhead', counterparty: 'J A Smith' }),
    { pageId: 'p1', vesselId: V })

  eq(d.officerName, '', 'no officer name is invented')
  eq(d.code, 'H', 'the code comes off the mapping')
  eq(d.itemN, '26.3', 'and the item')
  /* THE BOOK IS KEPT IN CUBIC METRES and the receipt is printed in litres.
     1 m3 = 1000 L is exact and is not a rate, which is why this is the one
     conversion this codebase does silently. */
  eq(d.quantity, 12, 'the quantity is converted to cubic metres')
  eq(d.unit, 'm3', 'in the unit the book is kept in')
  /* AND THE LITRES ARE STILL SAID. The quantity FIELD carries one number and one
     unit, because two numbers in a prescribed column is an ambiguity somebody
     has to resolve; the receipt figure goes in the remarks, where it ties the
     entry to the delivery note without muddling the field. */
  ok(/12,000 L as bunkered/.test(d.narrative), 'and the litres off the receipt are in the narrative')
  eq(d.converted.litres, 12000, 'the draft says what it converted from')
  eq(d.converted.cubic, 12, 'and to')
  eq(d.tank, null, 'the tank is left empty, because the fuel log has none')
  eq(d.port, 'Peterhead', 'the place carries over')
  eq(d.fuelLogId, 'f1', 'and the entry remembers what raised it')
  ok(/grade MGO/.test(d.narrative), 'the grade is in the narrative')
  ok(/from J A Smith/.test(d.narrative), 'and who it came from')
  ok(/Raised from the fuel log/.test(d.narrative), 'and that it was raised rather than written')
  ok(d.needs.length > 0, 'and it says what is still missing before it is compliant')

  eq(draftFromFuel(fuel('x', 'consumption', '2026-08-01', 1)), null,
     'a kind the book does not want makes no draft')
  eq(draftFromFuel(null), null, 'and neither does nothing')
}

/* ---- NULL IS NOT ZERO -------------------------------------------------- */
{
  const d = draftFromFuel(fuel('f', 'fuel', '2026-08-01', null), { vesselId: V })
  eq(d.quantity, null, 'a movement with no litres has no quantity')
  eq(d.unit, null, 'and no unit either, rather than a volume of nothing')
  eq(d.converted, null, 'and nothing to say it converted')
  const e = draftFromFuel(fuel('f', 'fuel', '2026-08-01', 0), { vesselId: V })
  eq(e.quantity, 0, 'while a real nought is kept')
  eq(e.unit, 'm3', 'and still carries its unit')
}

/* ---- THE RECONCILIATION REPORTS MOVEMENTS, NOT A SCORE ---------------- */
{
  const rows = [
    fuel('f1', 'fuel', '2026-08-01', 12000),
    fuel('f2', 'fuel', '2026-08-10', 9000),
    fuel('f3', 'dirty_oil', '2026-08-11', 500),
    fuel('f4', 'consumption', '2026-08-12', 400),
  ]
  const r = reconcile(rows, [{ id: 'e', fuel_log_id: 'f1' }], { vesselId: V, asOf: '2026-09-10' })

  eq(r.total, 3, 'only the movements the book wants are counted')
  eq(r.recorded, 1, 'one of them is in the book')
  eq(r.missing.length, 2, 'and two are not')
  eq(r.kinds.map((k) => k.kind), ['fuel', 'dirty_oil'], 'grouped by kind, most oil first')
  eq(r.kinds[0].litres, 9000, 'with the oil the gap accounts for')
  /* NOT A PERCENTAGE. Two of three is not 67% of a duty done — each is its own
     entry and its own signature. */
  ok(!('percent' in r), 'no percentage is offered')
}

/* ---- NOTHING AT ALL ---------------------------------------------------- */
{
  eq(unrecorded([], []), [], 'no movements, no gap')
  eq(unrecorded(null, null), [], 'and null does not throw')
  const r = reconcile([], [])
  eq(r.total, 0, 'nothing to reconcile')
  eq(r.missing, [], 'and nothing missing')
}

console.log('orb link: ' + n + ' checks passed')
