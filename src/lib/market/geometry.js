/* HOW MUCH ROOM THERE IS, TIER BY TIER.
 *
 * `planLayout` was written against a market of identical tiers and slices its
 * two rows at a fixed 21 and 26 in a dozen places. Peterhead is not that shape:
 * 61 of its 176 tiers are, and the rest run 44, 45, 34, 14, 12, 8, 15. This is
 * the seam between the allocator and the floor it is laying fish on.
 *
 * TWO GEOMETRIES, ONE INTERFACE.
 *
 *   uniformGeometry()  — 21 and 26 for ever, which is EXACTLY what the app did
 *                        before. It is the default, so every existing caller
 *                        and all thirteen real tallies come out unchanged.
 *   marketGeometry()   — a real market from a real start tier.
 *
 * THE CAFE AND THE OLD MARKET HAVE NO TOP ROW, and that is expressed as a top
 * capacity of nought rather than as a special case. Everything follows from it:
 * a clock cannot be put on a row that does not exist, so past the new market
 * the fish runs one clock at a time down a single lane — which is the rule
 * David gave, arrived at by the geometry rather than by a branch.
 *
 * AND THE BOTTOM LANE CARRIES ON THROUGH THE JOIN. David: "cafe is a
 * continuation of the bottom of new market." A tier is walked top row then
 * bottom row, so the bottom of the last new-market tier is the very next thing
 * before tier 78 — a run crossing the boundary is unbroken as long as it is on
 * the bottom, and needs no machinery of its own.
 */
import { TOP_ROW, BOTTOM_ROW } from './layoutRules.js'
import { tiersFrom } from './markets.js'

/** The shape the app has always assumed: one tier repeated for ever. */
export function uniformGeometry(top = TOP_ROW, bottom = BOTTOM_ROW) {
  return make({
    label: null,
    bounded: false,
    capAt: () => ({ top, bottom }),
    numberAt: (i) => i + 1,
    areaAt: () => null,
    count: Infinity,
  })
}

/** A real market, walked upward from `startTier` and stopping at its end. */
export function marketGeometry(market, startTier) {
  const tiers = tiersFrom(market, startTier)
  return make({
    label: market.label,
    bounded: true,
    capAt: (i) => (tiers[i] ? { top: tiers[i].top, bottom: tiers[i].bottom } : { top: 0, bottom: 0 }),
    numberAt: (i) => tiers[i]?.n ?? null,
    areaAt: (i) => tiers[i]?.area ?? null,
    count: tiers.length,
  })
}

function make(g) {
  /* HOW MANY TIERS TWO ROWS NEED. The uniform case is
   * `max(ceil(t/21), ceil(b/26), 1)`, and this must agree with it exactly or
   * every tally in the regression moves. It does, because consuming 21 and 26 a
   * tier at a time is the same arithmetic said slowly. */
  const tiersFor = (topLen, bottomLen) => fill(topLen, bottomLen).tiers

  /* Walk the market taking what each tier can hold. Returns how far it got and
   * what would not fit — running off the end is REPORTED, never wrapped round
   * to tier 1 and never quietly truncated. */
  const fill = (topLen, bottomLen) => {
    let t = Math.max(0, topLen), b = Math.max(0, bottomLen), i = 0
    while ((t > 0 || b > 0) && i < g.count) {
      const c = g.capAt(i)
      t -= c.top; b -= c.bottom
      i++
      /* A tier that can hold NOTHING would spin for ever. It cannot arise from
       * a real market, but a bounded walk must not depend on that. */
      if (c.top <= 0 && c.bottom <= 0) break
    }
    const short = Math.max(0, t) + Math.max(0, b)
    return {
      tiers: Math.max(i, 1),
      fits: short <= 0,
      shortTop: Math.max(0, t),
      shortBottom: Math.max(0, b),
      short,
    }
  }

  /* How many tiers ONE row alone would need. Nought for an empty row, which
   * matters: the spill picks the fuller row by comparing these two, and the old
   * `Math.ceil(0 / 21)` is 0, not 1. */
  const rowTiers = (len, which) => {
    let left = Math.max(0, len), i = 0
    while (left > 0 && i < g.count) {
      const c = g.capAt(i)
      const take = which === 'top' ? c.top : c.bottom
      i++
      if (take <= 0 && (c.top <= 0 && c.bottom <= 0)) break
      left -= take
      if (take <= 0 && i > g.count) break
    }
    return i
  }

  /** Room in the first `n` tiers. */
  const capUpTo = (n) => {
    let top = 0, bottom = 0
    for (let i = 0; i < n && i < g.count; i++) { const c = g.capAt(i); top += c.top; bottom += c.bottom }
    return { top, bottom, total: top + bottom }
  }

  /* The fewest tiers this many footprints could occupy if they packed
   * perfectly — the floor the drop solver is never allowed to raise. */
  const floorTiers = (footprints) => {
    let left = footprints, i = 0
    while (left > 0 && i < g.count) { const c = g.capAt(i); left -= c.top + c.bottom; i++ }
    return Math.max(1, i)
  }

  /* Cut two flat rows into tiers, each taking what that tier can hold.
   * Carries the tier's real NUMBER and AREA, because past the new market those
   * are what the sheet says and what the warnings key on. */
  const sliceTiers = (rows, tiers) => {
    const out = []
    let ti = 0, bi = 0
    for (let i = 0; i < tiers; i++) {
      const c = g.capAt(i)
      out.push({
        tier: i + 1,
        number: g.numberAt(i) ?? i + 1,
        area: g.areaAt(i),
        cap: c,
        top: rows.top.slice(ti, ti + c.top),
        bottom: rows.bottom.slice(bi, bi + c.bottom),
      })
      ti += c.top; bi += c.bottom
    }
    return out
  }

  /* WALK ORDER — 21 into a tier's top, then 26 into its bottom, then on. Used
   * when one fish fills the market; with a variable market the chunk sizes
   * change tier by tier, which is the whole reason it lives here. */
  const walkRows = (all) => {
    const rows = { top: [], bottom: [] }
    let i = 0
    for (let t = 0; i < all.length && t < g.count; t++) {
      const c = g.capAt(t)
      rows.top.push(...all.slice(i, i + c.top)); i += c.top
      rows.bottom.push(...all.slice(i, i + c.bottom)); i += c.bottom
      if (c.top <= 0 && c.bottom <= 0) break
    }
    return rows
  }

  /** Areas touched by a plan of `n` tiers, in floor order. */
  const areasUsed = (n) => {
    const seen = []
    for (let i = 0; i < n && i < g.count; i++) {
      const a = g.areaAt(i)
      if (a && !seen.includes(a)) seen.push(a)
    }
    return seen
  }

  /* Where the top row runs out. Past it there is one lane only, so a clock
   * that has to live on the top cannot go beyond here — which is what makes
   * "one clock at a time" true of the cafe corner without saying so. */
  const topEndsAfter = () => {
    if (!g.bounded) return Infinity
    let n = 0
    for (let i = 0; i < g.count; i++) { if (g.capAt(i).top > 0) n = i + 1; else break }
    return n
  }

  return {
    ...g, tiersFor, fill, rowTiers, capUpTo, floorTiers, sliceTiers, walkRows, areasUsed, topEndsAfter,
    rowSize: (r, i = 0) => (r === 'top' ? g.capAt(i).top : g.capAt(i).bottom),
  }
}
