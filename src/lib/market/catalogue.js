import { bySaleOrder } from './auctionOrder.js'
/* THE BUYERS' CATALOGUE — what is on the floor, by day, for the auction.
 *
 * David, Aug 2026: buyers are complaining the auction is not clear. The market
 * staff catalogue it, and it is hard to keep track of what has been sold — so a
 * buyer cannot tell whether the lot coming up is day 5 fish or day 1.
 *
 * This is the same day tally the chalk sheet is built from, turned round to
 * face the other way: the chalk sheet tells the boat where to lay the fish, and
 * this tells the buyer what is there and in what order it will come up.
 *
 * THE FRESHEST DAY IS SOLD AS A+, EVERYTHING ELSE AS A. That is the whole
 * reason the day matters to a buyer, and it is why this sheet exists rather
 * than a plain species list.
 */

/* THE MARKET'S OWN TAG COLOURS, off the tally workbook's "Tag Colours" tab.
 *
 * NOT the same as DAY_INK in sheet.js, and the two must not be confused. That
 * one is brand colours for marking the boat's chalk sheet — an internal
 * document. These are what is physically printed on the tag stapled to the box,
 * so they are what a buyer standing at the auction actually sees. Using the
 * wrong set would put a colour on the sheet that matches nothing on the floor.
 */
export const TAG_COLOURS = [
  { day: 1, name: 'Black', hex: '#1B1B1B', ink: '#FFFFFF' },
  { day: 2, name: 'Purple', hex: '#5B3E9B', ink: '#FFFFFF' },
  { day: 3, name: 'Red', hex: '#C2342A', ink: '#FFFFFF' },
  { day: 4, name: 'Orange', hex: '#D97A14', ink: '#1B1B1B' },
  { day: 5, name: 'Green', hex: '#26654F', ink: '#FFFFFF' },
  { day: 6, name: 'Light Blue', hex: '#7FB6D6', ink: '#1B1B1B' },
  { day: 7, name: 'Yellow', hex: '#E8C51C', ink: '#1B1B1B' },
  { day: 8, name: 'Grey', hex: '#8A9096', ink: '#1B1B1B' },
  { day: 9, name: 'Pink', hex: '#E39BB8', ink: '#1B1B1B' },
  { day: 10, name: 'White', hex: '#FFFFFF', ink: '#1B1B1B' },
]
export const tagFor = (day) =>
  TAG_COLOURS.find((t) => t.day === Number(day))
  || { day: Number(day), name: `Day ${day}`, hex: '#ECEFEE', ink: '#1B1B1B' }

/* WHICH DAY IS THE FRESHEST.
 *
 * A boat fills day 1 first, so on a five-day trip day 5 is the last caught and
 * the freshest — and the auction runs freshest first, which is why a buyer
 * counts down 5, 4, 3, 2, 1.
 *
 * It is a parameter rather than an assumption baked in, because getting it
 * backwards would put A+ on the OLDEST fish on every sheet the market hands
 * out, and that is not a mistake worth risking on my reading of it.
 */
export const freshestDayOf = (days, mode = 'high') => {
  const d = (days || []).filter((n) => Number.isFinite(Number(n))).map(Number)
  if (!d.length) return null
  return mode === 'low' ? Math.min(...d) : Math.max(...d)
}

const clockOf = (rules, species) => {
  const key = String(species || '').trim().toUpperCase()
  return rules.speciesClock?.[key] ?? null
}

/* Build the catalogue.
 *
 * ONLY WHAT IS ABOARD. The tally already drops any species/grade/day with no
 * boxes, so nothing empty reaches here — a catalogue listing every grade the
 * market recognises would be a worse document than none, because the buyer
 * would have to read past the fish that is not there.
 *
 * Order, and none of it is alphabetical:
 *   clock   — the auction's own order, 1 Cod, 2 Haddock & Whiting, 3 Rough, 4 Flats
 *   species — the tally's own row order (`seq`), which is the grading order
 *   grade   — likewise
 *   day     — FRESHEST FIRST, because that is the order the lots come up
 */
