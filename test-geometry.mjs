/* THE SEAM BETWEEN THE ALLOCATOR AND THE FLOOR.
 *
 * The first thing this has to prove is that it changed NOTHING. `planLayout`
 * has been tuned against thirteen real tallies, and the uniform geometry has to
 * reproduce its arithmetic exactly — `max(ceil(t/21), ceil(b/26), 1)` — or
 * every one of those trips moves and the regression is worthless.
 *
 * Only then does the variable market matter.
 */
import assert from 'node:assert/strict'
import { uniformGeometry, marketGeometry } from './src/lib/market/geometry.js'
import { PETERHEAD, tierAt } from './src/lib/market/markets.js'
import { TOP_ROW, BOTTOM_ROW } from './src/lib/market/layoutRules.js'

let n = 0
const eq = (a, b, m) => { n++; assert.deepEqual(a, b, m) }
const ok = (c, m) => { n++; assert.ok(c, m) }

// ---- THE UNIFORM CASE MUST NOT MOVE --------------------------------------
const U = uniformGeometry()
const oldTiersFor = (t, b) => Math.max(Math.ceil(t / TOP_ROW), Math.ceil(b / BOTTOM_ROW), 1)

let worst = null
for (let t = 0; t <= 400; t += 1) {
  for (const b of [0, 1, 25, 26, 27, 51, 52, 130, 260, 399, 400]) {
    if (U.tiersFor(t, b) !== oldTiersFor(t, b)) { worst = [t, b, U.tiersFor(t, b), oldTiersFor(t, b)]; break }
  }
  if (worst) break
}
eq(worst, null, 'the uniform geometry agrees with the old arithmetic on every pair tried')
n += 1

eq(U.tiersFor(0, 0), 1, 'nothing still occupies a tier, as before')
eq(U.tiersFor(21, 26), 1, 'one full tier')
eq(U.tiersFor(22, 26), 2, 'one over the top row is a second tier')
eq(U.tiersFor(0, 27), 2, 'and one over the bottom')
eq(U.floorTiers(47), 1, 'a tier holds 47 flat')
eq(U.floorTiers(48), 2, 'and 48 needs two')
eq(U.capUpTo(3), { top: 63, bottom: 78, total: 141 }, 'three tiers of room')
ok(!U.bounded, 'the uniform market never runs out')
eq(U.topEndsAfter(), Infinity, 'and its top row never ends')

{
  // Slicing must chunk exactly as the old fixed slice did.
  const rows = { top: Array.from({ length: 45 }, (_, i) => 't' + i),
                 bottom: Array.from({ length: 55 }, (_, i) => 'b' + i) }
  const cut = U.sliceTiers(rows, U.tiersFor(45, 55))
  eq(cut.length, 3, 'three tiers')
  eq(cut[0].top.length, 21, 'first tier takes 21 on top')
  eq(cut[0].bottom.length, 26, 'and 26 on the bottom')
  eq(cut[2].top, ['t42', 't43', 't44'], 'the tail lands in the last tier')
  eq(cut.flatMap((c) => c.top).length + cut.flatMap((c) => c.bottom).length, 100,
     'and nothing is lost or duplicated in the cut')
}

// ---- THE REAL MARKET ------------------------------------------------------
{
  // From tier 7, the standard part: it should behave just like the old model.
  const G = marketGeometry(PETERHEAD, 7)
  eq(G.capAt(0), { top: 21, bottom: 26 }, 'tier 7 is the standard tier')
  eq(G.numberAt(0), 7, 'and it is numbered 7, not 1')
  eq(G.tiersFor(21, 26), 1, 'one tier holds one tier')
  eq(G.areaAt(0), 'new', 'in the new market')
}

