import { TOP_ROW, BOTTOM_ROW, PER_TIER_FLAT, tiersByRuleOfThumb, RULES, isPrime } from './layoutRules.js'

/* Turn a day tally into a market layout.
 *
 * The job: get every box onto the market in as few tiers as possible, while
 * keeping the four auctions together, keeping a species in one band, and
 * laying the fish out in day-tag order from the high number down.
 *
 * WHY THE TWO ROWS ARE FILLED IN PROPORTION. A tier gives 21 footprints on the
 * top row and 26 on the bottom at the same time — you cannot take one without
 * the other. So the number of tiers is set by whichever row runs out first,
 * and packing the bottom tight while the top sits half empty simply costs
 * tiers. Species are handed to whichever row is furthest from its share.
 *
 * THEN THE SPARE SPACE IS SPENT ON THE DEAR FISH. The heights in layoutRules
 * are a ceiling, not a target: a grade may always be laid lower, and the good
 * stuff is favoured low so it can be seen and handled. Once the tier count is
 * settled, whatever footprints are left over inside those tiers are given to
 * the most valuable grades, one level at a time. See `solveDrops`.
 */

/* Boxes of one grade, in day order, poured into stacks of at most `height`.
 * A stack may span two days rather than stand part-full — David's rule — so
 * the parts are recorded and the day tags on a stack are known. */
export function buildStacks(dayEntries, height) {
  const desc = [...dayEntries].filter((e) => e.boxes > 0).sort((a, b) => b.day - a.day)
  const stacks = []
  let cur = null
  for (const e of desc) {
    let left = e.boxes
    while (left > 0) {
      if (!cur || cur.boxes >= height) { cur = { boxes: 0, height, parts: [] }; stacks.push(cur) }
      const take = Math.min(left, height - cur.boxes)
      cur.boxes += take
      left -= take
      const last = cur.parts[cur.parts.length - 1]
      if (last && last.day === e.day) last.boxes += take
      else cur.parts.push({ day: e.day, boxes: take })
    }
  }
  return stacks
}

/* One bucket per species+grade, carrying its days and its ceiling. */
function bucketGrades(clean, rules) {
  const grades = new Map()
  for (const l of clean) {
    const key = `${l.species}||${l.grade}`
    if (!grades.has(key)) {
      grades.set(key, {
        key,
        species: l.species, grade: l.grade,
        auction: rules.clockFor(l.species),
        max: rules.maxHeight(l.species, l.grade),
        prime: isPrime(l.species, l.grade),
        value: rules.valueOf(l.species, l.grade),
        // Position in the tally, which is grading order. Falls back to a big
        // number so a line without it sorts last rather than first.
        seq: Number.isFinite(l.seq) ? l.seq : Number.MAX_SAFE_INTEGER,
        boxes: 0,
        days: [],
      })
    }
    const g = grades.get(key)
    if (Number.isFinite(l.seq)) g.seq = Math.min(g.seq, l.seq)
    g.boxes += Number(l.boxes)
    g.days.push({ day: Number(l.day), boxes: Number(l.boxes) })
  }
  return [...grades.values()]
}

/* Footprints a grade takes at a given height.
 *
 * Exact rather than an estimate: buildStacks fills each stack right up before
 * starting the next, spanning day tags to do it, so a grade of n boxes at
 * height h always occupies ceil(n / h) footprints. That is what makes the cost
 * of laying a grade one lower knowable before doing it. */
const cost = (boxes, height) => Math.ceil(boxes / Math.max(height, 1))

/* Spend leftover footprints on laying the valuable fish lower.
 *
 * Heights are a ceiling — "can not go higher, but can go lower" — and high
 * value species and grades are always favoured low. So once the tier count is
 * fixed, any footprint left inside those tiers is worth more under a good fish
 * than left as a gap in the floor.
 *
 * Most of the dear stuff already lies flat (cod's big grades, monks, ling, the
 * flats), so in practice this reaches the next rank down: cod's small grades,
 * then catfish, saithe, haddock, whiting.
 *
 * Round by round, most valuable first, one level at a time — so a strong grade
 * gets to 1 high before a weaker one gets its first drop, and the drops spread
 * evenly if the budget will not stretch that far.
 *
 * Returns a Map of key → height. Budget is a footprint count; the caller
 * re-runs the layout and checks the tier count really did hold, because row
 * assignment can shift when stack counts change. */
