/* THE MARKET IS NOT ONE SHAPE. Peterhead is three.
 *
 * Everything before this assumed a market of identical tiers — 21 footprints
 * along the top, 26 along the bottom, 47 in all, forever. That is true of the
 * middle of the new market and of nowhere else, and the sheet the market
 * actually works from says so: read off `PD Market Layout.xlsx`, 176 tiers
 * numbered 1 to 177, in three areas of three different depths.
 *
 *   NEW MARKET    tiers   1-77   the only area with a TOP and a BOTTOM
 *   CAFE CORNER   tiers  78-112  no top, and the tiers are different sizes
 *   OLD MARKET    tiers 113-177  no top, uniform
 *
 * THE NUMBER PRINTED ON THE SHEET IS BOXES, NOT FOOTPRINTS. Every tier is
 * printed at exactly twice its drawn squares — a standard tier draws 47 and is
 * printed 94 — because the market counts a footprint as two boxes high. That is
 * also why David's phone-call rule is `boxes ÷ 94`: it is one tier's worth.
 * Confirmed with him Aug 2026. This file holds FOOTPRINTS — the drawn squares
 * everywhere except tiers 84-112, where the drawing is one out and the printed
 * 28 is right (see CAFE_DEPTH_UNCONFIRMED). So the printed figure is twice the
 * real depth with no exception, which is what that reading rests on.
 *
 * TIER 100 DOES NOT EXIST. The sheet skips it. 176 tiers numbered to 177, and
 * the gap is honoured rather than tidied away — the number on the floor is what
 * the market calls over the phone.
 */

/* Amber and red are not decoration. The new market is the market; the cafe
 * corner is a squeeze and the old market is worse, so a shot that reaches
 * either is something the skipper wants to know before he rings up, not
 * something he discovers when he gets there. */
export const AREAS = [
  { key: 'new', label: 'New Market', tone: 'ok', hasTop: true },
  { key: 'cafe', label: 'Cafe Corner', tone: 'amber', hasTop: false },
  { key: 'old', label: 'Old Market', tone: 'red', hasTop: false },
]

export const areaOf = (key) => AREAS.find((a) => a.key === key) || null
export const areaLabel = (key) => areaOf(key)?.label || key

/* The runs, exactly as the sheet draws them. Written as runs rather than 176
 * literals so the shape is READABLE — a run that is wrong is visible here,
 * where a wrong row buried in a list of 176 is not. */
const RUNS = [
  // from   to   area     top  bottom
  [1, 6, 'new', 18, 26],
  [7, 67, 'new', 21, 26],     // the standard tier: 47, printed 94
  [68, 73, 'new', 19, 26],
  [74, 77, 'new', 20, 14],    // the short bay at the far end, drawn offset
  [78, 79, 'cafe', 0, 14],
  [80, 81, 'cafe', 0, 12],
  [82, 83, 'cafe', 0, 8],
  [84, 112, 'cafe', 0, 14],   // 14, not the drawn 15 — see below. tier 100 is skipped
  [113, 177, 'old', 0, 15],
]

/* WHERE THE DRAWING AND THE PRINTED FIGURE DISAGREED, AND WHO WON.
 *
 * Tiers 84-112 are drawn 15 squares deep but printed 28, where 15 footprints
 * would print 30. I took the drawing as the authority and was wrong: David,
 * Aug 2026, gave the cafe corner as 14 / 12 / 8 / 14 flat — so the printed 28
 * was right and the fifteenth square is the drawing being out.
 *
 * That matters beyond the 28 footprints it costs, because it means the printed
 * number is twice the REAL depth everywhere without exception, which is what
 * the whole boxes-versus-footprints reading rests on.
 *
 * HE IS CHECKING IT ON THE FLOOR NEXT TIME HE IS AT THE MARKET. Recorded as
 * his figure pending that, rather than as settled — the run is 28 tiers, so
 * being one out is 28 footprints, most of two cafe tiers. */
export const CAFE_DEPTH_UNCONFIRMED = {
  from: 84, to: 112, using: 14, drawnAs: 15, printed: 28,
  note: "David's figure, Aug 2026. He is confirming it on the market floor.",
}

const MISSING = new Set([100])

function buildTiers() {
  const out = []
  for (const [from, to, area, top, bottom] of RUNS) {
    for (let n = from; n <= to; n++) {
      if (MISSING.has(n)) continue
      out.push({ n, area, top, bottom, total: top + bottom })
    }
  }
  return out
}

export const PETERHEAD = {
  key: 'peterhead',
  label: 'Peterhead',
  tiers: buildTiers(),
}

export const marketTotals = (market = PETERHEAD) => {
  const by = new Map()
  for (const t of market.tiers) {
    const a = by.get(t.area) || { area: t.area, tiers: 0, footprints: 0 }
    a.tiers++; a.footprints += t.total
    by.set(t.area, a)
  }
  return {
    tiers: market.tiers.length,
    footprints: market.tiers.reduce((s, t) => s + t.total, 0),
    byArea: AREAS.map((a) => by.get(a.key)).filter(Boolean),
  }
}

export const tierAt = (market, n) => market.tiers.find((t) => t.n === n) || null

/* THE SHOT RUNS UPWARD FROM WHERE HE STARTS AND STOPS AT THE END OF THE MARKET.
 * It does not wrap round to tier 1 — David's call, and the right one: a sheet
 * that silently continued at the other end of the building would send a buyer
 * the length of the market for the tail of one species. Running out is reported
 * instead. */
export function tiersFrom(market, startTier) {
  const i = market.tiers.findIndex((t) => t.n === startTier)
  return i < 0 ? [] : market.tiers.slice(i)
}

/**
 * Which tiers a shot of `footprints` occupies from `startTier`, and what that
 * costs in areas touched.
 *
 * Returns `fits: false` with what it could not place, rather than a short
 * answer that looks complete.
 */
export function fitShot(market, startTier, footprints) {
  const avail = tiersFrom(market, startTier)
  const used = []
  let left = Math.max(0, Math.ceil(footprints))
  for (const t of avail) {
    if (left <= 0) break
    const take = Math.min(left, t.total)
    used.push({ ...t, used: take, spare: t.total - take })
    left -= take
  }
  const areasUsed = [...new Set(used.map((t) => t.area))]
  return {
    fits: left <= 0,
    shortBy: left,
    tiers: used,
    firstTier: used[0]?.n ?? null,
    lastTier: used[used.length - 1]?.n ?? null,
    areas: areasUsed,
    capacityFrom: avail.reduce((s, t) => s + t.total, 0),
    warnings: areaWarnings(areasUsed, left),
  }
}

/* AMBER INTO THE CAFE, RED INTO THE OLD MARKET — David's words. The tone is
 * carried rather than the colour, so the page decides how to draw it. */
export function areaWarnings(areasUsed, shortBy = 0) {
  const out = []
  if (areasUsed.includes('cafe')) {
    out.push({ tone: 'amber', area: 'cafe',
               text: 'This shot runs into the Cafe Corner. Those tiers have no top row and are different sizes.' })
  }
  if (areasUsed.includes('old')) {
    out.push({ tone: 'red', area: 'old',
               text: 'This shot reaches the Old Market. No top row there either, and it is the far end of the building.' })
  }
  if (shortBy > 0) {
    out.push({ tone: 'red', area: null,
               text: `${shortBy} footprints do not fit before the end of the market. Start further back, or ask for less room.` })
  }
  return out
}
