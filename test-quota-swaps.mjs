/* A STATEMENT IS A TRUE POSITION, SO IT ALREADY CONTAINS THE SWAPS BEFORE IT.
 *
 * David, Oct 2026: "statements are true positions, all swap/rents are on
 * statements. so a swap/rent should be dated, if statement is after date
 * inputted they disppear as they are now included in statement."
 *
 * `quota_adjustments` had no date at all, so buildPosition filtered on YEAR
 * and added every swap on top of whatever statement was loaded. Audacious's
 * own 22 were agreed between June and 15 September against a statement as at
 * 30-09-2026 — every one of them inside it, and the statement carries 120
 * tonnes of swaps in its own `swaps` column to prove it.
 *
 * The boundary is the part worth pinning: ON the statement date is INSIDE it.
 */
import assert from 'node:assert'
import { buildPosition } from './src/lib/quota/quotaAgg.js'

let n = 0
const ok = (c, m) => { assert.ok(c, m); n++ }
const eq = (a, b, m) => { assert.strictEqual(a, b, m); n++ }

const STATEMENT = '2026-09-30'
const snap = (lastLanding = STATEMENT) => ({
  year: 2026, last_landing_date: lastLanding,
  lines: [{ section: 'North Sea', stock: 'NS Saithe', allocation: 127.8, balance: 40, catch_total: 87.8 }],
})
const swap = (effective_date, tonnes = 100, direction = 'in') =>
  ({ id: effective_date + direction + tonnes, year: 2026, stock: 'NS Saithe', direction, tonnes, effective_date })

const saithe = (p) => p.rows.find(r => r.stock === 'NS Saithe')

/* ---- before the statement: it is IN the statement, so not added again --- */
{
  const p = buildPosition({ snapshot: snap(), trips: [], year: 2026, adjustments: [swap('2026-07-13')] })
  eq(saithe(p).adj_t, 0, 'a swap struck before the statement adds nothing')
  eq(saithe(p).est_balance, 40, 'so the estimate is the statement balance, not 140')
  eq(p.supersededAdj.length, 1, 'and it is reported as superseded')
  eq(p.undatedAdj.length, 0, 'not as undated')
}

/* ---- ON the statement date is INSIDE it -------------------------------- *
 * The statement is struck at the end of that landing day, and the manual
 * ledger one block away uses the same `<=` rule. An off-by-one here silently
 * double counts a swap agreed the very day the statement was drawn. */
{
  const p = buildPosition({ snapshot: snap(), trips: [], year: 2026, adjustments: [swap(STATEMENT)] })
  eq(saithe(p).adj_t, 0, 'a swap dated ON the statement day is inside it')
  eq(p.supersededAdj.length, 1, 'and reported')
}

/* ---- the day after is NOT, and still counts ---------------------------- */
{
  const p = buildPosition({ snapshot: snap(), trips: [], year: 2026, adjustments: [swap('2026-10-01')] })
  eq(saithe(p).adj_t, 100, 'a swap the day after the statement still counts')
  eq(saithe(p).est_balance, 140, 'and lifts the estimate')
  eq(p.supersededAdj.length, 0, 'nothing superseded')
}

/* ---- OUT keeps its sign ------------------------------------------------ */
{
  const p = buildPosition({ snapshot: snap(), trips: [], year: 2026, adjustments: [swap('2026-10-01', 20, 'out')] })
  eq(saithe(p).adj_t, -20, 'an OUT after the statement is negative')
  eq(saithe(p).est_balance, 20, 'and reduces the estimate')
}

/* ---- UNDATED IS A THIRD STATE: counted, and named ---------------------- *
 * Nobody can tell whether the statement covers it. Dropping it would move the
 * position with nothing on screen to say why; assuming it is covered would
 * lose a real trade. It keeps the behaviour it always had, and asks. */
{
  const p = buildPosition({ snapshot: snap(), trips: [], year: 2026, adjustments: [swap(null)] })
  eq(saithe(p).adj_t, 100, 'an undated swap is still counted')
  eq(p.undatedAdj.length, 1, 'and is named so it can be dated')
  eq(p.supersededAdj.length, 0, 'it is not quietly treated as superseded')
}