export function buildCatalogue({ lines, rules, freshest = 'high' }) {
  const all = lines || []
  const days = [...new Set(all.map((l) => Number(l.day)))].filter(Number.isFinite)
  const freshestDay = freshestDayOf(days, freshest)

  // species -> grade -> rows, keeping the sheet's own order via seq.
  const bySpecies = new Map()
  for (const l of all) {
    if (!(Number(l.boxes) > 0)) continue
    const sp = String(l.species || '').trim()
    if (!bySpecies.has(sp)) bySpecies.set(sp, { species: sp, seq: l.seq, grades: new Map() })
    const s = bySpecies.get(sp)
    s.seq = Math.min(s.seq, l.seq)
    const g = String(l.grade || '').trim()
    if (!s.grades.has(g)) {
      s.grades.set(g, { grade: g, size: l.size || null, boxKg: l.boxKg || null, seq: l.seq, rows: [] })
    }
    const gr = s.grades.get(g)
    gr.seq = Math.min(gr.seq, l.seq)
    gr.rows.push({ day: Number(l.day), boxes: Number(l.boxes) })
  }

  const speciesList = [...bySpecies.values()]
    .map((s) => {
      const grades = [...s.grades.values()]
        .map((g) => {
          // Freshest first: the order the lots actually come up.
          const rows = g.rows.slice().sort((a, b) =>
            freshest === 'low' ? a.day - b.day : b.day - a.day)
          const total = rows.reduce((n, r) => n + r.boxes, 0)
          let sold = 0
          const marked = rows.map((r) => {
            sold += r.boxes
            return {
              ...r,
              tag: tagFor(r.day),
              // THE POINT OF THE SHEET. Only the freshest day is A+.
              mark: r.day === freshestDay ? 'A+' : 'A',
              /* How many boxes of this grade are still to come AFTER this lot.
               * That is the question a buyer is actually asking when he crosses
               * one off — "if I let this go, what is left?" */
              after: total - sold,
            }
          })
          return { ...g, rows: marked, total }
        })
        .sort((a, b) => a.seq - b.seq)
      return { ...s, grades, total: grades.reduce((n, g) => n + g.total, 0) }
    })

  /* SPECIES COME UP IN THE ORDER THE MARKET SELLS THEM — the same order the
   * chalk sheet lays them out in, off the same measured sequence.
   *
   * That is the whole use of this document. A buyer crossing a lot off wants
   * to know what is coming next, so a catalogue in a different order from the
   * floor is worse than no catalogue: he reads down for his next lot and finds
   * it three species away from where the fish actually is.
   *
   * One function, imported by both, so the two can never drift. Grades inside
   * a species keep the tally's own seq — the market's grading order, and the
   * export agrees, every block running 1 → 5. */
  const seqOf = new Map(speciesList.map((s) => [s.species, s.seq]))
  const cmp = bySaleOrder(rules.auctionOrder, (sp) => seqOf.get(sp) ?? 0)
  speciesList.sort((a, b) => cmp(a.species, b.species))

  // Group into the auction's clocks, in the clock's own order.
  const clocks = (rules.clocks || []).map((c) => ({
    clock: c,
    species: speciesList.filter((s) => clockOf(rules, s.species) === c.id),
  })).filter((c) => c.species.length)

  /* A species nobody has filed goes on the sheet anyway and is NAMED, the same
   * as the layout page does. Quietly leaving a fish off a catalogue the buyers
   * are working from is worse than an untidy heading. */
  const filed = new Set(clocks.flatMap((c) => c.species.map((s) => s.species)))
  const unfiled = speciesList.filter((s) => !filed.has(s.species))

  return {
    clocks,
    unfiled,
    days: days.sort((a, b) => (freshest === 'low' ? a - b : b - a)),
    freshestDay,
    freshest,
    totalBoxes: speciesList.reduce((n, s) => n + s.total, 0),
    speciesCount: speciesList.length,
  }
}

// One line of copy the sheet leads with, so nobody has to work out the rule.
export const freshestNote = (cat) =>
  cat.freshestDay == null
    ? 'No day tags on this tally.'
    : `Day ${cat.freshestDay} (${tagFor(cat.freshestDay).name}) is the freshest and sells as A+. Every other day is A.`
