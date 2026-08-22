import { TOP_ROW, BOTTOM_ROW, PER_TIER_FLAT, tiersByRuleOfThumb, RULES, isPrime } from './layoutRules.js'
import { bySaleOrder } from './auctionOrder.js'

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
/* `forceMode` pins the shape to whatever the CEILING pass chose.
 *
 * The tier count is decided by that first pass and nothing below may raise it.
 * The single-species fallback exists to bring the tier count down, so letting
 * the second pass re-decide it is wrong twice over: it changes the shape of a
 * sheet whose tier count is already settled, and it fires on trips where it
 * saves nothing.
 *
 * Trip 61 is the case. Row bands gave 18 tiers at ceiling heights. The drops
 * pass lays fish lower, so row bands then wanted 19 and the fallback stepped
 * in at 18 — flipping a perfectly good sheet into one where cod, haddock,
 * black, ling, lythe, hake and lemons were ALL split across the two rows, for
 * no tier at all. That is the "why is the flats doubled" complaint applied to
 * every fish on the market. */
function layoutOnce(clean, totalBoxes, heightOf, rules, forceMode) {
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

  /* Order: clock 1→n, then THE ORDER THE MARKET SELLS IN.
   *
   * Within a clock it used to be "biggest species first, so the awkward
   * remainders are the small ones" — a packing convenience with nothing to
   * do with the auction. It is now the sale order measured off Peterhead's
   * own transaction export, so a buyer following the rough walks the fish in
   * the order the clock will offer it. See `auctionOrder.js`.
   *
   * It orders species WITHIN a clock and never between: the measured
   * sequence interleaves them — lemons sell between lythe and tusk — and
   * reading it globally would undo keeping a clock in one run.
   *
   * A species the sale order has never seen keeps the tally's own position,
   * which is the honest answer. Haddock and whiting are not on a live clock
   * yet, so that is most of a Peterhead sheet by volume. */
  const order = new Map(rules.clocks.map((a, i) => [a.id, i]))
  const seqOfSpecies = new Map([...speciesList.values()]
    .map((s) => [s.species, Math.min(...s.stacks.map((st) => st.seq))]))
  const saleOrder = bySaleOrder(rules.auctionOrder, (sp) => seqOfSpecies.get(sp) ?? 0)
  const species = [...speciesList.values()].sort((a, b) =>
    order.get(a.auction) - order.get(b.auction) ||
    saleOrder(a.species, b.species))
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
    let bestT = 0
    for (let mv = 1; mv <= movable; mv++) {
      const fromLen = r[from].length - mv
      const toLen = r[to].length + mv
      const t = from === 'top' ? tiersFor(fromLen, toLen) : tiersFor(toLen, fromLen)
      if (t >= start) continue
      /* A SPECIES MAY ONLY BE CUT BY A TOP-TO-BOTTOM SPILL.
       *
       * Splitting one flat is the documented exception and it works: Trip 64
       * carries hake 62/9 off the end of tier 17's top into the start of tier
       * 17's bottom, which is the very next thing walked, so it reads as one
       * run.
       *
       * The other direction can never do that. A tier is walked top row then
       * bottom row, so a chunk moved from the BOTTOM into the same tier's top
       * is walked BEFORE the part it was taken from — the halves come out back
       * to front with the whole tier between them. On David's Trip 63 sheet
       * the spill took 5 of the 8 halibut off the bottom and left 3:
       *
       *     tier 16 top     HALIBUT x5 | TURBOT x1
       *     tier 16 bottom  LEMONS x6 | PLAICE x4 | MEGS x12 | WITCH x1 | HALIBUT x3
       *
       * — the same fish at both ends of one tier. David: "in that last tier
       * the halibut isn't next to each other."
       *
       * So a bottom-to-top spill must take WHOLE species. On Trip 63 that
       * moves all 8 halibut and the turbot, fits in the same 16 tiers, and
       * leaves every fish in one place.
       */
      const cut = r[from].length - mv
      if (strict && from === 'bottom' && cut > 0 && cut < r[from].length
          && r[from][cut - 1].species === r[from][cut].species) continue
      // Does the receiving row ALREADY reach the tier the donor now ends on?
      // Its current length is what decides where the spill can be inserted; if
      // the row stops short of that tier the two halves land in different tiers
      // and the carry-over is broken.
      const destTier = Math.max(1, Math.ceil(fromLen / rowSize(from)))
      const at = (destTier - 1) * rowSize(to)
      if (strict && r[to].length < at) continue
      /* AND THE INSERTION POINT MUST NOT CUT A RUN — SPECIES OR CLOCK.
       *
       * The spill shuffles whatever is already in the receiving row along
       * behind it, which costs those fish nothing PROVIDED the cut falls
       * between two runs. It does not always. Checking the species alone was
       * not enough, and both failures came off real tallies:
       *
       *   Trip 63  the tier boundary landed inside the lythe, and a whole
       *            run came out LYTHE x16 | LEMONS x8 | LYTHE x14.
       *   Trip 55  it landed cleanly BETWEEN two species and still inside
       *            the rough clock, giving rough x442 | flats x19 | rough x3
       *            — a buyer following the rough walks past the flats and
       *            back, which is the complaint this whole change is about.
       *
       * Nothing to weigh up: a tier is not worth breaking a second run to
       * save. If the boundary does not fall cleanly this many is not
       * spillable and the loop tries the next. */
      const cuts = (k) => at > 0 && at < r[to].length && r[to][at - 1][k] === r[to][at][k]
      if (strict && (cuts('species') || cuts('auction'))) continue
      if (strict) { take = mv; break }
      /* THE LOOSE PASS TAKES THE BEST, NOT THE FIRST.
       *
       * The strict path deliberately moves the FEWEST that drops a tier, to
       * keep the split as small as possible. The loose figure is not laying
       * anything out — it exists only to answer "what did the rule cost?" —
       * so it has to be the best the tally could have done, or the answer is
       * too flattering. On Trip 64 the first-that-drops reading said 18 both
       * ways and the page stayed silent, when 17 was genuinely available. */
      if (!bestT || t < bestT) { bestT = t; take = mv }
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

  let looseTiers = null

  /* Everything from a pair of rows to a finished plan. Shared, because the
   * single-species fallback above builds its rows a different way and must
   * come out of the same door — tiers, spans and warnings all alike. */
  const finish = (rows, mode) => {
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

    for (const a of auctionSpans) {
      if (a.tiers && a.to - a.from + 1 !== a.tiers) {
        warnings.push(`${a.label} is split across tiers ${a.from}–${a.to} rather than sitting in one run.`)
      }
    }

    /* `looseTiers` is what the SAME tally would come to if the spill were
     * allowed to break a second fish. Reported, never laid out — and read off
     * the CEILING pass, see planLayout. */
    return { tiers, looseTiers, mode, totalBoxes, footprints, rows, byTier, auctionSpans, warnings, species, gradeList }
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

  /* WHEN ONE FISH IS THE WHOLE MARKET, IT HAS TO GO DOWN BOTH ROWS.
   *
   * "A species goes into a row WHOLE" is right for a mixed trip and absurd for
   * a single-species one. Trip 60 landed 1,626 boxes of which 1,602 were
   * haddock — 757 footprints. Held to one row that is 757 ÷ 26 = 30 tiers with
   * the top row empty in 29 of them, against a floor of 17. Trip 57 is the
   * same shape: 28 against 16. The sheet asked Peterhead for thirteen tiers of
   * market that were never going to hold a fish.
   *
   * No arrangement avoids it. At 17 tiers the market offers 357 places on the
   * top row and 442 on the bottom; the haddock alone needs 757. It goes down
   * both sides of the walkway because there is nowhere else for it.
   *
   * So the sheet is laid in WALK ORDER instead — 21 into the top of a tier, 26
   * into the bottom, then on to the next. That is exactly the order a tier is
   * walked, so every species still reads as one unbroken run to a buyer
   * following it, which is a stronger guarantee than keeping it in one row,
   * not a weaker one.
   *
   * The alternative was to band the grades, the first half along the top row
   * and the rest along the bottom, and it breaks David's own rule: a fish that
   * starts at tier 15 top continues at tier 15 bottom, it does not reappear
   * ten tiers away.
   *
   * IT IS DECIDED ON THE OUTCOME, NOT THE SHAPE. An earlier version fired
   * whenever a clock was bigger than a row could hold, which caught trips
   * where the spill already deals with it perfectly well and cost nothing. It
   * now runs only when it actually saves tiers AND the clock genuinely cannot
   * be held in one row at that count. Every tally that already sat on its
   * floor is untouched — checked against all twelve, not assumed.
   */
  const floorTiers = Math.max(1, Math.ceil(footprints / (TOP_ROW + BOTTOM_ROW)))
  if (forceMode !== 'rows' && best.t > floorTiers) {
    const all = byClock.flatMap((c) => c.stacks)
    const walk = { top: [], bottom: [] }
    for (let i = 0; i < all.length;) {
      walk.top.push(...all.slice(i, i + TOP_ROW)); i += TOP_ROW
      walk.bottom.push(...all.slice(i, i + BOTTOM_ROW)); i += BOTTOM_ROW
    }
    const walkTiers = tiersFor(walk.top.length, walk.bottom.length)
    const forced = byClock.some((c) => c.stacks.length > BOTTOM_ROW * walkTiers)
    if (walkTiers < best.t && forced) {
      warnings.push(
        `One fish fills the market here, so it is laid down BOTH rows in the order a tier is `
        + `walked. Keeping it to one row would take ${best.t} tiers instead of ${walkTiers}, `
        + `with the other row standing empty.`,
      )
      return finish(walk, 'walk')
    }
  }

  return finish(best.lay, 'rows')

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
   * than a tier of flats — but a tier is real market floor, and this page
   * does not spend one silently. Same argument as `plan.held`, which reports
   * only where a floor actually bit.
   *
   * IT IS READ OFF THIS PASS, NOT THE FINISHED PLAN. The ceiling pass is
   * what fixes the tier count; `solveDrops` then spends the room inside
   * those tiers laying dear fish flatter. Ask the finished plan and the
   * comparison is already gone — Trip 64 is 18 tiers against a possible 17
   * and said nothing at all, because by then the drops had taken the 795
   * footprints to 803 and 18 was the floor for both. */
  const looseCeiling = plan.looseTiers
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
      const candidate = layoutOnce(clean, totalBoxes, (g) => tryHeights.get(g.key) ?? g.max, rules, plan.mode)
      if (candidate.tiers <= ceiling) { plan = candidate; heights = tryHeights; break }
      budget -= 1
    }
  }

  if (looseCeiling != null && looseCeiling < plan.tiers) {
    const n = plan.tiers - looseCeiling
    plan.warnings.push(`${plan.tiers} tiers keeps every fish in one run. ${looseCeiling} would `
      + `fit (${n} fewer), but only by splitting one so it reads as two lots on the floor.`)
  }

  const ruleOfThumb = tiersByRuleOfThumb(totalBoxes)
  const spare = plan.tiers * PER_TIER_FLAT - plan.footprints

  /* WHERE THE SPARE ROOM IS, not just how much of it there is.
   *
   * The rows fill independently, so a total is not a budget. On Trip 63 the
   * sheet came out with 15 footprints going spare and the megrim still stacked
   * two high — David, looking at the printed page: "the megs could go flat to
   * use up some of the space left."
   *
   * They could not. Every one of those 15 places was on the TOP row of the
   * last tier, and the megrim are on the BOTTOM row, which is full to the last
   * place. Laying them flat would have added a seventeenth tier.
   *
   * The page used to say "15 footprints still spare — not enough to drop
   * another grade a full level", which is true and reads as an arithmetic
   * shortfall when it is nothing of the kind. Reporting the two rows lets it
   * say the real reason. */
  const spareTop = plan.tiers * TOP_ROW - plan.rows.top.length
  const spareBottom = plan.tiers * BOTTOM_ROW - plan.rows.bottom.length

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
    tiers: plan.tiers, mode: plan.mode, ruleOfThumb, totalBoxes, footprints: plan.footprints,
    spare, spareTop, spareBottom, lowered, held, unfiled,
    rows: plan.rows, byTier: plan.byTier, auctionSpans: plan.auctionSpans,
    warnings, species: plan.species, clocks: rules.clocks,
  }
}
