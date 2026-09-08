import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import {
  quotaBoard, quotaLine, speciesOf, zoneOf,
  QUOTA_ORDER, SMALL_OVERSHOOT_T, MEANINGFUL_ALLOCATION_T,
} from './src/lib/quotaBoard.js'

let n = 0
const ok = (c, why) => { assert.ok(c, why); n++ }
const eq = (a, b, why) => { assert.deepStrictEqual(a, b, why); n++ }

/* The boat's own statement of 23-04-2026 — 45 lines, real sections, real
   floats. Every rule below was written because this data broke the last one. */
const REAL = JSON.parse(readFileSync('./scripts/fixtures/quota-statement.json', 'utf8'))

/* ---- THE ZONE IS NOT ALWAYS IN THE NAME -------------------------------- */
{
  eq(zoneOf({ stock: 'NS Cod', section: 'North Sea' }), 'NS', 'a prefixed name')
  /* WEST-COAST COD IS "Cod Area VIa" WITH NO PREFIX AT ALL, so the section is
     the authority. A rule reading the name would have found no WC cod on a
     statement that carries two lines of it. */
  eq(zoneOf({ stock: 'Cod Area VIa', section: 'West Coast' }), 'WC', 'and one with none')
  eq(zoneOf({ stock: 'Saithe VII', section: 'Area VII' }), null, 'area VII is neither')
  eq(zoneOf({}), null, 'and nothing is neither')
}

/* ---- BLUE LING IS NOT LING --------------------------------------------- */
{
  eq(speciesOf({ stock: 'NS Ling (UK)' }), 'Ling', 'a national suffix comes off')
  eq(speciesOf({ stock: 'Cod Area VIa' }), 'Cod', 'and an area')
  eq(speciesOf({ stock: 'Haddock VIIb-k' }), 'Haddock', 'in either spelling')
  /* THE ONE THAT MATTERS. `includes('Ling')` matches this, and it is the 371%
     line David singled out as NOT an issue — a different fish with its own
     deepwater TAC. Promoting it into the six he named would have put the wrong
     species on the front page under his own heading. */
  eq(speciesOf({ stock: 'WC Blue Ling' }), 'Blue Ling', 'and blue ling stays blue ling')
  eq(speciesOf({ stock: 'NS Tusk (UK)' }), 'Tusk', 'tusk is not ling either')
}

/* ---- A ZERO ALLOCATION IS NOT AN OVERSHOOT -----------------------------
 * David, Sep 2026: "NS pollock, NS squid & NS cats are all non quota speices."
 * They carry no allocation because none is required, so the statement's
 * negative balance is 0 − caught, not a debt.
 */
{
  const pollack = quotaLine({ stock: 'NS Pollack', section: 'North Sea',
    allocation: 0, catch_total: 8.24073, balance: -8.24073 })
  eq(pollack.over, 0, 'a stock with no allocation is never over')
  eq(pollack.used, null, 'and has no percentage — there is nothing to divide by')
  eq(pollack.noAllocation, true, 'it is its own state')
  eq(pollack.state, '', 'and carries no warning')
  ok(pollack.caught > 0, 'while the catch is still on the record')

  /* A REAL OVERSHOOT still is one. */
  const saithe = quotaLine({ stock: 'NS Saithe', section: 'North Sea',
    allocation: 127.80004, catch_total: 214.34508, balance: -86.54504 })
  eq(Math.round(saithe.over * 100) / 100, 86.55, 'a real overshoot is measured in tonnes')
  eq(saithe.state, 'over', 'and marked')
}

/* ---- THE SIX HE NAMED, IN HIS ORDER ------------------------------------ */
{
  const b = quotaBoard(REAL)
  eq(b.named.map((l) => l.stock),
    ['NS Cod', 'Cod Area VIa', 'NS Saithe', 'WC Saithe', 'NS Ling (UK)', 'WC Ling'],
    'NS cod, WC cod, NS saithe, WC saithe, NS ling, WC ling')
  eq(QUOTA_ORDER.length, 6, 'six slots')
  ok(!b.named.some((l) => l.stock === 'WC Blue Ling'), 'and blue ling is not one of them')
  ok(!b.named.some((l) => l.stock === 'NS Haddock'), 'nor the biggest allocation on the boat')
}

