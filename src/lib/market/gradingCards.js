/* THE BOX-TOP TICKETS, for what this trip actually landed.
 *
 * The boat keeps a folder of grading cards — one A4 page per species, eight
 * tickets to a page, each one SPECIES / GRADE NAME / GRADE CODE. David prints
 * them every week and most of it is fish he has not got: *"theres lot's i don't
 * need. large witch, XL hadd, etc, etc."* Trip 63 lands 60 grades out of a
 * folder that runs to twenty-odd pages.
 *
 * TWO TICKETS PER RUN — one where a grade starts, one where it finishes.
 *
 * David gave the count for cod on trip 63 and then, when I could not see why
 * baby cod needed four, spelled it out: *"a ticket at first box after big baby,
 * a ticket at bottom of 4th tier, ticket at top of 5th tier and a ticket
 * between baby and next speices/grade."*
 *
 * That is both ends of both runs. Baby cod sits at the end of tier 10's top row
 * and again at the start of tier 11's, so it is marked four times; big baby is
 * one run and is marked twice. All six of his cod figures come out of that rule
 * exactly.
 *
 * A RUN IS PER TIER AND PER ROW, and it has to be — the whole point is that a
 * buyer walking past sees what he is looking at. A grade carrying on into the
 * next tier is a new thing to label, because it is a new place on the floor.
 *
 * IT MUST BE COUNTED ON THE PLAN THE PAGE ACTUALLY PRODUCES. I first checked
 * this rule against the default rules rather than Audacious's own, which put
 * big baby and baby FLAT instead of 2HI — and that moves where the runs break.
 * Two of the six came out wrong and the rule looked broken when it was not.
 * The fleet's resolved rules are part of the answer, not a detail.
 */

/* REGRADED AT THE MARKET. The boat can only call these Large or Small; the
 * market splits them by weight, so the ticket carries a weight band and no
 * grade code — which is exactly how the boat's own artwork already draws them.
 *
 * Bands read off the folder: Turbot.pdf and Halibut.pdf. */
export const REGRADED = {
  TURBOT: ['0-1 kg', '1-2 kg', '2-3 kg', '3-4 kg', '4-5 kg', '5-7 kg', '7-9 kg', '9 kg+'],
  HALIBUT: ['1-3 kg', '3-5 kg', '5-10 kg', '10-15 kg', '15 kg+'],
}

export const isRegraded = (species) => Object.hasOwn(REGRADED, String(species || '').toUpperCase())

/* Split "Large (1b)" into its name and its code. Both go on the ticket and
 * neither identifies a grade on its own — `Seed (2a)` and `Chipper (2b)` share
 * a band, and "Large" is four different fish. */
export function splitGrade(grade) {
  const m = String(grade || '').match(/^(.*?)\s*\(([^)]+)\)\s*$/)
  return m ? { name: m[1].trim(), code: m[2].trim() } : { name: String(grade || '').trim(), code: '' }
}

/**
 * Every run of every grade, in the order the market is walked.
 *
 * A run is a stretch of one grade inside ONE row of ONE tier. Consecutive
 * footprints of the same grade are one run however many day tags they carry —
 * the ticket names the grade, not the tag.
 */
export function runsOf(plan) {
  const out = []
  for (const t of plan?.byTier || []) {
    for (const row of ['top', 'bottom']) {
      let cur = null
      for (const s of t[row] || []) {
        if (cur && cur.species === s.species && cur.grade === s.grade) {
          cur.footprints++; cur.boxes += Number(s.boxes) || 0
          continue
        }
        cur = {
          species: s.species,
          grade: s.grade,
          ...splitGrade(s.grade),
          tier: t.number ?? t.tier,
          area: t.area ?? null,
          row,
          footprints: 1,
          boxes: Number(s.boxes) || 0,
          height: s.height,
        }
        out.push(cur)
      }
    }
  }
  return out
}

/**
 * The tickets to print, in the order they are placed walking the market.
 *
 * Two per run — `at: 'start'` and `at: 'end'` — so a run of one footprint still
 * gets both. That is deliberate: the box is the start and the finish of that
 * grade, and a buyer coming the other way needs to read it too.
 */
export function ticketsFor(plan, opts = {}) {
  const { regradeBands = true } = opts
  const tickets = []

  for (const r of runsOf(plan)) {
    if (regradeBands && isRegraded(r.species)) continue   // handled in one block below
    tickets.push({ ...r, at: 'start' })
    tickets.push({ ...r, at: 'end' })
  }

  /* THE REGRADED FISH ARE GAUGED BY HOW MUCH THERE IS. David: "turbot and
   * halibut are regraded in market. so quantity of them would need to be gauged
   * by how much there is."
   *
   * The boat cannot say which band a box will fall in, so it prints bands
   * rather than grades — but printing all eight turbot bands for a single box
   * is the same waste this page exists to stop. One band per box, capped at the
   * bands that exist: 1 turbot box gives 1 ticket, 8 halibut boxes gives all
   * five. It is a guess at his rule and the easiest thing here to change. */
  if (regradeBands) {
    for (const [species, bands] of Object.entries(REGRADED)) {
      const runs = runsOf(plan).filter((r) => String(r.species).toUpperCase() === species)
      if (!runs.length) continue
      const boxes = runs.reduce((s, r) => s + r.boxes, 0)
      const n = Math.max(1, Math.min(bands.length, boxes))
      for (let i = 0; i < n; i++) {
        tickets.push({
          species, grade: bands[i], name: bands[i], code: '',
          regraded: true, boxes,
          tier: runs[0].tier, area: runs[0].area, row: runs[0].row,
          footprints: 0, at: 'band',
        })
      }
    }
  }

  return tickets
}

/** What the page needs to say about the printing: how many, how much paper. */
export function ticketSummary(plan, opts = {}) {
  const tickets = ticketsFor(plan, opts)
  const kinds = new Set(tickets.map((t) => t.species + '|' + t.grade))
  const regraded = tickets.filter((t) => t.regraded)
  return {
    tickets: tickets.length,
    kinds: kinds.size,
    pages: Math.ceil(tickets.length / 8),
    regraded: regraded.length,
    species: [...new Set(tickets.map((t) => t.species))],
  }
}

/* The grading table, cut down to what is aboard. The folder's four sheets carry
 * every grade Peterhead recognises; this is the handful the crew are actually
 * grading to, so it fits on a page and nobody reads past fish that is not
 * there — the same argument as the buyers' catalogue. */
export function tableFor(plan, table) {
  const landed = new Map()
  for (const r of runsOf(plan)) {
    if (!landed.has(r.species)) landed.set(r.species, new Set())
    landed.get(r.species).add(r.code || r.name)
  }
  const out = []
  for (const [species, codes] of landed) {
    const rows = (table?.[species] || []).filter((g) => codes.has(g.code))
    out.push({ species, rows, unknown: rows.length === 0 })
  }
  return out
}