{
  // From tier 1, where the market is SHALLOWER than the app has ever assumed.
  const G = marketGeometry(PETERHEAD, 1)
  eq(G.capAt(0), { top: 18, bottom: 26 }, 'tier 1 is 18 on top, not 21')
  eq(G.tiersFor(21, 26), 2,
     'so 21 boxes on the top row does NOT fit in tier 1 — the old model would have said it did')
  eq(G.capUpTo(6).top, 18 * 6, 'the first six are all 18 on top')
  eq(G.capUpTo(7).top, 18 * 6 + 21, 'and the seventh opens out')
}

{
  /* THE CAFE HAS NO TOP ROW, and that is the whole rule expressed as a
   * capacity of nought rather than as a special case. */
  const G = marketGeometry(PETERHEAD, 78)
  eq(G.capAt(0), { top: 0, bottom: 14 }, 'tier 78 is one lane, 14 deep')
  eq(G.topEndsAfter(), 0, 'there is no top row here at all')
  const f = G.fill(5, 0)
  ok(!f.fits, 'so fish that needs a top row does not fit')
  eq(f.shortTop, 5, 'and it says how much could not be placed')
}

{
  // Starting in the new market, the top row ends where the new market does.
  const G = marketGeometry(PETERHEAD, 70)
  eq(G.topEndsAfter(), 8, 'eight tiers of top row left from 70 (70-77)')
  eq(G.numberAt(8), 78, 'and the ninth tier along is the cafe')
  eq(G.areaAt(8), 'cafe', 'which is where the amber starts')
  eq(G.areasUsed(9), ['new', 'cafe'], 'nine tiers from 70 crosses the join')
  eq(G.areasUsed(3), ['new'], 'three does not')
}

{
  // IT RUNS OUT, and says so rather than wrapping.
  const G = marketGeometry(PETERHEAD, 170)
  eq(G.count, 8, 'eight tiers from 170 to the end')
  const f = G.fill(0, 500)
  ok(!f.fits, 'five hundred does not fit in eight tiers of fifteen')
  eq(f.shortBottom, 500 - 8 * 15, 'and it reports the shortfall exactly')
  eq(f.tiers, 8, 'having used every tier there is')
}

{
  /* THE BOTTOM LANE CARRIES ON THROUGH THE JOIN — David: "cafe is a
   * continuation of the bottom of new market". A tier is walked top then
   * bottom, so the bottom of the last new-market tier is immediately followed
   * by the cafe, and a run crossing it is unbroken with no machinery. */
  const G = marketGeometry(PETERHEAD, 76)
  const rows = { top: Array.from({ length: 40 }, (_, i) => 't' + i),
                 bottom: Array.from({ length: 60 }, (_, i) => 'b' + i) }
  const cut = G.sliceTiers(rows, 5)
  eq(cut.map((c) => c.number), [76, 77, 78, 79, 80], 'tier numbers run on across the areas')
  eq(cut.map((c) => c.area), ['new', 'new', 'cafe', 'cafe', 'cafe'], 'and so do the areas')
  eq(cut[2].top, [], 'the cafe tiers take nothing on top')
  ok(cut[2].bottom.length > 0, 'everything there is on the bottom lane')
  // the bottom lane is continuous across the seam
  const lane = cut.flatMap((c) => c.bottom)
  eq(lane.slice(0, 3), ['b0', 'b1', 'b2'], 'the lane starts at the start')
  const atJoin = cut[1].bottom[cut[1].bottom.length - 1]
  eq(lane[lane.indexOf(atJoin) + 1], cut[2].bottom[0],
     'and the fish after the last new-market bottom is the first fish in the cafe — unbroken')
}

{
  // Walk order with a variable market takes each tier's own chunk sizes.
  const G = marketGeometry(PETERHEAD, 1)
  const all = Array.from({ length: 100 }, (_, i) => 'x' + i)
  const w = G.walkRows(all)
  eq(w.top.length + w.bottom.length, 100, 'every stack placed')
  eq(w.top.slice(0, 18).length, 18, 'the first tier takes its own 18 on top, not 21')
}

console.log('geometry: ' + n + ' checks passed')