/* ---- NO STATEMENT AT ALL: everything counts --------------------------- *
 * With no true position to be inside of, every swap is live. A fleet that has
 * never uploaded a statement must not have its swaps silently dropped. */
{
  const p = buildPosition({
    snapshot: { year: 2026, last_landing_date: null, lines: snap().lines },
    trips: [], year: 2026, adjustments: [swap('2026-01-05'), swap('2026-07-13')],
  })
  eq(saithe(p).adj_t, 200, 'with no statement date, every swap counts')
  eq(p.supersededAdj.length, 0, 'and none is superseded')
}

/* ---- the year filter still applies ------------------------------------- */
{
  const p = buildPosition({
    snapshot: snap(), trips: [], year: 2026,
    adjustments: [{ ...swap('2026-10-01'), year: 2025 }],
  })
  eq(saithe(p).adj_t, 0, 'another year’s swap is not counted')
  eq(p.supersededAdj.length, 0, 'nor reported against this year')
}

/* ---- AUDACIOUS'S REAL 22, AGAINST HER REAL STATEMENT ------------------- *
 * All agreed 10-06 to 15-09-2026; the statement is as at 30-09-2026. If a
 * single one of them still counted, the position would be overstated by its
 * tonnage — and the biggest is 100 t of NS Saithe from Lockers. */
{
  const real = [
    ['2026-06-10', 'Cod Area VIa', 'in', 4.8], ['2026-06-10', 'Cod Area VIa', 'in', 2],
    ['2026-06-10', 'NS Cod', 'out', 20], ['2026-06-10', 'NS Saithe', 'in', 100],
    ['2026-06-30', 'NS Cod', 'in', 63], ['2026-07-10', 'NS Cod', 'in', 2],
    ['2026-07-10', 'NS Ling (UK)', 'in', 22], ['2026-07-10', 'NS Tusk (UK)', 'in', 0.9],
    ['2026-07-10', 'WC Ling', 'in', 20], ['2026-07-13', 'NS Ling (UK)', 'in', 20],
    ['2026-07-13', 'NS Saithe', 'in', 75], ['2026-07-13', 'NS Saithe', 'in', 50],
    ['2026-07-13', 'NS Saithe', 'in', 16], ['2026-07-13', 'NS Saithe', 'in', 17],
    ['2026-07-13', 'WC Ling', 'out', 20], ['2026-07-13', 'WC Saithe', 'out', 16],
    ['2026-07-13', 'WC Saithe', 'in', 35], ['2026-07-13', 'WC Saithe', 'out', 17],
    ['2026-09-15', 'NS Cod', 'in', 4], ['2026-09-15', 'NS Ling (UK)', 'in', 8],
    ['2026-09-15', 'NS Ling (UK)', 'out', 20], ['2026-09-15', 'NS Saithe', 'out', 8],
  ].map(([d, stock, direction, tonnes], i) =>
    ({ id: 'r' + i, year: 2026, stock, direction, tonnes, effective_date: d }))

  const p = buildPosition({ snapshot: snap(), trips: [], year: 2026, adjustments: real })
  eq(p.supersededAdj.length, 22, 'all 22 of the real swaps are inside the 30-09 statement')
  eq(p.undatedAdj.length, 0, 'none of them is undated')
  eq(saithe(p).adj_t, 0, 'so NS Saithe gains nothing on top of its true position')
  eq(saithe(p).est_balance, 40, 'and the estimate is the statement, not 290 tonnes more')
  ok(p.rows.every(r => (r.adj_t || 0) === 0), 'no stock anywhere is adjusted twice')
}

console.log(`quota swaps: ${n} checks passed`)