export function solveDrops(gradeList, budget) {
  const heights = new Map(gradeList.map((g) => [g.key, g.max]))
  let spare = budget
  if (spare <= 0) return heights

  // Most valuable species first; inside a species the tally's own order, which
  // is grading order, so the bigger grade is favoured over the smaller.
  const candidates = [...gradeList].sort((a, b) => b.value - a.value || a.seq - b.seq)

  let moved = true
  while (moved && spare > 0) {
    moved = false
    for (const g of candidates) {
      const h = heights.get(g.key)
      if (h <= 1) continue
      const extra = cost(g.boxes, h - 1) - cost(g.boxes, h)
      if (extra > spare) continue           // cannot afford this one; try the next
      heights.set(g.key, h - 1)
      spare -= extra
      moved = true
      if (spare <= 0) break
    }
  }
  return heights
}

/* One pass at a fixed set of heights. `heightOf(grade)` returns the height to
 * lay each bucket at; the two-pass planner below calls this twice. */
function layoutOnce(clean, totalBoxes, heightOf, rules) {
  const warnings = []
  const gradeList = bucketGrades(clean, rules)

  // Stacks, then gather them by species so a species stays whole.
  const speciesList = new Map()
  for (const g of gradeList) {
    const height = heightOf(g)
    const stacks = buildStacks(g.days, height).map((s) => ({
      species: g.species, grade: g.grade, auction: g.auction,
      height, max: g.max, lowered: height < g.max,
      boxes: s.boxes, parts: s.parts, prime: g.prime, seq: g.seq,
    }))
    const key = `${g.auction}||${g.species}`
    if (!speciesList.has(key)) speciesList.set(key, { species: g.species, auction: g.auction, stacks: [] })
    speciesList.get(key).stacks.push(...stacks)
  }

  // Order: clock 1→n; within a clock the biggest species first, so the awkward
  // remainders are the small ones; within a species the prime grades first,
  // which is what puts them low and at the head of the run.
  const order = new Map(rules.clocks.map((a, i) => [a.id, i]))
  const species = [...speciesList.values()].sort((a, b) =>
    order.get(a.auction) - order.get(b.auction) ||
    b.stacks.length - a.stacks.length ||
    a.species.localeCompare(b.species))
  // Grades in the order the tally lists them, which is the grading order the
  // market itself uses — biggest first. Sorting by grade NAME put Sprag above
  // Med and Cod above Large, which is not how anyone reads a market.
  for (const sp of species) sp.stacks.sort((a, b) => a.seq - b.seq)

  const footprints = species.reduce((s, sp) => s + sp.stacks.length, 0)

  // Hand each species to the row that is furthest behind its share. Only the
  // flats auction may be broken across the two rows.
  const rows = { top: [], bottom: [] }
  const pressure = (r) => (r === 'top' ? rows.top.length / TOP_ROW : rows.bottom.length / BOTTOM_ROW)
  for (const sp of species) {
    if (rules.canSplitRows(sp.auction)) {
      for (const st of sp.stacks) rows[pressure('top') <= pressure('bottom') ? 'top' : 'bottom'].push(st)
    } else {
      const band = pressure('top') <= pressure('bottom') ? 'top' : 'bottom'
      rows[band].push(...sp.stacks)
    }
  }

  // Tiers are set by whichever row runs out first.
  const tiers = Math.max(Math.ceil(rows.top.length / TOP_ROW), Math.ceil(rows.bottom.length / BOTTOM_ROW), 1)

  const byTier = []
  for (let t = 0; t < tiers; t++) {
    byTier.push({
      tier: t + 1,
      top: rows.top.slice(t * TOP_ROW, (t + 1) * TOP_ROW),
      bottom: rows.bottom.slice(t * BOTTOM_ROW, (t + 1) * BOTTOM_ROW),
    })
  }

  // Which tiers each clock lands on — what you actually tell the market.
  const auctionSpans = rules.clocks.map((a) => {
    const hits = []
    byTier.forEach((t, i) => {
      if ([...t.top, ...t.bottom].some((s) => s.auction === a.id)) hits.push(i + 1)
    })
    const boxes = species.filter((s) => s.auction === a.id)
      .reduce((sum, s) => sum + s.stacks.reduce((x, st) => x + st.boxes, 0), 0)
    return { ...a, boxes, from: hits[0] || null, to: hits[hits.length - 1] || null, tiers: hits.length }
  }).filter((a) => a.boxes > 0)

  for (const a of auctionSpans) {
    if (a.tiers && a.to - a.from + 1 !== a.tiers) {
      warnings.push(`${a.label} is split across tiers ${a.from}–${a.to} rather than sitting in one run.`)
    }
  }

  return { tiers, totalBoxes, footprints, rows, byTier, auctionSpans, warnings, species, gradeList }
}