/* ---- NOTABLE MEANS TONNES, NOT PER CENT --------------------------------
 * Ranked on percentage, WC Blue Ling leads the whole statement at 371% — on an
 * allocation of 0.30 t. Three of the four biggest negative balances are
 * non-quota species. Neither belongs on the front page.
 */
{
  const b = quotaBoard(REAL)
  eq(b.others, [], 'after his six, nothing else is over materially or running short')

  const small = b.small.map((l) => l.stock)
  eq(small, ['WC Blue Ling', 'NS Tusk (UK)', 'WC Skates/Rays'],
     'the token overshoots are named at the foot, biggest first')
  ok(b.small.every((l) => l.over < SMALL_OVERSHOOT_T), 'every one under the threshold')
  ok(b.small.every((l) => l.alloc > 0), 'and every one a real allocation, not a non-quota line')

  /* THE NON-QUOTA SPECIES ARE REPORTED, NOT HIDDEN — just not as overshoots. */
  const un = b.unallocated.map((l) => l.stock)
  eq(un.slice(0, 3), ['NS Pollack', 'NS Squid', 'NS Cats'], 'biggest catch first')
  ok(b.unallocated.every((l) => l.over === 0), 'none of them called over')
}

/* ---- A PERCENTAGE ON A TOKEN ALLOCATION IS NOT "RUNNING SHORT" ----------
 * The first cut tested `used >= 0.85` alone, which let the percentage back in
 * through the side door and put all three of the token overshoots into the
 * notable list — the exact three David said were not an issue.
 */
{
  const tiny = quotaLine({ stock: 'WC Blue Ling', section: 'West Coast',
    allocation: 0.3, catch_total: 1.1115, balance: -0.8115 })
  ok(tiny.used > 3.7, 'blue ling is 371% caught')
  ok(tiny.over < SMALL_OVERSHOOT_T, 'and over by less than a tonne')

  const nearlyGone = quotaBoard([
    { stock: 'NS Haddock', section: 'North Sea', allocation: 100, catch_total: 95, balance: 5 },
    { stock: 'NS Brill', section: 'North Sea', allocation: 1, catch_total: 0.95, balance: 0.05 },
  ])
  eq(nearlyGone.others.map((l) => l.stock), ['NS Haddock'],
     'a big allocation nearly gone is worth knowing')
  ok(MEANINGFUL_ALLOCATION_T === 20, 'a 1 t allocation at 95% is not, whatever the percentage')
}

/* ---- ONE SLOT, SEVERAL LINES ------------------------------------------- */
{
  /* West-coast cod is held as VIa and VIb separately. Both belong in the slot;
     they are NOT added together, because two allocations summed is an
     allocation nobody holds. VIb here is a zero with a token catch, so it
     falls out to the unallocated line like any other. */
  const b = quotaBoard(REAL, { small: 20 })
  const wcCod = b.named.filter((l) => l.zone === 'WC' && l.species === 'Cod')
  eq(wcCod.map((l) => l.stock), ['Cod Area VIa'], 'the one with an allocation shows')
  ok(b.unallocated.some((l) => l.stock === 'Cod Area VIb'), 'and the zero is reported below')
  /* THE LIST IS CAPPED AND THE COUNT IS NOT, so the page can say how many it is
     not showing rather than quietly ending. Eight lines, six shown. */
  const capped = quotaBoard(REAL)
  eq(capped.unallocatedTotal, 8, 'the count is of all of them')
  eq(capped.unallocated.length, 6, 'while the list is capped')

  const both = quotaBoard([
    { stock: 'Cod Area VIa', section: 'West Coast', allocation: 6, catch_total: 2, balance: 4 },
    { stock: 'Cod Area VIb', section: 'West Coast', allocation: 3, catch_total: 1, balance: 2 },
  ])
  eq(both.named.map((l) => l.stock), ['Cod Area VIa', 'Cod Area VIb'],
     'two real allocations both show, bigger first')
  eq(both.named[0].alloc + both.named[1].alloc, 9, 'and are never summed into one row')
}

/* ---- NOTHING AT ALL IS NOT A LINE -------------------------------------- */
{
  const b = quotaBoard([
    { stock: 'Nephrops VII', section: 'Area VII', allocation: 0, catch_total: 0, balance: 0 },
    { stock: 'Monks VIII', section: 'Area VIII', allocation: null, catch_total: null, balance: null },
    { stock: 'NS Cod', section: 'North Sea', allocation: 10, catch_total: 1, balance: 9 },
  ])
  eq(b.named.map((l) => l.stock), ['NS Cod'], 'held nothing and caught nothing is no line')
  eq(b.others, [], 'and neither is a line with no figures on it')
  eq(quotaBoard([]).named, [], 'an empty statement gives nothing')
  eq(quotaBoard(null).named, [], 'and null does not throw')
}

/* ---- A NAMED STOCK THE STATEMENT DOES NOT CARRY IS ABSENT --------------
 * Printing "WC Ling — not on the statement" for a boat that never fishes the
 * west coast is a row about nothing.
 */
{
  const b = quotaBoard([
    { stock: 'NS Cod', section: 'North Sea', allocation: 10, catch_total: 1, balance: 9 },
  ])
  eq(b.named.length, 1, 'only what she actually holds')
  ok(!JSON.stringify(b).includes('WC'), 'and no placeholder for what she does not')
}

console.log('quota board: ' + n + ' checks passed')
