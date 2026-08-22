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
        // How low this grade is allowed to go. 1 for most fish; higher for the
        // bulk grades, where flattening swallows the floor and buys nothing.
        min: rules.minHeight(l.species, l.grade),
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
      // The floor, not 1. A grade held at its floor is one the skipper has
      // said must not come down any further — a bulk grade laid flat costs
      // the whole market and buys nobody a better look at the fish.
      if (h <= Math.max(1, g.min || 1)) continue
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

  const rowSize = (r) => (r === 'top' ? TOP_ROW : BOTTOM_ROW)
  const tiersFor = (t, b) => Math.max(Math.ceil(t / TOP_ROW), Math.ceil(b / BOTTOM_ROW), 1)

  /* THE SPILL, as a function of a pair of rows — because the assignment
   * above has to be scored on what the sheet ACTUALLY comes to, and that is
   * the tier count AFTER the flats have moved. Scoring the raw assignment
   * put the flats on whichever row came out emptier on a "many species"
   * tally, which is the one row the spill is not allowed to take from: it
   * may only move a run of SPLITTABLE stacks off the end of the FULLER row.
   * So the layout it chose was one the spill could not then rescue, and the
   * sheet came out a tier longer than it needed to be. */
  const spillOnce = (top, bottom, strict = true) => {
    const r = { top: [...top], bottom: [...bottom] }
    /* ONLY NOW does a splittable clock spill, and only as far as it must.
     *
     * The rule is "the flats MAY be broken across the two rows to use up space
     * the other three leave behind" — not "cut every flat down the middle". The
     * old code handed each STACK to whichever row was behind, which did exactly
     * that: on Trip 64 it split hake 39/32, megrim 9/10, lemons 6/7 and halibut
     * 4/5, so four species appeared twice and a buyer after hake had to walk
     * both rows. That is precisely what keeping a species in one band is for,
     * and David spotted it on the printed sheet — "why is the flats doubled".
     *
     * So: move ONE contiguous run off the end of the fuller row, take the
     * FEWEST stacks that drop a tier, and if nothing drops a tier move nothing
     * at all. At most one species ends up split, at one clean break, and only
     * when the split is genuinely paying for itself. On Trip 64 that is still
     * 17 tiers rather than 18; on Trip 63 the split earned nothing and now does
     * not happen. */
    const start = tiersFor(r.top.length, r.bottom.length)
    const from = Math.ceil(r.top.length / TOP_ROW) >= Math.ceil(r.bottom.length / BOTTOM_ROW) ? 'top' : 'bottom'
    const to = from === 'top' ? 'bottom' : 'top'
    // Only the trailing stacks whose clock allows a split may move.
    let movable = 0
    while (movable < r[from].length
           && rules.canSplitRows(r[from][r[from].length - 1 - movable].auction)) movable++
    /* Pick how many to move.
     *
     * It has to do two things at once: drop a tier, and land in the SAME tier
     * the donor row now ends in — a tier is walked top row then bottom row, so a
     * fish that spills must carry straight over with nothing between the halves.
     * Moving the bare minimum can leave the receiving row still short of that
     * tier, in which case the two halves end up in different tiers, which is
     * the break David objected to.
     *
     * So take the FEWEST that satisfies both. If nothing does, spill nothing
     * and wear the extra tier — a sheet that reads correctly is worth more than
     * a tier, and this is the flats, which is a handful of boxes. */
    let take = 0
    for (let mv = 1; mv <= movable; mv++) {
      const fromLen = r[from].length - mv
      const toLen = r[to].length + mv
      const t = from === 'top' ? tiersFor(fromLen, toLen) : tiersFor(toLen, fromLen)
      if (t >= start) continue
      // Does the receiving row ALREADY reach the tier the donor now ends on?
      // Its current length is what decides where the spill can be inserted; if
      // the row stops short of that tier the two halves land in different tiers
      // and the carry-over is broken.
      const destTier = Math.max(1, Math.ceil(fromLen / rowSize(from)))
      const at = (destTier - 1) * rowSize(to)
      if (strict && r[to].length < at) continue
      /* AND THE INSERTION POINT MUST BE A SPECIES BOUNDARY.
       *
       * The spill shuffles everything already in the receiving row along
       * behind it, which costs those species nothing PROVIDED the cut falls
       * between two of them. It does not always: on a four-clock tally the
       * tier boundary landed in the middle of the lythe, so a run that had
       * been whole came out as LYTHE x16 | LEMONS x8 | LYTHE x14 — the
       * flats carried over correctly and broke a rough fish in half doing
       * it, which is the same complaint one species further along.
       *
       * There is nothing to weigh up here: a tier is not worth splitting a
       * second species to save. If the boundary does not fall cleanly, this
       * many is not spillable and the loop tries the next. */
      if (strict && at > 0 && at < r[to].length && r[to][at - 1].species === r[to][at].species) continue
      take = mv
      break
    }
    if (take) {
      const moved = r[from].splice(r[from].length - take, take)
      /* AND IT LANDS AT THE START OF THE SAME TIER'S OTHER ROW.
       *
       * A tier is walked top row then bottom row, so a fish that spills has to
       * carry straight off the end of the one into the beginning of the other
       * with nothing in between. Appending it to the end of the row instead put
       * four species between the two halves of the hake on Trip 64:
       *
       *   tier 17 top     HAKE x21
       *   tier 17 bottom  HALIBUT x7 | WITCH x2 | PLAICE x1 | TURBOT x1 | HAKE x9
       *
       * David: "if hake is started at top tier 15, it can only go to bottom
       * tier 15 — continued from top to bottom with no breaks of another
       * species between."
       *
       * The donor row now ends exactly on a tier boundary, so that tier is where
       * the spill belongs; everything already in its other row shuffles along
       * behind, which costs those species nothing since they stay in one run. */
      const destTier = Math.max(1, Math.ceil(r[from].length / rowSize(from)))
      const at = Math.min((destTier - 1) * rowSize(to), r[to].length)
      r[to].splice(at, 0, ...moved)
    }

    return r
  }

  /* THE UNIT PLACED IS THE CLOCK, NOT THE SPECIES.
   *
   * It used to hand each SPECIES to whichever row was furthest behind its
   * share. That balanced the rows beautifully and shredded the clocks across
   * both of them. On the 19-08-2026 sheet the rough came out with monks and
   * lythe on the TOP row and ling and tusk on the BOTTOM, and the flats with
   * hake on the top and lemons, megrim and halibut below — so a buyer
   * following the rough walked the top for his monks and came back along the
   * bottom for his ling, and the flats read as two separate lots.
   *
   * David: "why is the ling not at the top with the rest of the rough and the
   * hake with the rest of the flats… ling could've been after lythe, and if
   * there was a spare tier at top, put some flats into it."
   *
   * So a clock goes WHOLE to one row. Deciding only at clock boundaries makes
   * the split he objected to impossible to produce, and the second half of
   * what he asks for — the flats moving up to use the room the others leave —
   * is the spill below, which was already there and already knows how to carry
   * a fish over inside ONE tier.
   *
   * THE ASSIGNMENT IS SEARCHED, NOT GUESSED. There are only a handful of
   * clocks, so every way of dealing them between the two rows is tried and the
   * one needing fewest tiers wins. Greedy alternatives were tried first and
   * both cost tiers: filling the top to its 21/47ths share and switching cost
   * one on a rough-heavy trip, because a big clock packs better on the bottom
   * row (26 to a tier) than the top (21) and greedy cannot see that coming.
   * Measured across five tally shapes, the search costs nothing anywhere and
   * saves one or two tiers on three of them. */
  const byClock = []
  for (const sp of species) {
    const last = byClock[byClock.length - 1]
    if (last && last.id === sp.auction) last.stacks.push(...sp.stacks)
    else byClock.push({ id: sp.auction, stacks: [...sp.stacks] })
  }

  const layFor = (mask) => {
    const top = [], bottom = []
    byClock.forEach((cl, i) => ((mask >> i) & 1 ? bottom : top).push(...cl.stacks))
    return { top, bottom }
  }

  /* 2^n over the clocks — four of them today, so sixteen tries. Capped so a
   * fleet that invents a dozen clocks falls back to everything on the top row
   * and lets the spill sort it out, rather than hanging the page.
   *
   * EACH ASSIGNMENT IS SCORED AFTER ITS SPILL, not before. Judged raw, a
   * "many species" tally put the flats on whichever row came out emptier —
   * and the spill may only take from the FULLER row, so it could do nothing
   * about it and the sheet ran a tier long. Scoring the finished thing lets
   * the search pick a layout the spill can then rescue. */
  let looseTiers = null
  let best = null
  const combos = byClock.length <= 12 ? 1 << byClock.length : 1
  for (let mask = 0; mask < combos; mask++) {
    const raw = layFor(mask)
    const lay = spillOnce(raw.top, raw.bottom)
    const t = tiersFor(lay.top.length, lay.bottom.length)
    /* What the same assignment would come to if the spill were allowed to cut
     * a second species. Never used to lay anything out — only to report what
     * keeping every run whole actually cost. */
    const loose = spillOnce(raw.top, raw.bottom, false)
    const lt = tiersFor(loose.top.length, loose.bottom.length)
    if (looseTiers === null || lt < looseTiers) looseTiers = lt
    // Fewest tiers wins; on a tie the more level pair of rows, which wastes
    // less of the last tier and leaves the fish easier to walk.
    const level = Math.abs(lay.top.length / TOP_ROW - lay.bottom.length / BOTTOM_ROW)
    if (!best || t < best.t || (t === best.t && level < best.level)) best = { t, level, lay }
  }
  const rows = best.lay


  // Tiers are set by whichever row runs out first.
  const tiers = tiersFor(rows.top.length, rows.bottom.length)

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

  /* WHAT KEEPING EVERY FISH IN ONE RUN COST, IF IT COST ANYTHING.
   *
   * Every rule on this page is a trade against floor space, and these ones
   * can take a tier. A spill that would drop one is refused twice over: when
   * its landing point falls inside another species (carrying the flats over
   * cleanly by cutting the lythe in half is the same complaint one fish
   * further along), and when the receiving row does not reach that tier at
   * all, which puts the two halves in different tiers.
   *
   * Both refusals are right — a sheet that reads correctly is worth more
   * than a tier of flats — but a tier is real market, so it is said out loud
   * rather than quietly spent. Same argument as `plan.held`, which reports
   * only where a floor actually bit. On the real Trip 56 tally it costs
   * nothing and nothing is said. */
  if (looseTiers !== null && looseTiers < tiers) {
    const n = tiers - looseTiers
    warnings.push(`${tiers} tiers keeps every fish in one run. ${looseTiers} would fit `
      + `(${n} fewer), but only by splitting one so it reads as two lots on the floor.`)
  }

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
    return { tiers: 0, ruleOfThumb: 0, totalBoxes: 0, footprints: 0, spare: 0, lowered: [], held: [], unfiled: [],
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

  // What the floors held up. Shown beside what was dropped, because a rule
  // that quietly refuses is as confusing as one that quietly acts — and this
  // is the list to loosen from when a trip has room going spare.
  const held = plan.gradeList
    .filter((g) => g.min > 1 && g.max > 1)
    .map((g) => ({
      species: g.species, grade: g.grade, boxes: g.boxes, seq: g.seq, value: g.value,
      max: g.max, floor: g.min, at: heights?.get(g.key) ?? g.max,
      // Could it have come down further but for the floor?
      blocked: (heights?.get(g.key) ?? g.max) <= g.min,
    }))
    .filter((h) => h.blocked)
    .sort((a, b) => b.value - a.value || a.seq - b.seq)

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
    tiers: plan.tiers, ruleOfThumb, totalBoxes, footprints: plan.footprints, spare, lowered, held, unfiled,
    rows: plan.rows, byTier: plan.byTier, auctionSpans: plan.auctionSpans,
    warnings, species: plan.species, clocks: rules.clocks,
  }
}