/* → { tiers, ruleOfThumb, totalBoxes, footprints, rows, auctionSpans, warnings }
 *
 * `opts.rules` is a resolved rules object (see resolveRules). Omit it and the
 * built-in defaults are used, which is what the tests and the scripts do. */
export function planLayout(lines, opts = {}) {
  const rules = opts.rules || RULES
  const clean = (lines || []).filter((l) => Number(l.boxes) > 0)
  const totalBoxes = clean.reduce((s, l) => s + Number(l.boxes), 0)
  if (!totalBoxes) {
    return { tiers: 0, ruleOfThumb: 0, totalBoxes: 0, footprints: 0, spare: 0, lowered: [], unfiled: [],
             rows: { top: [], bottom: [] }, byTier: [], auctionSpans: [], warnings: ['Nothing on the tally.'] }
  }

  // A caller dictating heights gets exactly those heights and no second-
  // guessing — that is the point of passing them.
  const fixed = opts.heightFor && ((g) => opts.heightFor(g.species, g.grade))

  // Pass one: everything at its ceiling. This is what sets the tier count, and
  // nothing below is allowed to raise it.
  let plan = layoutOnce(clean, totalBoxes, fixed || ((g) => g.max), rules)
  let heights = null

  if (!fixed && opts.drop !== false) {
    const ceiling = plan.tiers
    // Footprints going spare inside the tiers already being paid for.
    let budget = ceiling * PER_TIER_FLAT - plan.footprints

    // The budget is a total, but the two rows fill independently, so a drop
    // that fits on paper can still push one row over. Back off until it holds
    // rather than trusting the arithmetic.
    while (budget > 0) {
      const tryHeights = solveDrops(plan.gradeList, budget)
      const candidate = layoutOnce(clean, totalBoxes, (g) => tryHeights.get(g.key) ?? g.max, rules)
      if (candidate.tiers <= ceiling) { plan = candidate; heights = tryHeights; break }
      budget -= 1
    }
  }

  const ruleOfThumb = tiersByRuleOfThumb(totalBoxes)
  const spare = plan.tiers * PER_TIER_FLAT - plan.footprints

  // What ended up laid lower than its ceiling, for the page to show — this is
  // a decision the skipper should be able to see and overrule, not a silent one.
  const lowered = []
  if (heights) {
    for (const g of plan.gradeList) {
      const h = heights.get(g.key)
      if (h < g.max) {
        lowered.push({ species: g.species, grade: g.grade, boxes: g.boxes,
                       from: g.max, to: h, seq: g.seq, value: g.value })
      }
    }
    lowered.sort((a, b) => b.value - a.value || a.seq - b.seq)
  }

  // A species nobody has put on a clock still gets laid out, on the last clock
  // and at the fallback height — but it is named, because a fish quietly sent
  // to the wrong auction is worse than one you were told about. The market
  // does move species between clocks, which is the whole reason the rules are
  // editable.
  const unfiled = [...new Set(clean.map((l) => l.species))].filter((s) => !rules.isFiled(s))

  const warnings = [...plan.warnings]
  if (plan.tiers > ruleOfThumb) {
    warnings.push(`Needs ${plan.tiers} tiers, but the ÷94 rule would have asked for ${ruleOfThumb}. Ask for ${plan.tiers}.`)
  }
  if (unfiled.length) {
    const one = unfiled.length === 1
    const fb = rules.clock(rules.fallbackClock)
    warnings.push(`${unfiled.join(', ')} ${one ? 'is' : 'are'} not on a clock, so ${one ? 'it has' : 'they have'} gone on ${fb?.label || 'the last one'}. Set ${one ? 'it' : 'them'} on Market Rules.`)
  }

  return {
    tiers: plan.tiers, ruleOfThumb, totalBoxes, footprints: plan.footprints, spare, lowered, unfiled,
    rows: plan.rows, byTier: plan.byTier, auctionSpans: plan.auctionSpans,
    warnings, species: plan.species, clocks: rules.clocks,
  }
}
