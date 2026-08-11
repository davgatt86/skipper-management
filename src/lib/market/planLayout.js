import {
  TOP_ROW, BOTTOM_ROW, PER_TIER_FLAT, tiersByRuleOfThumb,
  AUCTIONS, auctionFor, canSplitBands, maxHeight, isPrime,
} from './layoutRules.js'

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

/* → { tiers, ruleOfThumb, totalBoxes, footprints, rows, auctionSpans, warnings } */
export function planLayout(lines, opts = {}) {
  const warnings = []
  const clean = (lines || []).filter((l) => Number(l.boxes) > 0)
  const totalBoxes = clean.reduce((s, l) => s + Number(l.boxes), 0)
  if (!totalBoxes) {
    return { tiers: 0, ruleOfThumb: 0, totalBoxes: 0, footprints: 0,
             rows: { top: [], bottom: [] }, byTier: [], auctionSpans: [], warnings: ['Nothing on the tally.'] }
  }

  // 1. One bucket per species+grade, carrying its days.
  const grades = new Map()
  for (const l of clean) {
    const key = `${l.species}||${l.grade}`
    if (!grades.has(key)) {
      grades.set(key, {
        species: l.species, grade: l.grade,
        auction: auctionFor(l.species),
        height: opts.heightFor ? opts.heightFor(l.species, l.grade) : maxHeight(l.species, l.grade),
        prime: isPrime(l.species, l.grade),
        // Position in the tally, which is grading order. Falls back to a big
        // number so a line without it sorts last rather than first.
        seq: Number.isFinite(l.seq) ? l.seq : Number.MAX_SAFE_INTEGER,
        days: [],
      })
    }
    if (Number.isFinite(l.seq)) grades.get(key).seq = Math.min(grades.get(key).seq, l.seq)
    grades.get(key).days.push({ day: Number(l.day), boxes: Number(l.boxes) })
  }

  // 2. Stacks, then gather them by species so a species stays whole.
  const speciesList = new Map()
  for (const g of grades.values()) {
    const stacks = buildStacks(g.days, g.height).map((s) => ({
      species: g.species, grade: g.grade, auction: g.auction,
      height: g.height, boxes: s.boxes, parts: s.parts, prime: g.prime, seq: g.seq,
    }))
    const key = `${g.auction}||${g.species}`
    if (!speciesList.has(key)) speciesList.set(key, { species: g.species, auction: g.auction, stacks: [] })
    speciesList.get(key).stacks.push(...stacks)
  }

  // Order: auction 1→4; within an auction the biggest species first, so the
  // awkward remainders are the small ones; within a species the prime grades
  // first, which is what puts them low and at the head of the run.
  const order = new Map(AUCTIONS.map((a, i) => [a.id, i]))
  const species = [...speciesList.values()].sort((a, b) =>
    order.get(a.auction) - order.get(b.auction) ||
    b.stacks.length - a.stacks.length ||
    a.species.localeCompare(b.species))
  // Grades in the order the tally lists them, which is the grading order the
  // market itself uses — biggest first. Sorting by grade NAME put Sprag above
  // Med and Cod above Large, which is not how anyone reads a market.
  for (const sp of species) sp.stacks.sort((a, b) => a.seq - b.seq)

  const footprints = species.reduce((s, sp) => s + sp.stacks.length, 0)

  // 3. Hand each species to the row that is furthest behind its share. Only
  //    the flats auction may be broken across the two rows.
  const rows = { top: [], bottom: [] }
  const pressure = (r) => (r === 'top' ? rows.top.length / TOP_ROW : rows.bottom.length / BOTTOM_ROW)
  for (const sp of species) {
    if (canSplitBands(sp.auction)) {
      for (const st of sp.stacks) rows[pressure('top') <= pressure('bottom') ? 'top' : 'bottom'].push(st)
    } else {
      const band = pressure('top') <= pressure('bottom') ? 'top' : 'bottom'
      rows[band].push(...sp.stacks)
    }
  }

  // 4. Tiers are set by whichever row runs out first.
  const tiers = Math.max(Math.ceil(rows.top.length / TOP_ROW), Math.ceil(rows.bottom.length / BOTTOM_ROW), 1)
  const ruleOfThumb = tiersByRuleOfThumb(totalBoxes)

  const byTier = []
  for (let t = 0; t < tiers; t++) {
    byTier.push({
      tier: t + 1,
      top: rows.top.slice(t * TOP_ROW, (t + 1) * TOP_ROW),
      bottom: rows.bottom.slice(t * BOTTOM_ROW, (t + 1) * BOTTOM_ROW),
    })
  }

  // Which tiers each auction lands on — what you actually tell the market.
  const auctionSpans = AUCTIONS.map((a) => {
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
  if (tiers > ruleOfThumb) {
    warnings.push(`Needs ${tiers} tiers, but the ÷94 rule would have asked for ${ruleOfThumb}. Ask for ${tiers}.`)
  }

  return { tiers, ruleOfThumb, totalBoxes, footprints, rows, byTier, auctionSpans, warnings, species }
}
