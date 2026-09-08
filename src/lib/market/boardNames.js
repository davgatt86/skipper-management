/* THE BOARD AND THE NOTES DO NOT CALL EVERY FISH THE SAME THING.
 *
 * `market_prices` is the daily board — Peterhead and Denmark — and it has no
 * `fleet_id`, which is what makes it the one thing every boat has on the day
 * she signs up. `sales_rows.species_canon` is what she actually landed. Putting
 * the two side by side is the whole point of the dashboard, and it needs the
 * names to line up.
 *
 * MOSTLY THEY DO. Measured over the last sixty days of the board against every
 * species landed in 2026: 23 match exactly, including every one that matters —
 * cod, haddock, saithe, ling, whiting, monkfish, hake, megrim, witch, squid,
 * blue ling.
 *
 * TWO DO NOT, AND ONE OF THEM WOULD HAVE BITTEN IMMEDIATELY:
 *
 *   the board says   POLLACK       the notes say   LYTHE
 *   the board says   LEMON         the notes say   LEMON SOLE
 *
 * Lythe is Audacious's FIFTH species by value. On a naive join her own boat
 * would have shown a blank price in the feature's first week.
 *
 * LYTHE IS THE APP'S NAME AND POLLACK MAPS ONTO IT, which is what
 * `parse-core`'s SPECIES_CANON already did. That is not a preference: LYTHE is
 * also a GRADE LABEL the estimator matches as an exact string, and a species on
 * the market clocks and in the auction order. Renaming it would move three
 * other things, so the board's name is translated here — at the one place the
 * board is read — rather than the app's name being changed everywhere.
 *
 * David, Sep 2026: "lythe is pollock."
 */

/** App species name -> the name the market board uses for it. */
export const BOARD_NAME = {
  Lythe: 'Pollack',
  'Lemon Sole': 'Lemon',
}

/** The board's name for a species, or the species itself where they agree. */
export const boardNameFor = (species) => BOARD_NAME[species] || species

/** And back the other way, for reading a board row into the app's vocabulary. */
const FROM_BOARD = Object.fromEntries(Object.entries(BOARD_NAME).map(([a, b]) => [b, a]))
export const fromBoardName = (name) => FROM_BOARD[name] || name

/* THE THREE EVERY BOAT WATCHES, pinned to the top of every dashboard whatever
 * she lands. David, Sep 2026: "everyone's main stocks are cod, haddock and
 * saithe. so they should be top of everyone's pages, all grades of those
 * species."
 *
 * All grades of the three is 17 rows on the Peterhead board — cod A1-A5,
 * haddock A1-A4 with the A4 sub-grades, saithe A1-A4. A readable panel rather
 * than a wall, which is why it is three and not ten.
 */
export const PINNED = ['Cod', 'Haddock', 'Saithe']

/* WHAT A BOAT WITH NO SALES NOTES YET GETS, and it is MEASURED rather than
 * chosen: across the seven real fleets on the record, the species after the
 * pinned three are whiting, ling and hake. So a brand-new boat sees something
 * true of most boats until her first note lands, and it improves the moment it
 * does.
 */
export const FALLBACK_EXTRAS = ['Whiting', 'Ling', 'Hake']

/**
 * The species a dashboard should show: the pinned three, then this boat's own
 * biggest, then the measured fallback — never more than `size`.
 *
 * `landed` is [{ species, value, weight }] for the year to date. `basis` is
 * 'value' or 'volume', which is the toggle.
 *
 * THE PINNED THREE ARE NEVER DUPLICATED by a boat that also lands them, which
 * is the ordinary case — six of the seven real fleets have all three in their
 * own top six already.
 */
export function dashboardSpecies(landed = [], { basis = 'value', size = 6 } = {}) {
  const key = basis === 'volume' ? 'weight' : 'value'
  /* A DEFAULT PARAMETER ONLY CATCHES `undefined`, NOT `null`, and a failed
     query returns null. This is the front page: a boat opening the app on a
     bad connection would have got a white screen rather than the market panel,
     which is the one part of it that needs no data of her own at all. */
  const own = [...(Array.isArray(landed) ? landed : [])]
    .filter((r) => r && r.species && Number(r[key]) > 0)
    .sort((a, b) => Number(b[key]) - Number(a[key]))
    .map((r) => r.species)

  const out = [...PINNED]
  const push = (s) => { if (s && !out.includes(s) && out.length < size) out.push(s) }
  for (const s of own) push(s)
  /* Only where her own record cannot fill the room. A boat that has landed
     four species gets her four and then the measured ones, rather than a short
     panel — and a boat that has landed nothing gets the fallback outright. */
  for (const s of FALLBACK_EXTRAS) push(s)
  return out.slice(0, size)
}

/**
 * Where the extras came from, so the page can say so.
 *
 * A BOAT'S OWN TOP SPECIES AND A GENERAL GUESS MUST NOT READ ALIKE. Told that
 * these are "your biggest" when they are in fact what most boats land is the
 * quiet lie this codebase keeps refusing to tell.
 */
export function speciesBasis(landed = [], { basis = 'value', size = 6 } = {}) {
  const chosen = dashboardSpecies(landed, { basis, size })
  const key = basis === 'volume' ? 'weight' : 'value'
  const own = new Set((Array.isArray(landed) ? landed : [])
    .filter((r) => r && r.species && Number(r[key]) > 0).map((r) => r.species))
  return chosen.map((species) => ({
    species,
    from: PINNED.includes(species) ? 'pinned' : own.has(species) ? 'own' : 'typical',
  }))
}
