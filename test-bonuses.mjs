/* ROLE BONUSES — and David's own two worked examples are the specification.
 *
 *   "landing 1 & 2, 2 different engineers. they get 0.25% each"
 *   "2 mates landing 1 and 1 mate landing 2 ... 2x 0.0625% and 1x 0.125%"
 *
 * One rule produces both: a role's rate is split across the LANDINGS, and each
 * landing's share is split among the men who held that role on it.
 */
import assert from 'node:assert/strict'
import {
  DEFAULT_RATES, BONUS_ROLES, roleForRank, resolveRates,
  computeBonuses, fmtPct,
} from './src/lib/su/bonuses.js'

let n = 0
const eq = (a, b, m) => { n++; assert.deepEqual(a, b, m) }
const ok = (c, m) => { n++; assert.ok(c, m) }

// ---- the rates -----------------------------------------------------------
eq(DEFAULT_RATES, { skipper: 3, engineer: 0.5, mate: 0.25 }, "David's rates as he gave them")

// ---- THE ORDINARY TRIP: one man per role, every landing -------------------
{
  const r = computeBonuses([
    { id: 'a', name: 'David', role: 'skipper' },
    { id: 'b', name: 'Norman', role: 'engineer' },
    { id: 'c', name: 'Barry', role: 'mate' },
  ], 2)
  eq(r.rows.map((x) => x.pct), [3, 0.5, 0.25],
     'a man who did both landings gets the whole rate — the 99% case needs no thought')
  eq(r.unallocated, [], 'nothing unclaimed')
  eq(r.total, 3.75, 'and the trip pays exactly the three rates')
}

// ---- HIS FIRST EXAMPLE: two engineers, one landing each -------------------
{
  const r = computeBonuses([
    { id: 'e1', name: 'Norman', role: 'engineer', landings: [1] },
    { id: 'e2', name: 'Animal', role: 'engineer', landings: [2] },
  ], 2)
  eq(r.rows.map((x) => x.pct), [0.25, 0.25],
     '"landing 1 & 2, 2 different engineers. they get 0.25% each"')
  eq(r.total, 0.5, 'and together they are still the one 0.5%')
  eq(r.unallocated.filter((u) => u.role === 'engineer'), [], 'the engineer bonus is fully claimed')
}

// ---- HIS SECOND EXAMPLE: 2 mates on one landing, 1 on the other ----------
{
  const r = computeBonuses([
    { id: 'm1', name: 'Mate A', role: 'mate', landings: [1] },
    { id: 'm2', name: 'Mate B', role: 'mate', landings: [1] },
    { id: 'm3', name: 'Mate C', role: 'mate', landings: [2] },
  ], 2)
  eq(r.rows.map((x) => x.pct), [0.0625, 0.0625, 0.125],
     '"2x 0.0625% and 1x 0.125%" — his figures exactly')
  eq(r.total, 0.25, 'and the three of them come to the one mate bonus')
  /* Scoped to the mate: this example assigns nobody to skipper or engineer, so
     those are legitimately unallocated and saying so is the point. */
  eq(r.unallocated.filter((u) => u.role === 'mate'), [], 'no part of the MATE bonus is left over')
}

/* THE FOUR DECIMAL PLACES ARE NOT FUSSINESS. 0.0625 is a real figure on a real
 * trip; rounding to two would make it 0.06 and lose money on every one. */
eq(fmtPct(0.0625), '0.0625%', 'a quarter share prints in full')
eq(fmtPct(0.25), '0.25%', 'and a plain one does not grow trailing zeros')
eq(fmtPct(3), '3%', 'nor a whole number')

// ---- NOBODY HELD THE ROLE ON A LANDING -----------------------------------
{
  /* Reported, never redistributed. Handing landing two's share to the mate who
   * did landing one would invent a payment nobody agreed; dropping it silently
   * would lose it. It is money, so the page shows it and the skipper decides. */
  const r = computeBonuses([{ id: 'm1', name: 'Mate A', role: 'mate', landings: [1] }], 2)
  eq(r.rows[0].pct, 0.125, 'he gets his own landing only, not the whole rate')
  const mateGap = r.unallocated.filter((u) => u.role === 'mate')
  eq(mateGap.length, 1, "and the other half of the MATE bonus is reported")
  eq(mateGap[0], { role: 'mate', landing: 2, pct: 0.125 }, 'named by role and landing')
  ok(r.total < r.expected, 'the trip pays less than the full rates, and says so')
}

// ---- a one-landing trip ---------------------------------------------------
{
  const r = computeBonuses([
    { id: 'a', name: 'David', role: 'skipper' },
    { id: 'b', name: 'B', role: 'mate' },
    { id: 'c', name: 'C', role: 'mate' },
  ], 1)
  eq(r.rows.map((x) => x.pct), [3, 0.125, 0.125], 'two mates on a single landing halve the mate bonus')
}

// ---- three landings -------------------------------------------------------
{
  const r = computeBonuses([
    { id: 'e1', name: 'A', role: 'engineer', landings: [1, 2] },
    { id: 'e2', name: 'B', role: 'engineer', landings: [3] },
  ], 3)
  eq(r.rows.map((x) => x.pct), [0.3333, 0.1667], 'two of three landings against one')
  ok(Math.abs(r.total - 0.5) < 0.001, 'and it still comes to the engineer rate')
}

// ---- rank suggests the role, so it is not typed twice ---------------------
eq(roleForRank('master'), 'skipper', 'a master is the skipper for bonus purposes')
eq(roleForRank('skipper'), 'skipper', 'and so is a skipper')
eq(roleForRank('chief_engineer'), 'engineer', 'chief engineer')
eq(roleForRank('second_engineer'), 'engineer', 'second engineer too — they share the one bonus')
eq(roleForRank('mate'), 'mate', 'mate')
eq(roleForRank('cook'), null, 'a cook carries no role bonus')
eq(roleForRank('deckhand'), null, 'nor a deckhand')
eq(roleForRank(null), null, 'nor an unknown rank')
eq(BONUS_ROLES.map((r) => r.key), ['skipper', 'engineer', 'mate'], 'three roles, in the order he wrote them')

// ---- the rates are settings ----------------------------------------------
eq(resolveRates(null), DEFAULT_RATES, 'nothing stored is the shipped rates')
eq(resolveRates({ mate: 0.5 }), { skipper: 3, engineer: 0.5, mate: 0.5 },
   'a stored rate supplies only what it changes, so later corrections still reach the boat')
eq(resolveRates({ mate: 'nonsense' }).mate, 0.25, 'and rubbish is ignored rather than zeroing a man')
eq(resolveRates({ mate: -1 }).mate, 0.25, 'a negative rate is not a bonus')

{
  const r = computeBonuses([{ id: 'a', name: 'D', role: 'skipper' }], 1, resolveRates({ skipper: 4 }))
  eq(r.rows[0].pct, 4, 'a changed rate is what gets paid')
}

// ---- edges ----------------------------------------------------------------
eq(computeBonuses([], 2).rows, [], 'nobody assigned, nobody paid')
eq(computeBonuses([{ id: 'x', name: 'X', role: 'deckhand' }], 1).rows, [],
   'a role with no rate is not a bonus')
eq(computeBonuses([{ id: 'a', name: 'A', role: 'mate' }], 0).landings, 1,
   'a trip always has at least one landing')
eq(computeBonuses([{ id: 'a', name: 'A', role: 'mate', landings: [5] }], 2).rows[0].pct, 0,
   'a landing that does not exist earns nothing rather than throwing')

console.log('bonuses: ' + n + ' checks passed')
